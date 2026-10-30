import type { EndpointSummary } from "@shared/endpoints";
import {
  PAGE_TRIGGER_LABELS,
  PAGE_TRIGGERS,
  type PageFields,
  type PageTrigger,
} from "@shared/pages";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { Controller, type UseFormReturn, useFieldArray } from "react-hook-form";
import { ulid } from "ulid";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateEndpointDialog } from "../endpoints/create-endpoint-dialog";
import { EditorSection } from "../endpoints/editor/editor-section";
import { endpointOptionLabel } from "../endpoints/labels";

type PageForm = UseFormReturn<PageFields, unknown, PageFields>;

/** The endpoints a page calls, each with when it's called and a note. */
export function EndpointLinksEditor({
  form,
  projectId,
  endpoints,
}: {
  form: PageForm;
  projectId: string;
  endpoints: EndpointSummary[];
}) {
  // `keyName` keeps React keys apart from the links' own `id` field.
  const links = useFieldArray({
    control: form.control,
    name: "endpoints",
    keyName: "fieldKey",
  });

  function addLink(endpointId: string, trigger: PageTrigger = "on_load") {
    links.append({ id: ulid(), endpointId, trigger, note: "" });
  }

  function addFirstUnused() {
    const used = new Set(
      form.getValues("endpoints").map((link) => link.endpointId),
    );
    const endpoint =
      endpoints.find((item) => !used.has(item.id)) ?? endpoints[0];
    if (endpoint) {
      addLink(endpoint.id);
    }
  }

  return (
    <EditorSection
      title="Endpoints"
      description="The endpoints this page calls, in the order it calls them."
      actions={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={endpoints.length === 0}
            onClick={addFirstUnused}
          >
            <PlusIcon />
            Add endpoint
          </Button>
          <CreateEndpointDialog
            projectId={projectId}
            onCreated={(endpoint) => addLink(endpoint.id)}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <PlusIcon />
                New endpoint
              </Button>
            }
          />
        </div>
      }
    >
      {links.fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {endpoints.length === 0
            ? "This project has no endpoints yet. Create one with New endpoint."
            : "No endpoints yet."}
        </p>
      )}
      {links.fields.map((link, index) => (
        <LinkRow
          key={link.fieldKey}
          form={form}
          index={index}
          count={links.fields.length}
          endpoints={endpoints}
          onMove={(offset) => links.move(index, index + offset)}
          onRemove={() => links.remove(index)}
        />
      ))}
    </EditorSection>
  );
}

function LinkRow({
  form,
  index,
  count,
  endpoints,
  onMove,
  onRemove,
}: {
  form: PageForm;
  index: number;
  count: number;
  endpoints: EndpointSummary[];
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const label = `Endpoint ${index + 1}`;

  return (
    <fieldset
      aria-label={label}
      className="m-0 grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,2fr)_12rem_minmax(0,1.5fr)_auto]"
    >
      <Controller
        control={form.control}
        name={`endpoints.${index}.endpointId`}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`${id}-endpoint`}>Endpoint</FieldLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                id={`${id}-endpoint`}
                className="w-full font-mono"
                aria-invalid={fieldState.invalid}
              >
                <SelectValue placeholder="Pick an endpoint" />
              </SelectTrigger>
              <SelectContent>
                {endpoints.map((endpoint) => (
                  <SelectItem
                    key={endpoint.id}
                    value={endpoint.id}
                    className="font-mono"
                  >
                    {endpointOptionLabel(endpoint)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name={`endpoints.${index}.trigger`}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor={`${id}-trigger`}>Trigger</FieldLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={`${id}-trigger`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_TRIGGERS.map((trigger) => (
                  <SelectItem key={trigger} value={trigger}>
                    {PAGE_TRIGGER_LABELS[trigger]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name={`endpoints.${index}.note`}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`${id}-note`}>Note</FieldLabel>
            <Input
              {...field}
              id={`${id}-note`}
              placeholder="e.g. Show errors inline"
              autoComplete="off"
              aria-invalid={fieldState.invalid}
            />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      <div className="flex items-end gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Move ${label} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Move ${label} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
    </fieldset>
  );
}
