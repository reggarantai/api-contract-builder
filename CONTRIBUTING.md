# Contributing

Thanks for helping. This guide covers the setup, how changes are made and tested, and the
conventions the code follows. How the app is built, and the reasoning behind its design,
is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Setup

Requirements: Node.js 24+ and pnpm (the version is pinned in `package.json`).

```bash
pnpm install
pnpm exec playwright install chromium   # once, for browser tests
pnpm dev
```

`pnpm dev` starts the API on <http://127.0.0.1:3000> and the app on
<http://localhost:5173>; Vite proxies `/api` and `/uploads` to the API. Data goes to
`./data`.

| Command            | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `pnpm dev`         | Start the API server (watch mode) and the Vite dev server       |
| `pnpm build`       | Build the client (`dist/client`) and the server (`dist/server`) |
| `pnpm start`       | Run the production build (app and API on one port)              |
| `pnpm test`        | Run unit and API tests (Vitest)                                 |
| `pnpm test:e2e`    | Build, then run browser tests (Playwright)                      |
| `pnpm typecheck`   | Type-check client, server, and tests (TypeScript 7)             |
| `pnpm check`       | Lint, check formatting, and check import order with Biome       |
| `pnpm check:fix`   | Apply safe Biome fixes and format                               |
| `pnpm db:generate` | Generate a migration after changing `src/server/db/schema.ts`   |

## How changes are made

**Test first.** Write the test that describes the change, see it fail for the right
reason, then write the code that makes it pass, then tidy up while it stays green.

- Rules and pure functions (`src/shared`, export builders): Vitest unit tests next to the
  code (`*.test.ts`).
- API routes: Vitest tests that call the app in process with a fresh database
  (`createTestApp` in `src/server/test-utils.ts`).
- Anything a person does in the browser: Playwright specs in `e2e/`. They run against the
  production build with a throwaway database, in parallel, so each test creates its own
  data with unique names (`uniqueName` in `e2e/helpers.ts`).

Before opening a pull request, run everything:

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm test:e2e
```

CI (`.github/workflows/ci.yml`) runs the same on every push to `main` and every pull
request, and also builds the Docker image and runs `scripts/smoke-test-image.sh` on it:
the container must turn healthy, run as a non-root user, export the sample project
cleanly, keep its data across a restart, and ship only the SQLite binary for its platform.
To check an image locally, including one built for the other architecture:

```bash
docker build -t api-contract-builder:dev .
scripts/smoke-test-image.sh api-contract-builder:dev
docker build --platform linux/amd64 -t api-contract-builder:dev-amd64 .
scripts/smoke-test-image.sh api-contract-builder:dev-amd64 linux/amd64
```

### Golden files

The exports of the sample project are compared with files in `test/golden/`: the OpenAPI
document and the Markdown bundle. When you change an export on purpose, regenerate them
and **read the diff** before committing; it is the review of the change:

```bash
UPDATE_GOLDEN=1 pnpm test
git diff test/golden
```

`test/golden` is excluded from Biome so formatting never changes them.

### The sample project

`src/server/samples/inventory.ts` builds the sample through the API, so it doubles as the
fixture for export tests. It's meant to show a production contract: the conventions in its
project description are checked on every operation by `src/server/routes/samples.test.ts`,
so a new endpoint that breaks one fails there, and
`src/client/features/schema-editor/sample-schemas.test.ts` checks that the builder can edit
every schema in it. Its mockups are rendered from HTML by
`scripts/render-sample-mockups.ts` into `samples/mockups/`:

```bash
pnpm exec tsx scripts/render-sample-mockups.ts
```

The README screenshots come from `scripts/take-screenshots.ts` (see the comment at the top
of the file for how to run it).

## Conventions

- **Shared rules live in `src/shared`** as Zod schemas, used by both the API and the forms,
  so the browser and the server agree on what's valid.
- **Model references** are stored as `model:<id>` and become `#/components/schemas/<Name>`
  only when shown as JSON or exported, so renaming a model never breaks a reference.
- **Database changes**: edit `src/server/db/schema.ts`, run `pnpm db:generate`, and commit
  the SQL in `drizzle/`. Migrations run on startup.
- **Dependencies**: `dependencies` holds only what the server needs at runtime; anything
  bundled into the client by Vite is a `devDependency`. That keeps the Docker image small.
- **UI text is English** and short. Buttons say what they do ("Create endpoint", not
  "Submit").
- **Formatting and lint** come from Biome. Run `pnpm check:fix` after adding a shadcn/ui
  component to bring it in line.
- **Commits**: a short imperative summary line, then what changed and why.

## Releasing

1. Set `version` in `package.json`, and add a `## [X.Y.Z] - YYYY-MM-DD` section to
   `CHANGELOG.md`.
2. Commit, then push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The Release workflow (`.github/workflows/release.yml`) then:

- runs CI, and checks that the tag matches `package.json`;
- builds the image for `linux/amd64` and `linux/arm64`, and pushes `X.Y.Z`, `X.Y`, and
  `latest` to Docker Hub (`reggarantai/api-contract-builder`), with provenance and an SBOM;
- smoke-tests the published image on both platforms;
- creates the GitHub release from the changelog section.

It needs a Docker Hub access token with Read & Write access, saved as the
`DOCKERHUB_TOKEN` secret of the `DOCKERHUB_TOKEN` environment (Settings → Environments),
so only the publishing job can read it. Allowing only `v*` tags to deploy to that
environment keeps every other run away from the token.

The image's build stages run on the build machine's own platform, because no dependency is
compiled; only the last stage is assembled per platform, so building for arm64 on an amd64
runner needs almost no emulation. If you add a dependency with a native binary, the smoke
test fails until the Dockerfile keeps the right binary for each platform.

## Project layout

```
src/client      React SPA (TanStack Router and Query, shadcn/ui)
  features/     one folder per area: projects, models, endpoints, pages, export, …
  routes/       file-based routes
src/server      Hono API and SQLite (Drizzle)
  routes/       API routes and their tests
  export/       OpenAPI and Markdown builders
  samples/      the sample project
src/shared      Zod schemas and pure helpers used by both sides
e2e/            Playwright browser tests
test/           fixtures shared by tests (images) and golden files
drizzle/        SQL migrations
samples/        sample project assets (mockup images)
scripts/        maintenance scripts (mockups, screenshots, image smoke test, release notes)
.github/        CI and release workflows, Dependabot for the workflows' actions
```

## Editor setup

Project settings for Zed (`.zed/settings.json`) and VS Code (`.vscode/settings.json`) make
Biome the formatter and run its safe fixes and import sorting on save.

**Zed**: install the **Biome** and **TypeScript Language Server** (`tsgo`) extensions. The
project settings pin `tsgo` to the TypeScript version in `package.json` and turn off Zed's
default TypeScript servers. When upgrading TypeScript, update
`lsp.typescript-ls.settings.package_version` too.

**VS Code**: install the recommended
[Biome extension](https://biomejs.dev/guides/editors/first-party-extensions/). TypeScript 7
doesn't ship `tsserver.js`, so VS Code uses its own bundled TypeScript; `pnpm typecheck` is
the source of truth.
