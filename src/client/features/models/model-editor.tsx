import { zodResolver } from "@hookform/resolvers/zod";
import {
  jsonSchemaSchema,
  type Model,
  modelDescriptionSchema,
  modelNameSchema,
} from "@shared/models";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import { SchemaEditor } from "../schema-editor/schema-editor";
import {
  modelKeys,
  modelsQueryOptions,
  useDeleteModel,
  useUpdateModel,
} from "./queries";

const formSchema = z.object({
  name: modelNameSchema,
  description: modelDescriptionSchema,
  schema: jsonSchemaSchema,
});

type FormValues = z.input<typeof formSchema>;

export function ModelEditor({
  projectId,
  model,
}: {
  projectId: string;
  model: Model;
}) {
  const models = useQuery(modelsQueryOptions(projectId)).data ?? [];
  const updateModel = useUpdateModel(projectId, model.id);
  const values = useMemo<FormValues>(
    () => ({
      name: model.name,
      description: model.description,
      schema: model.schema,
    }),
    [model.name, model.description, model.schema],
  );
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values,
  });
  const [schemaValid, setSchemaValid] = useState(true);
  // Remounts the schema editor on discard, so JSON mode reloads its text.
  const [editorKey, setEditorKey] = useState(0);
  // JSON that doesn't parse yet is an unsaved change too.
  const hasChanges = form.formState.isDirty || !schemaValid;

  useBlocker({
    shouldBlockFn: () =>
      hasChanges && !window.confirm("Leave without saving your changes?"),
    enableBeforeUnload: () => hasChanges,
  });

  function discard() {
    form.reset(values);
    setSchemaValid(true);
    setEditorKey((key) => key + 1);
  }

  const onSubmit = form.handleSubmit((input) =>
    updateModel.mutate(input, {
      onSuccess: () => toast.success("Model saved"),
      onError: (error) => showRequestError(error, form.setError),
    }),
  );

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle className="font-mono">{model.name}</CardTitle>
          <CardAction>
            <DeleteModelButton projectId={projectId} model={model} />
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-[16rem_1fr]">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="model-editor-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="model-editor-name"
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
              name="description"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="model-editor-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="model-editor-description"
                    rows={2}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="schema"
            render={({ field, fieldState }) => (
              <div className="grid gap-2">
                <SchemaEditor
                  key={editorKey}
                  value={field.value}
                  onChange={field.onChange}
                  models={models}
                  onValidityChange={setSchemaValid}
                />
                <FieldError errors={[fieldState.error]} />
              </div>
            )}
          />
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          {!schemaValid && (
            <span className="mr-auto text-sm text-destructive">
              Fix the JSON before saving.
            </span>
          )}
          <SaveButtons
            isDirty={hasChanges}
            isSaving={updateModel.isPending}
            canSave={schemaValid}
            onReset={discard}
          />
        </CardFooter>
      </Card>
    </form>
  );
}

function DeleteModelButton({
  projectId,
  model,
}: {
  projectId: string;
  model: Model;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteModel = useDeleteModel(projectId);

  async function onDelete() {
    try {
      await deleteModel.mutateAsync(model.id);
    } catch (error) {
      setOpen(false);
      toast.error((error as Error).message);
      return;
    }
    setOpen(false);
    await navigate({
      to: "/projects/$projectId/models",
      params: { projectId },
    });
    queryClient.removeQueries({
      queryKey: modelKeys.detail(projectId, model.id),
    });
    toast.success(`Deleted ${model.name}`);
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
          <AlertDialogTitle>Delete {model.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This can't be undone. Models that reference it must be changed
            first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteModel.isPending}
            onClick={onDelete}
          >
            Delete model
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
