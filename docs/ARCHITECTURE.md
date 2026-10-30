# Architecture

How API Contract Builder is put together, and why. For the setup, tests, and conventions,
see [CONTRIBUTING.md](../CONTRIBUTING.md); for what changed between versions, see
[CHANGELOG.md](../CHANGELOG.md).

## What it is

A self-hosted tool for writing API contracts **page by page**, the way a product is
discussed, and handing them over as OpenAPI 3.1 for tools and Markdown for people, so
frontend and backend can build in parallel. It runs locally for one author: no accounts,
one Docker container, and the data stays on the machine.

Left out on purpose: logins and multiple users, a built-in mock server (the frontend mocks
from the exported OpenAPI with Prism), GraphQL and WebSocket APIs, and Figma integration.
Ideas for later are
[issues labeled enhancement](https://github.com/reggarantai/api-contract-builder/issues?q=label%3Aenhancement).

## Concepts

```
Project
 ├─ Settings    servers, API version, security schemes, the default scheme
 ├─ Models      reusable schemas (User, StockItem, …)
 ├─ Endpoints   method and path, parameters, request body, responses, status, notes
 └─ Pages       description, acceptance criteria, mockups, and the endpoints the page calls
```

- **Endpoints belong to the project, not to a page.** A page links endpoints, each with a
  trigger (on load, on submit, on an action, other) and a note. One endpoint can serve many
  pages, and a page can link the same endpoint twice with different triggers.
- **Schemas are JSON Schema 2020-12**, the dialect of OpenAPI 3.1, so exports lose nothing.
- **Model references are stored by ID** (`{"$ref": "model:<id>"}`) and become
  `#/components/schemas/<Name>` only in JSON views and exports, so renaming a model never
  breaks a reference.
- **Parameters and response headers are object schemas**: one per location (path, query,
  header) and one per response. Each property is a parameter or a header, and `required`
  lists the required ones, so the same field builder edits them. Path parameters follow the
  path: renaming `{id}` in place keeps its schema.
- **Examples are named** (`success`, `locked-account`, …), so a mock server can return a
  chosen scenario.

## Data

SQLite through better-sqlite3 and Drizzle, in `DATA_DIR/app.db`. Uploaded mockups are
files in `DATA_DIR/uploads/<project id>/`, named by a new ID. IDs are ULIDs. The SQL
migrations in `drizzle/` run on startup.

| Table            | Holds                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projects`       | name, unique slug, description (Markdown), API version, servers and security schemes (JSON, each with its own ID), the default scheme                                                                  |
| `models`         | name (unique per project, ignoring case), description, schema (JSON)                                                                                                                                   |
| `endpoints`      | method, path, `path_key` (the path without parameter names), operation ID, summary, description, status, deprecated, security, parameters, request body, and responses (JSON columns), FE and BE notes |
| `pages`          | name, unique slug, description and acceptance criteria (Markdown), position                                                                                                                            |
| `page_endpoints` | a page's links to endpoints: trigger, note, position                                                                                                                                                   |
| `page_mockups`   | uploaded images: file name, original name, type, width and height, caption, position                                                                                                                   |
| `app_meta`       | facts about the instance, like when its data directory was created                                                                                                                                     |

Deleting a project deletes everything it owns, files included. Models and security schemes
that endpoints use, and models other models use, can't be deleted, so exports never have
dangling references.

## Server

One Node.js process (Hono) serves the single-page app, the API under `/api`, and uploads
under `/uploads`:

- `/api/projects`: projects and, under each, `models`, `endpoints`, `pages` (with their
  `mockups` and order), and `export/openapi`, `export/markdown`, and `export/report`;
- `/api/samples`: creates the sample project, through the API itself;
- `/api/health`: status, version, and when the data directory was created; the Docker
  healthcheck calls it.

Requests are checked with the Zod schemas in `src/shared`, the same ones the forms use.
Errors are `{ error, issues? }`, with a field path per issue so forms show each on its
field. Uploads are checked by content (PNG, JPEG, GIF, WebP; SVG is refused because it can
carry scripts) and served with immutable caching and `nosniff`. Configuration comes from
environment variables (see the README).

## Exports

Both exports cover the whole project or one page. A page export has the page's endpoints
and the models they use, directly or through other models.

**OpenAPI 3.1** (YAML or JSON):

| Contract                     | OpenAPI 3.1                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Project                      | `info` (title, version, description), `servers`                                 |
| Security schemes, default    | `components.securitySchemes`, top-level `security`                              |
| Endpoint security            | default: inherited; none: `security: []`; chosen schemes: any one of them       |
| Model                        | `components.schemas.<Name>`                                                     |
| Endpoint                     | `paths.<path>.<method>`; an empty operation ID is made from method and path     |
| Parameters, response headers | one parameter or header per property; its `description` moves out of the schema |
| Page                         | a tag; an endpoint that several pages use gets several tags                     |
| A page's link to it          | `x-pages: [{ page, slug, trigger, note }]`                                      |
| Status, notes                | `x-status`, `x-notes-fe`, `x-notes-be`                                          |
| Named examples               | `content.<type>.examples.<name>`                                                |

The Export tab shows **warnings** (bodies without examples, endpoints no page uses, models
nothing uses) and **errors**. Errors come from two checks: the document against the
official OpenAPI 3.1 schema, and every schema against the JSON Schema 2020-12 meta-schema,
because the first alone accepts schemas like `{"type": "strng"}`. A contract with errors
can't be downloaded as OpenAPI.

**Markdown** (`<project>.contract.zip`): a README (the description, servers,
authentication, pages, endpoints, and how to mock with Prism), `models.md`, one file per
page, the mockups as `images/<page>/NN-<name>.<ext>`, and the OpenAPI file when the
contract is valid. Page files stand alone: referenced models are expanded in place
(`data[].category.name`), stopping where a model contains itself. Tables show types and
rules (lengths, ranges, allowed values, patterns, defaults); parameter and header tables
add examples, and bodies show theirs as JSON.

## Client

A React single-page app built with Vite: TanStack Router (file-based routes) and Query,
shadcn/ui on Tailwind CSS, and CodeMirror for JSON (loaded only when needed). Code is
grouped by area in `src/client/features`.

The schema builder edits the JSON Schema document in place, so switching between the
builder and JSON loses nothing, and keywords the builder doesn't know are kept. Subschemas
it can't edit (`oneOf`, `if`/`then`, `const`, …) show as Custom and are edited as JSON.

## Running and releasing

The Docker image (`reggarantai/api-contract-builder`, for `linux/amd64` and
`linux/arm64`) is a multi-stage build on `node:24-trixie-slim` (Debian, for glibc):

- the stages that install and build run on the build machine's own platform, because no
  dependency is compiled, so building for the other architecture needs almost no
  emulation;
- the final stage has only the runtime dependencies, and only the target platform's
  prebuilt SQLite binary;
- it runs as the `node` user, keeps everything in the `/data` volume, and has a
  healthcheck on `/api/health`.

CI runs on every push and pull request; pushing a `v*` tag publishes the image. See
"Releasing" in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing).

## Tests

- **Vitest**: rules and pure functions; API routes, in process with a fresh database;
  exports against golden files in `test/golden`; the OpenAPI export through Prism's mock
  engine (examples, errors, request validation, security); the data migrations.
- **Playwright**: everything a person does in the browser, against the production build.
- **The image**: `scripts/smoke-test-image.sh` runs a built image the way users do.

## Decisions

The calls that shape the code, and why. Earlier plans and their history are in git.

- **Local, one author, no accounts.** The author owns the data, and contracts reach others
  as exports, so there's no login, permission, or hosting to build.
- **No built-in mock server.** Prism serves the exported OpenAPI well (named examples,
  `Prefer` headers, request validation), and a standard export works with any OpenAPI
  tool. Project export and import, wanted mostly for that, went to the backlog with it.
- **SQLite and files in one volume**, so a backup is a copy of the volume.
- **Schemas are kept as JSON Schema, and references by model ID.** The builder edits the
  stored document instead of a model of its own, so nothing is lost when switching to
  JSON, and exports are a translation, not a conversion.
- **An endpoint is saved as a whole**, so its parameters, body, and responses are JSON
  columns, not tables; nothing reads a single response.
- **Parameters and response headers are object schemas**, so one editor serves both, and
  each property maps to one OpenAPI parameter or header.
- **Paths that differ only in parameter names are the same path**, as OpenAPI says:
  `/users/{id}` and `/users/{userId}` share a `path_key`, which is unique per method.
- **Things in use can't be deleted** (models, security schemes), so an export never points
  at something missing.
- **Mockups are saved right away**, apart from the page's Save button, because a file
  exists as soon as it's uploaded.
- **Markdown page files stand alone**, so someone can read one page without jumping
  around; `models.md` lists each model once.
- **The sample project is built through the API and is the export fixture**, so what users
  see is what the golden files pin. It's written like a production contract, and tests
  check its conventions on every operation and that the builder can edit every schema in
  it (so it uses one-value enums instead of `const`, and states conditional rules in
  words instead of `if`/`then`).
- **Biome instead of ESLint and Prettier**, because typescript-eslint doesn't support
  TypeScript 7, which type-checks the project.
- **Pinned GitHub Actions** (full commit SHAs, updated by Dependabot); npm packages are
  updated by hand, because TypeScript must stay in step with the `tsgo` version in the Zed
  settings.

### The sample contract

The sample (`src/server/samples/inventory.ts`) is meant to be copied, so its less obvious
calls are explained here:

- A **401 always means the access token is missing or expired**, and bearer 401s carry a
  `WWW-Authenticate` challenge (RFC 6750). Wrong sign-in credentials answer 400, like
  OAuth's `invalid_grant`, so a frontend that refreshes on 401 never does so on the login
  form. A failed refresh answers 401, matching its cookie security scheme.
- **Registration always answers 202**, and the other endpoints that take an email never
  show whether it has an account.
- **`Session` holds only the access token**; the user comes from `GET /me`.
- **The refresh token is an HttpOnly, `SameSite=Strict` cookie**, rotated on each use, with
  30 seconds' grace so several tabs can refresh at once. Sessions end 12 hours (or 30 days
  with "remember") after sign-in; refreshing doesn't extend them. Sign-out always
  succeeds. Staging is on its own site, so cookies never cross between environments.
- **Creates take a required `Idempotency-Key`**; only successes are replayed, and a resend
  while the first request runs answers 409 `request-in-progress`.
- **Recording a stock movement answers 201 without `Location`**, because a single movement
  has no URL of its own; the Stock item page fetches the item again for its new status.
- Left out: `ETag` and `If-Match` on stock items (every movement changes the item, so edits
  would often fail, and a merge patch only touches the fields it sends); a CSRF header
  (the cookie endpoints check `Origin`, the cookie is `SameSite=Strict`, and requests are
  JSON only); and a `default` response on every operation (the project description says
  other errors are problem details too).
