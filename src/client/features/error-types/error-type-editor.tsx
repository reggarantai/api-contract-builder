import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ErrorType,
  type ErrorTypeFields,
  errorTypeFieldsSchema,
} from "@shared/error-types";
import { generateExample } from "@shared/generate-example";
import type { JsonValue } from "@shared/json-schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { SparklesIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { SaveButtons } from "@/components/save-buttons";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { showRequestError } from "@/lib/forms";
import { errorAt } from "../endpoints/editor/form-errors";
import { endpointsQueryOptions } from "../endpoints/queries";
import { modelsQueryOptions, useLoadModelSchemas } from "../models/queries";
import { SchemaEditor } from "../schema-editor/schema-editor";
import {
  errorTypeKeys,
  useDeleteErrorType,
  useUpdateErrorType,
} from "./queries";

function fieldsOf(errorType: ErrorType): ErrorTypeFields {
  return {
    name: errorType.name,
    status: errorType.status,
    title: errorType.title,
    description: errorType.description,
    headers: errorType.headers,
    body: errorType.body,
  };
}

function formatValue(value: JsonValue) {
  return JSON.stringify(value, null, 2);
}

export function ErrorTypeEditor({
  projectId,
  errorType,
}: {
  projectId: string;
  errorType: ErrorType;
}) {
  const models = useQuery(modelsQueryOptions(projectId)).data ?? [];
  const updateErrorType = useUpdateErrorType(projectId, errorType.id);
  const loadModelSchemas = useLoadModelSchemas(projectId);
  const values = useMemo(() => fieldsOf(errorType), [errorType]);
  const form = useForm<ErrorTypeFields, unknown, ErrorTypeFields>({
    resolver: zodResolver(errorTypeFieldsSchema),
    values,
  });
  // Text that doesn't parse yet (the schemas, the example) can't be saved.
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const reportValidity = (key: string, valid: boolean) =>
    setInvalid((current) => {
      if (valid !== current.has(key)) {
        return current;
      }
      const next = new Set(current);
      if (valid) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  const [exampleText, setExampleText] = useState(() =>
    formatValue(errorType.body.example),
  );
  // Remounts the schema editors on discard, so JSON mode reloads its text.
  const [editorKey, setEditorKey] = useState(0);
  const hasChanges = form.formState.isDirty || invalid.size > 0;

  useBlocker({
    shouldBlockFn: () =>
      hasChanges && !window.confirm("Leave without saving your changes?"),
    enableBeforeUnload: () => hasChanges,
  });

  function discard() {
    form.reset(values);
    setInvalid(new Set());
    setExampleText(formatValue(values.body.example));
    setEditorKey((key) => key + 1);
  }

  function changeExample(text: string) {
    setExampleText(text);
    try {
      const example = JSON.parse(text) as JsonValue;
      reportValidity("example", true);
      form.setValue("body.example", example, { shouldDirty: true });
    } catch {
      reportValidity("example", false);
    }
  }

  async function generate() {
    const resolveModel = await loadModelSchemas();
    const example = generateExample(
      form.getValues("body.schema"),
      resolveModel,
    );
    setExampleText(formatValue(example));
    reportValidity("example", true);
    form.setValue("body.example", example, { shouldDirty: true });
  }

  const onSubmit = form.handleSubmit((input) =>
    updateErrorType.mutate(input, {
      onSuccess: () => toast.success("Error type saved"),
      onError: (error) => showRequestError(error, form.setError),
    }),
  );
  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle className="font-mono">{errorType.name}</CardTitle>
          <CardAction>
            <DeleteErrorTypeButton
              projectId={projectId}
              errorType={errorType}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-[16rem_7rem_1fr]">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="error-type-editor-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="error-type-editor-name"
                    className="font-mono"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="status"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="error-type-editor-status">
                    Status
                  </FieldLabel>
                  <Input
                    {...field}
                    id="error-type-editor-status"
                    className="font-mono"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="title"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="error-type-editor-title">
                    Title
                  </FieldLabel>
                  <Input
                    {...field}
                    id="error-type-editor-title"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="error-type-editor-description">
                  Description
                </FieldLabel>
                <Textarea
                  {...field}
                  id="error-type-editor-description"
                  rows={3}
                  placeholder="When it happens, and what the client should do. Markdown is fine."
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <div key={editorKey} className="grid gap-6">
            <section aria-label="Headers" className="grid gap-2">
              <h3 className="text-sm font-medium">Headers</h3>
              <Controller
                control={form.control}
                name="headers"
                render={({ field, fieldState }) => (
                  <>
                    <SchemaEditor
                      variant="fields"
                      value={field.value}
                      onChange={field.onChange}
                      models={models}
                      ownerName={`${errorType.name} headers`}
                      emptyText="No headers."
                    />
                    <FieldError errors={[fieldState.error]} />
                  </>
                )}
              />
            </section>
            <section aria-label="Body" className="grid gap-4">
              <h3 className="text-sm font-medium">Body</h3>
              <Controller
                control={form.control}
                name="body.contentType"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} className="max-w-sm">
                    <FieldLabel htmlFor="error-type-editor-content-type">
                      Content type
                    </FieldLabel>
                    <Input
                      {...field}
                      id="error-type-editor-content-type"
                      className="font-mono"
                      autoComplete="off"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="body.schema"
                render={({ field }) => (
                  <SchemaEditor
                    value={field.value}
                    onChange={field.onChange}
                    models={models}
                    ownerName={`${errorType.name} body`}
                    onValidityChange={(valid) =>
                      reportValidity("schema", valid)
                    }
                  />
                )}
              />
              <Field data-invalid={invalid.has("example")}>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="error-type-editor-example">
                    Example
                  </FieldLabel>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={generate}
                  >
                    <SparklesIcon />
                    Generate from schema
                  </Button>
                </div>
                <Textarea
                  id="error-type-editor-example"
                  className="font-mono text-xs"
                  rows={Math.min(
                    16,
                    Math.max(4, exampleText.split("\n").length),
                  )}
                  value={exampleText}
                  spellCheck={false}
                  aria-invalid={invalid.has("example")}
                  onChange={(event) => changeExample(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  The error as the API sends it. Responses use it unless an
                  endpoint gives its own examples.
                </p>
                {invalid.has("example") && (
                  <FieldError>Enter valid JSON</FieldError>
                )}
                <FieldError>{errorAt(errors, "body.example")}</FieldError>
              </Field>
            </section>
          </div>
          <UsedBy projectId={projectId} errorType={errorType} />
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          {invalid.size > 0 && (
            <span className="mr-auto text-sm text-destructive">
              Fix the JSON before saving.
            </span>
          )}
          <SaveButtons
            isDirty={hasChanges}
            isSaving={updateErrorType.isPending}
            canSave={invalid.size === 0}
            onReset={discard}
          />
        </CardFooter>
      </Card>
    </form>
  );
}

/** The endpoints whose responses answer with the error type. */
function UsedBy({
  projectId,
  errorType,
}: {
  projectId: string;
  errorType: ErrorType;
}) {
  const endpoints = useQuery(endpointsQueryOptions(projectId)).data ?? [];
  const users = endpoints.filter((endpoint) =>
    errorType.endpointIds.includes(endpoint.id),
  );

  return (
    <section aria-label="Used by" className="grid gap-2">
      <h3 className="text-sm font-medium">Used by</h3>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No endpoint answers with it yet. Add it from an endpoint's responses.
        </p>
      ) : (
        <ul className="grid gap-1">
          {users.map((endpoint) => (
            <li key={endpoint.id}>
              <Link
                to="/projects/$projectId/endpoints/$endpointId"
                params={{ projectId, endpointId: endpoint.id }}
                className="font-mono text-sm underline-offset-4 hover:underline"
              >
                {endpoint.method} {endpoint.path}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeleteErrorTypeButton({
  projectId,
  errorType,
}: {
  projectId: string;
  errorType: ErrorType;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteErrorType = useDeleteErrorType(projectId);

  async function onDelete() {
    try {
      await deleteErrorType.mutateAsync(errorType.id);
    } catch (error) {
      setOpen(false);
      toast.error((error as Error).message);
      return;
    }
    setOpen(false);
    await navigate({
      to: "/projects/$projectId/error-types",
      params: { projectId },
    });
    queryClient.removeQueries({
      queryKey: errorTypeKeys.detail(projectId, errorType.id),
    });
    toast.success(`Deleted ${errorType.name}`);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Trash2Icon />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {errorType.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This can't be undone. Responses that use it must drop it first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteErrorType.isPending}
            onClick={onDelete}
          >
            Delete error type
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
