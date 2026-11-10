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
cleanly, import the sample's project file as a copy that exports the same OpenAPI, import
the sample's OpenAPI document as a project that exports it again unchanged, keep its
data across a restart, ship only the SQLite binary for its platform, and have no shell or
package manager. Then Trivy scans the image, and CI fails on any high
or critical vulnerability that already has a fix. To check an image locally, including
one built for the other architecture:

```bash
docker build -t api-contract-builder:dev .
scripts/smoke-test-image.sh api-contract-builder:dev
docker build --platform linux/amd64 -t api-contract-builder:dev-amd64 .
scripts/smoke-test-image.sh api-contract-builder:dev-amd64 linux/amd64
```

The runtime image is distroless, so there's no shell to `docker exec` into: read
`docker logs`, or run Node in it, like
`docker exec <container> node -e "console.log(process.versions)"`.

### Golden files

The exports of the sample project are compared with files in `test/golden/`: the OpenAPI
document and the Markdown bundle. When you change an export on purpose, regenerate them
and **read the diff** before committing; it is the review of the change:

```bash
UPDATE_GOLDEN=1 pnpm test
git diff test/golden
```

`test/golden` is excluded from Biome so formatting never changes them.

`test/golden/inventory-markdown-without-states` is different: it's what 0.2.0 exported,
before page states, and the sample built without its states must still export exactly
that. Don't regenerate it to make a test pass; a change there means projects that don't
use states see a different export.

`test/golden/inventory.project.json` is the sample's project file, with its IDs renamed
in order (`model-1`, `page-1`, …) since every build makes new ones.

### Project files

`test/fixtures/project-file-v1` is a project file of format version 1, written by hand,
with every kind of reference. `test/fixtures/project-file-v1-zips` holds it zipped by real
tools (Finder's Compress, Info-ZIP with and without ZIP64, libarchive, Python). Like the
0.2.0 golden files, they never change: files from older versions must keep importing.
They're excluded from Biome for that reason.

To change what a project file holds, in `src/server/project-file/format.ts`:

1. raise `PROJECT_FILE_VERSION`;
2. add the upgrade from the version before to `UPGRADES`;
3. add a frozen fixture of the new version next to the old one;
4. regenerate the golden file.

A rule that gets stricter, so that data saved before it no longer passes, needs one of
two things. Either a repair in `repairEndpointFields` (or a function like it), which runs
where stored data is read and on imported files, or a new format version whose upgrade
does the repair. Otherwise older files stop importing. Upgrades get files from outside
before anything has checked them, so they must not trust their shape.

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
# Only some of them, so the others keep their bytes:
pnpm exec tsx scripts/render-sample-mockups.ts stock-list-empty
```

`src/server/export/prism-states.test.ts` sends the headers of every state of the sample
to Prism's HTTP server and checks the answer, so a state whose `Prefer` header doesn't
reproduce it fails there.

The README screenshots come from `scripts/take-screenshots.ts` (see the comment at the top
of the file for how to run it).

## Conventions

- **Shared rules live in `src/shared`** as Zod schemas, used by both the API and the forms,
  so the browser and the server agree on what's valid.
- **Model references** are stored as `model:<id>` and become `#/components/schemas/<Name>`
  only when shown as JSON or exported, so renaming a model never breaks a reference.
  Responses refer to error types by ID too.
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
so only the publishing jobs can read it. The environment allows `v*` tags (releases) and
the `main` branch (scheduled rebuilds), which keeps every other run away from the token.

### Weekly rebuilds

The Rebuild workflow (`.github/workflows/rebuild.yml`) runs every Monday. It compares the
base images recorded in the provenance of the published `X.Y` image with what their tags
point to now (`scripts/base-images.ts`). If one has moved, it rebuilds the latest release
from its tag, tests both platforms (smoke test and Trivy) before pushing, and publishes
`X.Y` and `latest` again; `X.Y.Z` stays as released. It never publishes over a newer
release. Run it by hand with `gh workflow run rebuild.yml`, adding `-f force=true` to
rebuild even when nothing has moved.

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
  project-file/ project files: the format, export, import, and the zip reader
  openapi-import/ OpenAPI documents into projects: reading JSON and YAML, references,
                schemas, the mapping, error types, and pages
  samples/      the sample project
src/shared      Zod schemas and pure helpers used by both sides
e2e/            Playwright browser tests
test/           fixtures shared by tests (images, zips, project files, OpenAPI documents)
                and golden files
drizzle/        SQL migrations
samples/        sample project assets (mockup images)
scripts/        maintenance scripts (mockups, screenshots, image smoke test, release notes,
                base-image check)
.github/        CI, release, and weekly rebuild workflows; Dependabot for their actions
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
