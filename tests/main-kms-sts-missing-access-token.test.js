import { KMS_ENV, mockOidcToken } from "./kms.js";
import { test } from "./main.js";

// Verify `main` fails with a clear message, instead of signing with an
// undefined token, when Google Cloud STS answers without an access token.
await test((_mockPool, mockAgent) => {
  mockOidcToken(mockAgent);
  mockAgent
    .get("https://sts.googleapis.com")
    .intercept({ path: "/v1/token", method: "POST" })
    .reply(
      200,
      { token_type: "Bearer" },
      { headers: { "content-type": "application/json" } },
    );
}, KMS_ENV);
