import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
} from "@shared/json-schema";
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSchemaEditor } from "./schema-editor-context";
import {
  exampleOf,
  formatInput,
  type NodeInfo,
  type ParsedInput,
  parseEnumInput,
  parseJsonInput,
  parseNumberInput,
  parsePatternInput,
  type SchemaPath,
  setExample,
  setKeyword,
  setNullable,
} from "./schema-ops";

const STRING_FORMATS = [
  "email",
  "uri",
  "uuid",
  "date",
  "date-time",
  "time",
  "hostname",
  "ipv4",
  "ipv6",
  "password",
  "byte",
  "binary",
];
const NO_FORMAT = "none";

/** Constraints and other settings of one field, shown below its row. */
export function SchemaDetails({
  path,
  node,
  info,
  displayName,
}: {
  path: SchemaPath;
  node: JsonSchema;
  info: NodeInfo;
  displayName: string;
}) {
  const { update } = useSchemaEditor();
  const updateNode = (change: (node: JsonSchema) => JsonSchema) =>
    update(path, (current) => change(isJsonObject(current) ? current : {}));
  const setValue = (keyword: string) => (value: JsonValue | undefined) =>
    updateNode((current) => setKeyword(current, keyword, value));

  if (info.kind === "custom") {
    return (
      <p className="text-sm text-muted-foreground">
        This field uses JSON Schema features the builder can't edit. Switch to
        JSON to change it.
      </p>
    );
  }

  const example = exampleOf(node);
  const setExampleValue = (value: JsonValue | undefined) =>
    updateNode((current) => setExample(current, value));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {"nullable" in info && (
        <CheckboxField
          label="Nullable"
          description="Can be null"
          checked={info.nullable}
          onChange={(nullable) =>
            updateNode((current) => setNullable(current, nullable))
          }
        />
      )}

      {info.kind === "string" ? (
        <DraftField
          label="Example"
          initial={formatInput(example, "text")}
          parse={(text) => ({ value: text === "" ? undefined : text })}
          onValue={setExampleValue}
        />
      ) : (
        <DraftField
          label="Example"
          description="As JSON"
          initial={formatInput(example, "json")}
          parse={parseJsonInput}
          onValue={setExampleValue}
          monospace
        />
      )}

      {info.kind === "string" && (
        <>
          <FormatField
            value={typeof node.format === "string" ? node.format : undefined}
            onChange={setValue("format")}
          />
          <NumberField
            label="Min length"
            node={node}
            keyword="minLength"
            onValue={setValue("minLength")}
            nonNegativeInteger
          />
          <NumberField
            label="Max length"
            node={node}
            keyword="maxLength"
            onValue={setValue("maxLength")}
            nonNegativeInteger
          />
          <DraftField
            label="Pattern"
            description="Regular expression"
            initial={formatInput(node.pattern, "text")}
            parse={parsePatternInput}
            onValue={setValue("pattern")}
            monospace
          />
        </>
      )}

      {(info.kind === "number" || info.kind === "integer") && (
        <>
          <NumberField
            label="Minimum"
            node={node}
            keyword="minimum"
            onValue={setValue("minimum")}
          />
          <NumberField
            label="Maximum"
            node={node}
            keyword="maximum"
            onValue={setValue("maximum")}
          />
        </>
      )}

      {(info.kind === "string" ||
        info.kind === "number" ||
        info.kind === "integer") && (
        <DraftField
          label="Allowed values"
          description="One per line; leave empty to allow any"
          initial={formatInput(node.enum, "lines")}
          parse={(text) => parseEnumInput(text, info.kind !== "string")}
          onValue={setValue("enum")}
          multiline
        />
      )}

      {info.kind === "array" && (
        <>
          <NumberField
            label="Min items"
            node={node}
            keyword="minItems"
            onValue={setValue("minItems")}
            nonNegativeInteger
          />
          <NumberField
            label="Max items"
            node={node}
            keyword="maxItems"
            onValue={setValue("maxItems")}
            nonNegativeInteger
          />
          <CheckboxField
            label="Unique items"
            description="No duplicates"
            checked={node.uniqueItems === true}
            onChange={(unique) =>
              setValue("uniqueItems")(unique ? true : undefined)
            }
          />
        </>
      )}

      {info.kind === "any" && (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          {displayName} accepts any JSON value.
        </p>
      )}
    </div>
  );
}

/**
 * A text input that applies its value once it parses. Starts from `initial`
 * and keeps its own text, so half-typed values like "-" aren't lost.
 */
function DraftField({
  label,
  description,
  initial,
  parse,
  onValue,
  multiline = false,
  monospace = false,
}: {
  label: string;
  description?: string;
  initial: string;
  parse: (text: string) => ParsedInput;
  onValue: (value: JsonValue | undefined) => void;
  multiline?: boolean;
  monospace?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    setText(next);
    const parsed = parse(next);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onValue(parsed.value);
  }

  const inputProps = {
    id,
    value: text,
    "aria-invalid": error !== null,
    className: monospace ? "font-mono" : undefined,
  };
  return (
    <Field data-invalid={error !== null}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          {...inputProps}
          rows={3}
          onChange={(event) => change(event.target.value)}
        />
      ) : (
        <Input
          {...inputProps}
          autoComplete="off"
          onChange={(event) => change(event.target.value)}
        />
      )}
      {description && !error && (
        <FieldDescription>{description}</FieldDescription>
      )}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

function NumberField({
  label,
  node,
  keyword,
  onValue,
  nonNegativeInteger = false,
}: {
  label: string;
  node: JsonSchema;
  keyword: string;
  onValue: (value: JsonValue | undefined) => void;
  nonNegativeInteger?: boolean;
}) {
  return (
    <DraftField
      label={label}
      initial={formatInput(node[keyword], "text")}
      parse={(text) => parseNumberInput(text, { nonNegativeInteger })}
      onValue={onValue}
    />
  );
}

function CheckboxField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" className="self-start">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(state) => onChange(state === true)}
      />
      <div className="grid gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </div>
    </Field>
  );
}

function FormatField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const formats =
    value && !STRING_FORMATS.includes(value)
      ? [value, ...STRING_FORMATS]
      : STRING_FORMATS;
  return (
    <Field>
      <FieldLabel htmlFor={id}>Format</FieldLabel>
      <Select
        value={value ?? NO_FORMAT}
        onValueChange={(next) =>
          onChange(next === NO_FORMAT ? undefined : next)
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FORMAT}>None</SelectItem>
          {formats.map((format) => (
            <SelectItem key={format} value={format}>
              {format}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
