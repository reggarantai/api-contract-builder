import type { EndpointBody } from "@shared/endpoints";
import type { ModelSummary } from "@shared/models";
import { useId } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SchemaEditor } from "../../schema-editor/schema-editor";
import { ExamplesEditor } from "./examples-editor";
import { useReportValidity } from "./validity";

const CONTENT_TYPES = [
  "application/json",
  "multipart/form-data",
  "application/x-www-form-urlencoded",
  "text/plain",
  "application/octet-stream",
];

export type BodyErrors = {
  contentType?: string;
  schema?: string;
  exampleNames?: (string | undefined)[];
};

/** Content type, schema, and examples of a request or response body. */
export function BodyEditor({
  body,
  onChange,
  projectId,
  models,
  validityKey,
  ownerName,
  errors = {},
}: {
  body: EndpointBody;
  onChange: (body: EndpointBody) => void;
  projectId: string;
  models: ModelSummary[];
  validityKey: string;
  /** For labels, e.g. "request body". */
  ownerName: string;
  errors?: BodyErrors;
}) {
  const id = useId();
  const reportValidity = useReportValidity();

  return (
    <div className="grid gap-4">
      <Field
        data-invalid={errors.contentType !== undefined}
        className="max-w-sm"
      >
        <FieldLabel htmlFor={`${id}-content-type`}>Content type</FieldLabel>
        <Input
          id={`${id}-content-type`}
          className="font-mono"
          list={`${id}-content-types`}
          value={body.contentType}
          autoComplete="off"
          aria-invalid={errors.contentType !== undefined}
          onChange={(event) =>
            onChange({ ...body, contentType: event.target.value })
          }
        />
        <datalist id={`${id}-content-types`}>
          {CONTENT_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
        {errors.contentType && <FieldError>{errors.contentType}</FieldError>}
      </Field>
      <div className="grid gap-2">
        <SchemaEditor
          value={body.schema}
          onChange={(schema) => onChange({ ...body, schema })}
          models={models}
          ownerName={ownerName}
          onValidityChange={(valid) =>
            reportValidity(`${validityKey}.schema`, valid)
          }
        />
        {errors.schema && (
          <p className="text-sm text-destructive">{errors.schema}</p>
        )}
      </div>
      <ExamplesEditor
        examples={body.examples}
        onChange={(examples) => onChange({ ...body, examples })}
        schema={body.schema}
        projectId={projectId}
        validityKey={`${validityKey}.examples`}
        nameErrors={errors.exampleNames}
      />
    </div>
  );
}
