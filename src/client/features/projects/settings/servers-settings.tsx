import { zodResolver } from "@hookform/resolvers/zod";
import { type Project, projectSettingsFieldsSchema } from "@shared/projects";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ulid } from "ulid";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { showRequestError } from "@/lib/forms";
import { useUpdateProject } from "../queries";
import { SaveButtons } from "./save-buttons";
import { SettingsSection } from "./settings-section";

const formSchema = projectSettingsFieldsSchema.pick({ servers: true });

type FormValues = z.input<typeof formSchema>;

export function ServersSettings({ project }: { project: Project }) {
  const updateProject = useUpdateProject(project.id);
  const values = useMemo<FormValues>(
    () => ({ servers: project.servers }),
    [project.servers],
  );
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values,
  });
  // `keyName` keeps React keys apart from the servers' own `id` field.
  const servers = useFieldArray({
    control: form.control,
    name: "servers",
    keyName: "fieldKey",
  });

  const onSubmit = form.handleSubmit((input) =>
    updateProject.mutate(input, {
      onSuccess: () => toast.success("Servers saved"),
      onError: (error) => showRequestError(error, form.setError),
    }),
  );

  return (
    <form onSubmit={onSubmit}>
      <SettingsSection
        title="Servers"
        description="Base URLs of the API per environment. The first one is the default in the OpenAPI export."
        footer={
          <SaveButtons
            isDirty={form.formState.isDirty}
            isSaving={updateProject.isPending}
            onReset={() => form.reset(values)}
          />
        }
      >
        <div className="grid gap-4">
          {servers.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">No servers yet.</p>
          )}
          {servers.fields.map((server, index) => (
            <div
              key={server.fieldKey}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[10rem_1fr_auto]"
            >
              <Controller
                control={form.control}
                name={`servers.${index}.name`}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`server-${index}-name`}>
                      Name
                    </FieldLabel>
                    <Input
                      {...field}
                      id={`server-${index}-name`}
                      placeholder="Production"
                      autoComplete="off"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name={`servers.${index}.url`}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`server-${index}-url`}>URL</FieldLabel>
                    <Input
                      {...field}
                      id={`server-${index}-url`}
                      placeholder="https://api.example.com/v1"
                      autoComplete="off"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <div className="flex items-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => servers.move(index, index - 1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  disabled={index === servers.fields.length - 1}
                  onClick={() => servers.move(index, index + 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove server"
                  onClick={() => servers.remove(index)}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <Controller
                control={form.control}
                name={`servers.${index}.description`}
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid}
                    className="sm:col-span-3"
                  >
                    <FieldLabel htmlFor={`server-${index}-description`}>
                      Description
                    </FieldLabel>
                    <Input
                      {...field}
                      id={`server-${index}-description`}
                      placeholder="Optional"
                      autoComplete="off"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                servers.append({
                  id: ulid(),
                  name: "",
                  url: "",
                  description: "",
                })
              }
            >
              <PlusIcon />
              Add server
            </Button>
          </div>
        </div>
      </SettingsSection>
    </form>
  );
}
