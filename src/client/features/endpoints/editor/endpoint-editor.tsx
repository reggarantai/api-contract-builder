import { zodResolver } from "@hookform/resolvers/zod";
import {
  ENDPOINT_STATUSES,
  type Endpoint,
  type EndpointFields,
  endpointSchema,
  HTTP_METHODS,
  type HttpMethod,
  methodAllowsBody,
  newBody,
  suggestOperationId,
  syncPathParameters,
} from "@shared/endpoints";
import type { Project } from "@shared/projects";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { showRequestError } from "@/lib/forms";
import { modelsQueryOptions } from "../../models/queries";
import { SchemaEditor } from "../../schema-editor/schema-editor";
import { StatusLabel } from "../badges";
import { endpointKeys, useDeleteEndpoint, useUpdateEndpoint } from "../queries";
import { BodyEditor } from "./body-editor";
import { EditorSection } from "./editor-section";
import { bodyErrorsAt, errorAt } from "./form-errors";
import { ResponsesEditor } from "./responses-editor";
import { SecuritySelect } from "./security-select";
import { ValidityContext } from "./validity";

function fieldsOf(endpoint: Endpoint): EndpointFields {
  return {
    method: endpoint.method,
    path: endpoint.path,
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    description: endpoint.description,
    status: endpoint.status,
    deprecated: endpoint.deprecated,
    security: endpoint.security,
    parameters: endpoint.parameters,
    requestBody: endpoint.requestBody,
    responses: endpoint.responses,
    notesFe: endpoint.notesFe,
    notesBe: endpoint.notesBe,
  };
}

export function EndpointEditor({
  project,
  endpoint,
}: {
  project: Project;
  endpoint: Endpoint;
}) {
  const projectId = project.id;
  const models = useQuery(modelsQueryOptions(projectId)).data ?? [];
  const updateEndpoint = useUpdateEndpoint(projectId, endpoint.id);
  const values = useMemo(() => fieldsOf(endpoint), [endpoint]);
  const form = useForm<EndpointFields, unknown, EndpointFields>({
    resolver: zodResolver(endpointSchema),
    values,
  });
  const { errors } = form.formState;

  const [invalidKeys, setInvalidKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const reportValidity = useCallback((key: string, valid: boolean) => {
    setInvalidKeys((current) => {
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
  }, []);
  // Remounts nested editors on discard so their text reloads.
  const [editorKey, setEditorKey] = useState(0);
  const hasChanges = form.formState.isDirty || invalidKeys.size > 0;

  useBlocker({
    shouldBlockFn: () =>
      hasChanges && !window.confirm("Leave without saving your changes?"),
    enableBeforeUnload: () => hasChanges,
  });

  const method = useWatch({ control: form.control, name: "method" });
  const path = useWatch({ control: form.control, name: "path" });

  function discard() {
    form.reset(values);
    setInvalidKeys(new Set());
    setEditorKey((key) => key + 1);
  }

  const onSubmit = form.handleSubmit((input) =>
    updateEndpoint.mutate(input, {
      onSuccess: () => toast.success("Endpoint saved"),
      onError: (error) => showRequestError(error, form.setError),
    }),
  );

  return (
    <ValidityContext.Provider value={reportValidity}>
      <form onSubmit={onSubmit} className="grid gap-6">
        <div className="flex items-center justify-between gap-4">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/projects/$projectId/endpoints" params={{ projectId }}>
              <ArrowLeftIcon />
              All endpoints
            </Link>
          </Button>
          <DeleteEndpointButton projectId={projectId} endpoint={endpoint} />
        </div>

        <div className="grid gap-4 rounded-xl border p-4">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_10rem]">
            <Controller
              control={form.control}
              name="method"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="endpoint-editor-method">
                    Method
                  </FieldLabel>
                  <Select
                    value={field.value}
                    onValueChange={(next) => {
                      const nextMethod = next as HttpMethod;
                      field.onChange(nextMethod);
                      if (!methodAllowsBody(nextMethod)) {
                        form.setValue("requestBody", null, {
                          shouldDirty: true,
                        });
                      }
                    }}
                  >
                    <SelectTrigger
                      id="endpoint-editor-method"
                      className="w-full font-mono"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HTTP_METHODS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="path"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="endpoint-editor-path">Path</FieldLabel>
                  <Input
                    {...field}
                    id="endpoint-editor-path"
                    className="font-mono"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                    onChange={(event) => {
                      const nextPath = event.target.value;
                      field.onChange(nextPath);
                      form.setValue(
                        "parameters.path",
                        syncPathParameters(
                          form.getValues("parameters.path"),
                          nextPath,
                        ),
                        { shouldDirty: true },
                      );
                    }}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="endpoint-editor-status">
                    Status
                  </FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="endpoint-editor-status"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENDPOINT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          <StatusLabel status={status} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="summary"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="endpoint-editor-summary">
                    Summary
                  </FieldLabel>
                  <Input
                    {...field}
                    id="endpoint-editor-summary"
                    placeholder="Get a stock item"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="operationId"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="endpoint-editor-operation-id">
                    Operation ID
                  </FieldLabel>
                  <Input
                    {...field}
                    id="endpoint-editor-operation-id"
                    className="font-mono"
                    placeholder={suggestOperationId(method, path)}
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
                <FieldLabel htmlFor="endpoint-editor-description">
                  Description
                </FieldLabel>
                <Textarea
                  {...field}
                  id="endpoint-editor-description"
                  rows={3}
                  placeholder="Behavior, rules, and edge cases. Markdown is fine."
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="security"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="endpoint-editor-security">
                    Authentication
                  </FieldLabel>
                  <SecuritySelect
                    id="endpoint-editor-security"
                    value={field.value}
                    onChange={field.onChange}
                    project={project}
                    invalid={fieldState.invalid}
                  />
                  <FieldError
                    errors={[
                      fieldState.error,
                      { message: errorAt(errors, "security.schemeIds") },
                    ]}
                  />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="deprecated"
              render={({ field }) => (
                <Field orientation="horizontal" className="h-9">
                  <Checkbox
                    id="endpoint-editor-deprecated"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                  <FieldLabel htmlFor="endpoint-editor-deprecated">
                    Deprecated
                  </FieldLabel>
                </Field>
              )}
            />
          </div>
        </div>

        <div key={editorKey} className="grid gap-6">
          <EditorSection
            title="Path parameters"
            description="Taken from the path; describe their types here."
            error={errorAt(errors, "parameters.path")}
          >
            <Controller
              control={form.control}
              name="parameters.path"
              render={({ field }) => (
                <SchemaEditor
                  variant="fields"
                  lockNames
                  value={field.value}
                  onChange={field.onChange}
                  models={models}
                  ownerName="path parameters"
                  emptyText="No path parameters. Add one to the path, like /stocks/{id}."
                />
              )}
            />
          </EditorSection>

          <EditorSection
            title="Query parameters"
            error={errorAt(errors, "parameters.query")}
          >
            <Controller
              control={form.control}
              name="parameters.query"
              render={({ field }) => (
                <SchemaEditor
                  variant="fields"
                  value={field.value}
                  onChange={field.onChange}
                  models={models}
                  ownerName="query parameters"
                  emptyText="No query parameters."
                />
              )}
            />
          </EditorSection>

          <EditorSection
            title="Header parameters"
            description="Authorization and Content-Type come from the authentication and body settings."
            error={errorAt(errors, "parameters.header")}
          >
            <Controller
              control={form.control}
              name="parameters.header"
              render={({ field }) => (
                <SchemaEditor
                  variant="fields"
                  value={field.value}
                  onChange={field.onChange}
                  models={models}
                  ownerName="header parameters"
                  emptyText="No header parameters."
                />
              )}
            />
          </EditorSection>

          {methodAllowsBody(method) && (
            <Controller
              control={form.control}
              name="requestBody"
              render={({ field }) => (
                <EditorSection
                  title="Request body"
                  error={
                    errorAt(errors, "requestBody") ??
                    errorAt(errors, "requestBody.root")
                  }
                  actions={
                    field.value && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => field.onChange(null)}
                      >
                        <Trash2Icon />
                        Remove request body
                      </Button>
                    )
                  }
                >
                  {field.value ? (
                    <div className="grid gap-4">
                      <Field orientation="horizontal">
                        <Checkbox
                          id="endpoint-editor-body-required"
                          checked={field.value.required}
                          onCheckedChange={(checked) =>
                            field.value &&
                            field.onChange({
                              ...field.value,
                              required: checked === true,
                            })
                          }
                        />
                        <FieldLabel htmlFor="endpoint-editor-body-required">
                          Body is required
                        </FieldLabel>
                      </Field>
                      <BodyEditor
                        body={field.value}
                        onChange={(body) =>
                          field.value &&
                          field.onChange({ ...field.value, ...body })
                        }
                        projectId={projectId}
                        models={models}
                        validityKey="requestBody"
                        ownerName="request body"
                        errors={bodyErrorsAt(errors, "requestBody")}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-muted-foreground">
                        No request body.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          field.onChange({
                            ...newBody(),
                            required: true,
                            description: "",
                          })
                        }
                      >
                        <PlusIcon />
                        Add request body
                      </Button>
                    </div>
                  )}
                </EditorSection>
              )}
            />
          )}

          <ResponsesEditor form={form} projectId={projectId} models={models} />

          <EditorSection
            title="Notes"
            description="Hand-off notes for each side; they don't change the contract."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="notesFe"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="endpoint-editor-notes-fe">
                      Notes for frontend
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="endpoint-editor-notes-fe"
                      rows={4}
                    />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="notesBe"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="endpoint-editor-notes-be">
                      Notes for backend
                    </FieldLabel>
                    <Textarea
                      {...field}
                      id="endpoint-editor-notes-be"
                      rows={4}
                    />
                  </Field>
                )}
              />
            </div>
          </EditorSection>
        </div>

        <div className="sticky bottom-0 -mx-2 flex items-center justify-end gap-2 border-t bg-background/95 px-2 py-3 backdrop-blur">
          {invalidKeys.size > 0 && (
            <span className="mr-auto text-sm text-destructive">
              Fix the invalid JSON before saving.
            </span>
          )}
          <SaveButtons
            isDirty={hasChanges}
            isSaving={updateEndpoint.isPending}
            canSave={invalidKeys.size === 0}
            onReset={discard}
          />
        </div>
      </form>
    </ValidityContext.Provider>
  );
}

function DeleteEndpointButton({
  projectId,
  endpoint,
}: {
  projectId: string;
  endpoint: Endpoint;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteEndpoint = useDeleteEndpoint(projectId);
  const label = `${endpoint.method} ${endpoint.path}`;

  async function onDelete() {
    try {
      await deleteEndpoint.mutateAsync(endpoint.id);
    } catch (error) {
      setOpen(false);
      toast.error((error as Error).message);
      return;
    }
    setOpen(false);
    await navigate({
      to: "/projects/$projectId/endpoints",
      params: { projectId },
    });
    queryClient.removeQueries({
      queryKey: endpointKeys.detail(projectId, endpoint.id),
    });
    toast.success(`Deleted ${label}`);
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
          <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This can't be undone. Pages that use it will lose the reference.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteEndpoint.isPending}
            onClick={onDelete}
          >
            Delete endpoint
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
