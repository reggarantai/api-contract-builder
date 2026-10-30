# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `SECURITY.md`: how to report a vulnerability, and how the image is kept clean.
- A weekly rebuild: when a base image has a new build, the latest release's image is
  rebuilt, tested, and published again as `X.Y` and `latest`.

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

[Unreleased]: https://github.com/reggarantai/api-contract-builder/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/reggarantai/api-contract-builder/releases/tag/v0.1.1
[0.1.0]: https://github.com/reggarantai/api-contract-builder/releases/tag/v0.1.0
