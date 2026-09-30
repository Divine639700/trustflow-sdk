# Contributing to TrustFlow SDK

Thank you for contributing to TrustFlow SDK! This guide will help you set up your environment, understand our conventions, and submit a PR successfully.

## Getting Started

### Prerequisites

- **Node.js**: 20.x or 22.x (both are tested in CI)
  - Check your version: `node --version`
  - Install via [nodejs.org](https://nodejs.org/), Homebrew (`brew install node`), or nvm
  
- **npm**: 10.x or later (comes with Node.js)
  - Check your version: `npm --version`

### Initial Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/[your-username]/trustflow-sdk.git
   cd trustflow-sdk
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Verify setup** (all should pass)
   ```bash
   npm run typecheck
   npm run lint
   npm run test
   ```

## Development Workflow

### Available Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Build distribution files (`dist/`) |
| `npm run dev` | Watch mode for development |
| `npm run typecheck` | Type-check `src/` with TypeScript strict mode |
| `npm run typecheck:tests` | Type-check `tests/` (Jest doesn't type-check by default) |
| `npm run test` | Run Jest tests |
| `npm run test:coverage` | Run tests with coverage report (enforces global thresholds) |
| `npm run lint` | Run ESLint on `src/` |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check if code is formatted correctly |
| `npm run lint:strict` | Run ESLint with strict config (extra rules) |
| `npm run docs` | Generate HTML API documentation (outputs to `docs/reference/`) |
| `npm run docs:watch` | Watch mode for documentation |

### Before You Start

- Check if an issue already exists or create one first
- If assigned to you or claimed in an issue, great! If not, comment on the issue to express interest

### While Developing

1. **Create a feature branch**
   ```bash
   git checkout -b fix/[issue-number] # for bug fixes
   git checkout -b feature/[description] # for new features
   ```

2. **Write your code**
   - Follow TypeScript strict mode (no `any` types in public APIs)
   - Add JSDoc comments to all public functions
   - Keep changes focused on the issue; avoid unrelated refactoring

3. **Run checks before committing**
   ```bash
   npm run typecheck
   npm run lint
   npm run format:check
   npm run test
   ```

4. **Fix formatting and linting**
   ```bash
   npm run format
   npm run lint:fix
   ```

5. **Write or update tests**
   - New utilities: add tests in `tests/[feature].test.ts`
   - Bug fixes: add a test that reproduces the bug, then fix it
   - Tests live in `tests/*.test.ts` with helpers in `tests/support/`
   - Run a single test file: `npm run test -- tests/auth.test.ts`

6. **Update documentation**
   - Update `docs/API.md` if the public API changed
   - Update `docs/ARCHITECTURE.md` if module structure or patterns changed
   - Update README if user-facing features changed
   - JSDoc comments should include examples for complex functions

7. **Update CHANGELOG.md**
   - Add an entry under `[Unreleased]` section:
     ```markdown
     - Issue #299: Brief description of the change
     ```
   - Keep entries organized by feature area (Escrow, Auth, Wallet, etc.)
   - Format: `- Issue #[number]: [Description]`
   - Breaking changes go under `### ⚠️ Breaking Changes` and need a migration section in
     `docs/UPGRADING.md`; deprecate with a `@deprecated` JSDoc tag before removing. See
     [docs/VERSIONING.md](docs/VERSIONING.md) for what counts as breaking.

### Committing

- Write clear, descriptive commit messages
- Reference the issue number: `git commit -m "Fix escrow release validation (issue #299)"`
- Avoid `git commit --amend` on public branches; use new commits instead

### Before Submitting a PR

Run the full check suite:
```bash
npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:coverage
```

All must pass before opening a PR.

## Test Coverage

- Global coverage floor: statements/lines **60%**, functions **59%**, branches **50%**
- Coverage is enforced in CI (Node 22.x) — a PR that lowers coverage will fail CI
- **Ratchet plan**: When you add tests that *raise* coverage (e.g., escrow, hooks, contract bindings), raise the floor in the same PR until the 60% target is met, then add per-path thresholds for well-covered directories

### Running Tests

```bash
# Run all tests
npm run test

# Run with coverage report
npm run test:coverage

# Run a single test file
npm run test -- tests/auth.test.ts

# Run tests matching a pattern
npm run test -- --testNamePattern="wallet"

# Run in watch mode (for development)
npm run test -- --watch
```

## Code Style

### TypeScript

- **Strict mode**: No `any` types in public APIs
- **Exports**: All public functions must be explicitly exported from `src/index.ts` (or subpath `src/[feature]/index.ts`)
- **Documentation**: All public functions need JSDoc comments with:
  - Summary
  - `@param` for each parameter
  - `@returns` description
  - `@throws` if applicable
  - `@example` code block for complex functions

### Example Function

```typescript
/**
 * Creates a new escrow on the TrustFlow contract.
 *
 * Validates the amount and participants, then invokes the contract.
 * Returns a promise that rejects if the contract call fails.
 *
 * @param client - Configured TrustFlowClient
 * @param params - Escrow creation parameters
 * @returns A promise resolving to the newly created Escrow
 * @throws {TrustFlowError} VALIDATION_ERROR if parameters are invalid
 *
 * @example
 * ```typescript
 * const escrow = await createEscrow(client, {
 *   sender: 'GSENDER...',
 *   recipient: 'GRECIPIENT...',
 *   amountStroops: 100_000_000n,
 *   durationBlocks: 1000,
 * });
 * console.log('Created escrow:', escrow.id);
 * ```
 */
export async function createEscrow(
  client: TrustFlowClient,
  params: CreateEscrowParams,
): Promise<Escrow> {
  // implementation
}
```

### Linting & Formatting

- **ESLint**: Enforced in CI; run `npm run lint` locally
- **Prettier**: Code formatter; run `npm run format` before committing
- Prefer `npm run lint:fix` to auto-fix most issues

## Branch and Commit Conventions

### Branch Naming

- **Bug fixes**: `fix/issue-[number]` or `fix/[short-description]`
  - Example: `fix/issue-299` or `fix/wallet-connection-error`
  
- **Features**: `feature/[description]` or `feat/[description]`
  - Example: `feature/multi-sig-escrow` or `feat/auth-session-management`
  
- **Documentation**: `docs/[description]`
  - Example: `docs/architecture-guide`
  
- **Refactoring**: `refactor/[description]`
  - Example: `refactor/error-handling`

### Commit Messages

- Use imperative mood ("add feature" not "added feature")
- Reference issue numbers: "Fix wallet validation (issue #299)"
- Keep first line under 70 characters
- Example:
  ```
  Add session storage configuration (issue #300)

  - Implement configureSessionStorage() to override default backend
  - Support Node.js durability via custom adapters (file, Redis, etc.)
  - Add tests for custom adapter setup
  ```

## Submitting a Pull Request

1. **Push your branch**
   ```bash
   git push -u origin [your-branch-name]
   ```

2. **Create a PR** on GitHub with:
   - Clear title: `[COMPONENT] Brief description`
   - Description: What does this PR do? Why?
   - Linked issue: "Closes #299" to auto-close the issue
   - Checklist: Run through the PR template checklist

3. **Wait for review**
   - Maintainers will review within **3-5 days**
   - Respond to feedback and make requested changes
   - Push updates to the same branch; the PR will auto-update

4. **Approval and merge**
   - Once approved, a maintainer will merge your PR
   - Congratulations! Your contribution is part of the SDK

## Getting Listed in CONTRIBUTORS.md

To be added to the [CONTRIBUTORS.md](./CONTRIBUTORS.md) file:

1. After your first PR is merged, leave a comment on this issue or contact a maintainer
2. Provide:
   - Your GitHub username
   - Your name (as you'd like it listed)
   - Optional: a URL to your website or GitHub profile

We manually maintain the CONTRIBUTORS.md file to recognize all contributors.

## End-to-end tests
`npm test` never needs Docker or a network. The e2e suite (`tests/e2e/`) runs against a live Stellar network:

```bash
docker run --rm -d -p 8000:8000 --name stellar stellar/quickstart:latest --local
npm run test:e2e
docker stop stellar
```

The suite waits for Horizon, Soroban RPC (`getHealth`) and friendbot before starting, and funds its accounts through friendbot. Defaults match the quickstart container; override them to target another network (for example testnet):

| Variable | Default |
| --- | --- |
| `E2E_HORIZON_URL` | `http://localhost:8000` |
| `E2E_RPC_URL` | `http://localhost:8000/rpc` |
| `E2E_FRIENDBOT_URL` | `http://localhost:8000/friendbot` |
| `E2E_NETWORK_PASSPHRASE` | `Standalone Network ; February 2017` |

## Hook tests
Hook tests run under jsdom via `@testing-library/react`. CI runs them on React 18 and 19; locally, use `npm install --no-save react@19 react-dom@19 @types/react@19 @types/react-dom@19` to try React 19.

## Releasing
See [docs/RELEASING.md](docs/RELEASING.md).

## Questions?

- **Setup issues**: Check this guide again or open an issue labeled `question`
- **Code review feedback**: Feel free to ask for clarification in the PR
- **General questions**: Open an issue or start a discussion on GitHub

## Security

For security issues, please **do not** open a public issue. See [SECURITY.md](./SECURITY.md) for private reporting instructions.

---

Thanks for contributing! We appreciate your help making TrustFlow SDK better.
