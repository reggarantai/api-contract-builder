import { Validator } from "@seriousme/openapi-schema-validator";
import Ajv2020 from "ajv/dist/2020.js";
import {
  type Endpoint,
  type EndpointBody,
  type EndpointResponse,
  type EndpointStatus,
  endpointLabel,
  HTTP_METHODS,
  PARAMETER_LOCATIONS,
  type ParameterLocation,
  schemasOfEndpoint,
  suggestOperationId,
} from "../../shared/endpoints";
import {
  type ErrorType,
  isProblemDetails,
  schemasOfErrorType,
} from "../../shared/error-types";
import type { LintIssue } from "../../shared/export";
import {
  collectRefs,
  DATA_KEYWORDS,
  isJsonObject,
  type JsonSchema,
  type JsonValue,
  modelIdOfRef,
  refsToComponentNames,
  SCHEMA_MAP_KEYWORDS,
} from "../../shared/json-schema";
import type { Model } from "../../shared/models";
import type { Page, PageTrigger } from "../../shared/pages";
import type { Project, SecurityScheme } from "../../shared/projects";
import { errorResponseParts } from "./error-responses";

/** Everything an export reads, as the API returns it. */
export type ExportInput = {
  project: Project;
  models: Model[];
  endpoints: Endpoint[];
  pages: Page[];
  /** The error catalog, by status and name. */
  errorTypes: ErrorType[];
};

/** Export the whole project, or only what one page uses. */
export type ExportOptions = { pageId?: string };

type HttpMethodKey = Lowercase<(typeof HTTP_METHODS)[number]>;

type Operation = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: true;
  security?: Record<string, string[]>[];
  parameters?: JsonSchema[];
  requestBody?: JsonSchema;
  responses: Record<string, JsonSchema>;
  "x-status": EndpointStatus;
  "x-notes-fe"?: string;
  "x-notes-be"?: string;
  "x-pages"?: {
    page: string;
    slug: string;
    trigger: PageTrigger;
    note?: string;
  }[];
};

export type OpenApiDocument = {
  openapi: "3.1.0";
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description: string }[];
  tags?: { name: string; description?: string }[];
  security?: Record<string, string[]>[];
  paths: Record<string, Partial<Record<HttpMethodKey, Operation>>>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    examples?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, JsonSchema>;
  };
};

// --- Scope ------------------------------------------------------------------

function compareEndpoints(a: Endpoint, b: Endpoint) {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  return HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method);
}

function modelRefsIn(schema: JsonSchema) {
  return collectRefs(schema).flatMap((ref) => {
    const id = modelIdOfRef(ref);
    return id === null ? [] : [id];
  });
}

/** The error types an endpoint's responses use. */
function errorTypeIdsOf(endpoint: Endpoint) {
  return endpoint.responses.flatMap((response) =>
    response.errors.map((error) => error.errorTypeId),
  );
}

/** The pages, endpoints, error types, and models an export includes. */
export function scopeOf(input: ExportInput, { pageId }: ExportOptions) {
  if (pageId === undefined) {
    return {
      page: undefined,
      pages: input.pages,
      endpoints: input.endpoints,
      errorTypes: input.errorTypes,
      models: input.models,
    };
  }
  const page = input.pages.find((item) => item.id === pageId);
  if (!page) {
    throw new Error(`No page ${pageId} in this project`);
  }
  const endpoints = input.endpoints.filter((endpoint) =>
    page.endpoints.some((link) => link.endpointId === endpoint.id),
  );
  const usedErrorTypes = new Set(endpoints.flatMap(errorTypeIdsOf));
  const errorTypes = input.errorTypes.filter((errorType) =>
    usedErrorTypes.has(errorType.id),
  );

  // Models the endpoints and errors use, and the models those use, and so on.
  const modelsById = new Map(input.models.map((model) => [model.id, model]));
  const used = new Set<string>();
  const pending = [
    ...endpoints.flatMap((endpoint) => schemasOfEndpoint(endpoint)),
    ...errorTypes.flatMap((errorType) => schemasOfErrorType(errorType)),
  ].flatMap(([, schema]) => modelRefsIn(schema));
  while (pending.length > 0) {
    const id = pending.pop() as string;
    const model = modelsById.get(id);
    if (model && !used.has(id)) {
      used.add(id);
      pending.push(...modelRefsIn(model.schema));
    }
  }
  const models = input.models.filter((model) => used.has(model.id));
  return { page, pages: [page], endpoints, errorTypes, models };
}

// --- Building ---------------------------------------------------------------

function withText<T extends object>(target: T, key: string, value: string) {
  return value ? { ...target, [key]: value } : target;
}

function securitySchemeObject(scheme: SecurityScheme): JsonSchema {
  const base: JsonSchema =
    scheme.type === "apiKey"
      ? { type: "apiKey", in: scheme.in, name: scheme.name }
      : scheme.type === "bearer"
        ? withText(
            { type: "http", scheme: "bearer" },
            "bearerFormat",
            scheme.bearerFormat,
          )
        : { type: "http", scheme: "basic" };
  return withText(base, "description", scheme.description);
}

/**
 * Builds an OpenAPI 3.1 document. Model references become component
 * references, each property of a parameters schema becomes a parameter, and
 * pages become tags plus `x-pages` on the operations they call.
 */
export function buildOpenApi(
  input: ExportInput,
  options: ExportOptions = {},
): OpenApiDocument {
  const { project } = input;
  const scope = scopeOf(input, options);
  const modelNames = new Map(
    input.models.map((model) => [model.id, model.name]),
  );
  const toRefs = (schema: JsonSchema) =>
    refsToComponentNames(schema, (id) => modelNames.get(id));
  const schemeKeys = new Map(
    project.securitySchemes.map((scheme) => [scheme.id, scheme.key]),
  );

  // Tags: one per page; a repeated page name gets its slug.
  const tagNames = new Map<string, string>();
  const usedTags = new Set<string>();
  for (const page of scope.pages) {
    const name = usedTags.has(page.name)
      ? `${page.name} (${page.slug})`
      : page.name;
    tagNames.set(page.id, name);
    usedTags.add(name);
  }

  // Operation IDs: explicit ones first, then unique suggestions. Each base
  // remembers how far its numbers are taken, so endpoints that share one
  // take linear time.
  const endpoints = [...scope.endpoints].sort(compareEndpoints);
  const usedIds = new Set(
    endpoints.map((endpoint) => endpoint.operationId).filter(Boolean),
  );
  const nextNumber = new Map<string, number>();
  const operationIds = new Map<string, string>();
  for (const endpoint of endpoints) {
    let id = endpoint.operationId;
    if (!id) {
      const base = suggestOperationId(endpoint.method, endpoint.path);
      let n = nextNumber.get(base) ?? 1;
      id = n === 1 ? base : `${base}${n}`;
      while (usedIds.has(id)) {
        n++;
        id = `${base}${n}`;
      }
      nextNumber.set(base, n + 1);
      usedIds.add(id);
    }
    operationIds.set(endpoint.id, id);
  }

  // The pages that link each endpoint, in page order, then link order.
  const linksOf = new Map<
    string,
    { page: Page; link: Page["endpoints"][number] }[]
  >();
  for (const page of scope.pages) {
    for (const link of page.endpoints) {
      const links = linksOf.get(link.endpointId);
      if (links) links.push({ page, link });
      else linksOf.set(link.endpointId, [{ page, link }]);
    }
  }

  function content(body: EndpointBody) {
    const media: JsonSchema = { schema: toRefs(body.schema) };
    if (body.examples.length > 0) {
      media.examples = Object.fromEntries(
        body.examples.map((example) => [
          example.name,
          { ...withText({}, "summary", example.summary), value: example.value },
        ]),
      );
    }
    return { [body.contentType]: media };
  }

  /**
   * One parameter or header object per property of an object schema, with
   * the property's description moved out of its schema.
   */
  function fieldObjects(
    schema: JsonSchema,
    alwaysRequired = false,
  ): [string, JsonSchema][] {
    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    const required = new Set(
      Array.isArray(schema.required) ? schema.required : [],
    );
    return Object.entries(properties).map(([name, property]) => {
      const { description, ...rest } = isJsonObject(property) ? property : {};
      const field: JsonSchema = {};
      if (alwaysRequired || required.has(name)) {
        field.required = true;
      }
      if (typeof description === "string" && description) {
        field.description = description;
      }
      field.schema = toRefs(
        typeof description === "string" || description === undefined
          ? rest
          : { ...rest, description },
      );
      return [name, field];
    });
  }

  function parameters(endpoint: Endpoint) {
    return PARAMETER_LOCATIONS.flatMap((location: ParameterLocation) =>
      fieldObjects(endpoint.parameters[location], location === "path").map(
        ([name, field]) => ({ name, in: location, ...field }),
      ),
    );
  }

  const errorTypesById = new Map(
    input.errorTypes.map((errorType) => [errorType.id, errorType]),
  );

  function response(response: EndpointResponse): JsonSchema {
    const object: JsonSchema = { description: response.description };
    const parts =
      response.errors.length > 0
        ? errorResponseParts(response, errorTypesById)
        : undefined;
    const headers = fieldObjects(parts ? parts.headers : response.headers);
    if (headers.length > 0) {
      object.headers = Object.fromEntries(headers);
    }
    if (parts) {
      // The catalog's examples are components; an endpoint's own stay here.
      const content: JsonSchema = {};
      for (const item of parts.contents) {
        const examples: JsonSchema = {};
        for (const example of item.examples) {
          examples[example.name] = example.own
            ? {
                ...withText({}, "summary", example.own.summary),
                value: example.own.value,
              }
            : { $ref: `#/components/examples/${example.errorType.name}` };
        }
        content[item.contentType] = { schema: toRefs(item.schema), examples };
      }
      object.content = content;
    } else if (response.body) {
      object.content = content(response.body);
    }
    return object;
  }

  function operation(endpoint: Endpoint): Operation {
    const links = linksOf.get(endpoint.id) ?? [];
    const tags = [
      ...new Set(links.map(({ page }) => tagNames.get(page.id) ?? page.name)),
    ];
    const params = parameters(endpoint);

    // Keys are added in the order they read best in the exported file.
    const op: Partial<Operation> = {
      operationId: operationIds.get(endpoint.id) ?? "",
    };
    if (endpoint.summary) op.summary = endpoint.summary;
    if (endpoint.description) op.description = endpoint.description;
    if (tags.length > 0) op.tags = tags;
    if (endpoint.deprecated) op.deprecated = true;
    if (endpoint.security.type === "none") {
      op.security = [];
    } else if (endpoint.security.type === "schemes") {
      op.security = endpoint.security.schemeIds.map((id) => ({
        [schemeKeys.get(id) ?? id]: [],
      }));
    }
    if (params.length > 0) op.parameters = params;
    if (endpoint.requestBody) {
      const { requestBody } = endpoint;
      op.requestBody = {
        ...withText({}, "description", requestBody.description),
        ...(requestBody.required ? { required: true } : {}),
        content: content(requestBody),
      };
    }
    op.responses = Object.fromEntries(
      endpoint.responses.map((item) => [item.status, response(item)]),
    );
    op["x-status"] = endpoint.status;
    if (endpoint.notesFe) op["x-notes-fe"] = endpoint.notesFe;
    if (endpoint.notesBe) op["x-notes-be"] = endpoint.notesBe;
    if (links.length > 0) {
      op["x-pages"] = links.map(({ page, link }) => ({
        page: page.name,
        slug: page.slug,
        trigger: link.trigger,
        ...(link.note ? { note: link.note } : {}),
      }));
    }
    return op as Operation;
  }

  const paths: OpenApiDocument["paths"] = {};
  for (const endpoint of endpoints) {
    const item = paths[endpoint.path] ?? {};
    item[endpoint.method.toLowerCase() as HttpMethodKey] = operation(endpoint);
    paths[endpoint.path] = item;
  }

  // Top-level keys in the conventional order; paths come after the shared parts.
  const doc = {
    openapi: "3.1.0",
    info: withText(
      {
        title: scope.page
          ? `${project.name}: ${scope.page.name}`
          : project.name,
        version: project.apiVersion,
      },
      "description",
      project.description,
    ),
  } as OpenApiDocument;
  if (project.servers.length > 0) {
    doc.servers = project.servers.map((server) => ({
      url: server.url,
      description: server.description
        ? `${server.name} — ${server.description}`
        : server.name,
    }));
  }
  if (scope.pages.length > 0) {
    doc.tags = scope.pages.map((page) =>
      withText(
        { name: tagNames.get(page.id) ?? page.name },
        "description",
        page.description,
      ),
    );
  }
  const defaultKey = project.defaultSecuritySchemeId
    ? schemeKeys.get(project.defaultSecuritySchemeId)
    : undefined;
  if (defaultKey) {
    doc.security = [{ [defaultKey]: [] }];
  }
  doc.paths = paths;

  const components: NonNullable<OpenApiDocument["components"]> = {};
  if (scope.models.length > 0) {
    components.schemas = Object.fromEntries(
      scope.models.map((model) => [
        model.name,
        model.description
          ? { description: model.description, ...toRefs(model.schema) }
          : toRefs(model.schema),
      ]),
    );
  }
  // Each error type once, so responses reference instead of repeating it.
  if (scope.errorTypes.length > 0) {
    components.examples = Object.fromEntries(
      scope.errorTypes.map((errorType) => [
        errorType.name,
        {
          summary: errorType.title,
          ...withText({}, "description", errorType.description),
          value: errorType.body.example,
        },
      ]),
    );
  }
  if (project.securitySchemes.length > 0) {
    components.securitySchemes = Object.fromEntries(
      project.securitySchemes.map((scheme) => [
        scheme.key,
        securitySchemeObject(scheme),
      ]),
    );
  }
  if (Object.keys(components).length > 0) {
    doc.components = components;
  }
  return doc;
}

// --- Lint -------------------------------------------------------------------

/** Things worth fixing before handing the contract over; they don't block exporting. */
export function lintContract(
  input: ExportInput,
  options: ExportOptions = {},
): LintIssue[] {
  const scope = scopeOf(input, options);
  const issues: LintIssue[] = [];
  const errorTypesById = new Map(
    input.errorTypes.map((errorType) => [errorType.id, errorType]),
  );

  for (const endpoint of scope.endpoints) {
    const target = { type: "endpoint" as const, id: endpoint.id };
    const label = endpointLabel(endpoint);
    if (endpoint.requestBody && endpoint.requestBody.examples.length === 0) {
      issues.push({
        kind: "missing-example",
        target,
        message: `${label}: the request body has no example`,
      });
    }
    for (const response of endpoint.responses) {
      if (response.body && response.body.examples.length === 0) {
        issues.push({
          kind: "missing-example",
          target,
          message: `${label}: the ${response.status} response has no example`,
        });
      }
      if (response.errors.length === 0) {
        continue;
      }
      const parts = errorResponseParts(response, errorTypesById);
      for (const { header, usedFrom } of parts.conflicts) {
        issues.push({
          kind: "error-mismatch",
          target,
          message: `${label}: the ${response.status} response's error types define ${header} differently; the export uses ${usedFrom}'s`,
        });
      }
      for (const usage of response.errors) {
        const errorType = errorTypesById.get(usage.errorTypeId);
        if (!errorType || !isProblemDetails(errorType.body.contentType)) {
          continue;
        }
        const catalogType = memberOf(errorType.body.example, "type");
        for (const example of usage.examples) {
          const what = `${label}: the ${response.status} example ${example.name}`;
          const value = example.value as JsonValue;
          const status = memberOf(value, "status");
          if (status !== undefined && status !== Number(errorType.status)) {
            issues.push({
              kind: "error-mismatch",
              target,
              message: `${what} has status ${JSON.stringify(status)}, but ${errorType.name}'s is ${errorType.status}`,
            });
          }
          const title = memberOf(value, "title");
          if (title !== undefined && title !== errorType.title) {
            issues.push({
              kind: "error-mismatch",
              target,
              message: `${what} has another title than ${errorType.name}`,
            });
          }
          const type = memberOf(value, "type");
          if (type !== undefined && type !== catalogType) {
            issues.push({
              kind: "error-mismatch",
              target,
              message: `${what} has another type than ${errorType.name}'s example`,
            });
          }
        }
      }
    }
  }

  // Problem details (RFC 9457) send the status of the response, keep the
  // title of their type, and are told apart by `type`.
  const types = new Map<string, string>();
  for (const errorType of scope.errorTypes) {
    if (!isProblemDetails(errorType.body.contentType)) {
      continue;
    }
    const target = { type: "error-type" as const, id: errorType.id };
    const { example } = errorType.body;
    const status = memberOf(example, "status");
    if (status !== undefined && status !== Number(errorType.status)) {
      issues.push({
        kind: "error-mismatch",
        target,
        message: `${errorType.name}: the example's status is ${JSON.stringify(status)}, but the error's is ${errorType.status}`,
      });
    }
    const title = memberOf(example, "title");
    if (title !== undefined && title !== errorType.title) {
      issues.push({
        kind: "error-mismatch",
        target,
        message: `${errorType.name}: the example's title isn't the error's title`,
      });
    }
    const type = memberOf(example, "type");
    if (typeof type === "string" && type !== "about:blank") {
      const first = types.get(type);
      if (first) {
        issues.push({
          kind: "error-mismatch",
          target,
          message: `${errorType.name} has the same type as ${first}: ${type}`,
        });
      } else {
        types.set(type, errorType.name);
      }
    }
  }

  // Whole-project checks; a page export only includes what the page uses.
  if (options.pageId === undefined) {
    const linked = new Set(
      input.pages.flatMap((page) =>
        page.endpoints.map((link) => link.endpointId),
      ),
    );
    for (const endpoint of scope.endpoints) {
      if (!linked.has(endpoint.id)) {
        issues.push({
          kind: "unused-endpoint",
          target: { type: "endpoint", id: endpoint.id },
          message: `${endpointLabel(endpoint)} isn't used by any page`,
        });
      }
    }

    const referenced = new Set([
      ...[
        ...input.endpoints.flatMap((endpoint) => schemasOfEndpoint(endpoint)),
        ...input.errorTypes.flatMap((errorType) =>
          schemasOfErrorType(errorType),
        ),
      ].flatMap(([, schema]) => modelRefsIn(schema)),
      ...input.models.flatMap((model) =>
        modelRefsIn(model.schema).filter((id) => id !== model.id),
      ),
    ]);
    for (const model of input.models) {
      if (!referenced.has(model.id)) {
        issues.push({
          kind: "unused-model",
          target: { type: "model", id: model.id },
          message: `${model.name} isn't used by any endpoint or other model`,
        });
      }
    }

    const usedErrorTypes = new Set(input.endpoints.flatMap(errorTypeIdsOf));
    for (const errorType of input.errorTypes) {
      if (!usedErrorTypes.has(errorType.id)) {
        issues.push({
          kind: "unused-error-type",
          target: { type: "error-type", id: errorType.id },
          message: `${errorType.name} isn't used by any endpoint`,
        });
      }
    }
  }
  return issues;
}

/** A member of a JSON object, or undefined. */
function memberOf(value: JsonValue, name: string): JsonValue | undefined {
  return isJsonObject(value) ? value[name] : undefined;
}

// --- Validation -------------------------------------------------------------

const MAX_VALIDATION_ERRORS = 20;

let openApiValidator: Validator | undefined;
let schemaValidator: InstanceType<typeof Ajv2020> | undefined;

type AjvError = { instancePath: string; message?: string };

/**
 * One message per invalid location (Ajv reports every branch it tried), as
 * `${prefix}${path}${separator}${message}`.
 */
function formatErrors(prefix: string, errors: AjvError[], separator = " ") {
  const seen = new Set<string>();
  return errors.flatMap((error) => {
    if (seen.has(error.instancePath)) {
      return [];
    }
    seen.add(error.instancePath);
    const path = error.instancePath || "/";
    return [`${prefix}${path}${separator}${error.message ?? "is invalid"}`];
  });
}

function schemaLabel(endpoint: Endpoint, fieldPath: string) {
  const [first, second, third] = fieldPath.split(".");
  if (first === "parameters") {
    return `${second} parameters`;
  }
  if (first === "requestBody") {
    return "request body";
  }
  const status = endpoint.responses[Number(second)]?.status ?? "?";
  return third === "headers"
    ? `${status} response headers`
    : `${status} response`;
}

/** A `$ref` key inside data, renamed so the validator doesn't follow it. */
const DATA_REF = "$ref (data)";

/** Renames every `$ref` key in data, at any depth, without recursion. */
function renameDataRefs(root: unknown) {
  const pending = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next !== "object" || next === null) continue;
    const value = next as Record<string, unknown>;
    if (!Array.isArray(value) && Object.hasOwn(value, "$ref")) {
      value[DATA_REF] = value.$ref;
      delete value.$ref;
    }
    for (const child of Object.values(value)) pending.push(child);
  }
}

/** Renames `$ref` keys in a schema's data keywords (examples, default, …). */
function renameSchemaDataRefs(root: unknown) {
  const pending = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (Array.isArray(next)) {
      pending.push(...next);
      continue;
    }
    if (!isJsonObject(next)) continue;
    for (const [key, child] of Object.entries(next)) {
      if (DATA_KEYWORDS.has(key)) {
        renameDataRefs(child);
      } else if (SCHEMA_MAP_KEYWORDS.has(key) && isJsonObject(child)) {
        pending.push(...Object.values(child));
      } else {
        pending.push(child);
      }
    }
  }
}

/**
 * The document as the OpenAPI validator should see it. It follows every
 * `$ref` it finds, but in an example's value or a schema's examples a
 * `$ref` is data, as OpenAPI reads it (an API about JSON Schema shows them).
 */
function forValidator(doc: OpenApiDocument): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(doc)) as OpenApiDocument;
  const schemas: unknown[] = Object.values(copy.components?.schemas ?? {});
  const values: unknown[] = Object.values(copy.components?.examples ?? {}).map(
    (example) => example.value,
  );
  const media = (content: unknown) => {
    for (const item of Object.values(isJsonObject(content) ? content : {})) {
      if (!isJsonObject(item)) continue;
      schemas.push(item.schema);
      for (const example of Object.values(
        isJsonObject(item.examples) ? item.examples : {},
      )) {
        if (isJsonObject(example) && Object.hasOwn(example, "value"))
          values.push(example.value);
      }
    }
  };
  for (const item of Object.values(copy.paths)) {
    for (const operation of Object.values(item ?? {})) {
      if (!operation) continue;
      for (const parameter of operation.parameters ?? [])
        schemas.push(parameter.schema);
      media(operation.requestBody?.content);
      for (const response of Object.values(operation.responses)) {
        for (const header of Object.values(
          isJsonObject(response.headers) ? response.headers : {},
        )) {
          if (isJsonObject(header)) schemas.push(header.schema);
        }
        media(response.content);
      }
    }
  }
  for (const schema of schemas) renameSchemaDataRefs(schema);
  for (const value of values) renameDataRefs(value);
  return copy as unknown as Record<string, unknown>;
}

/**
 * Problems that make the export wrong: schemas that aren't valid JSON Schema
 * (2020-12) and documents that aren't valid OpenAPI 3.1.
 */
export async function validateContract(
  input: ExportInput,
  doc: OpenApiDocument,
  options: ExportOptions = {},
): Promise<string[]> {
  const scope = scopeOf(input, options);
  schemaValidator ??= new Ajv2020({ strict: false, validateFormats: false });
  openApiValidator ??= new Validator();
  const ajv = schemaValidator;

  const checkSchema = (prefix: string, schema: JsonSchema) => {
    // Ajv checks a schema against the meta-schema its $schema names, and
    // throws for one it doesn't have; the export is 2020-12 throughout.
    const dialect = schema.$schema;
    let checked = schema;
    if (dialect !== undefined && typeof dialect !== "string") {
      return [
        `${prefix}its $schema isn't a URI, as JSON Schema 2020-12 needs; remove it`,
      ];
    }
    if (typeof dialect === "string") {
      // OpenAPI's own dialect is 2020-12 with OpenAPI's keywords.
      if (
        /^https:\/\/spec\.openapis\.org\/oas\/3\.[12]\/dialect\//.test(dialect)
      ) {
        const { $schema: _dialect, ...rest } = schema;
        checked = rest;
      } else if (
        !/^https:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/.test(dialect)
      ) {
        return [
          `${prefix}its $schema, ${dialect.length > 200 ? `${dialect.slice(0, 199)}…` : dialect}, isn't JSON Schema 2020-12, which OpenAPI 3.1 schemas use; remove it if the schema means the same in 2020-12`,
        ];
      }
    }
    return ajv.validateSchema(checked)
      ? []
      : formatErrors(prefix, (ajv.errors ?? []) as AjvError[]);
  };

  const messages = [
    ...scope.models.flatMap((model) =>
      checkSchema(`Model ${model.name}: `, model.schema),
    ),
    ...scope.errorTypes.flatMap((errorType) =>
      schemasOfErrorType(errorType).flatMap(([fieldPath, schema]) =>
        checkSchema(
          `Error type ${errorType.name} ${fieldPath === "headers" ? "headers" : "body"}: `,
          schema,
        ),
      ),
    ),
    ...scope.endpoints.flatMap((endpoint) =>
      schemasOfEndpoint(endpoint).flatMap(([fieldPath, schema]) =>
        checkSchema(
          `${endpointLabel(endpoint)} ${schemaLabel(endpoint, fieldPath)}: `,
          schema,
        ),
      ),
    ),
  ];

  const result = await openApiValidator.validate(forValidator(doc));
  if (!result.valid) {
    messages.push(
      ...(typeof result.errors === "string"
        ? [`OpenAPI: ${result.errors}`]
        : formatErrors("OpenAPI ", (result.errors ?? []) as AjvError[], ": ")),
    );
  }
  return messages.slice(0, MAX_VALIDATION_ERRORS);
}
