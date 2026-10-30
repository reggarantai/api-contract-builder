import { modelRef } from "@shared/json-schema";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSchemaEditor } from "./schema-editor-context";
import {
  type KindTarget,
  type NodeInfo,
  SCHEMA_TYPES,
  type SchemaType,
} from "./schema-ops";

const TYPE_LABELS: Record<SchemaType | "any", string> = {
  string: "String",
  number: "Number",
  integer: "Integer",
  boolean: "Boolean",
  object: "Object",
  array: "Array",
  any: "Any",
};

const REF_VALUE_PREFIX = "ref:";

export function TypeSelect({
  info,
  onChange,
  label,
}: {
  info: NodeInfo;
  onChange: (target: KindTarget) => void;
  /** Accessible name, e.g. "Type of email". */
  label: string;
}) {
  const { models } = useSchemaEditor();

  if (
    info.kind === "custom" ||
    (info.kind === "ref" && info.modelId === null)
  ) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" aria-label={label} tabIndex={0}>
            Custom
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          Uses JSON Schema features the builder can't edit. Switch to JSON to
          change it.
        </TooltipContent>
      </Tooltip>
    );
  }

  const value =
    info.kind === "ref" ? `${REF_VALUE_PREFIX}${info.modelId}` : info.kind;
  const isUnknownModel =
    info.kind === "ref" && !models.some((model) => model.id === info.modelId);

  return (
    <Select
      value={value}
      onValueChange={(next) =>
        onChange(
          next.startsWith(REF_VALUE_PREFIX)
            ? { ref: modelRef(next.slice(REF_VALUE_PREFIX.length)) }
            : (next as SchemaType | "any"),
        )
      }
    >
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Types</SelectLabel>
          {[...SCHEMA_TYPES, "any" as const].map((type) => (
            <SelectItem key={type} value={type}>
              {TYPE_LABELS[type]}
            </SelectItem>
          ))}
        </SelectGroup>
        {models.length > 0 && (
          <SelectGroup>
            <SelectLabel>Models</SelectLabel>
            {models.map((model) => (
              <SelectItem
                key={model.id}
                value={`${REF_VALUE_PREFIX}${model.id}`}
              >
                {model.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {isUnknownModel && (
          <SelectItem value={value} disabled>
            Unknown model
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
