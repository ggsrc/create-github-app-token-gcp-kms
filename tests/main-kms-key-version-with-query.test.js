import { KMS_ENV, KMS_KEY_VERSION } from "./kms.js";

for (const [key, value] of Object.entries({
  ...KMS_ENV,
  "INPUT_KMS-KEY-VERSION": `${KMS_KEY_VERSION}?alt=media`,
})) {
  process.env[key] = value;
}

// Log only the error message, not the full stack trace, because the stack
// trace contains environment-specific paths and ANSI codes that differ
// between local and CI environments.
const _error = console.error;
console.error = (err) => _error(err?.message ?? err);

// Verify `main` rejects a `kms-key-version` that would change the request URL.
const { default: promise } = await import("../main.js");
await promise;
process.exitCode = 0;
