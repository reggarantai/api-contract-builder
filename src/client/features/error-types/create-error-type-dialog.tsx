import { zodResolver } from "@hookform/resolvers/zod";
import { errorTypeFieldsSchema } from "@shared/error-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
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
import { showRequestError } from "@/lib/forms";
import { modelsQueryOptions } from "../models/queries";
import { errorTypesQueryOptions, useCreateErrorType } from "./queries";
import { suggestErrorTypeBody } from "./suggest-body";

const formSchema = errorTypeFieldsSchema.pick({
  name: true,
  status: true,
  title: true,
});

type FormValues = z.input<typeof formSchema>;

const defaultValues: FormValues = { name: "", status: "", title: "" };

export function CreateErrorTypeDialog({
  projectId,
  trigger,
}: {
  projectId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const models = useQuery(modelsQueryOptions(projectId)).data ?? [];
  const createErrorType = useCreateErrorType(projectId);
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

  // mutateAsync rather than mutate callbacks: creating the first error type
  // replaces the empty state that holds this dialog, unmounting it.
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const existing = await queryClient.ensureQueryData(
        errorTypesQueryOptions(projectId),
      );
      const errorType = await createErrorType.mutateAsync({
        ...values,
        body: suggestErrorTypeBody(values, existing, models),
      });
      onOpenChange(false);
      toast.success(`Created ${errorType.name}`);
      await navigate({
        to: "/projects/$projectId/error-types/$errorTypeId",
        params: { projectId, errorTypeId: errorType.id },
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
            <DialogTitle>New error type</DialogTitle>
            <DialogDescription>
              An error the API answers with, like a problem type of RFC 9457.
              Describe it once and use it in any endpoint's responses.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="error-type-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="error-type-name"
                    className="font-mono"
                    placeholder="sku-taken"
                    autoComplete="off"
                    autoFocus
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Mock servers return it by this name.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
              <Controller
                control={form.control}
                name="status"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="error-type-status">Status</FieldLabel>
                    <Input
                      {...field}
                      id="error-type-status"
                      className="font-mono"
                      placeholder="409"
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
                    <FieldLabel htmlFor="error-type-title">Title</FieldLabel>
                    <Input
                      {...field}
                      id="error-type-title"
                      placeholder="SKU already used"
                      autoComplete="off"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={createErrorType.isPending}>
              Create error type
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
