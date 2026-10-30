import {
  ENDPOINT_STATUS_LABELS,
  type Endpoint,
  type EndpointBody,
  endpointLabel,
  PARAMETER_LOCATIONS,
} from "../../shared/endpoints";
import { isJsonObject, type JsonValue } from "../../shared/json-schema";
import {
  type Mockup,
  PAGE_TRIGGER_LABELS,
  type Page,
} from "../../shared/pages";
import type { SecurityScheme } from "../../shared/projects";
import { slugify } from "../../shared/slug";
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

  function endpointSection(endpoint: Endpoint, page: Page) {
    const context = contextFor("../");
    const when = page.endpoints
      .filter((link) => link.endpointId === endpoint.id)
      .map(
        (link) =>
          `- **When:** ${PAGE_TRIGGER_LABELS[link.trigger]}${link.note ? ` — ${link.note}` : ""}`,
      );
    const parameterRows = PARAMETER_LOCATIONS.flatMap((location) => {
      const schema = endpoint.parameters[location];
      const properties = isJsonObject(schema.properties)
        ? schema.properties
        : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      return Object.entries(properties).map(([name, property]) => {
        const [row] = fieldRows(
          { type: "object", properties: { [name]: property } },
          context,
        );
        return [
          `\`${name}\``,
          location,
          row?.type ?? "",
          location === "path" || required.includes(name) ? "Yes" : "",
          row?.description ?? "",
          row?.rules ?? "",
        ];
      });
    });

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
        `#### Parameters\n\n${table(["Name", "In", "Type", "Required", "Description", "Rules"], parameterRows)}`,
      endpoint.requestBody &&
        blocks(
          "#### Request body",
          endpoint.requestBody.required ? "Required." : "Optional.",
          endpoint.requestBody.description,
          bodySection(endpoint.requestBody, context),
        ).trimEnd(),
      `#### Responses\n\n${endpoint.responses
        .map(
          (response) =>
            `##### ${response.status} ${response.description}\n\n${response.body ? bodySection(response.body, context) : "No body."}`,
        )
        .join("\n\n")}`,
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
    const mockups = page.mockups.flatMap((mockup) => {
      const imagePath = imagePaths.get(mockup.id);
      const label = mockup.caption || mockup.originalName;
      return imagePath
        ? [
            `![${label}](../${imagePath})${mockup.caption ? `\n\n_${mockup.caption}_` : ""}`,
          ]
        : [];
    });

    files[pageFile(page)] = blocks(
      `# ${page.name}`,
      `Part of [${project.name}](../README.md).`,
      `## Description\n\n${page.description || "_No description yet._"}`,
      `## Acceptance criteria\n\n${page.acceptanceCriteria || "_None yet._"}`,
      `## Mockups\n\n${mockups.length > 0 ? mockups.join("\n\n") : "_No mockups yet._"}`,
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
        ].join("\n\n")
      : "> This contract isn't valid OpenAPI yet, so the bundle has no OpenAPI file. Fix the problems listed on the Export tab and export again.",
  );

  return files;
}
