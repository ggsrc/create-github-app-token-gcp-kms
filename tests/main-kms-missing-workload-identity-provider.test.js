import { KMS_ENV } from "./kms.js";

for (const [key, value] of Object.entries({
  ...KMS_ENV,
  "INPUT_WORKLOAD-IDENTITY-PROVIDER": "",
})) {
  process.env[key] = value;
}

// Log only the error message, not the full stack trace, because the stack
// trace contains environment-specific paths and ANSI codes that differ
// between local and CI environments.
const _error = console.error;
console.error = (err) => _error(err?.message ?? err);

// Verify `main` exits with an error when `kms-key-version` is set without `workload-identity-provider`.
const { default: promise } = await import("../main.js");
await promise;
process.exitCode = 0;
