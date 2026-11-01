import {
  ENDPOINT_STATUS_LABELS,
  type Endpoint,
  type EndpointBody,
  type EndpointResponse,
  endpointLabel,
  PARAMETER_LOCATIONS,
} from "../../shared/endpoints";
import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
} from "../../shared/json-schema";
import {
  PAGE_STATE_KIND_LABELS,
  type PageState,
  prismHeaderLines,
  type ResolvedCause,
  resolveCause,
  type StateCause,
} from "../../shared/page-states";
import {
  linkLabel,
  type Mockup,
  PAGE_TRIGGER_LABELS,
  type Page,
} from "../../shared/pages";
import type { SecurityScheme } from "../../shared/projects";
import { slugify } from "../../shared/slug";
import { errorResponseParts } from "./error-responses";
import {
  anchorOf,
  blocks,
  cell,
  type FieldContext,
  fieldRows,
  fieldTable,
  jsonBlock,
  table,
  typeLabel,
} from "./markdown";
import { type ExportInput, type ExportOptions, scopeOf } from "./openapi";

/** One row per property of an object schema, without nested fields. */
function topLevelRows(schema: JsonSchema, context: FieldContext) {
  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(properties).flatMap(([name, property]) =>
    fieldRows(
      {
        type: "object",
        properties: { [name]: property },
        required: required.includes(name) ? [name] : [],
      },
      context,
    ).slice(0, 1),
  );
}

/** A table with an Example column, left out when no row has an example. */
function tableWithExamples(
  headers: string[],
  rows: [cells: string[], example: string][],
) {
  return rows.some(([, example]) => example)
    ? table(
        [...headers, "Example"],
        rows.map(([cells, example]) => [...cells, example]),
      )
    : table(
        headers,
        rows.map(([cells]) => cells),
      );
}

/** "`a`", "`a` and `b`", "`a`, `b`, and `c`" */
function andList(items: string[]) {
  return items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * The Markdown bundle for people: a README, one file per page, the models,
 * and the mockup images. Paths are relative to the bundle's folder.
 */
export function buildMarkdownFiles(
  input: ExportInput,
  options: ExportOptions,
  assets: {
    readImage: (mockup: Mockup) => Uint8Array | undefined;
    /** The OpenAPI file to include, or null while the contract isn't valid. */
    openApi: { fileName: string; content: string } | null;
  },
): Record<string, string | Uint8Array> {
  const { project } = input;
  const scope = scopeOf(input, options);
  const modelsById = new Map(input.models.map((model) => [model.id, model]));
  const contextFor = (pathToRoot: string): FieldContext => ({
    model: (id) => modelsById.get(id),
    modelLink: (name) => `${pathToRoot}models.md#${anchorOf(name)}`,
  });
  const pageFile = (page: Page) => `pages/${page.slug}.md`;
  const pagesUsing = (endpoint: Endpoint) =>
    scope.pages.filter((page) =>
      page.endpoints.some((link) => link.endpointId === endpoint.id),
    );
  const errorTypesById = new Map(
    input.errorTypes.map((errorType) => [errorType.id, errorType]),
  );
  const errorTypeLink = (name: string, pathToRoot: string) =>
    `${pathToRoot}error-types.md#${anchorOf(name)}`;
  const endpointsById = new Map(
    input.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );

  const files: Record<string, string | Uint8Array> = {};

  // Images, named by position so they sort like the page shows them.
  const imagePaths = new Map<string, string>();
  for (const page of scope.pages) {
    page.mockups.forEach((mockup, index) => {
      const data = assets.readImage(mockup);
      if (!data) {
        return;
      }
      const base =
        slugify(mockup.originalName.replace(/\.[^.]+$/, "")) || "mockup";
      const extension = mockup.url.split(".").at(-1) ?? "png";
      const imagePath = `images/${page.slug}/${String(index + 1).padStart(2, "0")}-${base}.${extension}`;
      imagePaths.set(mockup.id, imagePath);
      files[imagePath] = data;
    });
  }

  function securityText(endpoint: Endpoint) {
    const keyOf = (id: string | null) =>
      project.securitySchemes.find((scheme) => scheme.id === id)?.key;
    switch (endpoint.security.type) {
      case "none":
        return "None (public)";
      case "schemes":
        return endpoint.security.schemeIds
          .map((id) => keyOf(id) ?? id)
          .join(" or ");
      default: {
        const key = keyOf(project.defaultSecuritySchemeId);
        return key ? `${key} (project default)` : "None (public)";
      }
    }
  }

  function bodySection(body: EndpointBody, context: FieldContext) {
    const rows = fieldRows(body.schema, context);
    return blocks(
      `\`${body.contentType}\` — ${typeLabel(body.schema, context)}`,
      rows.length > 0 && fieldTable(rows),
      ...body.examples.map(
        (example) =>
          `Example \`${example.name}\`${example.summary ? ` — ${example.summary}` : ""}:\n\n${jsonBlock(example.value as JsonValue)}`,
      ),
    ).trimEnd();
  }

  /** A schema with its content type, and its fields when it has some. */
  function schemaSection(
    contentType: string,
    schema: JsonSchema,
    context: FieldContext,
  ) {
    const rows = fieldRows(schema, context);
    return blocks(
      `\`${contentType}\` — ${typeLabel(schema, context)}`,
      rows.length > 0 && fieldTable(rows),
    ).trimEnd();
  }

  /**
   * The bodies of a response with catalog errors, then each error type: its
   * title and when it happens (page files stand alone), and its examples.
   */
  function errorsSection(
    response: EndpointResponse,
    contents: ReturnType<typeof errorResponseParts>["contents"],
    context: FieldContext,
  ) {
    return blocks(
      ...contents.flatMap((content) =>
        // One table per schema: field tables can't show "any of".
        content.schemas.map((schema) =>
          schemaSection(content.contentType, schema, context),
        ),
      ),
      ...response.errors.flatMap((usage) => {
        const errorType = errorTypesById.get(usage.errorTypeId);
        if (!errorType) {
          return [];
        }
        return [
          blocks(
            `[\`${errorType.name}\`](${errorTypeLink(errorType.name, "../")}): **${errorType.title}**`,
            errorType.description,
            ...(usage.examples.length > 0
              ? usage.examples.map(
                  (example) =>
                    `Example \`${example.name}\`${example.summary ? ` — ${example.summary}` : ""}:\n\n${jsonBlock(example.value as JsonValue)}`,
                )
              : [jsonBlock(errorType.body.example)]),
          ).trimEnd(),
        ];
      }),
    ).trimEnd();
  }

  /** A mockup as an image in a page file, with its caption below. */
  function mockupImage(mockup: Mockup) {
    const imagePath = imagePaths.get(mockup.id);
    const label = mockup.caption || mockup.originalName;
    return imagePath
      ? [
          `![${label}](../${imagePath})${mockup.caption ? `\n\n_${mockup.caption}_` : ""}`,
        ]
      : [];
  }

  /**
   * Each state: the calls it waits for, what it shows, the responses that
   * lead to it with the Prism headers that answer with each (when the bundle
   * has the OpenAPI file to mock), and its mockups.
   */
  function statesSection(page: Page) {
    const call = ({ link, endpoint }: ResolvedCause) => {
      const label = endpointLabel(endpoint);
      const trigger = linkLabel(link, endpoint, page.endpoints).slice(
        label.length,
      );
      return `[\`${label}\`](#${anchorOf(label)})${trigger}`;
    };
    const response = (cause: StateCause, resolved: ResolvedCause) => {
      const { errorType, example } = resolved;
      if (errorType) {
        const named =
          cause.type === "error" && cause.exampleId !== null && example
            ? `, example \`${example.name}\``
            : "";
        return `${errorType.status} [\`${errorType.name}\`](${errorTypeLink(errorType.name, "../")})${named}`;
      }
      const status = `${resolved.response?.status} ${cell(resolved.response?.description ?? "")}`;
      return example ? `${status}, example \`${example.name}\`` : status;
    };
    const stateSection = (state: PageState) => {
      const causes = state.causes.flatMap((cause) => {
        const resolved = resolveCause(
          cause,
          page.endpoints,
          endpointsById,
          errorTypesById,
        );
        return "error" in resolved ? [] : [{ cause, resolved }];
      });
      const calls = causes.filter(({ cause }) => cause.type === "request");
      const responses = causes.filter(({ cause }) => cause.type !== "request");
      return blocks(
        `### ${PAGE_STATE_KIND_LABELS[state.kind]}: ${state.name}`,
        calls.length > 0 &&
          `While ${andList(calls.map(({ resolved }) => call(resolved)))} ${calls.length === 1 ? "runs" : "run"}.`,
        state.description,
        responses.length > 0 &&
          table(
            [
              "Comes from",
              "Response",
              ...(assets.openApi ? ["Prism headers"] : []),
            ],
            responses.map(({ cause, resolved }) => [
              call(resolved),
              response(cause, resolved),
              ...(assets.openApi
                ? [
                    resolved.mock
                      ? prismHeaderLines(resolved.mock)
                          .map((line) => `\`${line}\``)
                          .join("<br>")
                      : "—",
                  ]
                : []),
            ]),
          ),
        ...page.mockups
          .filter((mockup) => state.mockupIds.includes(mockup.id))
          .flatMap(mockupImage),
      ).trimEnd();
    };
    return `## States\n\n${page.states.map(stateSection).join("\n\n")}`;
  }

  /**
   * Mockups, or with states, those no state shows: the others are with their
   * states. Null when every mockup is.
   */
  function mockupsSection(page: Page) {
    const shown = new Set(page.states.flatMap((state) => state.mockupIds));
    const rest = page.mockups.filter((mockup) => !shown.has(mockup.id));
    const images = rest.flatMap(mockupImage);
    if (shown.size === 0) {
      return `## Mockups\n\n${images.length > 0 ? images.join("\n\n") : "_No mockups yet._"}`;
    }
    return images.length > 0
      ? `## Other mockups\n\n${images.join("\n\n")}`
      : null;
  }

  function endpointSection(endpoint: Endpoint, page: Page) {
    const context = contextFor("../");
    const when = page.endpoints
      .filter((link) => link.endpointId === endpoint.id)
      .map(
        (link) =>
          `- **When:** ${PAGE_TRIGGER_LABELS[link.trigger]}${link.note ? ` — ${link.note}` : ""}`,
      );
    const parameterRows = PARAMETER_LOCATIONS.flatMap((location) =>
      topLevelRows(endpoint.parameters[location], context).map(
        (row): [string[], string] => [
          [
            `\`${row.field}\``,
            location,
            row.type,
            location === "path" || row.required ? "Yes" : "",
            row.description,
            row.rules,
          ],
          row.example,
        ],
      ),
    );
    const responseSection = (response: EndpointResponse) => {
      const parts =
        response.errors.length > 0
          ? errorResponseParts(response, errorTypesById)
          : undefined;
      const headerRows = topLevelRows(
        parts ? parts.headers : response.headers,
        context,
      ).map((row): [string[], string] => [
        [
          `\`${row.field}\``,
          row.type,
          row.required ? "Yes" : "",
          row.description,
          row.rules,
        ],
        row.example,
      ]);
      return blocks(
        `##### ${response.status} ${response.description}`,
        headerRows.length > 0 &&
          tableWithExamples(
            ["Header", "Type", "Required", "Description", "Rules"],
            headerRows,
          ),
        parts
          ? errorsSection(response, parts.contents, context)
          : response.body
            ? bodySection(response.body, context)
            : "No body.",
      ).trimEnd();
    };

    return blocks(
      `### ${endpointLabel(endpoint)}`,
      endpoint.summary,
      [
        ...when,
        `- **Status:** ${ENDPOINT_STATUS_LABELS[endpoint.status]}`,
        `- **Authentication:** ${securityText(endpoint)}`,
        endpoint.deprecated ? "- **Deprecated:** avoid in new code" : null,
      ]
        .filter(Boolean)
        .join("\n"),
      endpoint.description,
      parameterRows.length > 0 &&
        `#### Parameters\n\n${tableWithExamples(["Name", "In", "Type", "Required", "Description", "Rules"], parameterRows)}`,
      endpoint.requestBody &&
        blocks(
          "#### Request body",
          endpoint.requestBody.required ? "Required." : "Optional.",
          endpoint.requestBody.description,
          bodySection(endpoint.requestBody, context),
        ).trimEnd(),
      `#### Responses\n\n${endpoint.responses.map(responseSection).join("\n\n")}`,
      endpoint.notesFe && `**Notes for frontend:** ${endpoint.notesFe}`,
      endpoint.notesBe && `**Notes for backend:** ${endpoint.notesBe}`,
    ).trimEnd();
  }

  // Pages
  for (const page of scope.pages) {
    const links = page.endpoints.flatMap((link) => {
      const endpoint = scope.endpoints.find(
        (item) => item.id === link.endpointId,
      );
      return endpoint ? [{ link, endpoint }] : [];
    });
    const endpoints = [...new Set(links.map(({ endpoint }) => endpoint))];

    files[pageFile(page)] = blocks(
      `# ${page.name}`,
      `Part of [${project.name}](../README.md).`,
      `## Description\n\n${page.description || "_No description yet._"}`,
      `## Acceptance criteria\n\n${page.acceptanceCriteria || "_None yet._"}`,
      page.states.length > 0 && statesSection(page),
      mockupsSection(page),
      `## Endpoints\n\n${
        links.length > 0
          ? table(
              ["When", "Method", "Path", "Summary", "Status"],
              links.map(({ link, endpoint }) => [
                cell(
                  `${PAGE_TRIGGER_LABELS[link.trigger]}${link.note ? ` — ${link.note}` : ""}`,
                ),
                `\`${endpoint.method}\``,
                `[\`${endpoint.path}\`](#${anchorOf(endpointLabel(endpoint))})`,
                cell(endpoint.summary),
                ENDPOINT_STATUS_LABELS[endpoint.status],
              ]),
            )
          : "_This page doesn't call any endpoints yet._"
      }`,
      ...endpoints.map((endpoint) => endpointSection(endpoint, page)),
    );
  }

  // Models
  // Each model has its own section here, so references link instead of repeating.
  const modelsContext: FieldContext = {
    model: (id) => modelsById.get(id),
    modelLink: (name) => `#${anchorOf(name)}`,
    expand: false,
  };
  files["models.md"] = blocks(
    "# Models",
    `Shared data shapes the endpoints use. Part of [${project.name}](README.md).`,
    scope.models.length === 0 && "_No models yet._",
    ...scope.models.map((model) => {
      const rows = fieldRows(model.schema, modelsContext);
      return blocks(
        `## ${model.name}`,
        model.description,
        `Type: ${typeLabel(model.schema, modelsContext)}`,
        rows.length > 0 && fieldTable(rows),
      ).trimEnd();
    }),
  );

  // Error types
  // Each error type has its own section here, like models in models.md.
  if (scope.errorTypes.length > 0) {
    // Models link to models.md instead of repeating their fields.
    const errorTypesContext: FieldContext = {
      ...contextFor(""),
      expand: false,
    };
    const endpointLink = (endpoint: Endpoint) => {
      const [page] = pagesUsing(endpoint);
      const label = `\`${endpointLabel(endpoint)}\``;
      return page
        ? `[${label}](${pageFile(page)}#${anchorOf(endpointLabel(endpoint))})`
        : label;
    };
    files["error-types.md"] = blocks(
      "# Error types",
      `The errors endpoints answer, each described once. Part of [${project.name}](README.md).`,
      ...scope.errorTypes.map((errorType) => {
        const headerRows = topLevelRows(
          errorType.headers,
          errorTypesContext,
        ).map((row): [string[], string] => [
          [
            `\`${row.field}\``,
            row.type,
            row.required ? "Yes" : "",
            row.description,
            row.rules,
          ],
          row.example,
        ]);
        const returnedBy = scope.endpoints.filter((endpoint) =>
          endpoint.responses.some((response) =>
            response.errors.some((error) => error.errorTypeId === errorType.id),
          ),
        );
        return blocks(
          `## ${errorType.name}`,
          `**${errorType.status}** — ${errorType.title}`,
          errorType.description,
          headerRows.length > 0 &&
            tableWithExamples(
              ["Header", "Type", "Required", "Description", "Rules"],
              headerRows,
            ),
          schemaSection(
            errorType.body.contentType,
            errorType.body.schema,
            errorTypesContext,
          ),
          jsonBlock(errorType.body.example),
          returnedBy.length > 0
            ? `Returned by ${returnedBy.map(endpointLink).join(", ")}.`
            : "No endpoint returns it yet.",
        ).trimEnd();
      }),
    );
  }

  // README
  const howToSend = (scheme: SecurityScheme) => {
    switch (scheme.type) {
      case "bearer":
        return `\`Authorization: Bearer <${scheme.bearerFormat || "token"}>\``;
      case "basic":
        return "`Authorization: Basic <base64 of user:password>`";
      case "apiKey":
        return scheme.in === "header"
          ? `\`${scheme.name}: <key>\``
          : scheme.in === "query"
            ? `\`?${scheme.name}=<key>\``
            : `\`Cookie: ${scheme.name}=<key>\``;
    }
  };
  const defaultScheme = project.securitySchemes.find(
    (scheme) => scheme.id === project.defaultSecuritySchemeId,
  );
  const sortedEndpoints = scope.endpoints;

  files["README.md"] = blocks(
    `# ${scope.page ? `${project.name}: ${scope.page.name}` : project.name}`,
    project.description,
    `API version **${project.apiVersion}**.`,
    `## Contents\n\n${[
      "- [Pages](#pages): what each screen does and which endpoints it calls",
      "- [Models](models.md): shared data shapes",
      scope.errorTypes.length > 0 &&
        "- [Error types](error-types.md): the errors endpoints answer, and when",
      assets.openApi &&
        `- [\`${assets.openApi.fileName}\`](${assets.openApi.fileName}): the contract for code generators and mock servers`,
    ]
      .filter(Boolean)
      .join("\n")}`,
    project.servers.length > 0 &&
      `## Servers\n\n${table(
        ["Name", "URL", "Notes"],
        project.servers.map((server) => [
          cell(server.name),
          server.url,
          cell(server.description),
        ]),
      )}`,
    project.securitySchemes.length > 0 &&
      `## Authentication\n\n${
        defaultScheme
          ? `Unless an endpoint says otherwise, requests use **${defaultScheme.key}**.`
          : "Endpoints are public unless they say otherwise."
      }\n\n${table(
        ["Scheme", "How to send", "Notes"],
        project.securitySchemes.map((scheme) => [
          cell(scheme.key),
          howToSend(scheme),
          cell(scheme.description),
        ]),
      )}`,
    `## Pages\n\n${
      scope.pages.length > 0
        ? table(
            ["Page", "Endpoints", "Mockups"],
            scope.pages.map((page) => [
              `[${cell(page.name)}](${pageFile(page)})`,
              String(
                new Set(page.endpoints.map((link) => link.endpointId)).size,
              ),
              String(page.mockups.length),
            ]),
          )
        : "_No pages yet._"
    }`,
    `## Endpoints\n\n${
      sortedEndpoints.length > 0
        ? table(
            ["Method", "Path", "Summary", "Status", "Pages"],
            sortedEndpoints.map((endpoint) => {
              const pages = pagesUsing(endpoint);
              return [
                `\`${endpoint.method}\``,
                `\`${endpoint.path}\``,
                cell(endpoint.summary),
                ENDPOINT_STATUS_LABELS[endpoint.status],
                pages.length > 0
                  ? pages
                      .map(
                        (page) =>
                          `[${cell(page.name)}](${pageFile(page)}#${anchorOf(endpointLabel(endpoint))})`,
                      )
                      .join(", ")
                  : "—",
              ];
            }),
          )
        : "_No endpoints yet._"
    }`,
    scope.errorTypes.length > 0 &&
      `## Error types\n\n${table(
        ["Status", "Error type", "Title"],
        scope.errorTypes.map((errorType) => [
          errorType.status,
          `[\`${errorType.name}\`](${errorTypeLink(errorType.name, "")})`,
          cell(errorType.title),
        ]),
      )}`,
    assets.openApi
      ? [
          "## Mock the API",
          "Run a mock server from the OpenAPI file in this folder. It answers with the examples from this contract on http://127.0.0.1:4010.",
          [
            "```bash",
            `npx @stoplight/prism-cli mock ${assets.openApi.fileName}`,
            "```",
          ].join("\n"),
          "Ask for a specific response or a named example with the `Prefer` header:",
          [
            "```bash",
            'curl -H "Prefer: code=404" http://127.0.0.1:4010/<path>',
            'curl -H "Prefer: example=<example name>" http://127.0.0.1:4010/<path>',
            "```",
          ].join("\n"),
          ...(scope.pages.some((page) => page.states.length > 0)
            ? [
                "Page files list each state with the headers that make Prism answer with it. Separate preferences with a comma, as in `Prefer: code=404, example=<example name>`: after a semicolon, Prism ignores the example. Loading states have none, since Prism answers right away; slow the network down in the browser's developer tools to see them.",
              ]
            : []),
        ].join("\n\n")
      : "> This contract isn't valid OpenAPI yet, so the bundle has no OpenAPI file. Fix the problems listed on the Export tab and export again.",
  );

  return files;
}
