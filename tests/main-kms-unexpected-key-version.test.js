import { KMS_ENV, mockKmsSign, mockOidcToken, mockStsToken } from "./kms.js";
import { test } from "./main.js";

// Verify `main` rejects a Cloud KMS response for a different key version.
await test((_mockPool, mockAgent) => {
  mockOidcToken(mockAgent);
  mockStsToken(mockAgent);
  mockKmsSign(mockAgent, {
    name: "projects/my-project/locations/global/keyRings/github-apps/cryptoKeys/other-app/cryptoKeyVersions/1",
    times: 1,
  });
}, KMS_ENV);
