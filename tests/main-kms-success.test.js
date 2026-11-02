import { KMS_ENV, mockKmsSign, mockOidcToken, mockStsToken } from "./kms.js";
import { test } from "./main.js";

// Verify `main` signs the app JWT with Cloud KMS, calling it with the federated
// token directly when no service account is set.
await test((_mockPool, mockAgent) => {
  mockOidcToken(mockAgent);
  mockStsToken(mockAgent);
  mockKmsSign(mockAgent);
}, KMS_ENV);
