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
- **A project file** (`<slug>.project.zip`) holds one whole project, mockups included, to
  move it to another machine or instance, or to keep it as a backup. Importing one makes a
  new project; see [Project files](#project-files).
- **An OpenAPI document** (3.0, 3.1, or 3.2, JSON or YAML) can start a project too: its
  schemas become models and its operations endpoints, and what a project can't hold is
  reported. See [OpenAPI import](#openapi-import).

## Data

SQLite through better-sqlite3 and Drizzle, in `DATA_DIR/app.db`. Uploaded mockups are
files in `DATA_DIR/uploads/<project id>/`, named by a new ID. IDs are ULIDs. The SQL
migrations in `drizzle/` run on startup. A project file being imported waits in
`DATA_DIR/tmp` while it's read.

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
  `mockups` and order), and `export/openapi`, `export/markdown`, `export/report`, and
  `export/project` (with its own `report`); `POST /api/projects/import` takes a project
  file (`application/zip`) or an OpenAPI document (`application/json`,
  `application/yaml`, and their aliases);
- `/api/samples`: creates the sample project, through the API itself;
- `/api/health`: status, version, when the data directory was created, and the largest
  project file it imports; the Docker healthcheck calls it.

Requests are checked with the Zod schemas in `src/shared`, the same ones the forms use.
Schemas and examples may nest at most 256 levels of objects and lists (`MAX_NESTING`),
checked without recursion before anything follows them; deeper ones are refused with
400. Data saved before the limit can be deeper: a save that leaves it as it was still
goes through, and where something can't follow it, the answer is a 422 that says so (and
the server logs it), not a server error.
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
define differently), grouped by kind with the first ten of each, and **errors**. Errors
come from two checks: the document against the official OpenAPI 3.1 schema, and every
schema against the JSON Schema 2020-12 meta-schema, because the first alone accepts
schemas like `{"type": "strng"}`. A schema whose `$schema` names another dialect
(draft-07, …) is an error of its own: the meta-schema check is 2020-12's (OpenAPI's own
dialect, 2020-12 with its keywords, is checked as 2020-12). The OpenAPI validator follows
every `$ref` it finds, so it gets a copy of the document in which the `$ref`s inside data
(example values, and a schema's `examples`, `default`, `enum`, and `const`) are renamed:
OpenAPI reads those as data, and an API about JSON Schema shows them. A contract with errors
can't be downloaded as OpenAPI. Checking and writing schemas recurse, and give out a few
hundred levels down; the API saves no more than 256, but data saved before can be
deeper. The OpenAPI download then answers 422, the report lists it as an error, and the
Markdown bundle leaves the OpenAPI file out, as for any error (or answers 422 too, where
it can't follow either). For a document deeper than saved data can make, the report also
writes both formats, so it says valid only for what the downloads can write.

**Markdown** (`<project>.contract.zip`): a README (the description, servers,
authentication, pages, endpoints, error types, and how to mock with Prism), `models.md`,
`error-types.md` when there are any, one file per page, the mockups as
`images/<page>/NN-<name>.<ext>`, and the OpenAPI file when the contract is valid.

- **Page files stand alone:** referenced models are expanded in place
  (`data[].category.name`). Expansion stops where a model contains itself; after 500 rows
  of models the table already showed, since models that refer to each other many times
  would otherwise multiply the rows; and 512 levels into fields, since a chain of models,
  each referring to the next, would otherwise go on until expanding ran out of stack. A
  last row then points to `models.md`. A table that shows each model once, and goes no
  deeper than a schema may nest, is never cut.
- **Size:** since page files repeat what they show, a bundle holds at most about 128 MB
  of text; past that, the export answers 422. A bundle near that size takes a few
  seconds and up to about a gigabyte of memory to build.
- **Tables** show types and rules (lengths, ranges, allowed values, patterns, defaults).
  Parameter and header tables add examples, and bodies show theirs as JSON.

A page with states gets a States section in place of Mockups: each state as
`### <Kind>: <name>`, the calls it waits for, its description, a table of the responses
that lead to it with their Prism headers (left out when the bundle has no OpenAPI file),
and its mockups. Mockups no state shows follow under "Other mockups". Pages without
states, and so projects without them, export exactly as before; the README explains the
headers only when some page has states. States don't reach the OpenAPI document.

## Project files

A project file (`<slug>.project.zip`) is one whole project. Its zip has one folder, named
after the slug, with `project.json` and the mockups as `mockups/<id>.<png|jpg|gif|webp>`.
The images are stored as they are, since they're compressed already.

`project.json` starts by saying what it is: `"format": "api-contract-builder/project"`, its
`formatVersion` (1), and the `generator`, the app version that wrote it. Then come the
project's settings, models, error types, endpoints, and pages (with their links, mockups,
and states). Models, error types, and endpoints are listed in ID order; IDs grow as things
are made (while the clock of the instance making them runs forward), so a renamed or
moved part keeps its place in the file and a new one goes last.
Pages and everything inside a part are in the order the project gives them. Each part has the fields the API saves, plus an `id` where
something refers to it. References use those IDs, as the database does: `model:<id>` in
schemas, `errorTypeId`, `endpointId` in links, and mockup IDs in states. IDs inside a
project (servers, schemes, responses, examples, links, states) stay as they are. Left out:
revisions, times, and whatever the instance works out for itself (URLs, image sizes,
`pathKey`). The JSON is indented, one value a line, so a change touches the lines of what
changed (and `generator` changes with the app's version); parts nested more than 64
levels deep are written on one line, since indentation grows with depth. The zip's dates are the project's last change,
so the same server exports an unchanged project as the same bytes.
`test/golden/inventory.project.json` is the sample's file.

An import:

1. streams the upload to a file in `DATA_DIR/tmp`, then reads the zip from there one entry
   at a time;
2. checks `project.json`: the JSON text (RFC 8259, with I-JSON's rules of no name twice in
   an object and no number a double can't hold), then the format and version (an older
   version is upgraded, a newer one is refused, with its version named), then, on the whole
   document, every rule the API applies when the same things are saved through it, after
   the repairs reading stored data makes (`repairEndpointFields`). It lists the first 50
   problems and stops looking there;
3. checks every image by its content, as uploads are checked;
4. keeps the file's IDs when they're all an instance's (ULIDs) and none of them is on this
   instance. Otherwise, as for a second import of the same file, everything gets new IDs and
   every reference follows. A slug that's taken becomes the next free one (`slug-2`), and the
   name stays;
5. writes the images to a folder in `DATA_DIR/tmp`, then saves everything else in one
   transaction, whose last step moves that folder into the uploads directory (copying it
   when uploads is mounted apart). If anything fails, nothing is left. An import cut
   short by a crash leaves its temporary folder, which the next start removes; a crash at
   the instant between the move and the commit can leave an unused folder in uploads, as
   a crash while deleting a project can. Nothing refers to such a folder, and an import
   doesn't count it as taken.

Limits: `MAX_IMPORT_MB` for the file and for what it unpacks to, `MAX_UPLOAD_MB` for each
image (as for uploads), 10,000 entries, and for `project.json` 16 MB, 10,000 levels of
nesting, and a million values. They bound the memory and time a file can take, far above
what a project needs: the largest `project.json` they allow takes a few hundred MB to
import. An import takes schemas and examples exactly as deep as the API saves them, so an
imported project exports as one made in the app would. The Export tab shows the file's size, and warns
when this instance couldn't import it, by any of these limits or rules, and when a
mockup's image is missing from the data directory, since the file then leaves that mockup
out.

## OpenAPI import

`POST /api/projects/import` with an OpenAPI document as the body (the Projects page's
**Import project** sends `.json` as `application/json` and `.yaml`/`.yml` as
`application/yaml`, and anything else by its first bytes) makes a project of it, the same
way a project file does: the document becomes a project file document (format 1), which
`validateProjectFile` checks with every rule the API applies, and the project file
import's writer saves it in one transaction, with new IDs. Code: `src/server/openapi-import`.

**Reading the text.** Limits: 16 MB (or `MAX_IMPORT_MB`, if lower), 272 levels of nesting
(`MAX_NESTING` plus the 16 levels a schema or example sits deep in a document), and a
million values, as for project files. All are checked before anything that recurses or
builds a tree.

- JSON is UTF-8 (RFC 8259) and read by the project file import's checker: no name twice
  in an object and no number a double can't hold (I-JSON).
- YAML is YAML 1.2, in UTF-8, UTF-16, or UTF-32 (by its byte order mark or zero bytes),
  read with the `yaml` package, in a worker thread whose heap is limited to the server's
  own (`yaml-reader.ts`, a second entry of the server build), in steps:
  1. its lexer counts the tokens, at most a million (every token but spaces, line
     breaks, and the closing bracket of a collection it opened, since an empty item, a
     comment, or a stray closing bracket costs memory too), and the line breaks, at most
     a million (the tree keeps a small token for each, blank lines too), so the tree's
     size is bounded before it's built;
  2. its parser makes the syntax tree, whose depth is counted without recursion;
  3. its composer, with the core schema, no merge keys, and string keys;
  4. our own walk to plain values, without recursion.

  The walk allows only the tags of YAML's JSON schema ruleset, as OpenAPI says (`!!str`,
  `!!int`, …; `!!binary`, `!!timestamp`, and custom tags are refused). It refuses keys
  twice in a mapping (with a Set: yaml's own check compares each key with every one
  before it, 17 s for 40,000 keys), a `<<` merge key (YAML 1.1's), a `%YAML` other than
  1.2, `.inf` and `.nan`, and anything yaml warns about. It copies what an alias points
  at, resolving it to the anchor before it, once, and counts every copied value, so a
  "billion laughs" stops at a million, and the text of every copied string and key, at
  most 16 MB in all (as much as the file may have, so only copies can reach it); an alias
  inside what it points at is refused.
- Both keep `__proto__` as a key, and report integers a double changes.
- The text of a YAML plain scalar that isn't a string is kept for fields that must be
  text: `version: 1.0` is "1.0". The worker sends it back by the object it's in (a
  worker's answer keeps which object is which), not by its path, so it costs a few
  slots a scalar however deep the document is.
- OpenAPI imports run one at a time, from reading to writing: each can take much of the
  server's memory, a YAML worker as much heap as the server has. Three more wait, each
  holding its document (16 MB at most); while one runs and three wait, another answers
  503 with `Retry-After: 1` before its document is received, so it holds nothing, and
  **Import project** waits its turn as asked, for a minute at most. A document that
  takes more than a minute to arrive is stopped (408), giving its turn back.

**Versions.** OpenAPI 3.0.x, 3.1.x, and 3.2.x (read as 3.1 is: 3.2 adds without changing,
and what it adds that a project can't hold is reported). Swagger 2.0 is refused with how
to convert it; so are other versions, a version that isn't text, and a project.json.

**References.** Nothing is ever fetched. A `$ref` is a JSON Pointer into the document
(percent-decoded, then `~1` and `~0`, following own properties only), or a URI that
resolves, by RFC 3986, to the document's `$self` (3.2) or to a schema's `$id` in it (3.1).
Anything else (another file, a URL, `file:`) is refused, every one listed, with a hint to
bundle the document. Outside schemas, only fields that take a Reference Object are
followed (in 3.2 a media type too); a chain of them is followed once, however many places
lead through it, and one that comes back is refused. Inside schemas, the app's own rules
say where `$ref`s are: everywhere but the data keywords (`examples`, `example`,
`default`, `enum`, `const`). Each schema's `$ref` is located once, however often the
schema is copied, and a chain of schemas that are only references is followed in a loop,
so its length takes no stack. The 3.1 `$id`s and `$anchor`s are indexed with a link to
the place each value is in, not its path, and a path is worked out only for a place a
reference names.

**Copies count.** What references copy in counts against the million values, as the
document's own values do: schemas and examples, and parameters, headers, responses,
media types, examples, and every field and key read, so a part used by a thousand
operations costs a thousand times what it holds, and a small document that would become
millions of values is refused ("more than 1,000,000 values once its references are copied
in"). Its text counts too: copies share their strings in memory, but the database and
every export write each one out, so the project may hold at most 16 MB of text (strings
and names, as much as a document may have) once references are copied in; 250 KB whose
2,000 responses use one example of 100 KB would be 200 MB. It's measured while each
response still has its own body and headers, as the exports write them: an error type
holds its schema and headers once, but the OpenAPI export writes them into every
response that uses it. The exports write more than the project holds, though, so
before it's saved the import builds both once and measures them as the downloads write
them: the OpenAPI download may take 32 MB, about twice GitHub's (16 MB as JSON), counted
as `JSON.stringify(doc, null, 2)` writes it (each value on its own line, indented two
spaces a level), with escapes as JSON or YAML writes them, whichever is longer, and each
line of a text YAML writes as a block indented as deep as it sits; the Markdown files may
take 16 MB. The OpenAPI export writes each page into every operation it links (tags and
`x-pages`) and a model's name into every reference to it, and the Markdown bundle writes
every endpoint into each page that calls it, and each nested field with the names of the
fields it's in. That takes about a tenth of a second for GitHub's; links, each writing
its page's name and slug, are counted first, so building them can't cost much either.
Measured in a 587 MB heap with the import in the same process, exports of 30 MB as
written (indented or escaped) peaked at 450–560 MB; 36 MB of OpenAPI made of page links
took 550 MB more, and so did 42 MB of Markdown. Nothing costs more for being
deep or for long names: notices tell places apart by the object they're in and their key,
never by a pointer (which, in a small document, can be megabytes long), each note at a
place is a small number, and a place a notice or a refusal shows is cut to 1,000
characters. Names made unique (models, operation IDs, slugs) remember, for each start
they're cut to and each length of number, how far their numbers are taken, so ten
thousand alike names take linear time, cut to fit or not.

| OpenAPI                                                | Project                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `info.title`, `version`, `description`                 | name (and slug), API version, description                                                            |
| `servers`                                              | servers: 3.2's `name`, or the description ("Name — description" splits); URL variables get defaults  |
| `components.securitySchemes`                           | bearer, basic, API key; OAuth 2.0 and OpenID Connect as bearer, their flows in the description       |
| `security`, an operation's `security`                  | the default scheme, or any one of some schemes, or none                                              |
| `components.schemas`                                   | models, renamed only to fit the app's names; their `description` the model's                         |
| `$ref` to `#/components/schemas/X`                     | a model reference                                                                                    |
| any other `$ref`                                       | a copy of what it points at (a pointer that comes back to itself makes its schema a model)           |
| `paths` × get, put, post, delete, options, head, patch | endpoints; `x-status`, `x-notes-fe`, `x-notes-be` back as what they were                             |
| `operationId`                                          | kept, changed to the app's letters, numbers, and underscores; left empty where the export derives it |
| parameters in path, query, header                      | one property each, with its description and examples                                                 |
| a request body, a response's content                   | its one media type (JSON first), named examples                                                      |
| `components.examples` used by error responses          | error types, where the export writes those responses back the same                                   |
| tags and `x-pages`, as this app writes them            | pages and their links                                                                                |

OpenAPI 3.0's Schema Objects become JSON Schema 2020-12 as OpenAPI 3.0.3 defines them:
`nullable: true` adds `"null"` to a `type` (and has no effect without one, which is
reported, since the `allOf` "nullable reference" then doesn't allow null), boolean
`exclusiveMinimum`/`exclusiveMaximum` become numbers, `example` becomes `examples`, a
`$ref`'s siblings are left out but for annotations, and a `$schema` is left out. 3.1's
schemas are taken as they are, but for 3.0's boolean bounds, which become 3.1's numbers
with a notice. A `$ref` whose target is copied, beside other keywords, goes first in an
`allOf` with what they add, an `allOf` beside it included. A `$schema` that isn't
2020-12's or OpenAPI's dialect, or isn't a URI at all, is kept, and the Export tab lists
it.

**Error types.** This app's export writes each error type once, in `components.examples`,
and a response that uses it as `examples.<name>: {$ref}`; an endpoint's own examples of it
are inline, with the same problem `type` (RFC 9457 identifies a problem type by it). So
every component example that error responses use, by its own name or by its `type`
(never `about:blank`, a type two examples share, or a `status` that doesn't fit), is a
candidate, with the status, media type, and schema of the responses that use it. A
response is given error types only when the export's own `errorResponseParts`, run on the
result, writes exactly the content and headers the document has; the headers the export
merged in go back to an error type only where that's certain (an "Only with `x`" note, or
the same header everywhere it's used alone, at least twice). Everywhere else a response
keeps a plain body, each example copied in under its own name.

**Pages** come back only from what this app writes: when some operation has `x-pages`, or
every one has its `x-status`, the tags are pages and each `x-pages` entry a link.
Another document's tags group operations, which isn't what a page is: its endpoints start
without pages, and the Export tab lists them as unused until pages link them.

**Notices.** Whatever a project can't hold is reported, never dropped quietly: cookie
parameters, other media types, callbacks, links, webhooks, extensions and unknown fields
(one notice for all extensions, and one for each kind of part, with a few of the names:
a document may have a million),
unused components, scopes, security requirements naming schemes the document doesn't
define (which can leave an operation public), shortened texts, renamed names, examples
without a value, and more, each kind once with how many places, the first few, and the
JSON Pointer of the first. Whatever breaks a rule
of the app (a response without a description, a name it can't take, an example without a
value) is repaired or left out with a notice, so what the converter makes always passes
the project file's rules and exports (tested on a thousand random mutations of each
fixture, values whose `toString` isn't a function included). A value of the document is
never turned into text with `String()`, which throws for `{"toString": 1}`; a mistake in
the app is refused with a request to report it, never answered with a server error.
**Import project** lists the notices before opening the project, with a button to copy
them.

**Cost.** On the Mac this was built on, in a fresh process: GitHub's REST API description
(1,272 operations, 1,010 schemas) takes 0.65 s and 440 MB as JSON (14 MB), 2.7 s and
880 MB as YAML (11 MB, the worker's heap included); Stripe's takes 0.4 s and 350 MB as
JSON (8 MB), 1.5 s and 670 MB as YAML. Measuring its exports is a tenth of a second of
that. GitHub's counts about 324,000 of the million values, and 7 MB of the 16 MB of
text, once its references are copied in. The Export tab's report of such a project takes
about half a second. YAML costs more because its syntax tree takes about 0.7 KB a token,
so a file of 1.5 MB can need several hundred MB to read; in the worker, one that needs
more than the server's heap is refused ("needs more memory to read than this instance
gives it"), and the server goes on. In a container limited to 1 GB (where Node takes a
587 MB heap), all of the above import, and documents made to cost the most are refused or
imported without stopping the server, their exports included: one made of empty maps at
the token limit, 770 KB of YAML with 60,000 numbers 260 levels deep, 1.8 MB of 3.1 JSON
with 900,000 values 250 levels deep, 183 KB whose 1,000 responses refer to one with
10,000 headers, 808 KB whose 4,000 responses share 20,000 media types, 8 MB of blank
lines, 2 million stray closing brackets, 15 MB whose 450,000 notices sit under 120 levels
of 60,000-character names (whose exports would be too large), 4.35 MB with 400,000
extensions on one operation, 251 KB of JSON or 121 KB of YAML that copies a 100 KB
example thousands of times, 1.08 MB whose 300 responses share one error response with a
1 MB schema or header, 1.44 MB whose 7,000 pages link one operation 50 paths share,
137 KB of 1,000 references to a model with a long name in a response 450 operations use,
and 1.8 MB whose model nests 125 levels deep over a list of 900,000 values (462 MB once
indented) or 626 KB whose 150 responses share 100 KB of control characters (92 MB once
escaped).
A project imported from a document that large can be more than a project file holds
(GitHub's would be 16.3 MB of project.json); the Export tab says so.

## Client

A React single-page app built with Vite: TanStack Router (file-based routes) and Query,
shadcn/ui on Tailwind CSS, and CodeMirror for JSON (loaded only when needed). Code is
grouped by area in `src/client/features`.

The schema builder edits the JSON Schema document in place, so switching between the
builder and JSON loses nothing, and keywords the builder doesn't know are kept. Subschemas
it can't edit (`oneOf`, `if`/`then`, `const`, …) show as Custom and are edited as JSON.

The Export tab downloads OpenAPI and Markdown through `fetch`, so a refused export shows
its reason in a toast instead of a failed download. The project file is a plain link,
since it can be gigabytes of mockups; its report says beforehand what would stop it.

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
- **Vitest, for OpenAPI imports**: every reading rule and limit (with the YAML shapes
  that cost memory without values); references; each mapping rule; error types and
  pages; the frozen documents in `test/fixtures/openapi` (3.0 and 3.1 as JSON and YAML,
  and 3.2) against the project files, notices, and OpenAPI they become in
  `test/golden/openapi-import` (a JSON and a YAML form of one document import the same);
  the sample's OpenAPI export imported into an empty instance, whose export must be the
  same bytes, for the whole project and every page, with what the project loses locked;
  random mutations of the fixtures, which must never make the import throw and whose
  projects must export; what a small document can make the import do (copies a
  reference makes, long chains, deep places with long names, thousands of alike names),
  timed, and in a separate process with a small container's heap for what costs memory
  (`limits.test.ts`); and the operation IDs left empty against the fixpoint they replace.
  Every protection was checked by disabling it and seeing a test fail.
- **Vitest, for project files**:
  - the sample's file against `test/golden/inventory.project.json`, with IDs normalized;
  - round trips into an empty instance, whose OpenAPI and Markdown exports must be
    byte-identical;
  - the frozen version 1 file in `test/fixtures/project-file-v1`, also zipped by real tools
    (Finder, Info-ZIP with and without ZIP64, libarchive, Python);
  - the zip reader against crafted and randomly mutated archives;
  - the JSON checker against `JSON.parse`.
- **Playwright**: everything a person does in the browser, against the production build.
- **The image**: `scripts/smoke-test-image.sh` runs a built image the way users do, and
  Trivy scans it for vulnerabilities that already have a fix.

## Decisions

The calls that shape the code, and why. Earlier plans and their history are in git.

- **Local, one author, no accounts.** The author owns the data, and contracts reach others
  as exports, so there's no login, permission, or hosting to build.
- **No built-in mock server.** Prism serves the exported OpenAPI well (named examples,
  `Prefer` headers, request validation), and a standard export works with any OpenAPI
  tool.
- **SQLite and files in one volume**, so a backup is a copy of the volume. One project
  moves as a project file.
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
- **A project file is a zip of JSON and the images**, like OpenDocument, EPUB, or Sketch
  files. Anyone can open one, `project.json` reads and diffs well, and the images stay
  files.
  - JSON rather than YAML: its parser has nothing to expand or guess (YAML has aliases and
    implicit types), and it's what the API speaks.
  - One document rather than a file per part: that's what a version snapshot (#4) would
    store and what an OpenAPI import (#2) would produce. The parts refer to each other by
    ID, never by position, so splitting them into files later, for contracts kept in Git,
    wouldn't change them.
- **References in a project file keep the database's IDs, not names**, and parts are listed
  in ID order, so a rename changes that part's own lines, which is what a diff of two
  versions needs. `refsToComponentNames` gives the names to anyone who wants them. IDs are
  ULIDs from a monotonic generator, so their order is the order things were made in.
- **One format version, upgraded a step at a time.** Anything that changes what a file can
  hold raises `formatVersion` and adds an upgrade from the version before. Files of every
  older version keep importing (`test/fixtures/project-file-v1` never changes). A newer
  file is refused with its version named, rather than half read. A rule that gets
  stricter either comes with a repair where stored data is read, which imports run too
  (`repairEndpointFields`, which makes response IDs unique), or raises the version with an
  upgrade that does it. Upgrades read files from outside, so one that fails refuses the
  file.
- **An import keeps the file's IDs when it can, all or none.** A restored project keeps its
  URLs, and exporting it again gives back the same `project.json`. Keeping only some IDs would
  mix two projects, so when any is taken, all are new, and the answer says it's a copy.
- **An import is checked whole against the API's rules, then written once.** Going through
  the routes would take dozens of saves: others could see a half-done project, and a crash
  could leave one. Here the shared rules run as functions (the Zod schemas,
  `checkResponseErrors`, `checkPageStates`, `modelRefIssues`, `checkMockupImage`), and the
  few checks the routes make against the database run against the document. Then one
  transaction writes everything. Unknown fields are refused, unlike in the API: the API
  drops them so older clients keep working, but a file states its version, so an unknown
  field means a typo or a change that would otherwise be lost.
- **Project files are read by their own zip reader** (`src/server/project-file/zip.ts`,
  on Node's zlib). fflate writes them, but its reader doesn't check CRC-32, allocates as
  much as an entry claims to unpack to, and lets a later entry win over an earlier one with
  the same name. This reader refuses:
  - unsafe and repeated names (zip-slip);
  - entries that share bytes (overlapping zip bombs);
  - encryption;
  - ZIP64 values that disagree with the plain record.

  It also checks an entry's packed size against what it unpacks to before reading it,
  unpacks it only up to the size it declares, and checks the length and the CRC-32. It reads names the way real tools write them: UTF-8 with or without the flag,
  CP437 otherwise, NFC, and backslashes as separators. Entry names are never used as paths:
  imported images get new file names.
- **Schemas and examples nest at most 256 levels, checked without recursion.** Validating,
  writing, and walking schemas recurse, so the stack decides where they give out, and the
  JIT moves that point: in a cold process the exports gave out between 500 and 600 levels
  of `items` or `not`, and further once the code is warm. A limit counted without
  recursion is the same everywhere, so the API, an import, and every export agree, and no
  saved schema is too deep to export. 256 is about half the coldest point and far above
  what schemas need (the sample's deepest is under 10). It's checked where things are
  saved, not in the shared Zod schemas, because the client parses what it reads with
  those, and data saved before the limit must still open; a save that leaves such data
  as it was goes through, so only what changes must fit.
- **Imports choose by `Content-Type`, on one endpoint.** It's one resource, "a project
  from a file", in two representations, as HTTP intends: `application/zip` (or
  `application/x-zip-compressed`, as Windows names it) for project files, and for OpenAPI
  documents `application/json`, `application/yaml` and the aliases RFC 9512 lists, or
  OpenAPI's own types. A 415 lists them all in `Accept` (RFC 9110). A browser has to ask
  the server before sending any of them from another site, and the server doesn't answer,
  so a page elsewhere can't import into the local app; HTML forms can't send them at all.
  Clients from before keep sending zips as they did.
- **An OpenAPI document becomes a project file document, imported by the same code.** One
  set of rules decides what a project can hold, and one writer saves it in a transaction,
  so an OpenAPI import can't make a project that saving through the API couldn't. The
  converter repairs what the rules refuse, with a notice, and the rules still check
  everything it makes.
- **YAML is read with the `yaml` package already used for exports, and our own walk.** It
  follows YAML 1.2 closely and says where in the text a problem is. Its defaults aren't
  safe for untrusted text: its duplicate key check is quadratic, its alias limit refuses
  an anchor used more than about a hundred times (real documents do), `toJS` would make
  shared and cyclic objects, and a tag like `!!binary` becomes a Buffer. So its composer
  makes the tree, and the walk checks every rule with bounded work. js-yaml 5 builds no
  tree and would take less memory, but it's a new dependency; the token limit bounds what
  the tree costs.
- **YAML is read in a worker thread with a heap limit.** Its memory follows its tokens,
  not its size, and differs by shape: GitHub's description needs about 0.6 KB a token,
  a file of empty items 0.7 KB. No fixed limit lets GitHub's 11 MB in and keeps a 1.5 MB
  file made of empty items within a small container: in a 1 GB one, that file stopped the
  whole server ("heap out of memory"). A check of the memory left before reading would
  depend on when garbage was last collected. In a worker whose heap is the server's own,
  the same file is refused with the reason and the server goes on, while everything the
  server could read before still reads. The server also keeps answering while a large
  document is read, and a document that takes more than two minutes is stopped. Readings
  wait for each other, since two workers could each take the whole heap. What a worker
  sends back is the document and, for each scalar whose text fields need, its object, not
  its path: paths cost scalars × depth, and 124 KB of deep YAML stopped the server that
  way after the worker had finished.
- **What references copy in counts, and nothing costs more for being deep.** The reading
  limits bound a document's text, but references multiply what it becomes: 183 KB whose
  1,000 responses refer to one with 10,000 headers is 10 million headers. So every part a
  reference brings in counts against the million values each time, fields read included,
  not only the schemas copied, and the text it holds counts against 16 MB: a project of a
  few hundred MB imported fine, then stopped the server (587 MB of heap) when its Export
  tab opened. A project of 16 MB of text exports everything there at about 620 MB of
  memory; 32 MB took 830 MB, too close to a 1 GB container. And a small document can reach many places with long
  pointers (272 levels of 60,000-character names), so nothing per place builds a
  pointer: places are told apart by their object and key, indexes link to parents, a
  shown pointer is cut to 1,000 characters, and a schema's `$ref` is located once.
  Names made unique remember how far their numbers are taken, and so does the export's
  operation ID numbering, which the Export tab runs on every view: 20,000 alike names took
  10 to 18 seconds before.
- **Nothing a document refers to is fetched**, neither another file nor a URL, so an
  import can't read the server's files or reach its network (SSRF). A `$ref` by `$id` or
  `$self` to a schema in the same document is followed, since the document is whole.
- **OpenAPI 3.0 is read as 3.0.3 defines it.** Patch versions clarify, and 3.0.3 says
  `nullable` adds null to a `type` and does nothing without one. Many documents mean "this
  reference may be null" by `nullable` beside `allOf`; changing that by guessing would
  turn a contract into another, so each such place is reported with how to allow null.
- **Error types come back only where the export would write the same response.** Reading
  the catalog back from merged responses is a guess, so the export's own function checks
  each one; RFC 9457's `type` tells an endpoint's own examples of an error type apart. An
  error type's headers stay on its responses where whose they are can't be told.
- **Pages come only from this app's own extensions.** OpenAPI tags group operations by
  topic ("pets", "store"), not by screen, so they aren't pages; making them pages would
  invent a page structure the document doesn't have.
- **Notices are grouped and shown once, not stored.** They describe the import, not the
  project, and would go stale as soon as the project changes; **Copy notices** keeps
  them. The answer lists each kind once, so a thousand operations make a short list.
- **The project file's limits stay.** Raising project.json past 16 MB for the largest
  imports would make importing a project file take several times the memory, and
  instances of 0.4.0 couldn't import such files; very large imports move as OpenAPI.
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
