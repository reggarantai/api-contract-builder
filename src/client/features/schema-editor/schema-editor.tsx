import { type JsonSchema, refsToComponentNames } from "@shared/json-schema";
import type { ModelSummary } from "@shared/models";
import { SlidersHorizontalIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SchemaDetails } from "./schema-details";
import { SchemaEditorContext, useSchemaEditor } from "./schema-editor-context";
import { ROW_GRID } from "./schema-layout";
import {
  changeKind,
  describeNode,
  parseSchemaJson,
  type SchemaPath,
  summarizeNode,
  updateAt,
} from "./schema-ops";
import { PropertyList, SchemaRow } from "./schema-tree";
import { TypeSelect } from "./type-select";

// CodeMirror is only needed in JSON mode.
const JsonCodeEditor = lazy(() => import("./json-code-editor"));

type Mode = "builder" | "json";

/**
 * Edits a JSON Schema with a field builder or as raw JSON. Model references
 * are `model:<id>` in `value` and `#/components/schemas/<Name>` in JSON mode.
 */
export function SchemaEditor({
  value,
  onChange,
  models,
  onValidityChange,
}: {
  value: JsonSchema;
  onChange: (value: JsonSchema) => void;
  models: ModelSummary[];
  /** Called with false while the JSON text can't be used as a schema. */
  onValidityChange?: (valid: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("builder");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const context = useMemo(
    () => ({
      root: value,
      update: (path: SchemaPath, change: Parameters<typeof updateAt>[2]) =>
        onChange(updateAt(value, path, change)),
      models,
      focusKey,
      setFocusKey,
    }),
    [value, onChange, models, focusKey],
  );

  function changeMode(next: Mode) {
    if (next === "json") {
      const nameOf = (id: string) =>
        models.find((model) => model.id === id)?.name;
      setJsonText(JSON.stringify(refsToComponentNames(value, nameOf), null, 2));
      setJsonError(null);
      setMode("json");
    } else if (jsonError === null) {
      setMode("builder");
    }
  }

  function changeJson(text: string) {
    setJsonText(text);
    const result = parseSchemaJson(
      text,
      (name) => models.find((model) => model.name === name)?.id,
    );
    if ("error" in result) {
      setJsonError(result.error);
      onValidityChange?.(false);
      return;
    }
    setJsonError(null);
    onValidityChange?.(true);
    onChange(result.schema);
  }

  return (
    <Tabs value={mode} onValueChange={(next) => changeMode(next as Mode)}>
      <TabsList>
        <TabsTrigger value="builder" disabled={jsonError !== null}>
          Builder
        </TabsTrigger>
        <TabsTrigger value="json">JSON</TabsTrigger>
      </TabsList>

      <TabsContent value="builder">
        <SchemaEditorContext.Provider value={context}>
          <SchemaBuilder />
        </SchemaEditorContext.Provider>
      </TabsContent>

      <TabsContent value="json" className="grid gap-2">
        <Suspense
          fallback={
            <div className="h-72 animate-pulse rounded-lg border bg-muted/30" />
          }
        >
          <JsonCodeEditor
            value={jsonText}
            onChange={changeJson}
            label="Schema JSON"
          />
        </Suspense>
        {jsonError ? (
          <p role="alert" className="text-sm text-destructive">
            {jsonError}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Reference a model with{" "}
            <code>{'{"$ref": "#/components/schemas/Name"}'}</code>.
          </p>
        )}
      </TabsContent>
    </Tabs>
  );
}

function SchemaBuilder() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { root, update } = useSchemaEditor();
  const info = describeNode(root);
  const summary = summarizeNode(root);

  return (
    <div className="overflow-hidden rounded-lg border text-sm">
      <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-3 py-2">
        <span className="font-medium">Root type</span>
        <div className="w-36">
          <TypeSelect
            info={info}
            label="Root type"
            onChange={(target) =>
              update([], (current) => changeKind(current, target))
            }
          />
        </div>
        {summary.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {summary.join(" · ")}
          </span>
        )}
        <Button
          type="button"
          variant={detailsOpen ? "secondary" : "ghost"}
          size="icon-sm"
          className="ml-auto"
          aria-label="Details of root"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          <SlidersHorizontalIcon />
        </Button>
      </div>
      {detailsOpen && (
        <div className="border-t bg-muted/30 px-3 py-3">
          <SchemaDetails
            path={[]}
            node={root}
            info={info}
            displayName="The root"
          />
        </div>
      )}

      {(info.kind === "object" || info.kind === "array") && (
        <div
          className={cn(
            ROW_GRID,
            "border-t text-xs font-medium text-muted-foreground",
          )}
        >
          <span className="pl-8">Name</span>
          <span>Type</span>
          <span className="text-center">Required</span>
          <span>Description</span>
        </div>
      )}
      {info.kind === "object" && (
        <PropertyList path={[]} depth={0} ownerName="root" />
      )}
      {info.kind === "array" && (
        <SchemaRow path={["items"]} depth={0} displayName="root[]" />
      )}
    </div>
  );
}
