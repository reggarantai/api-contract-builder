import { zodResolver } from "@hookform/resolvers/zod";
import {
  apiVersionSchema,
  DEFAULT_API_VERSION,
  projectDescriptionSchema,
  projectNameSchema,
} from "@shared/projects";
import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify } from "@shared/slug";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { showRequestError } from "@/lib/forms";
import { useCreateProject } from "./queries";

const formSchema = z.object({
  name: projectNameSchema,
  description: projectDescriptionSchema,
  apiVersion: apiVersionSchema,
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

const defaultValues: FormValues = {
  name: "",
  description: "",
  apiVersion: DEFAULT_API_VERSION,
  slug: "",
};

export function CreateProjectDialog({
  trigger = (
    <Button>
      <PlusIcon />
      New project
    </Button>
  ),
}: {
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const createProject = useCreateProject();
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

  // mutateAsync rather than mutate callbacks: creating the first project
  // replaces the empty state that holds this dialog, unmounting it.
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const project = await createProject.mutateAsync({
        ...values,
        slug: values.slug || undefined,
      });
      onOpenChange(false);
      toast.success(`Created ${project.name}`);
      await navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
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
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A project holds the pages, endpoints, and models of one API.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="project-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="project-name"
                    placeholder="Inventory App"
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
              name="description"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="project-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="project-description"
                    placeholder="What the API is for, who uses it"
                    rows={3}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="apiVersion"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="project-api-version">
                      API version
                    </FieldLabel>
                    <Input
                      {...field}
                      id="project-api-version"
                      autoComplete="off"
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
                    <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
                    <Input
                      {...field}
                      id="project-slug"
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
            </div>
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={createProject.isPending}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
