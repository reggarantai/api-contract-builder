import { zodResolver } from "@hookform/resolvers/zod";
import { HTTP_METHODS, pathSchema } from "@shared/endpoints";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showRequestError } from "@/lib/forms";
import { useCreateEndpoint } from "./queries";

const formSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: pathSchema,
  summary: z.string().trim().max(200),
});

type FormValues = z.input<typeof formSchema>;

const defaultValues: FormValues = { method: "GET", path: "/", summary: "" };

export function CreateEndpointDialog({
  projectId,
  trigger,
}: {
  projectId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const createEndpoint = useCreateEndpoint(projectId);
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

  // mutateAsync: creating the first endpoint unmounts the empty state.
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const endpoint = await createEndpoint.mutateAsync(values);
      onOpenChange(false);
      toast.success(`Created ${endpoint.method} ${endpoint.path}`);
      await navigate({
        to: "/projects/$projectId/endpoints/$endpointId",
        params: { projectId, endpointId: endpoint.id },
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
            <DialogTitle>New endpoint</DialogTitle>
            <DialogDescription>
              Pages reference endpoints, so one endpoint can serve several
              pages.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Controller
                control={form.control}
                name="method"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="endpoint-method">Method</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="endpoint-method" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HTTP_METHODS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {method}
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
                    <FieldLabel htmlFor="endpoint-path">Path</FieldLabel>
                    <Input
                      {...field}
                      id="endpoint-path"
                      className="font-mono"
                      placeholder="/stocks/{id}"
                      autoComplete="off"
                      autoFocus
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldDescription>
                      Without the server URL. Write parameters as{" "}
                      <code>{"{name}"}</code>.
                    </FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>
            <Controller
              control={form.control}
              name="summary"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="endpoint-summary">Summary</FieldLabel>
                  <Input
                    {...field}
                    id="endpoint-summary"
                    placeholder="Get a stock item"
                    autoComplete="off"
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
            <Button type="submit" disabled={createEndpoint.isPending}>
              Create endpoint
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
