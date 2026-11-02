// @ts-check

import * as core from "@actions/core";
import { createAppAuth } from "@octokit/auth-app";

import { getPermissionsFromInputs } from "./lib/get-permissions-from-inputs.js";
import { createKmsJwtSigner } from "./lib/kms.js";
import { main } from "./lib/main.js";
import request, { ensureNativeProxySupport } from "./lib/request.js";

if (!process.env.GITHUB_REPOSITORY) {
  throw new Error("GITHUB_REPOSITORY missing, must be set to '<owner>/<repo>'");
}

if (!process.env.GITHUB_REPOSITORY_OWNER) {
  throw new Error("GITHUB_REPOSITORY_OWNER missing, must be set to '<owner>'");
}

async function run() {
  ensureNativeProxySupport();

  const clientId = core.getInput("client-id") || core.getInput("app-id");
  if (!clientId) {
    throw new Error("The 'client-id' (or deprecated 'app-id') input must be set to a non-empty string. If using a secret or variable, ensure it is available in this workflow context.");
  }
  const privateKey = core.getInput("private-key");
  const kmsKeyVersion = core.getInput("kms-key-version");
  if (privateKey && kmsKeyVersion) {
    throw new Error("The 'private-key' and 'kms-key-version' inputs cannot be used together.");
  }
  if (!privateKey && !kmsKeyVersion) {
    throw new Error("The 'private-key' or 'kms-key-version' input must be set to a non-empty string. If using a secret or variable, ensure it is available in this workflow context.");
  }
  const signingOptions = privateKey
    ? { privateKey }
    : {
        createJwt: createKmsJwtSigner({
          kmsKeyVersion,
          workloadIdentityProvider: core.getInput("workload-identity-provider"),
          serviceAccount: core.getInput("service-account"),
          quotaProject: core.getInput("quota-project"),
          core,
        }),
      };
  const enterprise = core.getInput("enterprise");
  const owner = core.getInput("owner");
  const repositories = core
    .getInput("repositories")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((x) => x !== "");

  const skipTokenRevoke = core.getBooleanInput("skip-token-revoke");

  const permissions = getPermissionsFromInputs(process.env);

  return main(
    clientId,
    signingOptions,
    enterprise,
    owner,
    repositories,
    permissions,
    core,
    createAppAuth,
    request,
    skipTokenRevoke,
  );
}

// Export promise for testing
export default run().catch((error) => {
  /* c8 ignore next 3 */
  console.error(error);
  core.setFailed(error.message);
});
