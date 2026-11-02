// @ts-check

import { createHash } from "node:crypto";

const KMS_KEY_VERSION_PATTERN =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/;
const WORKLOAD_IDENTITY_PROVIDER_PATTERN =
  /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[^/]+\/providers\/[^/]+$/;

const CLOUD_KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Create a `createJwt` callback for `@octokit/auth-app` that signs the app JWT
 * with a Cloud KMS key instead of a private key held by the workflow.
 *
 * The action authenticates to Google Cloud itself: it exchanges the job's
 * GitHub OIDC token through Workload Identity Federation and keeps the
 * resulting credentials in memory, so later steps of the job can't use them.
 *
 * @param {object} options
 * @param {string} options.kmsKeyVersion
 * @param {string} options.workloadIdentityProvider
 * @param {string} options.serviceAccount
 * @param {string} options.quotaProject
 * @param {import("@actions/core")} options.core
 */
export function createKmsJwtSigner({
  kmsKeyVersion,
  workloadIdentityProvider,
  serviceAccount,
  quotaProject,
  core,
}) {
  if (!KMS_KEY_VERSION_PATTERN.test(kmsKeyVersion)) {
    throw new Error(
      "The 'kms-key-version' input must be a Cloud KMS key version resource name: 'projects/<project>/locations/<location>/keyRings/<key-ring>/cryptoKeys/<key>/cryptoKeyVersions/<version>'.",
    );
  }

  if (!WORKLOAD_IDENTITY_PROVIDER_PATTERN.test(workloadIdentityProvider)) {
    throw new Error(
      "The 'workload-identity-provider' input must be set to 'projects/<project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>' when using 'kms-key-version'.",
    );
  }

  /** @type {Promise<string> | undefined} */
  let accessTokenPromise;

  // Reuse one Google Cloud access token for every JWT this run signs. A failed
  // attempt is forgotten so that the token retry in `main` starts over.
  function getAccessToken() {
    accessTokenPromise ??= getGoogleCloudAccessToken(
      workloadIdentityProvider,
      serviceAccount,
      core,
    ).catch((error) => {
      accessTokenPromise = undefined;
      throw error;
    });

    return accessTokenPromise;
  }

  /**
   * @param {string | number} clientId
   * @param {number} [timeDifference]
   */
  return async function createJwt(clientId, timeDifference = 0) {
    // Same claims as universal-github-app-jwt: issued 30s in the past to
    // tolerate clock drift, valid for the 10 minute maximum.
    const issuedAt = Math.floor(Date.now() / 1000) + timeDifference - 30;
    const expiresAt = issuedAt + 60 * 10;

    const signingInput = [
      { alg: "RS256", typ: "JWT" },
      { iat: issuedAt, exp: expiresAt, iss: clientId },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".");

    const signature = await signWithKms(
      kmsKeyVersion,
      signingInput,
      await getAccessToken(),
      quotaProject,
    );
    const jwt = `${signingInput}.${signature}`;

    // The JWT can create installation tokens until it expires
    core.setSecret(jwt);

    return { jwt, expiresAt: new Date(expiresAt * 1000).toISOString() };
  };
}

/**
 * @param {string} workloadIdentityProvider
 * @param {string} serviceAccount
 * @param {import("@actions/core")} core
 */
async function getGoogleCloudAccessToken(
  workloadIdentityProvider,
  serviceAccount,
  core,
) {
  const oidcToken = await getGitHubOidcToken(
    `https://iam.googleapis.com/${workloadIdentityProvider}`,
    core,
  );

  // https://cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
  const stsResponse = await fetchJson("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${workloadIdentityProvider}`,
      // Impersonation needs a token for the IAM Credentials API; otherwise the
      // federated token only needs to reach Cloud KMS.
      scope: serviceAccount ? CLOUD_PLATFORM_SCOPE : CLOUD_KMS_SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: oidcToken,
    }),
  }, "exchange the GitHub OIDC token with Google Cloud STS");
  core.setSecret(stsResponse.access_token);

  if (!serviceAccount) {
    return stsResponse.access_token;
  }

  // https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
  const iamResponse = await fetchJson(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateAccessToken`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${stsResponse.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ scope: [CLOUD_KMS_SCOPE], lifetime: "300s" }),
    },
    `impersonate service account ${serviceAccount}`,
  );
  core.setSecret(iamResponse.accessToken);

  return iamResponse.accessToken;
}

/**
 * @param {string} audience
 * @param {import("@actions/core")} core
 */
async function getGitHubOidcToken(audience, core) {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

  if (!requestUrl || !requestToken) {
    throw new Error(
      "Unable to get a GitHub OIDC token. Grant the job the 'id-token: write' permission to use 'kms-key-version'.",
    );
  }

  const url = new URL(requestUrl);
  url.searchParams.set("audience", audience);

  const { value } = await fetchJson(
    url.href,
    { headers: { authorization: `Bearer ${requestToken}` } },
    "get a GitHub OIDC token",
  );
  core.setSecret(value);

  return value;
}

/**
 * @param {string} kmsKeyVersion
 * @param {string} signingInput
 * @param {string} accessToken
 * @param {string} quotaProject
 */
async function signWithKms(kmsKeyVersion, signingInput, accessToken, quotaProject) {
  /** @type {Record<string, string>} */
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
  if (quotaProject) {
    headers["x-goog-user-project"] = quotaProject;
  }

  // https://cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys.cryptoKeyVersions/asymmetricSign
  const response = await fetchJson(
    `https://cloudkms.googleapis.com/v1/${kmsKeyVersion}:asymmetricSign`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        digest: {
          sha256: createHash("sha256").update(signingInput).digest("base64"),
        },
      }),
    },
    "sign the GitHub App JWT with Cloud KMS",
  );

  // Cloud KMS echoes the key version it used; anything else means the request
  // was not handled as sent.
  if (response.name !== kmsKeyVersion || !response.signature) {
    throw new Error(
      `Cloud KMS returned an unexpected response for key version '${kmsKeyVersion}'.`,
    );
  }

  return Buffer.from(response.signature, "base64").toString("base64url");
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} action
 */
async function fetchJson(url, init, action) {
  const response = await fetch(url, init);

  if (!response.ok) {
    const error = new Error(
      `Failed to ${action}: ${response.status} ${await response.text()}`,
    );
    // Let the token retry in `main` retry server errors
    Object.assign(error, { status: response.status });
    throw error;
  }

  return response.json();
}
