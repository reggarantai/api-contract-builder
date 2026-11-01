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
 ├─ Settings      servers, API version, security schemes, the default scheme
 ├─ Models        reusable schemas (User, StockItem, …)
 ├─ Error types   the errors the API answers with (sku-taken, token-expired, …)
 ├─ Endpoints     method and path, parameters, request body, responses, status, notes
 └─ Pages         description, acceptance criteria, mockups, the endpoints the page calls,
                  and its states (loading, empty, error, …) with what leads to each
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
- **Error types are described once**: a status, a title, when it happens (Markdown),
  headers, and a body with one example, like an RFC 9457 problem type. A response lists
  the error types it answers with, by ID, and then has no body of its own; for each it
  uses the catalog's example, or the endpoint's own examples instead (a 422 reports the
  fields of that endpoint's request). An error type goes in the response that answers
  its status: OpenAPI picks an exact code over `4XX`, and `4XX` over `default`.
- **A page's states** describe what it shows: idle (a form waiting for input), loading,
  success, empty, or error, any number of each, with a name, a description, the page's
  mockups that show it, and what leads to it. A cause is one of the page's calls (its
  link): the call itself while it runs (loading states only), a response or one of its
  body's examples, or an error type the call answers with or one of the endpoint's own
  examples of it. Each cause gets the Prism `Prefer` header (and `Accept`, when the
  content isn't JSON) that makes the mock server answer with it.

## Data

SQLite through better-sqlite3 and Drizzle, in `DATA_DIR/app.db`. Uploaded mockups are
files in `DATA_DIR/uploads/<project id>/`, named by a new ID. IDs are ULIDs. The SQL
migrations in `drizzle/` run on startup.

| Table            | Holds                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`       | name, unique slug, description (Markdown), API version, servers and security schemes (JSON, each with its own ID), the default scheme, a revision                                                                                                     |
| `models`         | name (unique per project, ignoring case), description, schema (JSON), a revision                                                                                                                                                                      |
| `endpoints`      | method, path, `path_key` (the path without parameter names), operation ID, summary, description, status, deprecated, security, parameters, request body, and responses (JSON columns, each with the error types it uses), FE and BE notes, a revision |
| `error_types`    | name (unique per project, ignoring case), status, title, description (Markdown), headers and body (JSON), a revision                                                                                                                                  |
| `pages`          | name, unique slug, description and acceptance criteria (Markdown), position, states (JSON: kind, name, description, causes, mockups), a revision                                                                                                      |
| `page_endpoints` | a page's links to endpoints: trigger, note, position                                                                                                                                                                                                  |
| `page_mockups`   | uploaded images: file name, original name, type, width and height, caption, position                                                                                                                                                                  |
| `app_meta`       | facts about the instance, like when its data directory was created                                                                                                                                                                                    |

Deleting a project deletes everything it owns, files included. Models and security schemes
that endpoints use, models other models or error types use, and error types responses use
can't be deleted, so exports never have dangling references. For the same reason an error
type in use can't change in a way that breaks a response using it (a status the response
doesn't answer, an example name the response already has).

Page states point at links, responses, examples, and error types by ID, so renaming any
of them is followed. What a state comes from can't disappear unnoticed: saving an
endpoint without a response or example a state uses is refused (409, naming the states)
unless the save asks to remove it from those states too (`?detachStates=true`, which the
editor offers); deleting an endpoint or a mockup takes it out of states, as its dialog
says; and saving a page without a call its states use is refused, with the issue on the
state, or as a 409 naming the states for clients that don't send `states`. A save that
still lists a mockup deleted since (from a window opened before) drops it.

Projects, models, error types, endpoints, and pages count their saves in a revision.
A save can name the revision it started from, and answers 409 with the current one when
the item was saved again since; editors always send it. Mockups don't count, since
they're saved apart from the page.

Responses and examples need unique IDs where states look them up. Data saved through the
API before that rule may repeat one; reading it renames the later ones (`r` stays,
another `r` becomes `r-2`), so saving it works and anything that pointed at the first
still does.

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
| Error type                   | `components.examples.<name>`: its title as `summary`, `description`, `value`    |
| A response's error types     | an example `$ref` each (or the endpoint's own examples); their headers merged   |

A response with error types gets one body per content type, with their schema, or `anyOf`
the schemas when they differ. Headers that several of its error types send appear once,
with all their examples (a missing token and an expired one get different
`WWW-Authenticate` challenges); a header is required only if every error type requires
it, and says "Only with `x`" when only some send it.

The Export tab shows **warnings** (bodies without examples, endpoints no page uses, models
or error types nothing uses, problem details whose `status` or `title` differ from their
error type, error types sharing a `type`, a header that error types in one response
define differently) and **errors**. Errors come from two checks: the document against the
official OpenAPI 3.1 schema, and every schema against the JSON Schema 2020-12 meta-schema,
because the first alone accepts schemas like `{"type": "strng"}`. A contract with errors
can't be downloaded as OpenAPI.

**Markdown** (`<project>.contract.zip`): a README (the description, servers,
authentication, pages, endpoints, error types, and how to mock with Prism), `models.md`,
`error-types.md` when there are any, one file per page, the mockups as
`images/<page>/NN-<name>.<ext>`, and the OpenAPI file when the contract is valid. Page files stand alone: referenced models are expanded in place
(`data[].category.name`), stopping where a model contains itself. Tables show types and
rules (lengths, ranges, allowed values, patterns, defaults); parameter and header tables
add examples, and bodies show theirs as JSON.

A page with states gets a States section in place of Mockups: each state as
`### <Kind>: <name>`, the calls it waits for, its description, a table of the responses
that lead to it with their Prism headers (left out when the bundle has no OpenAPI file),
and its mockups. Mockups no state shows follow under "Other mockups". Pages without
states, and so projects without them, export exactly as before; the README explains the
headers only when some page has states. States don't reach the OpenAPI document.

## Client

A React single-page app built with Vite: TanStack Router (file-based routes) and Query,
shadcn/ui on Tailwind CSS, and CodeMirror for JSON (loaded only when needed). Code is
grouped by area in `src/client/features`.

The schema builder edits the JSON Schema document in place, so switching between the
builder and JSON loses nothing, and keywords the builder doesn't know are kept. Subschemas
it can't edit (`oneOf`, `if`/`then`, `const`, …) show as Custom and are edited as JSON.

Editors share `useSavedForm` (`src/client/lib/saved-form.ts`): it decides when server data
replaces the form (`serverChange`: responses that arrive late are ignored, since
revisions only grow), sends the revision with each save, turns a 409 for an older
revision into `ConflictDialog`, and makes the form inert for the moment a save or load
runs, so nothing typed then is lost to the reset that follows.

## Running and releasing

The Docker image (`reggarantai/api-contract-builder`, for `linux/amd64` and
`linux/arm64`) is a multi-stage build:

- the stages that install and build use `node:24-trixie-slim` and run on the build
  machine's own platform, because no dependency is compiled, so building for the other
  architecture needs almost no emulation;
- the final stage is distroless (`gcr.io/distroless/nodejs24-debian13`): Node, glibc, and
  certificates, with no shell or package manager, plus the runtime dependencies and only
  the target platform's prebuilt SQLite binary;
- it runs as user 1000, keeps everything in the `/data` volume, and has a healthcheck on
  `/api/health`.

CI runs on every push and pull request and fails on high or critical vulnerabilities that
already have a fix; pushing a `v*` tag publishes the image. Every Monday, if a base image
has moved, the latest release is rebuilt and published again as `X.Y` and `latest`. See
"Releasing" in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing).

## Tests

- **Vitest**: rules and pure functions; API routes, in process with a fresh database;
  exports against golden files in `test/golden` (and the sample without its states
  against what 0.2.0 exported, in `test/golden/inventory-markdown-without-states`); the
  OpenAPI export through Prism's mock engine (examples, errors, request validation,
  security), and every page state's headers through Prism's HTTP server; the data
  migrations.
- **Playwright**: everything a person does in the browser, against the production build.
- **The image**: `scripts/smoke-test-image.sh` runs a built image the way users do, and
  Trivy scans it for vulnerabilities that already have a fix.

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
- **Things in use can't be deleted** (models, security schemes, error types), so an export
  never points at something missing.
- **Errors are catalogued as types, not as shared responses.** OpenAPI's answer is
  `components.responses`, but a 3.1 Reference Object can only override `summary` and
  `description`, so a shared response can't take an endpoint's own examples, and
  endpoints combine errors differently at one status (the sample's 409s: `sku-taken` with
  `request-in-progress` on create, with `unit-locked` on update). RFC 9457 defines a
  problem type by its type URI, title, and status, so that's the unit; responses refer to
  it, and exports define it once in `components.examples`, which Prism serves by name.
  The type URI lives in the example, so APIs with other error formats can use the
  catalog too; problem details are only what a new error type starts as. Errors without
  a body stay plain responses: nothing in the export would tell them apart.
- **Saving a response without `errors` keeps the ones it had.** API clients from before
  the catalog, like a browser tab left open across an upgrade, drop fields they don't
  know, and that must not silently empty a response.
- **Mockups are saved right away**, apart from the page's Save button, because a file
  exists as soon as it's uploaded.
- **Page states are a closed set of kinds**: the request lifecycle frontends already
  model (TanStack Query's and Redux's idle, loading, success, error) plus the designer's
  empty state. A fixed set gives every project the same vocabulary and lets the rules
  check causes (an idle state has none; only loading waits for a call); anything finer,
  like "Too many attempts", is the state's name, and a page can have several of a kind.
- **A state's causes point at the page's calls**, not at endpoints, so a call made twice
  (the sample's on-load refresh and the background one) leads to different states, and
  the trigger comes along. A response with error types is reached through its error
  types: their example and status match, while asking Prism for a range or default
  response would answer one error's body with another code. An error cause has no
  response ID, since an error type sits in one response per endpoint, so moving it to
  another response keeps the state. Nothing reaches a state from "any endpoint": Prism
  mocks one request at a time.
- **Prism headers are worked out, not stored**, so renames never leave a stale header.
  Preferences are separated by commas (RFC 7240): Prism's parser reads
  `code=200; example=empty` as one preference with a parameter and ignores the example.
  A range or default response gets the first usual code that reaches it, skipping 401,
  407, 408, and 429, which frontends handle on their own; `Accept` is added when the
  content isn't JSON, since Prism only finds examples in the content type it negotiates.
  1xx and 3xx responses can't be causes: a page never sees them through `fetch`.
- **States are saved with the page, as a JSON column**, like an endpoint's responses:
  the page form saves them as a whole, and nothing reads one state alone. A save without
  `states` keeps them, so older clients don't erase them. Issue #6's mockup annotations
  should link to states from the annotation, not add fields to states, or a client from
  before them would drop those fields on save.
- **Editors keep unsaved changes, and saves name the revision they started from.** Each
  editor takes new data from the server (a refetch when the window becomes visible, a
  mockup delete that prunes states) only while it has no changes of its own, instead of
  replacing what the user typed; TanStack Query and React Hook Form both advise against
  syncing background updates into a form being edited. Without a check, that would let
  one tab save over a newer save from another tab or window, so items count their saves,
  and a save based on an older revision answers 409: the editor offers to load the saved
  version or to save over it. RFC 9110 gives this, a versioning conflict, as its example
  of a 409. Project settings save in sections; a section moves on to the new revision
  when only other sections' fields changed, so sections never conflict with each other.
  `ETag` and `If-Match` would be the header form of it, but a page's representation
  includes its mockups, which are saved apart and right away, so a strong `ETag` would
  change with every upload and report conflicts that aren't. API clients that don't send
  a revision save as before.
- **Leaving OpenAPI alone for states.** OpenAPI describes the HTTP interface, no tool
  reads UI states, and an `x-` extension would only churn generated clients and mocks;
  Prism needs only the example names already there.
- **Markdown page files stand alone**, so someone can read one page without jumping
  around; `models.md` lists each model once.
- **The sample project is built through the API and is the export fixture**, so what users
  see is what the golden files pin. It's written like a production contract, and tests
  check its conventions on every operation and that the builder can edit every schema in
  it (so it uses one-value enums instead of `const`, and states conditional rules in
  words instead of `if`/`then`).
- **Biome instead of ESLint and Prettier**, because typescript-eslint doesn't support
  TypeScript 7, which type-checks the project.
- **A distroless runtime image.** The Debian slim base brought high-severity findings in
  packages the app never runs (mount helpers, ncurses, Perl) and in the npm it ships, which
  the app doesn't use either. Distroless leaves those out, keeps glibc (Node's main
  platform, and what the SQLite binary is built for), and has no shell for an attacker to
  use. Alpine would have fewer packages still, but Node treats musl as experimental. The
  user ID stays 1000, so data volumes from earlier images keep working.
- **`X.Y.Z` tags never change; `X.Y` and `latest` are rebuilt.** Someone who pins a version
  gets exactly what was released, and everyone else gets the base images' security fixes
  within a week, without a release for each. The rebuild only runs when a base image's
  digest differs from the one in the published image's provenance.
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
- **Every page describes its states**, from its acceptance criteria, and every mockup
  shows one. Stock list has the loading, empty, and delete-refused screens as mockups.
- **Every error is an error type in the catalog**, 20 of them. The 422s give their own
  examples, the fields each endpoint checks, under `validation-failed`; the 415 keeps
  `Accept-Patch` as its own header, since only the PATCH endpoint sends it.
- **Recording a stock movement answers 201 without `Location`**, because a single movement
  has no URL of its own; the Stock item page fetches the item again for its new status.
- Left out: `ETag` and `If-Match` on stock items (every movement changes the item, so edits
  would often fail, and a merge patch only touches the fields it sends); a CSRF header
  (the cookie endpoints check `Origin`, the cookie is `SameSite=Strict`, and requests are
  JSON only); and a `default` response on every operation (the project description says
  other errors are problem details too).
