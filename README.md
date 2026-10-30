# API Contract Builder

Write API contracts page by page — description, mockups, endpoints, requests, and
responses — and export them to OpenAPI 3.1 and Markdown so frontend and backend engineers
can work in parallel.

> **Status:** early development. See [docs/PLAN.md](docs/PLAN.md) for the MVP plan and
> milestones.

## Run with Docker

```bash
docker build -t api-contract-builder:local .
docker run -d --name api-contract-builder \
  -p 127.0.0.1:3000:3000 \
  -v api-contract-builder-data:/data \
  api-contract-builder:local
```

Or with Docker Compose: `docker compose up -d --build`.

Then open <http://127.0.0.1:3000>. All data (the SQLite database and uploaded images) lives
in the volume mounted at `/data`, so it survives upgrades and container restarts.

A prebuilt image on Docker Hub will be available from the first release.

## Development

Requirements: Node.js 24+ and pnpm (the version is pinned in `package.json`).

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the API on <http://127.0.0.1:3000> and the app on
<http://localhost:5173> (Vite proxies `/api` to the API).

| Command            | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `pnpm dev`         | Start the API server (watch mode) and the Vite dev server       |
| `pnpm build`       | Build the client (`dist/client`) and the server (`dist/server`) |
| `pnpm start`       | Run the production build (app and API on one port)              |
| `pnpm test`        | Run unit and API tests (Vitest)                                 |
| `pnpm test:e2e`    | Build, then run browser tests (Playwright)                      |
| `pnpm typecheck`   | Type-check client and server (TypeScript 7)                     |
| `pnpm check`       | Lint, check formatting, and check import order with Biome       |
| `pnpm check:fix`   | Apply safe Biome fixes and format                               |
| `pnpm lint`        | Lint only                                                       |
| `pnpm format`      | Format only                                                     |
| `pnpm db:generate` | Generate a migration after changing `src/server/db/schema.ts`   |

Export tests compare against golden files in `test/golden/`. After an intended change to
the export, regenerate them with `UPDATE_GOLDEN=1 pnpm test` and review the diff.

Before the first `pnpm test:e2e`, install the test browser with
`pnpm exec playwright install chromium`. Browser tests run against the production build on
port 4100 with a throwaway data directory.

### Editor setup

Project settings for Zed (`.zed/settings.json`) and VS Code (`.vscode/settings.json`) make
Biome the formatter and run its safe fixes and import sorting on save.

**Zed** — install two extensions from `zed: extensions`:

- **Biome**: lint and format. It uses the Biome version from `node_modules`.
- **TypeScript Language Server** (`tsgo`): the native TypeScript 7 language server. The
  project settings pin it to the same TypeScript version as `package.json` and turn off
  Zed's default `vtsls` / `typescript-language-server`. When upgrading TypeScript, update
  `lsp.typescript-ls.settings.package_version` too.

**VS Code** — install the recommended
[Biome extension](https://biomejs.dev/guides/editors/first-party-extensions/). TypeScript 7
does not ship `tsserver.js`, so VS Code uses its own bundled TypeScript; `pnpm typecheck` is
the source of truth.

After adding a shadcn/ui component, run `pnpm check:fix` to bring it in line with the
project's lint and format rules.

### Configuration

| Variable        | Default                           | Description                             |
| --------------- | --------------------------------- | --------------------------------------- |
| `HOST`          | `127.0.0.1` (`0.0.0.0` in Docker) | Interface the server listens on         |
| `PORT`          | `3000`                            | Port the server listens on              |
| `DATA_DIR`      | `./data` (`/data` in Docker)      | SQLite database and uploaded images     |
| `MAX_UPLOAD_MB` | `10`                              | Largest mockup image accepted, per file |

### Project layout

```
src/client    React SPA (TanStack Router, TanStack Query, shadcn/ui)
src/server    Hono API and database (Drizzle + SQLite)
src/shared    Zod schemas shared by client and server
drizzle       SQL migrations, applied automatically on startup
```

`dependencies` in `package.json` holds only what the server needs at runtime. Everything
bundled into the client by Vite is a `devDependency`, which keeps the Docker image small.

## License

[MIT](LICENSE) © Regga
