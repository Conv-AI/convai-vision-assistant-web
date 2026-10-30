# Contributing

Thank you for helping improve Convai Vision Assistant for the web. This guide explains how to set
up the project, what a pull request needs, and how changes are merged.

By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Before you start

- For a bug, open an issue with the steps to reproduce it, unless one exists already.
- For a new feature or a larger change, open an issue first so we can agree on the approach before
  you write the code.
- Security problems are reported privately, as described in [SECURITY.md](SECURITY.md).

## Setting up

Follow [Get started](README.md#get-started) in the README. You need Node.js 22.18 or newer and
the pinned pnpm 10.17.1. Install the end-to-end test browser once:

```bash
pnpm exec playwright install chromium
```

On Linux, use `pnpm exec playwright install --with-deps chromium` to install the browser's system
libraries as well.

## Making a change

1. Fork the repository and create a branch from `main` in your fork, named after what it does, for
   example `fix/transcript-scroll` or `feat/region-share`.
2. Keep the change focused on one thing. Unrelated fixes go in their own pull request.
3. A change in behaviour comes with a test that fails without it. A bug fix starts with a test that
   reproduces the bug.
4. A change people will notice gets an entry under `[Unreleased]` in
   [CHANGELOG.md](CHANGELOG.md).
5. Never commit API keys, tokens or `.env.local`. Configuration goes in `.env.example`, with empty
   values.

## Checks

Run these before you open a pull request. CI runs the same checks and must pass before a pull
request is merged.

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm e2e --project=chromium
```

`pnpm format` fixes formatting for you. CI also checks the build: that it holds no server-only
value (`pnpm build`, then `pnpm check:bundle`, both with `CONVAI_API_KEY`
set to a stand-in value) and that its first load stays within the size budget
(`pnpm check:size`, after `pnpm build`), and it builds the Docker image.

### Browser tests

Playwright builds with `--mode e2e` to enable its fake transport. A normal `pnpm build` removes
the transport injection hook; publish only the normal production build. Browser tests use fake
media, require no API key, and do not replace a live voice and vision test.

Set `VA_E2E_PORT` to change the test server port, which defaults to 4173. To run the other desktop
engines, install them first:

```sh
pnpm exec playwright install firefox webkit
pnpm e2e --project=firefox
pnpm e2e --project=webkit
```

On Linux, add `--with-deps` to the installation command. `pnpm e2e` without a project selector runs
all three browser projects.

The Firefox and WebKit CI jobs run on Linux. Some Windows WebKit builds do not expose the media APIs
required by capture tests, so use the Linux jobs for the complete cross-browser matrix. The setup
and error-flow checks can be run separately with `pnpm e2e e2e/setup.spec.ts --project=webkit`.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<optional scope>): <summary in the imperative mood>
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci` and `chore`. Mark
a breaking change with `!` after the type, such as `feat!: …`, and explain it in the body.

## Pull requests

- Fill in the pull request template: what changed, why, and how you tested it.
- Add screenshots or a short recording for any change to the interface.
- Pull requests are squash-merged into `main`, so the pull request title becomes the commit
  message and must follow Conventional Commits too.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License, Version 2.0](LICENSE).
