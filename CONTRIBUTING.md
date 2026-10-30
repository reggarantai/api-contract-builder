# Contributing

Thanks for helping. This guide covers the setup, how changes are made and tested, and the
conventions the code follows. The plan and the reasoning behind past decisions are in
[docs/PLAN.md](docs/PLAN.md).

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
fixture for export tests. Its mockups are rendered from HTML by
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
scripts/        maintenance scripts (mockups, screenshots)
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
