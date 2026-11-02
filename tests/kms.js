// Base for `main` tests that sign the app JWT with Cloud KMS.
// @ts-check
import { mock } from "node:test";

import { DEFAULT_ENV } from "./main.js";

// Pin the clock so the JWT claims, and therefore the KMS digest, are stable
// across runs.
mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1) });

export const KMS_KEY_VERSION =
  "projects/my-project/locations/global/keyRings/github-apps/cryptoKeys/my-app/cryptoKeyVersions/1";

export const KMS_ENV = {
  ...DEFAULT_ENV,
  "INPUT_PRIVATE-KEY": "",
  "INPUT_KMS-KEY-VERSION": KMS_KEY_VERSION,
  "INPUT_WORKLOAD-IDENTITY-PROVIDER":
    "projects/123456789/locations/global/workloadIdentityPools/github/providers/github",
  "INPUT_SERVICE-ACCOUNT": "",
  "INPUT_QUOTA-PROJECT": "",
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://pipelines.actions.githubusercontent.com/oidc/token?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-token",
};

/**
 * Mock the GitHub OIDC token endpoint.
 *
 * @param {import("undici").MockAgent} mockAgent
 */
export function mockOidcToken(mockAgent) {
  mockAgent
    .get("https://pipelines.actions.githubusercontent.com")
    .intercept({
      // The audience must be the provider's full resource URL for STS to accept the token
      path: `/oidc/token?api-version=2.0&audience=${encodeURIComponent(
        `https://iam.googleapis.com/${KMS_ENV["INPUT_WORKLOAD-IDENTITY-PROVIDER"]}`,
      )}`,
      method: "GET",
      headers: { authorization: "Bearer oidc-request-token" },
    })
    .reply(
      200,
      { value: "github-oidc-token" },
      { headers: { "content-type": "application/json" } },
    );
}

/**
 * Mock the Google Cloud STS token exchange.
 *
 * @param {import("undici").MockAgent} mockAgent
 * @param {number} [status]
 */
export function mockStsToken(mockAgent, status = 200) {
  mockAgent
    .get("https://sts.googleapis.com")
    .intercept({ path: "/v1/token", method: "POST" })
    .reply(
      status,
      status === 200
        ? { access_token: "federated-access-token", token_type: "Bearer" }
        : { error: "temporarily_unavailable" },
      { headers: { "content-type": "application/json" } },
    );
}

/**
 * Mock Cloud KMS signing. The action signs one JWT per GitHub request.
 *
 * @param {import("undici").MockAgent} mockAgent
 * @param {object} [options]
 * @param {string} [options.accessToken]
 * @param {string} [options.name]
 * @param {number} [options.times]
 */
export function mockKmsSign(
  mockAgent,
  { accessToken = "federated-access-token", name = KMS_KEY_VERSION, times = 2 } = {},
) {
  mockAgent
    .get("https://cloudkms.googleapis.com")
    .intercept({
      path: `/v1/${KMS_KEY_VERSION}:asymmetricSign`,
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    })
    .reply(
      200,
      { name, signature: Buffer.from("kms-signature").toString("base64") },
      { headers: { "content-type": "application/json" } },
    )
    .times(times);
}
