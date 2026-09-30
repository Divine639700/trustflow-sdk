# Pull Request

## Description

What does this PR do? Describe the changes clearly.

## Linked Issue

Closes #[issue number]

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change — see `docs/VERSIONING.md`; add a `### ⚠️ Breaking Changes` changelog entry and a `docs/UPGRADING.md` section)
- [ ] Documentation update
- [ ] Dependency update
- [ ] Refactor (no functional changes)

## Checklist

### Code Quality
- [ ] TypeScript strict mode: no `any` types in public APIs
- [ ] All public functions have JSDoc comments
- [ ] Code follows the project's style (run `npm run format:check` to verify)
- [ ] Linting passes: `npm run lint`
- [ ] Type checking passes: `npm run typecheck` (and `npm run typecheck:tests` if tests were modified)

### Testing
- [ ] Tests added or updated for new/changed functionality
- [ ] Tests pass: `npm run test`
- [ ] Test coverage maintained or improved (run `npm run test:coverage` to check)
- [ ] No unrelated test changes

### Documentation
- [ ] `CHANGELOG.md` updated with entry under `[Unreleased]` section, formatted as:
  ```markdown
  - Issue #[number]: Brief description of change
  ```
- [ ] README updated if user-facing features changed
- [ ] API documentation (`docs/API.md`) updated if public API changed
- [ ] Architecture documentation (`docs/ARCHITECTURE.md`) updated if module structure/patterns changed
- [ ] JSDoc comments are clear and include examples for complex functions

### General
- [ ] No console.log() or debug code left behind
- [ ] No unrelated files committed
- [ ] Branch follows convention: `fix/[issue-number]` or `feature/[description]`
- [ ] Commit messages are descriptive and reference issue numbers where applicable

## Notes

Any additional notes for reviewers? (e.g., known limitations, future improvements, testing instructions)

## Screenshots (if applicable)

Include screenshots or GIFs for UI changes or visual updates.
