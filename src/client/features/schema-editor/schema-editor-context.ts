import type { JsonSchema, JsonValue } from "@shared/json-schema";
import type { ModelSummary } from "@shared/models";
import { createContext, useContext } from "react";
import type { SchemaPath } from "./schema-ops";

type SchemaEditorContextValue = {
  root: JsonSchema;
  update: (
    path: SchemaPath,
    update: (node: JsonValue | undefined) => JsonValue,
  ) => void;
  /** Models a field can reference. */
  models: ModelSummary[];
  /** Top-level field names are fixed: no adding, renaming, or removing. */
  lockNames: boolean;
  /** Key of the field added last, so its name input takes focus. */
  focusKey: string | null;
  setFocusKey: (key: string | null) => void;
};

export const SchemaEditorContext =
  createContext<SchemaEditorContextValue | null>(null);

export function useSchemaEditor() {
  const context = useContext(SchemaEditorContext);
  if (!context) {
    throw new Error("useSchemaEditor must be used inside <SchemaEditor>");
  }
  return context;
}

export function pathKey(path: SchemaPath) {
  return JSON.stringify(path);
}
