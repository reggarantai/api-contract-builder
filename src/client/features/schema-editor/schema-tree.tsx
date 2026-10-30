import { isJsonObject, type JsonSchema } from "@shared/json-schema";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SchemaDetails } from "./schema-details";
import { pathKey, useSchemaEditor } from "./schema-editor-context";
import { ROW_GRID } from "./schema-layout";
import {
  addProperty,
  changeKind,
  describeNode,
  getAt,
  isRequired,
  moveProperty,
  propertyNames,
  removeProperty,
  renameProperty,
  type SchemaPath,
  setKeyword,
  setRequired,
  summarizeNode,
  uniquePropertyName,
} from "./schema-ops";
import { TypeSelect } from "./type-select";

const INDENT_REM = 1.25;

function asObject(node: unknown): JsonSchema {
  return isJsonObject(node) ? node : {};
}

type PropertyRowContext = {
  /** Path of the object schema that owns the property. */
  parentPath: SchemaPath;
  name: string;
  index: number;
  siblings: string[];
};

/** The properties of the object schema at `path`, plus an "Add field" button. */
export function PropertyList({
  path,
  depth,
  ownerName,
}: {
  path: SchemaPath;
  depth: number;
  /** Name used in accessible labels, e.g. "address". */
  ownerName: string;
}) {
  const { root, update, setFocusKey } = useSchemaEditor();
  const node = getAt(root, path);
  const names = propertyNames(node);

  function addField() {
    const name = uniquePropertyName(node);
    update(path, (current) => addProperty(asObject(current), name));
    setFocusKey(pathKey([...path, "properties", name]));
  }

  return (
    <>
      {names.map((name, index) => (
        <SchemaRow
          key={name}
          path={[...path, "properties", name]}
          depth={depth}
          displayName={name}
          property={{ parentPath: path, name, index, siblings: names }}
        />
      ))}
      <div
        className="border-t px-3 py-1"
        style={{ paddingLeft: `${0.75 + depth * INDENT_REM + 1.75}rem` }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-label={`Add field to ${ownerName}`}
          onClick={addField}
        >
          <PlusIcon />
          Add field
        </Button>
      </div>
    </>
  );
}

/** One field (a property, or the items of an array) and its children. */
export function SchemaRow({
  path,
  depth,
  displayName,
  property,
}: {
  path: SchemaPath;
  depth: number;
  /** Name used in labels: the property name, or "tags[]" for array items. */
  displayName: string;
  property?: PropertyRowContext;
}) {
  const { root, update, focusKey, setFocusKey } = useSchemaEditor();
  const [expanded, setExpanded] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const node = getAt(root, path);
  const info = describeNode(node);
  const summary = summarizeNode(node);
  const hasChildren = info.kind === "object" || info.kind === "array";
  const description =
    isJsonObject(node) && typeof node.description === "string"
      ? node.description
      : "";

  const updateNode = (change: (node: JsonSchema) => JsonSchema) =>
    update(path, (current) => change(asObject(current)));
  const updateParent = (change: (node: JsonSchema) => JsonSchema) => {
    if (property) {
      update(property.parentPath, (current) => change(asObject(current)));
    }
  };

  return (
    <div className="border-t">
      <div className={ROW_GRID}>
        <div
          className="flex min-w-0 items-start gap-1"
          style={{ paddingLeft: `${depth * INDENT_REM}rem` }}
        >
          {hasChildren ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${displayName}`}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronRightIcon
                className={cn("transition-transform", expanded && "rotate-90")}
              />
            </Button>
          ) : (
            <span className="w-7 shrink-0" />
          )}
          {property ? (
            <NameInput
              name={property.name}
              siblings={property.siblings}
              autoFocus={focusKey === pathKey(path)}
              onFocused={() => setFocusKey(null)}
              onRename={(name) =>
                updateParent((parent) =>
                  renameProperty(parent, property.name, name),
                )
              }
            />
          ) : (
            <span className="px-2.5 py-1.5 font-mono text-sm text-muted-foreground">
              items
            </span>
          )}
        </div>

        <div className="grid min-w-0 gap-0.5">
          <TypeSelect
            info={info}
            label={`Type of ${displayName}`}
            onChange={(target) =>
              update(path, (current) => changeKind(current, target))
            }
          />
          {summary.length > 0 && (
            <span className="truncate px-1 text-xs text-muted-foreground">
              {summary.join(" · ")}
            </span>
          )}
        </div>

        <div className="flex h-8 items-center justify-center">
          {property && (
            <Checkbox
              aria-label={`${displayName} is required`}
              checked={isRequired(
                getAt(root, property.parentPath),
                property.name,
              )}
              onCheckedChange={(checked) =>
                updateParent((parent) =>
                  setRequired(parent, property.name, checked === true),
                )
              }
            />
          )}
        </div>

        <Input
          className="h-8"
          placeholder="Description"
          aria-label={`Description of ${displayName}`}
          value={description}
          onChange={(event) =>
            updateNode((current) =>
              setKeyword(
                current,
                "description",
                event.target.value || undefined,
              ),
            )
          }
        />

        <div className="flex justify-end gap-0.5">
          <Button
            type="button"
            variant={detailsOpen ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={`Details of ${displayName}`}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <SlidersHorizontalIcon />
          </Button>
          {property && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${displayName}`}
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={property.index === 0}
                  onSelect={() =>
                    updateParent((parent) =>
                      moveProperty(parent, property.name, -1),
                    )
                  }
                >
                  <ArrowUpIcon />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={property.index === property.siblings.length - 1}
                  onSelect={() =>
                    updateParent((parent) =>
                      moveProperty(parent, property.name, 1),
                    )
                  }
                >
                  <ArrowDownIcon />
                  Move down
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    updateParent((parent) =>
                      removeProperty(parent, property.name),
                    )
                  }
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {detailsOpen && isJsonObject(node) && (
        <div
          className="border-t bg-muted/30 px-3 py-3"
          style={{ paddingLeft: `${0.75 + depth * INDENT_REM + 1.75}rem` }}
        >
          <SchemaDetails
            path={path}
            node={node}
            info={info}
            displayName={displayName}
          />
        </div>
      )}

      {expanded && info.kind === "object" && (
        <PropertyList path={path} depth={depth + 1} ownerName={displayName} />
      )}
      {expanded && info.kind === "array" && (
        <SchemaRow
          path={[...path, "items"]}
          depth={depth + 1}
          displayName={`${displayName}[]`}
        />
      )}
    </div>
  );
}

/**
 * Edits a property name. Renaming changes the row's key, so the new name is
 * applied on blur or Enter rather than on every keystroke.
 */
function NameInput({
  name,
  siblings,
  autoFocus,
  onFocused,
  onRename,
}: {
  name: string;
  siblings: string[];
  autoFocus: boolean;
  onFocused: () => void;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  const error =
    trimmed === ""
      ? "Name is required"
      : trimmed !== name && siblings.includes(trimmed)
        ? "Name already used"
        : null;

  function commit() {
    if (error) {
      setDraft(name);
    } else if (trimmed !== name) {
      onRename(trimmed);
    }
  }

  return (
    <div className="grid min-w-0 flex-1 gap-0.5">
      <Input
        className="h-8 font-mono"
        aria-label={`Name of ${name}`}
        aria-invalid={error !== null}
        value={draft}
        autoFocus={autoFocus}
        onFocus={(event) => {
          if (autoFocus) {
            event.target.select();
            onFocused();
          }
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Don't submit the surrounding form.
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setDraft(name);
          }
        }}
      />
      {error && <span className="px-1 text-xs text-destructive">{error}</span>}
    </div>
  );
}
