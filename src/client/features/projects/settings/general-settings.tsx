import { zodResolver } from "@hookform/resolvers/zod";
import { type Project, projectSettingsFieldsSchema } from "@shared/projects";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { SaveButtons } from "@/components/save-buttons";
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
import { useUpdateProject } from "../queries";
import { SettingsSection } from "./settings-section";

const formSchema = projectSettingsFieldsSchema.pick({
  name: true,
  slug: true,
  description: true,
  apiVersion: true,
});

type FormValues = z.input<typeof formSchema>;

export function GeneralSettings({ project }: { project: Project }) {
  const updateProject = useUpdateProject(project.id);
  const values = useMemo<FormValues>(
    () => ({
      name: project.name,
      slug: project.slug,
      description: project.description,
      apiVersion: project.apiVersion,
    }),
    [project.name, project.slug, project.description, project.apiVersion],
  );
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values,
  });

  const onSubmit = form.handleSubmit((input) =>
    updateProject.mutate(input, {
      onSuccess: () => toast.success("General settings saved"),
      onError: (error) => showRequestError(error, form.setError),
    }),
  );

  return (
    <form onSubmit={onSubmit}>
      <SettingsSection
        title="General"
        description="How the project is named and versioned in exports."
        footer={
          <SaveButtons
            isDirty={form.formState.isDirty}
            isSaving={updateProject.isPending}
            onReset={() => form.reset(values)}
          />
        }
      >
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="settings-name"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="apiVersion"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="settings-api-version">
                    API version
                  </FieldLabel>
                  <Input
                    {...field}
                    id="settings-api-version"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Shown as <code>info.version</code> in OpenAPI.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="slug"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="settings-slug">Slug</FieldLabel>
                <Input
                  {...field}
                  id="settings-slug"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription>Used in export file names.</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="settings-description">
                  Description
                </FieldLabel>
                <Textarea
                  {...field}
                  id="settings-description"
                  rows={6}
                  placeholder="What the API is for, and conventions every endpoint follows. Markdown is fine; the first paragraph is the summary."
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </SettingsSection>
    </form>
  );
}
