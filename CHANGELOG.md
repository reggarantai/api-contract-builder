# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-11-03

### Added

- **Project files**: download a whole project, mockups included, as one .zip from its
  Export tab, and import it with **Import project** on the Projects page of another
  machine or instance. An import checks the file with the same rules as saving, and
  happens completely or not at all. A project that isn't on the instance yet keeps its
  IDs, so links to it keep working; one that is comes in as a copy, under a free slug.
  The Export tab shows the file's size, and warns when this instance couldn't import it.
  Through the API: `GET /api/projects/{projectId}/export/project`, and
  `POST /api/projects/import` with the file as the body and
  `Content-Type: application/zip`.
- `MAX_IMPORT_MB` (default 1024): the largest project file an instance imports.

### Changed

- Projects with the same name, like an imported copy, show their slugs on the Projects
  page and in the project switcher.
- `GET /api/health` also answers `maxImportBytes`.
- Schemas and examples may nest at most 256 levels of objects and lists; saving a deeper
  one answers 400, as importing one does. The exports follow schemas recursively and give
  out a few hundred levels down, so this way nothing saved is too deep to export. Data
  saved before keeps opening, and saves that leave its deep parts as they are still go
  through.
- The Markdown bundle holds at most about 128 MB of text, since page files repeat what
  they show, and a bigger bundle answers 422 with the reason. A table stops expanding
  models it already showed after 500 rows, and goes at most 512 levels deep into the
  models it expands, pointing to `models.md` for the rest.
- The Export tab downloads OpenAPI and Markdown through the app, so a refused download
  says why.

### Fixed

- Exports keep a schema key named `__proto__` instead of dropping it.
- Exports of a schema or example nested deeper than they can follow, saved before the
  limit above, say so (422, and an error in the export report) instead of failing with a
  server error, and so does anything else that meets such data. The Markdown bundle
  leaves the OpenAPI file out instead, as for other errors.
- Generate example stops at 10,000 values and at a million characters of property names
  and given values (`examples`, `const`, `enum`, `default`), so models that refer to each
  other many times can't freeze the browser.

## [0.3.0] - 2026-11-01

### Added

- **Page states**: describe each state a page can be in (idle, loading, success, empty,
  or error, as many of each as needed), with a description, the page's mockups that show
  it, and what leads to it: one of the page's calls while it runs, a response or one of
  its examples, or an error type. The page view shows each with the Prism headers that
  make the mock server answer with it, ready to copy, and page files in the Markdown
  bundle get a States section. The OpenAPI export doesn't change.
- The sample project describes the states of all its pages, with three new Stock list
  mockups: loading, nothing found, and a delete refused with a 409.
- Saving a page, an endpoint, a model, an error type, or project settings that were
  saved somewhere else since you opened them, like another tab or window, asks first:
  load the saved version, or save over it. Through the API, a save can send the
  `revision` it started from, and gets 409 when the item is past it.

### Changed

- Saving an endpoint without a response or example that a page state comes from asks
  first, and then removes it from those states too; through the API, the save answers
  409 unless it adds `?detachStates=true`. Deleting an endpoint or a mockup takes it out
  of the states that used it.
- Endpoints refuse two responses with the same ID, and two examples with the same ID in
  one body or one error type's examples, since states refer to them by ID. Endpoints
  saved through the API with repeated IDs before get unique ones when read, so they can
  still be saved.
- Editors keep unsaved changes when the item changes elsewhere, instead of replacing
  them with the saved version when the window becomes visible again. While a save
  runs, the form is locked, so nothing typed then is lost.
- Data volumes from 0.2.0 work as they are: pages start without states, and projects
  without states export exactly as before.

### Fixed

- Saving a page with two endpoint links that share an ID answers 400 instead of failing
  with a server error.
- After saving a change that the server trims away, like a trailing space, editors no
  longer show unsaved changes.
- When an endpoint, model, or error type changes elsewhere while its editor has no
  changes, JSON text and examples in the editor show the new values instead of the old
  ones.

## [0.2.0] - 2026-11-01

### Added

- **Error types**: a catalog of the errors the API answers with, each described once:
  status, title, when it happens, headers (like `Retry-After`), and an example. Responses
  list the error types they answer with, and an endpoint can give its own examples of one
  (like the fields its 422 reports). Exports define each error type once, as
  `components.examples` in OpenAPI and in `error-types.md` in the Markdown bundle, and
  warn about unused error types and problem details (RFC 9457) that contradict theirs.
- `SECURITY.md`: how to report a vulnerability, and how the image is kept clean.
- A weekly rebuild: when a base image has a new build, the latest release's image is
  rebuilt, tested, and published again as `X.Y` and `latest`.

### Changed

- The sample project describes its 20 error types once in the catalog. Their examples are
  named after the error type now, so `Prefer: example=wrong-password` is
  `Prefer: example=invalid-credentials` (also `email-not-verified`, `invalid-parameters`,
  `idempotency-key-missing`, `idempotency-key-reused`, `request-in-progress`,
  `item-has-stock`, and `insufficient-stock`). Sample projects created before keep theirs.
- Data volumes from 0.1.x work as they are: the database is migrated on start, and
  existing responses keep their bodies.

## [0.1.1] - 2026-10-30

### Security

- The image now runs on distroless (`gcr.io/distroless/nodejs24-debian13`) instead of
  Debian slim: no shell, package manager, or npm. At release it has no known high or
  critical vulnerabilities, down from 14, and it's about a third smaller (401 to 270 MB on
  arm64).
- CI fails when the image has a high or critical vulnerability that already has a fix.

### Changed

- There's no shell in the container anymore; use `docker logs` to see what the app is
  doing. Data volumes from 0.1.0 work as they are.

## [0.1.0] - 2026-10-30

The first release.

### Added

- **Projects**: several independent projects, each with servers, an API version, and
  security schemes (bearer, an API key in a header, query, or cookie, and basic).
- **Models**: reusable JSON Schema, edited with a field builder (types, required, nullable,
  formats, allowed values, lengths, ranges, patterns, nested objects and arrays, model
  references) or as JSON, without losing anything when switching.
- **Endpoints**: method and path (path parameters follow the path), query and header
  parameters, a request body, responses per status code with their headers and named
  examples, a status (draft, in review, agreed), authentication, deprecation, and notes for
  frontend and backend. Examples can be generated from the schema.
- **Pages**: Markdown description and acceptance criteria, mockup images (upload, order,
  captions, full-size view), and the endpoints the page calls, each with a trigger and a
  note.
- **OpenAPI 3.1 export** (YAML or JSON) for the whole project or one page, validated against
  the OpenAPI 3.1 schema and JSON Schema 2020-12, with warnings for missing examples and
  for endpoints or models nothing uses. Ready for mock servers such as Prism.
- **Markdown export** (.zip): a README, one stand-alone file per page with its mockups and
  endpoints, the models, and the OpenAPI file.
- **Sample project**: an inventory app with sign-in, written like a production API, to look
  around and to copy from.
- **Docker image** `reggarantai/api-contract-builder` for `linux/amd64` and `linux/arm64`:
  runs as a non-root user, keeps everything in the `/data` volume, and has a healthcheck.

[0.4.0]: https://github.com/reggarantai/api-contract-builder/releases/tag/v0.4.0
[0.3.0]: https://github.com/reggarantai/api-contract-builder/releases/tag/v0.3.0
[0.2.0]: https://github.com/reggarantai/api-contract-builder/releases/tag/v0.2.0
[0.1.1]: https://github.com/reggarantai/api-contract-builder/releases/tag/v0.1.1
[0.1.0]: https://github.com/reggarantai/api-contract-builder/releases/tag/v0.1.0
