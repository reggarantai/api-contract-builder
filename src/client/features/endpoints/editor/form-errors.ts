import { type FieldError, get } from "react-hook-form";
import type { BodyErrors } from "./body-editor";

// Typed access like `errors.parameters.path` makes TypeScript expand
// react-hook-form's error types through the recursive JSON Schema type, which
// it gives up on. Reading by path keeps the types shallow.

/** The error message at a dotted form path, e.g. "responses.0.status". */
export function errorAt(errors: object, path: string): string | undefined {
  return get<object, FieldError | undefined>(errors, path)?.message;
}

export function bodyErrorsAt(errors: object, path: string): BodyErrors {
  const examples = get<object, unknown>(errors, `${path}.examples`);
  return {
    contentType: errorAt(errors, `${path}.contentType`),
    schema: errorAt(errors, `${path}.schema`),
    exampleNames: Array.isArray(examples)
      ? examples.map((example) => errorAt(example ?? {}, "name"))
      : undefined,
  };
}
