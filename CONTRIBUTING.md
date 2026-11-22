# Contributing

## Commits and pull requests

- Work on a branch and open a pull request into `main`.
- **PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/)**:
  `type(optional-scope): lowercase subject`, for example `feat(physics): add hailstorm disaster`.
  Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`.
  Use `!` after the type or scope for breaking changes (`feat(types)!: ...`).
  The `PR title` CI check enforces this.
- **PRs are squash-merged.** The squash commit uses the PR title as its subject, so `main` history is
  one Conventional Commit per PR. Individual commits on a branch can be messy; only the title matters.
- Before opening a PR run `npm run format`, `npm run lint`, `npm run build` and `npm test`.
  CI runs `npm run format:check`, `npm run lint`, `npm run build` and `npm test` on every PR.

## Repository settings (one-time, by an admin)

Settings > General > Pull Requests:

- Allow squash merging: on. Default commit message: "Pull request title and description"
  (title: "Pull request title").
- Allow merge commits: off. Allow rebase merging: off.
- Automatically delete head branches: on.

Optionally require the `build` and `Conventional Commits title` checks via a branch ruleset on `main`.
