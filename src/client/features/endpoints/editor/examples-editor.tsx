import type { EndpointExample } from "@shared/endpoints";
import { generateExample } from "@shared/generate-example";
import type { JsonSchema, JsonValue } from "@shared/json-schema";
import { PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLoadModelSchemas } from "../../models/queries";
import { useReportValidity } from "./validity";

function uniqueExampleName(examples: EndpointExample[]) {
  const names = new Set(examples.map((example) => example.name));
  if (!names.has("example")) {
    return "example";
  }
  for (let n = 2; ; n++) {
    if (!names.has(`example${n}`)) {
      return `example${n}`;
    }
  }
}

function formatValue(value: JsonValue) {
  return JSON.stringify(value, null, 2);
}

/** Named examples of a body; mock servers can pick one by name. */
export function ExamplesEditor({
  examples,
  onChange,
  schema,
  projectId,
  validityKey,
  nameErrors = [],
}: {
  examples: EndpointExample[];
  onChange: (examples: EndpointExample[]) => void;
  /** The body's schema, used to generate example values. */
  schema: JsonSchema;
  projectId: string;
  validityKey: string;
  nameErrors?: (string | undefined)[];
}) {
  const loadModelSchemas = useLoadModelSchemas(projectId);

  async function addExample() {
    const resolveModel = await loadModelSchemas();
    onChange([
      ...examples,
      {
        id: ulid(),
        name: uniqueExampleName(examples),
        summary: "",
        value: generateExample(schema, resolveModel),
      },
    ]);
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Examples</span>
        <Button type="button" variant="outline" size="sm" onClick={addExample}>
          <PlusIcon />
          Add example
        </Button>
      </div>
      {examples.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No examples yet. Frontend mocks need one to return data.
        </p>
      )}
      {examples.map((example, index) => (
        <ExampleItem
          key={example.id}
          example={example}
          schema={schema}
          projectId={projectId}
          validityKey={`${validityKey}.${example.id}`}
          nameError={nameErrors[index]}
          onChange={(changed) =>
            onChange(
              examples.map((item) => (item.id === changed.id ? changed : item)),
            )
          }
          onRemove={() =>
            onChange(examples.filter((item) => item.id !== example.id))
          }
        />
      ))}
    </div>
  );
}

function ExampleItem({
  example,
  schema,
  projectId,
  validityKey,
  nameError,
  onChange,
  onRemove,
}: {
  example: EndpointExample;
  schema: JsonSchema;
  projectId: string;
  validityKey: string;
  nameError?: string;
  onChange: (example: EndpointExample) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const reportValidity = useReportValidity();
  const loadModelSchemas = useLoadModelSchemas(projectId);
  // The value is edited as text and applied whenever it parses.
  const [text, setText] = useState(() => formatValue(example.value));
  const [valueError, setValueError] = useState<string | null>(null);

  useEffect(
    () => () => reportValidity(validityKey, true),
    [reportValidity, validityKey],
  );

  function changeText(next: string) {
    setText(next);
    try {
      const value = JSON.parse(next) as JsonValue;
      setValueError(null);
      reportValidity(validityKey, true);
      onChange({ ...example, value });
    } catch {
      setValueError("Enter valid JSON");
      reportValidity(validityKey, false);
    }
  }

  async function generate() {
    const resolveModel = await loadModelSchemas();
    const value = generateExample(schema, resolveModel);
    setText(formatValue(value));
    setValueError(null);
    reportValidity(validityKey, true);
    onChange({ ...example, value });
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto]">
        <Field data-invalid={nameError !== undefined}>
          <FieldLabel htmlFor={`${id}-name`}>Example name</FieldLabel>
          <Input
            id={`${id}-name`}
            className="font-mono"
            value={example.name}
            autoComplete="off"
            aria-invalid={nameError !== undefined}
            onChange={(event) =>
              onChange({ ...example, name: event.target.value })
            }
          />
          {nameError && <FieldError>{nameError}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-summary`}>Example summary</FieldLabel>
          <Input
            id={`${id}-summary`}
            value={example.summary}
            placeholder="e.g. Item out of stock"
            autoComplete="off"
            onChange={(event) =>
              onChange({ ...example, summary: event.target.value })
            }
          />
        </Field>
        <div className="flex items-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove example"
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <Field data-invalid={valueError !== null}>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${id}-value`}>Example value</FieldLabel>
          <Button type="button" variant="ghost" size="sm" onClick={generate}>
            <SparklesIcon />
            Generate from schema
          </Button>
        </div>
        <Textarea
          id={`${id}-value`}
          className="font-mono text-xs"
          rows={Math.min(16, Math.max(4, text.split("\n").length))}
          value={text}
          spellCheck={false}
          aria-invalid={valueError !== null}
          onChange={(event) => changeText(event.target.value)}
        />
        {valueError && <FieldError>{valueError}</FieldError>}
      </Field>
    </div>
  );
}
