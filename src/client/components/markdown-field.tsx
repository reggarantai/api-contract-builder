import { useId } from "react";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "./markdown";

/** A Markdown text area with a preview tab; a group named by its label. */
export function MarkdownField({
  label,
  value,
  onChange,
  placeholder,
  error,
  rows = 6,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  rows?: number;
}) {
  const id = useId();

  return (
    <fieldset
      aria-labelledby={`${id}-label`}
      className="m-0 grid min-w-0 gap-2 border-0 p-0"
    >
      <Tabs defaultValue="write" className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel id={`${id}-label`} htmlFor={`${id}-text`}>
            {label}
          </FieldLabel>
          <TabsList className="h-7">
            <TabsTrigger value="write" className="text-xs">
              Write
            </TabsTrigger>
            <TabsTrigger value="preview" className="text-xs">
              Preview
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="write">
          <Textarea
            id={`${id}-text`}
            rows={rows}
            value={value}
            placeholder={placeholder}
            aria-invalid={error !== undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        </TabsContent>
        <TabsContent
          value="preview"
          className="min-h-24 rounded-lg border px-3 py-2"
        >
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          )}
        </TabsContent>
      </Tabs>
      {error && <FieldError>{error}</FieldError>}
    </fieldset>
  );
}
