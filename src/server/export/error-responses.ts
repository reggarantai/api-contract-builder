import type { EndpointResponse } from "../../shared/endpoints";
import type { ErrorType } from "../../shared/error-types";
import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
} from "../../shared/json-schema";

/** An example in a response with catalog errors. */
export type ErrorExample = {
  name: string;
  /** The error type it shows. */
  errorType: ErrorType;
  /** The endpoint's own example, or null for the catalog's. */
  own: { summary: string; value: JsonValue } | null;
};

export type ErrorContent = {
  contentType: string;
  /** The errors' schema, or any of them when they differ. */
  schema: JsonSchema;
  /** The distinct schemas, for tables that can't show "any of". */
  schemas: JsonSchema[];
  examples: ErrorExample[];
};

function properties(schema: JsonSchema) {
  return isJsonObject(schema.properties) ? schema.properties : {};
}

function requiredNames(schema: JsonSchema) {
  return Array.isArray(schema.required) ? schema.required : [];
}

/** "`a`", "`a` or `b`", "`a`, `b`, or `c`" */
function orList(names: string[]) {
  const quoted = names.map((name) => `\`${name}\``);
  return quoted.length <= 2
    ? quoted.join(" or ")
    : `${quoted.slice(0, -1).join(", ")}, or ${quoted.at(-1)}`;
}

/** A header's schema without the parts that may differ between error types. */
function headerShape(schema: JsonSchema) {
  const { description: _description, examples: _examples, ...rest } = schema;
  return JSON.stringify(rest);
}

type MergedHeader = {
  name: string;
  schema: JsonSchema;
  examples: JsonValue[];
  senders: ErrorType[];
  requiredBy: number;
  conflict: boolean;
};

/**
 * What a response with catalog errors answers.
 *
 * Headers: the response's own, then the errors' by name, ignoring case. A
 * header several errors send keeps the first description and lists all
 * their examples; it's required only when every error requires it, and
 * says "Only with …" when only some send it. `conflicts` names headers the
 * errors define differently otherwise.
 *
 * Bodies: one per content type (ignoring case), with the errors' schemas
 * (any of them when they differ) and their examples: the endpoint's own,
 * or the catalog's.
 */
export function errorResponseParts(
  response: EndpointResponse,
  errorTypesById: ReadonlyMap<string, ErrorType>,
) {
  const used = response.errors.flatMap((usage) => {
    const errorType = errorTypesById.get(usage.errorTypeId);
    return errorType ? [{ usage, errorType }] : [];
  });

  const own = properties(response.headers);
  const ownNames = new Set(Object.keys(own).map((name) => name.toLowerCase()));
  const headers = new Map<string, MergedHeader>();
  for (const { errorType } of used) {
    const required = new Set(requiredNames(errorType.headers));
    for (const [name, value] of Object.entries(properties(errorType.headers))) {
      const key = name.toLowerCase();
      if (ownNames.has(key)) {
        continue;
      }
      const schema = isJsonObject(value) ? value : {};
      const header = headers.get(key) ?? {
        name,
        schema,
        examples: [],
        senders: [],
        requiredBy: 0,
        conflict: false,
      };
      header.conflict ||= headerShape(schema) !== headerShape(header.schema);
      const examples = Array.isArray(schema.examples) ? schema.examples : [];
      for (const example of examples) {
        if (
          !header.examples.some(
            (seen) => JSON.stringify(seen) === JSON.stringify(example),
          )
        ) {
          header.examples.push(example);
        }
      }
      header.senders.push(errorType);
      header.requiredBy += required.has(name) ? 1 : 0;
      headers.set(key, header);
    }
  }

  const mergedProperties: JsonSchema = { ...own };
  const mergedRequired = [...requiredNames(response.headers)];
  for (const header of headers.values()) {
    const schema: JsonSchema = { ...header.schema };
    if (header.examples.length > 0) {
      schema.examples = header.examples;
    }
    if (header.senders.length < used.length) {
      const condition = `Only with ${orList(header.senders.map((errorType) => errorType.name))}`;
      schema.description =
        typeof schema.description === "string" && schema.description
          ? `${condition}: ${schema.description}`
          : condition;
    } else if (header.requiredBy === used.length) {
      mergedRequired.push(header.name);
    }
    // Defined, not assigned: a header named __proto__ would set the prototype.
    Object.defineProperty(mergedProperties, header.name, {
      value: schema,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  const contents = new Map<
    string,
    { contentType: string; schemas: JsonSchema[]; examples: ErrorExample[] }
  >();
  for (const { usage, errorType } of used) {
    const { body } = errorType;
    const key = body.contentType.toLowerCase();
    const content = contents.get(key) ?? {
      contentType: body.contentType,
      schemas: [],
      examples: [],
    };
    const schemaKey = JSON.stringify(body.schema);
    if (
      !content.schemas.some((schema) => JSON.stringify(schema) === schemaKey)
    ) {
      content.schemas.push(body.schema);
    }
    content.examples.push(
      ...(usage.examples.length === 0
        ? [{ name: errorType.name, errorType, own: null }]
        : usage.examples.map((example) => ({
            name: example.name,
            errorType,
            own: {
              summary: example.summary,
              value: example.value as JsonValue,
            },
          }))),
    );
    contents.set(key, content);
  }

  return {
    errorTypes: used.map(({ errorType }) => errorType),
    headers: {
      ...response.headers,
      properties: mergedProperties,
      ...(mergedRequired.length > 0 ? { required: mergedRequired } : {}),
    } as JsonSchema,
    /** Headers the errors define differently, beyond description and examples. */
    conflicts: [...headers.values()]
      .filter((header) => header.conflict)
      .map((header) => ({
        header: header.name,
        /** The error type whose definition the response uses. */
        usedFrom: header.senders[0]?.name ?? "",
      })),
    contents: [...contents.values()].map(
      ({ contentType, schemas, examples }): ErrorContent => ({
        contentType,
        schema:
          schemas.length === 1 && schemas[0] ? schemas[0] : { anyOf: schemas },
        schemas,
        examples,
      }),
    ),
  };
}
