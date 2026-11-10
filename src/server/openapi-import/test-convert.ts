import { expect } from "vitest";
import type { ApiIssue } from "../../shared/api-error";
import {
  COMPONENT_REF_PREFIX,
  type JsonSchema,
  mapRefs,
  modelIdOfRef,
} from "../../shared/json-schema";
import type { ProjectFile } from "../project-file/format";
import { validateProjectFile } from "../project-file/validate";
import { convertOpenApi } from "./convert";

// Helpers for the converter's tests: they read the project file document an
// OpenAPI document becomes, and check every time that it passes the rules a
// project file import applies, since a document that doesn't would be
// refused whole.

// biome-ignore lint/suspicious/noExplicitAny: tests build documents loosely.
export type Loose = any;

export type Converted = {
  document: ProjectFile;
  notices: ApiIssue[];
  /** Notice messages, for matching. */
  messages: string[];
};

/** The project file document of `doc`, checked by the project file rules. */
export function convert(
  doc: unknown,
  sourceText?: (container: object, key: string | number) => string | undefined,
): Converted {
  const result = convertOpenApi(doc, { sourceText });
  if ("error" in result) {
    throw new Error(
      `Expected a project, got: ${result.error}\n${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
  const checked = validateProjectFile(structuredClone(result.document), {
    appVersion: "1.2.3",
  });
  if ("error" in checked) {
    throw new Error(
      `The converted document breaks the project file rules: ${checked.error}\n${checked.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
  return {
    document: result.document as ProjectFile,
    notices: result.notices,
    messages: result.notices.map((notice) => notice.message),
  };
}

/** Why `doc` can't be imported: the error and its issues, one a line. */
export function refusal(doc: unknown) {
  const result = convertOpenApi(doc, {});
  if (!("error" in result)) {
    throw new Error("Expected a refusal, got a project");
  }
  return [
    result.error,
    ...result.issues.map((issue) => `${issue.path}: ${issue.message}`),
  ].join("\n");
}

/** A minimal 3.1 document with these parts. */
export function doc31(parts: Record<string, unknown> = {}) {
  return {
    openapi: "3.1.0",
    info: { title: "Shop", version: "1.0.0" },
    ...parts,
  };
}

/** A minimal 3.0 document with these parts. */
export function doc30(parts: Record<string, unknown> = {}) {
  return {
    openapi: "3.0.3",
    info: { title: "Shop", version: "1.0.0" },
    ...parts,
  };
}

/** A schema with model references written as component references, by name. */
export function readable(document: ProjectFile, schema: unknown): Loose {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return schema;
  }
  const names = new Map(document.models.map((model) => [model.id, model.name]));
  return mapRefs(schema as JsonSchema, (ref) => {
    const id = modelIdOfRef(ref);
    return id === null
      ? ref
      : `${COMPONENT_REF_PREFIX}${names.get(id) ?? `?${id}`}`;
  });
}

export function model(converted: Converted, name: string) {
  const found = converted.document.models.find((item) => item.name === name);
  expect(found, `model ${name}`).toBeDefined();
  return {
    ...(found as NonNullable<typeof found>),
    schema: readable(converted.document, found?.schema),
  };
}

export function endpoint(converted: Converted, label: string) {
  const found = converted.document.endpoints.find(
    (item) => `${item.method} ${item.path}` === label,
  );
  expect(found, `endpoint ${label}`).toBeDefined();
  return found as NonNullable<typeof found>;
}

/** An operation with one 200 response whose JSON body has `schema`. */
export function withBody(schema: unknown) {
  return {
    "/things": {
      get: {
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema } },
          },
        },
      },
    },
  };
}

/** The 200 body schema of GET /things, readable. */
export function bodySchema(converted: Converted) {
  const found = endpoint(converted, "GET /things");
  return readable(converted.document, found.responses[0]?.body?.schema);
}

export { exportInputOf } from "./exports";
