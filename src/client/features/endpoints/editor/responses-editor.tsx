import {
  type EndpointFields,
  newBody,
  newResponse,
  RESPONSE_DESCRIPTIONS,
} from "@shared/endpoints";
import type { ModelSummary } from "@shared/models";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import {
  Controller,
  type UseFormReturn,
  useFieldArray,
  useWatch,
} from "react-hook-form";
import { ulid } from "ulid";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SchemaEditor } from "../../schema-editor/schema-editor";
import { BodyEditor } from "./body-editor";
import { EditorSection } from "./editor-section";
import { bodyErrorsAt, errorAt } from "./form-errors";

type EndpointForm = UseFormReturn<EndpointFields, unknown, EndpointFields>;

const COMMON_STATUSES = Object.keys(RESPONSE_DESCRIPTIONS);

function statusRank(status: string) {
  return status === "default" ? 1000 : Number.parseInt(status, 10) || 999;
}

export function ResponsesEditor({
  form,
  projectId,
  models,
}: {
  form: EndpointForm;
  projectId: string;
  models: ModelSummary[];
}) {
  // `keyName` keeps React keys apart from the responses' own `id` field.
  const responses = useFieldArray({
    control: form.control,
    name: "responses",
    keyName: "fieldKey",
  });
  const current = useWatch({ control: form.control, name: "responses" });
  const usedStatuses = new Set(current.map((response) => response.status));
  const { errors } = form.formState;

  function addResponse(status: string) {
    const index = current.findIndex(
      (response) => statusRank(response.status) > statusRank(status),
    );
    const response = newResponse(ulid(), status);
    if (index === -1) {
      responses.append(response);
    } else {
      responses.insert(index, response);
    }
  }

  return (
    <EditorSection
      title="Responses"
      description="What the endpoint can answer. Include the errors the frontend must handle."
      error={errorAt(errors, "responses.root") ?? errorAt(errors, "responses")}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <PlusIcon />
              Add response
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {COMMON_STATUSES.filter((status) => !usedStatuses.has(status)).map(
              (status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() => addResponse(status)}
                >
                  {status} {RESPONSE_DESCRIPTIONS[status]}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {responses.fields.map((response, index) => (
        <ResponseItem
          key={response.fieldKey}
          form={form}
          index={index}
          projectId={projectId}
          models={models}
          onRemove={() => responses.remove(index)}
        />
      ))}
    </EditorSection>
  );
}

function ResponseItem({
  form,
  index,
  projectId,
  models,
  onRemove,
}: {
  form: EndpointForm;
  index: number;
  projectId: string;
  models: ModelSummary[];
  onRemove: () => void;
}) {
  const id = useId();
  const response = useWatch({
    control: form.control,
    name: `responses.${index}`,
  });
  const { errors } = form.formState;

  return (
    <section
      aria-label={`Response ${response.status}`}
      className="grid gap-4 rounded-lg border p-3"
    >
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto]">
        <Controller
          control={form.control}
          name={`responses.${index}.status`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${id}-status`}>Status code</FieldLabel>
              <Input
                {...field}
                id={`${id}-status`}
                className="font-mono"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
                onChange={(event) => {
                  const status = event.target.value;
                  // Keep the description in step while it's still the default text.
                  const description = form.getValues(
                    `responses.${index}.description`,
                  );
                  if (
                    description === (RESPONSE_DESCRIPTIONS[field.value] ?? "")
                  ) {
                    form.setValue(
                      `responses.${index}.description`,
                      RESPONSE_DESCRIPTIONS[status] ?? "",
                      { shouldDirty: true },
                    );
                  }
                  field.onChange(status);
                }}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name={`responses.${index}.description`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
              <Input
                {...field}
                id={`${id}-description`}
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <div className="flex items-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove response"
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <h4 className="text-sm font-medium">Headers</h4>
        <Controller
          control={form.control}
          name={`responses.${index}.headers`}
          render={({ field }) => (
            <SchemaEditor
              variant="fields"
              value={field.value}
              onChange={field.onChange}
              models={models}
              ownerName={`response ${response.status} headers`}
              emptyText="No headers."
            />
          )}
        />
        <FieldError>{errorAt(errors, `responses.${index}.headers`)}</FieldError>
      </div>
      <Controller
        control={form.control}
        name={`responses.${index}.body`}
        render={({ field }) => (
          <>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-has-body`}
                checked={field.value !== null}
                onCheckedChange={(checked) =>
                  field.onChange(checked === true ? newBody() : null)
                }
              />
              <FieldLabel htmlFor={`${id}-has-body`}>Has a body</FieldLabel>
            </Field>
            {field.value && (
              <BodyEditor
                body={field.value}
                onChange={field.onChange}
                projectId={projectId}
                models={models}
                validityKey={`responses.${response.id}.body`}
                ownerName={`response ${response.status} body`}
                errors={bodyErrorsAt(errors, `responses.${index}.body`)}
              />
            )}
          </>
        )}
      />
    </section>
  );
}
