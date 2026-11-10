import {
  type EndpointFields,
  type HttpMethod,
  methodAllowsBody,
  parsePathTemplate,
  pathMatchKey,
} from "../../shared/endpoints";
import type { JsonSchema, JsonValue } from "../../shared/json-schema";
import { readParameterSchema, readRequestBody, readResponses } from "./bodies";
import {
  isObject,
  own,
  type Raw,
  type Segments,
  setOwn,
  shortened,
  shown,
} from "./context";
import type { Converter } from "./convert";
import { counted } from "./notices";
import { shownPointer } from "./pointer";
import { readSecurity } from "./project";
import { UniqueNames } from "./unique-names";

// Endpoints from an OpenAPI document's paths, with their parameters.

const OPERATION_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
] as const;
const STATUSES = new Set(["draft", "review", "agreed"]);

export function readEndpoints(c: Converter) {
  const paths = own(c.ctx.doc, "paths");
  if (paths === undefined) return [];
  if (!isObject(paths)) {
    c.ctx.refuse(["paths"], "Expected an object of paths");
    return [];
  }
  const out: (EndpointFields & { id: string })[] = [];
  const taken = new Map<string, string>();
  const operationIds = new OperationIds();
  for (const path of Object.keys(paths)) {
    c.ctx.count();
    const itemAt = ["paths", path];
    if (path.startsWith("x-")) {
      c.rest({ [path]: paths[path] }, ["paths"], [], "paths");
      continue;
    }
    const followed = c.follow(paths[path], itemAt, "a path item");
    if (!followed) continue;
    const item = followed.value;
    if (!isObject(item)) {
      c.ctx.refuse(itemAt, "Expected a path item object");
      continue;
    }
    const parsed = parsePathTemplate(path);
    if ("error" in parsed || path.length > 500) {
      c.note(
        "bad-path",
        itemAt,
        (count, examples) =>
          `${counted(count, "path")} the app can't take ${count === 1 ? "was" : "were"} left out: ${examples}`,
        `${shown(path, 60)} (${"error" in parsed ? parsed.error : "longer than 500 characters"})`,
      );
      continue;
    }
    for (const key of ["servers"]) {
      if (own(item, key) !== undefined) {
        c.note(
          "path-servers",
          [...followed.at, key],
          (count, examples) =>
            `Servers of single paths or operations aren't kept (${counted(count, "place")}, like ${examples})`,
          shownPointer([...followed.at, key], 200),
        );
      }
    }
    for (const method of Object.keys(item)) {
      if ((OPERATION_METHODS as readonly string[]).includes(method)) continue;
      if (
        method === "trace" ||
        method === "query" ||
        method === "additionalOperations"
      ) {
        c.note(
          "methods",
          [...followed.at, method],
          (count, examples) =>
            `The app has no ${count === 1 ? "operation like this" : "operations like these"}, so ${count === 1 ? "it was" : "they were"} left out: ${examples}`,
          method === "additionalOperations"
            ? `${shown(additionalNames(c, item[method]), 60)} ${path}`
            : `${method.toUpperCase()} ${path}`,
        );
      }
    }
    c.rest(
      item,
      followed.at,
      [
        "$ref",
        "summary",
        "description",
        "parameters",
        "servers",
        "trace",
        "query",
        "additionalOperations",
        ...OPERATION_METHODS,
      ],
      "a path item",
    );
    for (const method of OPERATION_METHODS) {
      const operation = own(item, method);
      if (operation === undefined) continue;
      const at = [...followed.at, method];
      if (!isObject(operation)) {
        c.ctx.refuse(at, "Expected an operation object");
        continue;
      }
      const upper = method.toUpperCase() as HttpMethod;
      const key = `${upper} ${pathMatchKey(path)}`;
      const first = taken.get(key);
      if (first !== undefined) {
        c.note(
          "same-path",
          at,
          (count, examples) =>
            `${counted(count, "operation")} on a path that differs from another only in parameter names ${count === 1 ? "was" : "were"} left out, since OpenAPI says they're the same path: ${examples}`,
          `${upper} ${path} (same as ${first})`,
        );
        continue;
      }
      taken.set(key, `${upper} ${path}`);
      const endpoint = readOperation(
        c,
        upper,
        path,
        parsed.params,
        item,
        followed,
        operation,
        at,
        operationIds,
      );
      if (endpoint) {
        const id = `e${out.length + 1}`;
        out.push({ id, ...endpoint });
        c.operationSources.set(id, operation);
        c.operationAt.set(id, [...at]);
      }
    }
  }
  return out;
}

/** Operation IDs taken so far: `id`, or the first free `id_2`, `id_3`, … within 100 characters. */
export class OperationIds extends UniqueNames {
  constructor() {
    super({ max: 100, separator: "_" });
  }
}

/** The methods of a 3.2 `additionalOperations`, counted, since a shared path item is read for each use. */
function additionalNames(c: Converter, value: unknown) {
  const names = Object.keys(isObject(value) ? value : {});
  c.ctx.count(names.length);
  return names.slice(0, 5).join(", ") + (names.length > 5 ? ", …" : "");
}

export function readOperationId(
  c: Converter,
  value: Raw,
  at: Segments,
  label: string,
  taken: OperationIds,
) {
  const raw = c.ctx.text(value, "operationId", at)?.trim() ?? "";
  if (raw === "") return "";
  let id = raw.replace(/[^A-Za-z0-9_]+/g, "_");
  if (!/^[A-Za-z_]/.test(id)) id = `_${id}`;
  id = id.slice(0, 100);
  const unique = taken.claim(id);
  if (unique !== raw) {
    c.note(
      "operation-ids",
      [...at, "operationId"],
      (count, examples) =>
        `${counted(count, "operation ID was", "operation IDs were")} changed to letters, numbers, and underscores, unique, as the app takes them: ${examples}`,
      `${shown(raw, 40)} → ${unique} (${label})`,
    );
  }
  return unique;
}

export function readOperation(
  c: Converter,
  method: HttpMethod,
  path: string,
  templateNames: string[],
  item: Raw,
  /** Where the path item is, and what a reference to it says over it (3.1). */
  itemPlace: { at: Segments; summary?: unknown; description?: unknown },
  value: Raw,
  at: Segments,
  operationIds: OperationIds,
): EndpointFields | undefined {
  c.ctx.count();
  const itemAt = itemPlace.at;
  const label = `${method} ${path}`;
  const operationId = readOperationId(c, value, at, label, operationIds);
  let summary = c.text(value, "summary", at, 200, `the summary of ${label}`);
  let description = c.text(
    value,
    "description",
    at,
    10_000,
    `the description of ${label}`,
  );
  for (const [key, current, max] of [
    ["summary", summary, 200],
    ["description", description, 10_000],
  ] as const) {
    // A reference to the path item may give its own (OpenAPI 3.1).
    const over = itemPlace[key];
    const shared =
      typeof over === "string"
        ? over.trim().length <= max
          ? over.trim()
          : shortened(over.trim(), max)
        : c.text(item, key, itemAt, max, `the ${key} of ${path}`);
    if (shared === "") continue;
    if (current === "") {
      if (key === "summary") summary = shared;
      else description = shared;
    } else if (current !== shared) {
      c.note(
        "path-text",
        [...itemAt, key],
        (count, examples) =>
          `A path's own summary or description isn't kept where its operations have their own (${counted(count, "path")}, like ${examples})`,
        path,
      );
    }
  }
  const xStatus = own(value, "x-status");
  let status: EndpointFields["status"] = "draft";
  if (typeof xStatus === "string" && STATUSES.has(xStatus)) {
    status = xStatus as EndpointFields["status"];
  } else if (xStatus !== undefined) {
    c.note(
      "x-status",
      [...at, "x-status"],
      (count, examples) =>
        `x-status must be draft, review, or agreed; ${counted(count, "endpoint")} ${count === 1 ? "is" : "are"} draft instead: ${examples}`,
      label,
    );
  }
  const deprecated = own(value, "deprecated");
  if (deprecated !== undefined && typeof deprecated !== "boolean") {
    c.ctx.refuse([...at, "deprecated"], "Expected true or false");
  }
  for (const key of ["callbacks", "externalDocs", "servers", "tags"]) {
    if (own(value, key) === undefined) continue;
    if (key === "tags") continue;
    c.note(
      `operation-${key}`,
      [...at, key],
      (count, examples) =>
        `${key === "callbacks" ? "Callbacks" : key === "externalDocs" ? "External docs of operations" : "Servers of single paths or operations"} aren't kept (${counted(count, "operation")}, like ${examples})`,
      label,
    );
  }
  const security =
    readSecurity(c, own(value, "security"), [...at, "security"]) ??
    c.defaultSecurity;
  const parameters = readParameters(
    c,
    own(item, "parameters"),
    [...itemAt, "parameters"],
    own(value, "parameters"),
    [...at, "parameters"],
    templateNames,
    label,
  );
  let requestBody: EndpointFields["requestBody"] = null;
  if (own(value, "requestBody") !== undefined) {
    if (!methodAllowsBody(method)) {
      c.note(
        "get-body",
        [...at, "requestBody"],
        (count, examples) =>
          `${method === "GET" || method === "HEAD" ? "GET and HEAD" : method} requests can't have a body in the app, so ${counted(count, "body was", "bodies were")} left out: ${examples}`,
        label,
      );
    } else {
      requestBody = readRequestBody(
        c,
        own(value, "requestBody"),
        [...at, "requestBody"],
        label,
      );
    }
  }
  const responses = readResponses(
    c,
    own(value, "responses"),
    [...at, "responses"],
    label,
  );
  c.rest(
    value,
    at,
    [
      "tags",
      "summary",
      "description",
      "externalDocs",
      "operationId",
      "parameters",
      "requestBody",
      "responses",
      "callbacks",
      "deprecated",
      "security",
      "servers",
    ],
    "an operation",
  );
  return {
    method,
    path,
    operationId,
    summary,
    description,
    status,
    deprecated: deprecated === true,
    security,
    parameters,
    requestBody,
    responses,
    notesFe: c.text(
      value,
      "x-notes-fe",
      at,
      10_000,
      `the frontend notes of ${label}`,
    ),
    notesBe: c.text(
      value,
      "x-notes-be",
      at,
      10_000,
      `the backend notes of ${label}`,
    ),
  };
}

export function readParameters(
  c: Converter,
  shared: unknown,
  sharedAt: Segments,
  own_: unknown,
  ownAt: Segments,
  templateNames: string[],
  label: string,
): EndpointFields["parameters"] {
  type Found = {
    name: string;
    location: "path" | "query" | "header";
    property: JsonSchema;
    required: boolean;
    at: Segments;
  };
  const found = new Map<string, Found>();
  const read = (list: unknown, at: Segments) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      c.ctx.refuse(at, "Expected a list of parameters");
      return;
    }
    const here = new Set<string>();
    list.forEach((raw, index) => {
      c.ctx.count();
      const itemAt = [...at, String(index)];
      const followed = c.follow(raw, itemAt);
      if (!followed) return;
      const parameter = followed.value;
      if (!isObject(parameter)) {
        c.ctx.refuse(itemAt, "Expected a parameter object");
        return;
      }
      const name = c.ctx.text(parameter, "name", followed.at);
      const location = own(parameter, "in");
      if (name === undefined || name === "" || typeof location !== "string") {
        c.ctx.refuse(followed.at, "A parameter needs a name and in");
        return;
      }
      const key = `${location}\u0000${location === "header" ? name.toLowerCase() : name}`;
      if (here.has(key)) {
        c.note(
          "parameter-twice",
          followed.at,
          (count, examples) =>
            `${counted(count, "parameter")} listed twice in one place ${count === 1 ? "was" : "were"} kept once: ${examples}`,
          `${shown(name, 60)} (${label})`,
        );
        return;
      }
      here.add(key);
      if (location === "cookie" || location === "querystring") {
        c.note(
          `parameter-${location}`,
          followed.at,
          (count, examples) =>
            location === "cookie"
              ? `Cookie parameters aren't kept, since endpoints have path, query, and header parameters (${counted(count, "parameter")}: ${examples})`
              : `in: querystring parameters aren't kept (${counted(count, "parameter")}: ${examples})`,
          `${shown(name, 60)} (${label})`,
        );
        return;
      }
      if (
        location !== "path" &&
        location !== "query" &&
        location !== "header"
      ) {
        c.ctx.refuse(
          [...followed.at, "in"],
          "Expected path, query, header, or cookie",
        );
        return;
      }
      if (
        location === "header" &&
        ["accept", "content-type", "authorization"].includes(name.toLowerCase())
      ) {
        c.note(
          "ignored-headers",
          followed.at,
          (count, examples) =>
            `Header parameters named Accept, Content-Type, or Authorization were left out, since OpenAPI ignores them (${counted(count, "parameter")}: ${examples})`,
          `${shown(name, 60)} (${label})`,
        );
        return;
      }
      const property = readParameterSchema(
        c,
        parameter,
        followed.at,
        label,
        name,
        followed.description,
      );
      found.set(key, {
        name,
        location,
        property,
        required: location === "path" || own(parameter, "required") === true,
        at: followed.at,
      });
    });
  };
  read(shared, sharedAt);
  read(own_, ownAt);

  const object = (location: "query" | "header"): JsonSchema => {
    const properties: Record<string, JsonValue> = {};
    const required: string[] = [];
    for (const item of found.values()) {
      if (item.location !== location) continue;
      setOwn(properties, item.name, item.property);
      if (item.required) required.push(item.name);
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  };
  // Path parameters follow the template, all required.
  const pathProperties: Record<string, JsonValue> = {};
  for (const name of templateNames) {
    const item = found.get(`path\u0000${name}`);
    if (item) {
      setOwn(pathProperties, name, item.property);
    } else {
      c.note(
        "path-parameter-missing",
        ownAt,
        (count, examples) =>
          `${counted(count, "path parameter")} had no definition, so ${count === 1 ? "it's" : "they're"} text: ${examples}`,
        `{${name}} (${label})`,
      );
      setOwn(pathProperties, name, { type: "string" });
    }
  }
  for (const item of found.values()) {
    if (item.location === "path" && !templateNames.includes(item.name)) {
      c.note(
        "path-parameter-extra",
        item.at,
        (count, examples) =>
          `${counted(count, "path parameter")} not in ${count === 1 ? "its path was" : "their paths were"} left out: ${examples}`,
        `${shown(item.name, 60)} (${label})`,
      );
    }
  }
  return {
    path: {
      type: "object",
      properties: pathProperties,
      ...(templateNames.length > 0 ? { required: [...templateNames] } : {}),
    },
    query: object("query"),
    header: object("header"),
  };
}
