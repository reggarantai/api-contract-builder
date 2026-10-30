import { zodResolver } from "@hookform/resolvers/zod";
import { modelDescriptionSchema, modelNameSchema } from "@shared/models";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
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
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { showRequestError } from "@/lib/forms";
import { useCreateModel } from "./queries";

const formSchema = z.object({
  name: modelNameSchema,
  description: modelDescriptionSchema,
});

type FormValues = z.input<typeof formSchema>;

const defaultValues: FormValues = { name: "", description: "" };

export function CreateModelDialog({
  projectId,
  trigger,
}: {
  projectId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const createModel = useCreateModel(projectId);
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      form.reset(defaultValues);
    }
  }

  // mutateAsync rather than mutate callbacks: creating the first model
  // replaces the empty state that holds this dialog, unmounting it.
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const model = await createModel.mutateAsync(values);
      onOpenChange(false);
      toast.success(`Created ${model.name}`);
      await navigate({
        to: "/projects/$projectId/models/$modelId",
        params: { projectId, modelId: model.id },
      });
    } catch (error) {
      showRequestError(error as Error, form.setError);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>New model</DialogTitle>
            <DialogDescription>
              A reusable schema, like User or Order, that endpoints and other
              models can reference.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="model-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="model-name"
                    placeholder="User"
                    autoComplete="off"
                    autoFocus
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Used in OpenAPI as <code>#/components/schemas/Name</code>.
                    PascalCase is common.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="model-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="model-description"
                    rows={3}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={createModel.isPending}>
              Create model
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
