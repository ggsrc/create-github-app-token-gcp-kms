import { KMS_ENV, mockKmsSign, mockOidcToken, mockStsToken } from "./kms.js";
import { test } from "./main.js";

// Verify a Google Cloud server error is retried from the OIDC token onwards.
await test((_mockPool, mockAgent) => {
  mockOidcToken(mockAgent);
  mockStsToken(mockAgent, 503);
  mockOidcToken(mockAgent);
  mockStsToken(mockAgent);
  mockKmsSign(mockAgent);
}, KMS_ENV);
