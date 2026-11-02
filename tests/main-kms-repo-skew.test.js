import { KMS_ENV, mockKmsSign, mockOidcToken, mockStsToken } from "./kms.js";
import { test } from "./main.js";

// Verify `main` re-signs the JWT with Cloud KMS, shifted by the server's clock,
// when GitHub rejects the first one because the runner's clock is behind.
await test(
  (mockPool, mockAgent) => {
    process.env.INPUT_OWNER = "actions";
    process.env.INPUT_REPOSITORIES = "failed-repo";
    const now = Math.floor(Date.now() / 1000);

    mockOidcToken(mockAgent);
    mockStsToken(mockAgent);
    // The rejected JWT, its replacement, and the JWT for the token request
    mockKmsSign(mockAgent, { times: 3 });

    mockPool
      .intercept({
        path: "/repos/actions/failed-repo/installation",
        method: "GET",
      })
      .reply(({ headers }) => {
        const [_, jwt] = (headers.authorization || "").split(" ");
        const payload = JSON.parse(
          Buffer.from(jwt.split(".")[1], "base64url").toString(),
        );

        if (payload.iat < now) {
          return {
            statusCode: 401,
            data: {
              message:
                "'Issued at' claim ('iat') must be an Integer representing the time that the assertion was issued.",
            },
            responseOptions: {
              headers: {
                "content-type": "application/json",
                date: new Date((now + 30) * 1000).toUTCString(),
              },
            },
          };
        }

        return {
          statusCode: 200,
          data: { id: "123456", app_slug: "github-actions" },
          responseOptions: {
            headers: { "content-type": "application/json" },
          },
        };
      })
      .times(2);
  },
  KMS_ENV,
);
