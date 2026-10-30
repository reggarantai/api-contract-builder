import { zodResolver } from "@hookform/resolvers/zod";
import { pageNameSchema } from "@shared/pages";
import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from "@shared/slug";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { showRequestError } from "@/lib/forms";
import { useCreatePage } from "./queries";

const formSchema = z.object({
  name: pageNameSchema,
  // Empty means "derive from the name" (the server picks a free slug).
  slug: z
    .string()
    .trim()
    .max(SLUG_MAX_LENGTH)
    .refine(
      (slug) => slug === "" || SLUG_PATTERN.test(slug),
      "Use lowercase letters, numbers, and single hyphens",
    ),
});

type FormValues = z.input<typeof formSchema>;

const defaultValues: FormValues = { name: "", slug: "" };

export function CreatePageDialog({
  projectId,
  trigger,
}: {
  projectId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const createPage = useCreatePage(projectId);
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });
  const name = useWatch({ control: form.control, name: "name" });

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      form.reset(defaultValues);
    }
  }

  // mutateAsync: creating the first page unmounts the empty state.
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const page = await createPage.mutateAsync({
        name: values.name,
        slug: values.slug || undefined,
      });
      onOpenChange(false);
      toast.success(`Created ${page.name}`);
      await navigate({
        to: "/projects/$projectId/pages/$pageId/edit",
        params: { projectId, pageId: page.id },
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
            <DialogTitle>New page</DialogTitle>
            <DialogDescription>
              A screen of the app, like Login or Stock List, with its mockups
              and the endpoints it calls.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="page-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="page-name"
                    placeholder="Login"
                    autoComplete="off"
                    autoFocus
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="slug"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="page-slug">Slug</FieldLabel>
                  <Input
                    {...field}
                    id="page-slug"
                    placeholder={slugify(name) || "derived from name"}
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Used in export file names.
                  </FieldDescription>
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
            <Button type="submit" disabled={createPage.isPending}>
              Create page
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
