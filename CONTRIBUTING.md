# Contributing to WebSocket DevTools

Thanks for helping improve WebSocket DevTools.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Keep changes focused on one problem or feature.
- For larger behavior or UI changes, open an issue first so the approach can be discussed.

## Local Setup

Install Node.js and pnpm versions compatible with [`package.json`](./package.json), then run:

```bash
pnpm install --frozen-lockfile
pnpm test
```

For extension code changes, also create a production build and load `dist/` as an unpacked extension in Chrome or Edge:

```bash
pnpm build
```

## Pull Requests

- Explain the problem and the chosen solution.
- Add or update tests when behavior changes.
- Include screenshots or a short recording for visible UI changes.
- Confirm generated locale files are up to date when translation sources change.
- Keep unrelated formatting or refactoring out of the pull request.

Maintainers may ask for changes or add a small follow-up commit before merging.
