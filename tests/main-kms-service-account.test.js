import { KMS_ENV, mockKmsSign, mockOidcToken, mockStsToken } from "./kms.js";
import { test } from "./main.js";

// Verify `main` impersonates the service account when it is set, and bills the
// Cloud KMS requests to the quota project.
await test(
  (_mockPool, mockAgent) => {
    mockOidcToken(mockAgent);
    mockStsToken(mockAgent);
    mockAgent
      .get("https://iamcredentials.googleapis.com")
      .intercept({
        path: "/v1/projects/-/serviceAccounts/signer%40my-project.iam.gserviceaccount.com:generateAccessToken",
        method: "POST",
        headers: { authorization: "Bearer federated-access-token" },
      })
      .reply(
        200,
        { accessToken: "service-account-access-token", expireTime: "2026-01-01T00:05:00Z" },
        { headers: { "content-type": "application/json" } },
      );
    mockKmsSign(mockAgent, { accessToken: "service-account-access-token" });
  },
  {
    ...KMS_ENV,
    "INPUT_SERVICE-ACCOUNT": "signer@my-project.iam.gserviceaccount.com",
    "INPUT_QUOTA-PROJECT": "my-project",
  },
);
