import {
  type EndpointFields,
  type EndpointResponse,
  newBody,
  newResponse,
  RESPONSE_DESCRIPTIONS,
  reasonPhrase,
} from "@shared/endpoints";
import { type ErrorType, responseForStatus } from "@shared/error-types";
import type { ModelSummary } from "@shared/models";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import {
  Controller,
  get,
  type UseFormReturn,
  useFieldArray,
  useWatch,
} from "react-hook-form";
import { ulid } from "ulid";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { ExamplesEditor } from "./examples-editor";
import { bodyErrorsAt, errorAt } from "./form-errors";

type EndpointForm = UseFormReturn<EndpointFields, unknown, EndpointFields>;

const COMMON_STATUSES = Object.keys(RESPONSE_DESCRIPTIONS);

function statusRank(status: string) {
  return status === "default" ? 1000 : Number.parseInt(status, 10) || 999;
}

/** Whether a response has a body of its own, which catalog errors can't share. */
function hasOwnBody(response: EndpointResponse) {
  return response.body !== null && response.errors.length === 0;
}

export function ResponsesEditor({
  form,
  projectId,
  models,
  errorTypes,
}: {
  form: EndpointForm;
  projectId: string;
  models: ModelSummary[];
  errorTypes: ErrorType[];
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

  function insertInOrder(response: EndpointResponse) {
    const index = form
      .getValues("responses")
      .findIndex(
        (item) => statusRank(item.status) > statusRank(response.status),
      );
    if (index === -1) {
      responses.append(response);
    } else {
      responses.insert(index, response);
    }
  }

  function addResponse(status: string) {
    insertInOrder(newResponse(ulid(), status));
  }

  /** Each error type goes in the response for its status, added if missing. */
  function addErrorTypes(selected: ErrorType[]) {
    for (const errorType of selected) {
      const all = form.getValues("responses");
      const target = responseForStatus(all, errorType.status);
      const usage = { errorTypeId: errorType.id, examples: [] };
      if (!target) {
        insertInOrder({
          ...newResponse(ulid(), errorType.status),
          description: reasonPhrase(errorType.status) || errorType.title,
          body: null,
          errors: [usage],
        });
        continue;
      }
      const index = all.indexOf(target);
      if (
        hasOwnBody(target) ||
        target.errors.some((error) => error.errorTypeId === errorType.id)
      ) {
        continue;
      }
      form.setValue(`responses.${index}.errors`, [...target.errors, usage], {
        shouldDirty: true,
      });
    }
  }

  return (
    <EditorSection
      title="Responses"
      description="What the endpoint can answer. Include the errors the frontend must handle."
      error={errorAt(errors, "responses.root") ?? errorAt(errors, "responses")}
      actions={
        <div className="flex gap-2">
          <AddErrorTypesDialog
            errorTypes={errorTypes}
            responses={current}
            onAdd={addErrorTypes}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <PlusIcon />
                Add response
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {COMMON_STATUSES.filter(
                (status) => !usedStatuses.has(status),
              ).map((status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() => addResponse(status)}
                >
                  {status} {RESPONSE_DESCRIPTIONS[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      {responses.fields.map((response, index) => (
        <ResponseItem
          key={response.fieldKey}
          form={form}
          index={index}
          projectId={projectId}
          models={models}
          errorTypes={errorTypes}
          onRemove={() => responses.remove(index)}
        />
      ))}
    </EditorSection>
  );
}

/** Picks error types from the catalog; each goes in the response for its status. */
function AddErrorTypesDialog({
  errorTypes,
  responses,
  onAdd,
}: {
  errorTypes: ErrorType[];
  responses: EndpointResponse[];
  onAdd: (selected: ErrorType[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    setSelected(new Set());
  }

  /** Why an error type can't be added, if it can't. */
  function blocker(errorType: ErrorType) {
    const target = responseForStatus(responses, errorType.status);
    if (!target) {
      return undefined;
    }
    if (target.errors.some((error) => error.errorTypeId === errorType.id)) {
      return `Already in the ${target.status} response`;
    }
    return hasOwnBody(target)
      ? `The ${target.status} response has its own body; remove it first`
      : undefined;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <PlusIcon />
          Add error types
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add error types</DialogTitle>
          <DialogDescription>
            Each goes in the response for its status, which is added if the
            endpoint doesn't have it yet.
          </DialogDescription>
        </DialogHeader>
        {errorTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The project has no error types yet. Add them on the Error types tab.
          </p>
        ) : (
          <ul className="grid gap-2">
            {errorTypes.map((errorType) => {
              const reason = blocker(errorType);
              const checkboxId = `${id}-${errorType.id}`;
              return (
                <li key={errorType.id}>
                  <Field orientation="horizontal" className="items-start">
                    <Checkbox
                      id={checkboxId}
                      className="mt-0.5"
                      disabled={reason !== undefined}
                      checked={selected.has(errorType.id)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked === true) {
                            next.add(errorType.id);
                          } else {
                            next.delete(errorType.id);
                          }
                          return next;
                        })
                      }
                    />
                    <FieldLabel
                      htmlFor={checkboxId}
                      className="grid gap-0.5 font-normal"
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {errorType.status}
                        </span>
                        <span className="font-mono">{errorType.name}</span>
                        <span className="text-muted-foreground">
                          {errorType.title}
                        </span>
                      </span>
                      {reason && (
                        <span className="text-xs text-muted-foreground">
                          {reason}
                        </span>
                      )}
                    </FieldLabel>
                  </Field>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={selected.size === 0}
            onClick={() => {
              onAdd(errorTypes.filter((item) => selected.has(item.id)));
              onOpenChange(false);
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResponseItem({
  form,
  index,
  projectId,
  models,
  errorTypes,
  onRemove,
}: {
  form: EndpointForm;
  index: number;
  projectId: string;
  models: ModelSummary[];
  errorTypes: ErrorType[];
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
      {response.errors.length > 0 ? (
        <ResponseErrorTypes
          form={form}
          index={index}
          projectId={projectId}
          errorTypes={errorTypes}
        />
      ) : (
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
      )}
      <FieldError>{errorAt(errors, `responses.${index}.body`)}</FieldError>
    </section>
  );
}

/**
 * The catalog's error types a response answers with, which give it its
 * body. Their order matters: mock servers answer with the first by default.
 */
function ResponseErrorTypes({
  form,
  index,
  projectId,
  errorTypes,
}: {
  form: EndpointForm;
  index: number;
  projectId: string;
  errorTypes: ErrorType[];
}) {
  const id = useId();
  const response = useWatch({
    control: form.control,
    name: `responses.${index}`,
  });
  const { errors } = form.formState;
  const usages = response.errors;
  const setUsages = (next: EndpointResponse["errors"]) =>
    form.setValue(`responses.${index}.errors`, next, { shouldDirty: true });
  const move = (from: number, to: number) => {
    const next = [...usages];
    const [moved] = next.splice(from, 1);
    if (moved) {
      next.splice(to, 0, moved);
      setUsages(next);
    }
  };

  return (
    <section aria-label="Error types" className="grid gap-2">
      <div className="grid gap-0.5">
        <h4 className="text-sm font-medium">Error types</h4>
        <p className="text-sm text-muted-foreground">
          The body comes from these, in this order; mock servers answer with the
          first.
        </p>
      </div>
      <ul className="grid gap-2">
        {usages.map((usage, usageIndex) => {
          const errorType = errorTypes.find(
            (item) => item.id === usage.errorTypeId,
          );
          const name = errorType?.name ?? "Unknown error type";
          const path = `responses.${index}.errors.${usageIndex}`;
          const exampleErrors = get(errors, `${path}.examples`) as unknown;
          return (
            <li
              key={usage.errorTypeId}
              className="grid gap-2 rounded-md border p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{name}</span>
                {errorType && (
                  <span className="text-sm text-muted-foreground">
                    {errorType.title}
                  </span>
                )}
                <div className="ml-auto flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${name} up`}
                    disabled={usageIndex === 0}
                    onClick={() => move(usageIndex, usageIndex - 1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${name} down`}
                    disabled={usageIndex === usages.length - 1}
                    onClick={() => move(usageIndex, usageIndex + 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${name}`}
                    onClick={() =>
                      setUsages(usages.filter((_, i) => i !== usageIndex))
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
              <FieldError>{errorAt(errors, `${path}.errorTypeId`)}</FieldError>
              {errorType && (
                <>
                  <Field orientation="horizontal">
                    <Checkbox
                      id={`${id}-${usage.errorTypeId}-own`}
                      aria-label={`Own examples of ${name}`}
                      checked={usage.examples.length > 0}
                      onCheckedChange={(checked) =>
                        setUsages(
                          usages.map((item, i) =>
                            i !== usageIndex
                              ? item
                              : {
                                  ...item,
                                  // Starts from the catalog's example.
                                  examples:
                                    checked === true
                                      ? [
                                          {
                                            id: ulid(),
                                            name: errorType.name,
                                            summary: "",
                                            value: errorType.body.example,
                                          },
                                        ]
                                      : [],
                                },
                          ),
                        )
                      }
                    />
                    <FieldLabel
                      htmlFor={`${id}-${usage.errorTypeId}-own`}
                      className="font-normal"
                    >
                      Use this endpoint's own examples, like the fields it
                      checks
                    </FieldLabel>
                  </Field>
                  {usage.examples.length > 0 && (
                    <ExamplesEditor
                      examples={usage.examples}
                      onChange={(examples) =>
                        setUsages(
                          usages.map((item, i) =>
                            i === usageIndex ? { ...item, examples } : item,
                          ),
                        )
                      }
                      schema={errorType.body.schema}
                      projectId={projectId}
                      validityKey={`responses.${response.id}.errors.${usage.errorTypeId}`}
                      nameErrors={
                        Array.isArray(exampleErrors)
                          ? exampleErrors.map((example) =>
                              errorAt(example ?? {}, "name"),
                            )
                          : undefined
                      }
                    />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
