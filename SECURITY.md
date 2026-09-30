# Security Policy

## Reporting Security Issues

TrustFlow SDK is financial transaction software. Security is critical. Please report security vulnerabilities responsibly.

### Private Reporting

**Do not open public GitHub issues for security vulnerabilities.** Instead:

1. Email **security@trustflow.xyz** with:
   - Vulnerability description
   - Affected SDK version(s)
   - Steps to reproduce (if possible)
   - Proof of concept or exploit code
   - Potential impact (severity)
   - Your contact information and preferred communication method

2. Allow the maintainers **at least 90 days** to investigate, patch, and prepare a release before public disclosure.

3. Once a patch is released, coordinate your public disclosure with the maintainers.

### GitHub Private Vulnerability Reporting

If you prefer, you can also report via GitHub's private vulnerability reporting feature:
1. Navigate to the [Security tab](https://github.com/trustflow-protocol/trustflow-sdk/security)
2. Click "Report a vulnerability"
3. Fill in the vulnerability details

Both channels are monitored and we aim to respond within **7 days**.

## Scope

This security policy applies to:

- **In scope:**
  - Signing and key handling code (`src/wallet/`, signature validation in `src/auth/`)
  - Cryptographic operations and their use of `@stellar/stellar-sdk`
  - XDR encoding/decoding in `src/contract/build.ts` and contract interaction
  - Session token storage and retrieval (`src/auth/session.ts`)
  - Validation logic for user inputs (`src/utils/validation.ts`)
  - Dependencies: any vulnerability in direct or transitive dependencies

- **Out of scope:**
  - Vulnerabilities in the Stellar network, Soroban runtime, or Horizon/RPC servers
  - Social engineering or phishing
  - Physical security
  - Vulnerabilities in your own application's integration of the SDK
  - DoS attacks not specific to this SDK

## Supported Versions

**Current release:** 0.2.1

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅ Yes    |
| 0.1.x   | ✅ Yes    |
| < 0.1.x | ❌ No     |

Security patches are applied to supported versions only. Users are encouraged to upgrade regularly.

## Security Best Practices for SDK Users

1. **Validate all external input** — Use the exported Zod schemas (`StellarAddressSchema`, `ContractIdSchema`, etc.) before passing to SDK functions
2. **Protect private keys** — Never embed secret keys in source code; use environment variables or secure key management
3. **Verify contract IDs** — Always use a contractId from a trusted source (e.g., official docs or a trusted registry)
4. **Session token protection** — Treat session tokens like passwords; use HTTPS, secure cookies (`HttpOnly`, `Secure` flags), and clear on logout
5. **Update regularly** — Keep the SDK and its dependencies up to date
6. **Review dependencies** — Use `npm audit` and consider `npm ci` with a `package-lock.json` to prevent accidental dependency updates
7. **Test error handling** — Ensure your application handles all three error patterns (thrown, SDKResult, PipelineResult) correctly

## Expected Response Time

- **Critical** (e.g. signing bypass, key leak): Response within **24 hours**; patch release within **3 days**
- **High** (e.g. unauthorized transaction): Response within **3 days**; patch release within **7 days**
- **Medium** (e.g. validation bypass): Response within **7 days**; patch release within **14 days**
- **Low** (e.g. denial of service): Response within **14 days**; patch release at next regular release

## Dependency Management

The SDK uses `npm ci` for deterministic builds. Dependencies are pinned to exact versions in `package-lock.json`.

### Transitive Dependencies

The main direct dependencies are:
- `@stellar/stellar-sdk` — Stellar JavaScript SDK (cryptography, XDR, Soroban RPC)
- `axios` + `axios-retry` — HTTP client for backend API
- `zod` — Runtime schema validation
- `react` (peer dependency, optional) — React integration

If a vulnerability is disclosed in any transitive dependency, we will:
1. Assess the impact on this SDK
2. Prepare a patch (bump the dependency or patch the SDK if needed)
3. Release a new version with notes in the CHANGELOG
4. Notify users via a GitHub Security Advisory

## Contacts

- **Security issues:** security@trustflow.xyz
- **Maintainers:** See [CONTRIBUTORS.md](./CONTRIBUTORS.md)
- **GitHub Issues:** For non-security bugs and feature requests only: https://github.com/trustflow-protocol/trustflow-sdk/issues

---

Thank you for helping keep TrustFlow Protocol secure.
