# API Contract Builder — MVP Plan

A self-hosted tool for writing API contracts **organized by page** (Login, Registration,
Stock List, Create Schedule, …) that every stakeholder can read, and that export to
standard formats so Frontend and Backend engineers can work in parallel.

## 1. Goals and non-goals

**Goals (MVP)**

- Author API contracts per page: description, acceptance criteria, mockup images, and the
  endpoints the page uses.
- Endpoints and models are defined once per project and reused across pages.
- Export to **OpenAPI 3.1** (YAML/JSON) and **Markdown (.zip with images)**.
- Exported OpenAPI is mock-ready, so FE can run a mock server from it (e.g. Prism).
- Multiple independent projects in one instance.
- Distributed as a Docker image on Docker Hub; runs locally.

**Non-goals (MVP)**

- Authentication, multiple users, comments.
- Built-in mock server (FE mocks from the exported OpenAPI instead).
- GraphQL / WebSocket (REST only).
- Figma integration (image uploads only).
- Hosted / SaaS deployment.

## 2. Decisions

| Topic        | Decision                                                          |
| ------------ | ----------------------------------------------------------------- |
| Deployment   | Open-source, self-hosted, runs locally (bound to `127.0.0.1`)     |
| Users        | Single contract author, no login                                  |
| Projects     | Multiple projects per instance, fully isolated                    |
| Storage      | Database (SQLite), images on local disk                           |
| API style    | REST only                                                         |
| Mockups      | Multiple image uploads per page                                   |
| Exports      | OpenAPI 3.1 (YAML/JSON), Markdown (.zip with images)              |
| Mocking      | Not built in — FE uses the exported OpenAPI with Prism or similar |
| UI language  | English                                                           |
| Stack        | TypeScript, React + Vite (SPA), Hono, SQLite + Drizzle            |
| Distribution | Multi-arch Docker image on Docker Hub                             |
| License      | MIT                                                               |

## 3. Core concepts

```
Project
 ├─ Settings    servers per environment, API version, auth schemes
 ├─ Models      reusable schemas (User, Stock, Schedule, …)
 ├─ Endpoints   first-class, reusable (POST /auth/login, GET /stocks, …)
 └─ Pages
     └─ Login
         ├─ Description, acceptance criteria (Markdown)
         ├─ Mockups (multiple images, ordered, with captions)
         └─ Endpoint usages
              • POST /auth/login   trigger: on submit
              • GET  /me           trigger: on load
```

Key design rules:

- **Endpoints belong to the project, not to a page.** Pages reference endpoints
  (many-to-many) with a trigger and a note. An endpoint like `GET /me` is defined once and
  used by many pages.
- **Schemas are stored as JSON Schema 2020-12** (the dialect used by OpenAPI 3.1), so the
  OpenAPI export is lossless. The schema builder UI edits this JSON Schema directly.
- **Model references are stored by model ID** internally (e.g. `{"$ref": "model:<id>"}`) so
  renaming a model never breaks references. They are resolved to
  `#/components/schemas/<Name>` on export.
- **Response examples are named** (e.g. `success`, `locked-account`) so mock tools can
  select a scenario.

## 4. Database schema (SQLite)

IDs are ULIDs (text). All tables have `created_at` / `updated_at`.

| Table                | Columns                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`           | `id`, `name`, `slug` (unique), `description`, `api_version`, `servers` (JSON: `[{name, url, description}]`), `security_schemes` (JSON), `default_security` (JSON)                                                                                                                                                                                                                                                                |
| `models`             | `id`, `project_id`, `name` (unique per project), `description`, `schema` (JSON Schema)                                                                                                                                                                                                                                                                                                                                           |
| `endpoints`          | `id`, `project_id`, `method`, `path` (e.g. `/stocks/{id}`), `operation_id`, `summary`, `description`, `security` (inherit / none / explicit), `status` (`draft` \| `review` \| `agreed`), `deprecated`, `notes_fe`, `notes_be`, `parameters` (JSON: `[{name, in, required, description, schema, example}]`), `request_body` (JSON: `{required, content_type, schema, examples}`, nullable) — unique `(project_id, method, path)` |
| `endpoint_responses` | `id`, `endpoint_id`, `status_code`, `description`, `content_type` (nullable, e.g. for 204), `schema` (JSON), `examples` (JSON: `[{name, summary, value}]`), `sort_order`                                                                                                                                                                                                                                                         |
| `pages`              | `id`, `project_id`, `name`, `slug`, `description_md`, `acceptance_criteria_md`, `sort_order`                                                                                                                                                                                                                                                                                                                                     |
| `page_mockups`       | `id`, `page_id`, `file_name`, `original_name`, `mime_type`, `width`, `height`, `caption`, `sort_order`                                                                                                                                                                                                                                                                                                                           |
| `page_endpoints`     | `id`, `page_id`, `endpoint_id`, `trigger` (`on_load` \| `on_submit` \| `on_action` \| `other`), `note`, `sort_order`                                                                                                                                                                                                                                                                                                             |

Deleting a project cascades to everything it owns, including its uploaded images.

## 5. Exports

### 5.1 OpenAPI 3.1 (YAML / JSON)

Scope: whole project, or a single page (only the endpoints that page uses, plus the models
they reference transitively).

| App concept               | OpenAPI 3.1                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| Project                   | `info` (title, version, description), `servers`                            |
| Auth schemes              | `components.securitySchemes`, top-level `security`                         |
| Model                     | `components.schemas.<Name>`                                                |
| Endpoint                  | `paths.<path>.<method>`                                                    |
| Page                      | `tags` (one per page; an endpoint used by several pages gets several tags) |
| Page usage of an endpoint | `x-pages: [{page, trigger, note}]` on the operation                        |
| Endpoint status / notes   | `x-status`, `x-notes-fe`, `x-notes-be`                                     |
| Named examples            | `content.<type>.examples.<name>`                                           |

Mockup images are not included in OpenAPI (they live in the Markdown export).

Before download, the export runs:

1. **Lint (warnings shown in the UI):**
   - responses with a body but no example;
   - `{param}` in the path that has no matching path parameter, or the reverse;
   - endpoints not used by any page;
   - unused models.
2. **Validation** against the OpenAPI 3.1 spec. An invalid document is an error, not a
   warning.

### 5.2 Markdown (.zip)

Scope: whole project, or a single page.

```
<project-slug>-contract.zip
├─ README.md          overview, servers, auth, page index, endpoint index, how to mock
├─ models.md          all models, rendered as field tables
├─ pages/
│  ├─ login.md
│  └─ stock-list.md
└─ images/
   └─ login/
      ├─ 01-login-form.png
      └─ 02-login-error.png
```

Each page file is self-contained, so a stakeholder can read one page without jumping around:

- title, description, and acceptance criteria;
- mockups with captions;
- a table of the endpoints the page uses (trigger, method, path, summary, status);
- full detail for each endpoint:
  - parameters table;
  - request body field table with an example JSON;
  - one section per response status, with a field table and example JSON.

Nested schemas are flattened into readable field paths:

| Field               | Type   | Required | Description     | Example      |
| ------------------- | ------ | -------- | --------------- | ------------ |
| `data.items[].name` | string | yes      | Stock item name | `"Widget A"` |

### 5.3 Mocking for FE (documented, not built in)

The exported OpenAPI includes examples for every response, so FE can run:

```bash
npx @stoplight/prism-cli mock openapi.yaml                 # http://127.0.0.1:4010
curl -H "Prefer: code=401" ...                             # force a status code
curl -H "Prefer: example=locked-account" ...               # force a named example
npx @stoplight/prism-cli mock -d openapi.yaml              # dynamic data from schemas
```

These instructions are generated into the Markdown export's `README.md`.

## 6. Architecture

```
┌──────────────── one container (Node 24 LTS + Hono) ────────────────┐
│  /             React SPA (editor)                                   │
│  /api/*        internal REST API (CRUD, exports, uploads)           │
│  /uploads/*    mockup images                                        │
│                                                                     │
│  /data/app.db  SQLite          /data/uploads/<project>/<file>       │
└─────────────────────────────────────────────────────────────────────┘
```

| Layer           | Choice                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| Language        | TypeScript everywhere; Zod schemas shared by client and server                      |
| Frontend        | React + Vite, TanStack Router, TanStack Query                                       |
| UI              | Tailwind CSS + shadcn/ui, CodeMirror 6 (JSON), dnd-kit (reordering), react-markdown |
| Backend         | Hono on Node.js                                                                     |
| Database        | SQLite via Drizzle ORM (better-sqlite3); migrations run on startup                  |
| Exports         | `yaml` for serialization, an OpenAPI 3.1 validator, a zip library for Markdown      |
| Tests           | Vitest (unit + golden-file tests for exports); Playwright later                     |
| Type checking   | TypeScript 7 (`tsc -b`)                                                             |
| Lint & format   | Biome (version pinned)                                                              |
| Package manager | pnpm                                                                                |

Configuration via environment variables: `PORT` (default `3000`), `HOST`, `DATA_DIR`
(default `/data` in Docker, `./data` otherwise), `MAX_UPLOAD_MB` (default `10`).

Uploads accept PNG, JPEG, WebP, and GIF. The file type is checked by content, not by
extension, and files are stored as `<ulid>.<ext>`.

### Repository layout

```
api-contract-builder/
├─ src/
│  ├─ client/                 React SPA
│  │  ├─ routes/
│  │  ├─ components/
│  │  │  └─ schema-builder/
│  │  └─ lib/
│  ├─ server/
│  │  ├─ index.ts             Hono entry: API + SPA + uploads
│  │  ├─ routes/              /api/*
│  │  ├─ db/                  Drizzle schema and client
│  │  ├─ export/
│  │  │  ├─ openapi/
│  │  │  └─ markdown/
│  │  └─ storage/             upload handling
│  └─ shared/                 Zod schemas and types
├─ drizzle/                   generated migrations
├─ docs/
├─ .github/workflows/
├─ Dockerfile
├─ docker-compose.yml
├─ LICENSE                    MIT
└─ README.md
```

## 7. Distribution

```bash
docker run -d --name api-contract-builder \
  -p 127.0.0.1:3000:3000 \
  -v api-contract-builder-data:/data \
  <namespace>/api-contract-builder:latest
```

- The container listens on `0.0.0.0` internally. Publishing the port on `127.0.0.1` keeps
  it reachable only from the local machine.
- All data (SQLite + images) lives in the `/data` volume. To back up, copy the volume. To
  upgrade, `docker pull` and recreate the container; migrations run automatically.
- The image is multi-arch (`linux/amd64`, `linux/arm64`). It uses a multi-stage build on a
  Debian slim base (for the native SQLite module), runs as a non-root user, and has a
  healthcheck on `/api/health`.
- Image tags: `latest`, `X.Y.Z`, `X.Y`.
- GitHub Actions:
  - **CI** on every push and pull request: lint, typecheck, test, build.
  - **Release** on tag `v*`: buildx multi-arch build, then push to Docker Hub.

## 8. Milestones

| #   | Milestone                                                                                                                                                                                                                                                                        | Done when                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| M1  | **Scaffold** — Vite + React + Hono in one package; Tailwind + shadcn/ui; Drizzle + SQLite with startup migrations; Vitest, Biome; Dockerfile; MIT LICENSE                                                                                                                        | `pnpm dev` serves the app; `docker build` + `docker run` serves it with data persisted in a volume |
| M2  | **Projects & settings** — project list, create/edit/delete (with confirmation), slug, API version, servers, auth schemes (bearer, API key, basic)                                                                                                                                | Multiple projects can be created and switched between                                              |
| M3  | **Schema builder + Models** — table/tree editor for JSON Schema: types, required, nullable, description, example, enum, format (email, date-time, uuid, uri, …), constraints (length, min/max, pattern), nested objects, arrays, model references; raw JSON mode with validation | Builder ↔ raw JSON round-trips without loss for the supported subset; unit tests cover it          |
| M4  | **Endpoint editor** — list with filters (method, status, page); method and path (path params auto-detected from `{param}`); query/header params; request body; responses with named examples; status; FE/BE notes; security; "generate example from schema" helper               | An endpoint can be fully described, and model references resolve                                   |
| M5  | **Pages** — ordered page list; Markdown description and acceptance criteria with preview; multiple image upload (drag & drop, reorder, caption, delete, lightbox); link existing endpoints or create one inline, with trigger and note; read-only page view                      | A complete Login page can be authored, including its mockups and endpoints                         |
| M6  | **OpenAPI export** — generator, lint panel, spec validation, YAML/JSON download for a project or a single page                                                                                                                                                                   | Golden-file tests pass; the exported spec validates and serves examples through Prism              |
| M7  | **Markdown export** — zip for a project or a single page, structured as in §5.2                                                                                                                                                                                                  | Zip opens with working image links and readable field tables                                       |
| M8  | **Docker & release** — multi-arch image, healthcheck, non-root user, CI and release workflows                                                                                                                                                                                    | Pushing a `v*` tag publishes the image to Docker Hub                                               |
| M9  | **Sample project & docs** — "Create sample project" (Login, Registration, Stock List, Create Schedule) on the empty state; README (quick start, backup/restore, mocking with Prism, codegen pointers); CONTRIBUTING                                                              | A new user can go from `docker run` to an exported contract using the sample                       |

Progress:

- **M1 — done (2026-10-30).** Tooling then switched from ESLint + Prettier to Biome, which
  unblocked TypeScript 7 (typescript-eslint only supports TypeScript < 6.1).
- **M2 — done (2026-10-30).** Servers and security schemes carry client-generated IDs, so
  endpoints (M4) can reference a scheme by ID and survive key renames.
- Note for M8: the image is ~430 MB uncompressed, mostly the Node base image (~340 MB).
  `better-sqlite3` ships prebuilt binaries for every platform (~27 MB); the ones for other
  platforms could be pruned.

## 9. Backlog (post-MVP)

- Project export/import (.zip) for backup and moving between machines
- Import from an existing OpenAPI document
- Central error catalog
- Contract versioning, diff, and changelog
- Page UI states (loading / empty / error / success)
- Mockup annotations (click a region of an image and link it to a field or endpoint)
- More export formats: TypeScript types / Zod, Postman / Bruno collections
- Built-in mock server
- Multi-user support with roles and comments

## 10. Open items

- **Docker Hub namespace** and **GitHub repository** for the release workflow, needed in M8.

Resolved:

- LICENSE (MIT) copyright line: `Copyright (c) 2026 Regga <coding@reggarantai.com>`.
