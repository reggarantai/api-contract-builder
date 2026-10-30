import { zodResolver } from "@hookform/resolvers/zod";
import {
  API_KEY_LOCATIONS,
  type Project,
  SECURITY_SCHEME_TYPES,
  type SecuritySchemeType,
  securitySettingsSchema,
} from "@shared/projects";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showRequestError } from "@/lib/forms";
import { useUpdateProject } from "../queries";
import {
  changeSecuritySchemeType,
  newSecurityScheme,
  SECURITY_SCHEME_LABELS,
} from "../security-schemes";
import { SaveButtons } from "./save-buttons";
import { SettingsSection } from "./settings-section";

type FormValues = z.input<typeof securitySettingsSchema>;

// Radix Select can't use an empty string as an item value.
const NO_DEFAULT = "none";

export function AuthSettings({ project }: { project: Project }) {
  const updateProject = useUpdateProject(project.id);
  const values = useMemo<FormValues>(
    () => ({
      securitySchemes: project.securitySchemes,
      defaultSecuritySchemeId: project.defaultSecuritySchemeId,
    }),
    [project.securitySchemes, project.defaultSecuritySchemeId],
  );
  const form = useForm<
    FormValues,
    unknown,
    z.output<typeof securitySettingsSchema>
  >({
    resolver: zodResolver(securitySettingsSchema),
    values,
  });
  // `keyName` keeps React keys apart from the schemes' own `id` field.
  const schemes = useFieldArray({
    control: form.control,
    name: "securitySchemes",
    keyName: "fieldKey",
  });
  const currentSchemes = useWatch({
    control: form.control,
    name: "securitySchemes",
  });
  const takenKeys = currentSchemes.map((scheme) => scheme.key);

  function removeScheme(index: number) {
    if (
      currentSchemes[index]?.id === form.getValues("defaultSecuritySchemeId")
    ) {
      form.setValue("defaultSecuritySchemeId", null, { shouldDirty: true });
    }
    schemes.remove(index);
  }

  function changeType(index: number, type: SecuritySchemeType) {
    const scheme = currentSchemes[index];
    if (scheme && scheme.type !== type) {
      schemes.update(index, changeSecuritySchemeType(scheme, type, takenKeys));
    }
  }

  const onSubmit = form.handleSubmit((input) =>
    updateProject.mutate(input, {
      onSuccess: () => toast.success("Authentication saved"),
      onError: (error) => showRequestError(error, form.setError),
    }),
  );

  return (
    <form onSubmit={onSubmit}>
      <SettingsSection
        title="Authentication"
        description="How clients authenticate. Endpoints use the default scheme unless they say otherwise."
        footer={
          <SaveButtons
            isDirty={form.formState.isDirty}
            isSaving={updateProject.isPending}
            onReset={() => form.reset(values)}
          />
        }
      >
        <div className="grid gap-4">
          {schemes.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No authentication schemes yet. Endpoints will be public.
            </p>
          )}
          {schemes.fields.map((scheme, index) => {
            const type = currentSchemes[index]?.type ?? scheme.type;
            return (
              <div
                key={scheme.fieldKey}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[10rem_1fr_auto]"
              >
                <Field>
                  <FieldLabel htmlFor={`scheme-${index}-type`}>Type</FieldLabel>
                  <Select
                    value={type}
                    onValueChange={(value) =>
                      changeType(index, value as SecuritySchemeType)
                    }
                  >
                    <SelectTrigger
                      id={`scheme-${index}-type`}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SECURITY_SCHEME_TYPES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {SECURITY_SCHEME_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Controller
                  control={form.control}
                  name={`securitySchemes.${index}.key`}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`scheme-${index}-key`}>
                        Key
                      </FieldLabel>
                      <Input
                        {...field}
                        id={`scheme-${index}-key`}
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
                    aria-label="Remove scheme"
                    onClick={() => removeScheme(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>

                {type === "bearer" && (
                  <Controller
                    control={form.control}
                    name={`securitySchemes.${index}.bearerFormat`}
                    render={({ field, fieldState }) => (
                      <Field
                        data-invalid={fieldState.invalid}
                        className="sm:col-span-3"
                      >
                        <FieldLabel htmlFor={`scheme-${index}-format`}>
                          Token format
                        </FieldLabel>
                        <Input
                          {...field}
                          id={`scheme-${index}-format`}
                          placeholder="JWT"
                          autoComplete="off"
                          aria-invalid={fieldState.invalid}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                )}

                {type === "apiKey" && (
                  <div className="grid gap-3 sm:col-span-3 sm:grid-cols-[10rem_1fr]">
                    <Controller
                      control={form.control}
                      name={`securitySchemes.${index}.in`}
                      render={({ field }) => (
                        <Field>
                          <FieldLabel htmlFor={`scheme-${index}-in`}>
                            Sent in
                          </FieldLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger
                              id={`scheme-${index}-in`}
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {API_KEY_LOCATIONS.map((location) => (
                                <SelectItem key={location} value={location}>
                                  {location[0]?.toUpperCase()}
                                  {location.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                    />
                    <Controller
                      control={form.control}
                      name={`securitySchemes.${index}.name`}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={`scheme-${index}-name`}>
                            Parameter name
                          </FieldLabel>
                          <Input
                            {...field}
                            id={`scheme-${index}-name`}
                            placeholder="X-API-Key"
                            autoComplete="off"
                            aria-invalid={fieldState.invalid}
                          />
                          <FieldError errors={[fieldState.error]} />
                        </Field>
                      )}
                    />
                  </div>
                )}

                <Controller
                  control={form.control}
                  name={`securitySchemes.${index}.description`}
                  render={({ field, fieldState }) => (
                    <Field
                      data-invalid={fieldState.invalid}
                      className="sm:col-span-3"
                    >
                      <FieldLabel htmlFor={`scheme-${index}-description`}>
                        Description
                      </FieldLabel>
                      <Input
                        {...field}
                        id={`scheme-${index}-description`}
                        placeholder="How to obtain the credentials"
                        autoComplete="off"
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </div>
            );
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                schemes.append(newSecurityScheme("bearer", takenKeys))
              }
            >
              <PlusIcon />
              Add scheme
            </Button>
          </div>

          <Controller
            control={form.control}
            name="defaultSecuritySchemeId"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="max-w-sm">
                <FieldLabel htmlFor="default-scheme">
                  Default for endpoints
                </FieldLabel>
                <Select
                  value={field.value ?? NO_DEFAULT}
                  onValueChange={(value) =>
                    field.onChange(value === NO_DEFAULT ? null : value)
                  }
                >
                  <SelectTrigger id="default-scheme" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEFAULT}>None (public)</SelectItem>
                    {currentSchemes.map((scheme) => (
                      <SelectItem key={scheme.id} value={scheme.id}>
                        {scheme.key || "Unnamed scheme"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Each endpoint can still override this.
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>
      </SettingsSection>
    </form>
  );
}
