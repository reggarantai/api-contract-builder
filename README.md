# API Contract Builder

[![CI](https://github.com/reggarantai/api-contract-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/reggarantai/api-contract-builder/actions/workflows/ci.yml)
[![Docker Hub](https://img.shields.io/docker/v/reggarantai/api-contract-builder?sort=semver&label=Docker%20Hub)](https://hub.docker.com/r/reggarantai/api-contract-builder)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Write API contracts the way the product is discussed: **page by page**. For each screen,
describe what it does, attach its mockups, and list the endpoints it calls and when. Then
hand the contract over as **OpenAPI 3.1** for frontend and backend tools and as
**Markdown** for everyone else, so frontend and backend can build in parallel.

![A page with its description, acceptance criteria, and states](docs/images/page-view.png)

- **Pages**: description and acceptance criteria in Markdown, mockup images, and the
  endpoints the page calls, each with a trigger (on load, on submit, on an action).
- **Page states**: what a page shows while it loads, when there's nothing to show, when a
  call fails, and so on, each with its mockups and the responses that lead to it, like
  the `empty` list example or a 409 `item-has-stock`. Each comes with the Prism `Prefer`
  header that makes the mock server answer with it.
- **Endpoints**: parameters, request bodies, responses per status code with their headers,
  named examples, authentication, a status (draft, in review, agreed), and notes for each
  side.
- **Models**: reusable schemas, edited with a field builder or as JSON Schema.
- **Error types**: each error the API answers with, like `sku-taken` or `token-expired`,
  described once (status, title, when it happens, headers, and an example, as RFC 9457
  problem details or any other format) and used in any endpoint's responses.
- **Export**: OpenAPI 3.1 (YAML or JSON) and a Markdown bundle (.zip), for the whole
  project or one page. Contracts are validated before export, and warnings point at
  missing examples, unused endpoints, models, or error types, and problem details that
  contradict their error type.
- **Project files**: a whole project, mockups included, as one .zip, to import on another
  machine or instance, or to keep as a backup.
- **OpenAPI import**: start a project from an OpenAPI 3.0, 3.1, or 3.2 document, as JSON or
  YAML. Its schemas become models and its operations endpoints, ready to link to pages,
  and anything a project can't hold is listed, never dropped quietly.

It runs locally, for one author, as a single Docker container. Data stays on your machine.

## Quick start

```bash
docker run -d --name api-contract-builder \
  -p 127.0.0.1:3000:3000 \
  -v api-contract-builder-data:/data \
  reggarantai/api-contract-builder:latest
```

The image runs on `linux/amd64` and `linux/arm64`, Apple silicon included. To build it
from this repository instead: `docker build -t api-contract-builder .`

Open <http://127.0.0.1:3000> and choose **Create sample project** to look around a
finished contract, start your own with **New project**, or bring an existing OpenAPI
document in with **Import project**. The sample is an inventory app
with sign-in, registration, password reset, and stock pages, written the way a production
API would be: problem details for errors, paged lists, refresh tokens in a cookie, and
idempotent creates.

The port is published on `127.0.0.1` only, so the app is reachable from your machine and
nowhere else. With Docker Compose: `docker compose up -d`.

## Starting from an existing OpenAPI document

Choose **Import project** on the Projects page and pick an OpenAPI 3.0, 3.1, or 3.2
document (`.json`, `.yaml`, or `.yml`, up to 16 MB). It becomes a new project:

- `components.schemas` become models, and references to them model references;
- each operation becomes an endpoint, with its parameters, request body, responses,
  headers, named examples, and security;
- the project gets the document's title, version, description, servers, and security
  schemes.

Pages are screens, which OpenAPI doesn't have, so the endpoints start without pages and
the Export tab lists them as unused until you link them. A document this app exported
brings its pages back, with their links; acceptance criteria, mockups, and states aren't in
OpenAPI. Error types come back from the `components.examples` this app's export writes.

What a project can't hold, like cookie parameters, a second media type, callbacks, or
`x-` extensions, is listed after the import, each with where it is in the document, ready to
copy. Nothing is fetched: a document that refers to other files or URLs is refused, with
each reference listed, so you can bundle it into one file first (for example with
`npx @redocly/cli bundle openapi.yaml -o bundled.yaml`). Swagger 2.0 documents need
converting to OpenAPI 3 first.

Through the API: `POST /api/projects/import` with the document as the body and
`Content-Type: application/json` or `application/yaml`.

## Handing the contract over

![The Export tab](docs/images/export.png)

The **Export** tab downloads the contract for the whole project or for one page.

**Frontend**

- Start a mock server from the OpenAPI file. It answers with the examples in the contract:

  ```bash
  npx @stoplight/prism-cli mock inventory-app.openapi.yaml
  curl -H "Authorization: Bearer x" http://127.0.0.1:4010/stock-items
  curl -H "Authorization: Bearer x" -H "Prefer: example=empty" http://127.0.0.1:4010/stock-items
  curl -X DELETE -H "Authorization: Bearer x" -H "Prefer: code=409" \
    http://127.0.0.1:4010/stock-items/1e3a5c7e-9b2d-4f6a-8c0e-3b5d7f9a1c2e
  ```

  Each page state lists the headers that reproduce it, like
  `Prefer: code=409, example=item-has-stock` for the Stock list's "Can't delete". Separate
  preferences with a comma: after a semicolon, Prism ignores the example.

  ![Two states of the Stock list, with the responses that lead to them and their Prism headers](docs/images/page-states.png)

- Generate types or a client, for example with
  [openapi-typescript](https://openapi-ts.dev) or [Orval](https://orval.dev).

**Backend**

- Generate server stubs or types with [OpenAPI Generator](https://openapi-generator.tech),
  [oapi-codegen](https://github.com/oapi-codegen/oapi-codegen) (Go), or the tool of your
  stack.
- Check a running implementation against the contract with Prism's proxy, which reports
  every request and response that doesn't match:
  `npx @stoplight/prism-cli proxy inventory-app.openapi.yaml http://localhost:8080`.

**Everyone else**

The Markdown bundle has a README, one file per page with its states, mockups, and
endpoints, the models, and the error types. It reads well on GitHub, GitLab, or any Markdown viewer, and
includes the OpenAPI file too.

![An endpoint in the editor](docs/images/endpoint-editor.png)

## Data, backups, and upgrades

Everything (the SQLite database and uploaded mockups) lives in the `/data` volume, so it
survives restarts, upgrades, and removing the container.

**Move or copy one project** to another machine or instance: on the project's **Export**
tab, download its **project file** (`inventory-app.project.zip`), then choose **Import
project** on the other instance's Projects page. The file holds everything in the project,
mockups included. Importing checks it with the same rules as saving does, and happens
completely or not at all. A project that isn't on the instance yet keeps its IDs, so links
to it keep working; one that is comes in as a copy, under a free slug like
`inventory-app-2`. A project file is also a backup of one project, readable as JSON. Its
descriptions are Markdown, so, as in any Markdown viewer, they can show images from other
sites, which load when you open the project.

The backup below copies the whole volume instead: every project at once.

**Back up** to `api-contract-builder-backup.tgz` in the current folder:

```bash
docker stop api-contract-builder
docker run --rm -v api-contract-builder-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/api-contract-builder-backup.tgz -C /data .
docker start api-contract-builder
```

**Restore** a backup, replacing the current data:

```bash
docker stop api-contract-builder
docker run --rm -v api-contract-builder-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/api-contract-builder-backup.tgz -C /data'
docker start api-contract-builder
```

**Upgrade** by pulling the new image and starting a new container on the same volume.
Database migrations run on startup.

```bash
docker pull reggarantai/api-contract-builder:latest
docker rm -f api-contract-builder
docker run -d --name api-contract-builder \
  -p 127.0.0.1:3000:3000 \
  -v api-contract-builder-data:/data \
  reggarantai/api-contract-builder:latest
```

To stay on one minor version, use a tag like `0.1` instead of `latest`; each release is
also tagged with its full version, like `0.1.0`. `latest` and `0.1` also get the base
images' security fixes every week, while `0.1.0` stays exactly as released.
[CHANGELOG.md](CHANGELOG.md) lists what changed.

## Configuration

| Variable        | Default                           | Description                                                                                             |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `HOST`          | `127.0.0.1` (`0.0.0.0` in Docker) | Interface the server listens on                                                                         |
| `PORT`          | `3000`                            | Port the server listens on                                                                              |
| `DATA_DIR`      | `./data` (`/data` in Docker)      | SQLite database and uploaded images                                                                     |
| `MAX_UPLOAD_MB` | `10`                              | Largest mockup image accepted, per file                                                                 |
| `MAX_IMPORT_MB` | `1024`                            | Largest project file Import project takes, and the most it may unpack to; OpenAPI documents up to 16 MB |

## Security

The app has no login, because it's meant for one person on their own machine: keep its
port on `127.0.0.1`. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, tests, and conventions,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it's built and why. Ideas for later
are [issues labeled enhancement](https://github.com/reggarantai/api-contract-builder/issues?q=label%3Aenhancement).

## License

[MIT](LICENSE) © Regga
