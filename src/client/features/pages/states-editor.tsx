import {
  MAX_PAGE_STATES,
  MAX_STATE_CAUSES,
  MAX_STATE_MOCKUPS,
  PAGE_STATE_KIND_HINTS,
  PAGE_STATE_KIND_LABELS,
  PAGE_STATE_KINDS,
  type PageState,
  type PageStateKind,
  type StateCause,
} from "@shared/page-states";
import type { Mockup, Page, PageFields } from "@shared/pages";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useId, useMemo } from "react";
import {
  Controller,
  get,
  type UseFormReturn,
  useFieldArray,
  useWatch,
} from "react-hook-form";
import { ulid } from "ulid";
import { MarkdownField } from "@/components/markdown-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EditorSection } from "../endpoints/editor/editor-section";
import {
  type CauseChoice,
  causeChoices,
  causeKey,
  fitsKind,
  usePageCalls,
} from "./page-calls";

type PageForm = UseFormReturn<PageFields, unknown, PageFields>;

/** The states a page can be in, each with what leads to it and its mockups. */
export function StatesEditor({ form, page }: { form: PageForm; page: Page }) {
  // `keyName` keeps React keys apart from the states' own `id` field.
  const states = useFieldArray({
    control: form.control,
    name: "states",
    keyName: "fieldKey",
  });
  const links = useWatch({ control: form.control, name: "endpoints" });
  const calls = usePageCalls(
    page.projectId,
    links.map((link) => link.endpointId),
    true,
  );
  const choices = useMemo(() => causeChoices(links, calls), [links, calls]);

  function addState() {
    states.append({
      id: ulid(),
      kind: "success",
      name: "",
      description: "",
      causes: [],
      mockupIds: [],
    } satisfies PageState);
  }

  const full = states.fields.length >= MAX_PAGE_STATES;
  const listError =
    form.formState.errors.states?.root?.message ??
    form.formState.errors.states?.message;

  return (
    <EditorSection
      title="States"
      description="What the page shows, and the calls and responses that lead to each. The page view shows the Prism headers that answer with each."
      error={listError}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={addState}
        >
          <PlusIcon />
          Add state
        </Button>
      }
    >
      {full && (
        <p className="text-sm text-muted-foreground">
          A page has at most {MAX_PAGE_STATES} states.
        </p>
      )}
      {states.fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No states yet. Describe what the page shows while it loads, when
          there's nothing to show, and when a call fails.
        </p>
      )}
      {states.fields.map((state, index) => (
        <StateItem
          key={state.fieldKey}
          form={form}
          index={index}
          count={states.fields.length}
          choices={choices}
          mockups={page.mockups}
          onMove={(offset) => states.move(index, index + offset)}
          onRemove={() => states.remove(index)}
        />
      ))}
    </EditorSection>
  );
}

function StateItem({
  form,
  index,
  count,
  choices,
  mockups,
  onMove,
  onRemove,
}: {
  form: PageForm;
  index: number;
  count: number;
  choices: CauseChoice[];
  mockups: Mockup[];
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const label = `State ${index + 1}`;
  const kind =
    useWatch({ control: form.control, name: `states.${index}.kind` }) ??
    "success";

  return (
    <fieldset
      aria-label={label}
      className="m-0 grid min-w-0 gap-3 rounded-lg border p-3"
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
        <Controller
          control={form.control}
          name={`states.${index}.kind`}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor={`${id}-kind`}>Kind</FieldLabel>
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  // Its causes may fit the new kind, or no longer fit.
                  if (form.formState.isSubmitted) {
                    void form.trigger(`states.${index}.causes`);
                  }
                }}
              >
                <SelectTrigger id={`${id}-kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_STATE_KINDS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PAGE_STATE_KIND_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name={`states.${index}.name`}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
              <Input
                {...field}
                id={`${id}-name`}
                placeholder="e.g. No matching items"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <div className="flex items-end gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${label} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Move ${label} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        {PAGE_STATE_KIND_HINTS[kind]}
      </p>
      <Controller
        control={form.control}
        name={`states.${index}.description`}
        render={({ field, fieldState }) => (
          <MarkdownField
            label="Description"
            value={field.value}
            onChange={field.onChange}
            placeholder="What the user sees, and what they can do"
            rows={3}
            error={fieldState.error?.message}
          />
        )}
      />
      <CausesEditor form={form} index={index} kind={kind} choices={choices} />
      {mockups.length > 0 && (
        <Controller
          control={form.control}
          name={`states.${index}.mockupIds`}
          render={({ field, fieldState }) => (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Mockups</span>
              <ul className="flex flex-wrap gap-2">
                {mockups.map((mockup) => (
                  <li
                    key={mockup.id}
                    className="flex items-center gap-2 rounded-lg border p-1.5 pr-3 text-sm has-data-checked:border-primary"
                  >
                    <Checkbox
                      id={`${id}-mockup-${mockup.id}`}
                      checked={field.value.includes(mockup.id)}
                      disabled={
                        !field.value.includes(mockup.id) &&
                        field.value.length >= MAX_STATE_MOCKUPS
                      }
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked
                            ? mockups
                                .map((item) => item.id)
                                .filter(
                                  (mockupId) =>
                                    mockupId === mockup.id ||
                                    field.value.includes(mockupId),
                                )
                            : field.value.filter(
                                (mockupId) => mockupId !== mockup.id,
                              ),
                        )
                      }
                    />
                    <label
                      htmlFor={`${id}-mockup-${mockup.id}`}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <img
                        src={mockup.url}
                        alt=""
                        className="h-10 w-14 rounded object-cover"
                      />
                      <span className="max-w-40 truncate">
                        {mockup.caption || mockup.originalName}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <FieldError errors={[fieldState.error]} />
            </div>
          )}
        />
      )}
    </fieldset>
  );
}

const CAUSE_HEADINGS: Record<PageStateKind, string> = {
  idle: "Comes from",
  loading: "Waits for, or comes from",
  success: "Comes from",
  empty: "Comes from",
  error: "Comes from",
};

/** The calls and responses that lead to a state, each picked from the page's calls. */
function CausesEditor({
  form,
  index,
  kind,
  choices,
}: {
  form: PageForm;
  index: number;
  kind: PageStateKind;
  choices: CauseChoice[];
}) {
  const name = `states.${index}.causes` as const;
  const causes = useWatch({ control: form.control, name });
  const { errors } = form.formState;
  const listError = get(errors, name) as { message?: string } | undefined;
  const fitting = choices.filter((choice) => fitsKind(kind, choice.cause));

  function setCauses(next: StateCause[]) {
    // Once the form was submitted, a change shows whether it fixed the issue.
    form.setValue(name, next, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  }

  function addCause() {
    const used = new Set(causes.map(causeKey));
    const next = fitting.find((choice) => !used.has(choice.key));
    if (next) {
      setCauses([...causes, next.cause]);
    }
  }

  if (kind === "idle" && causes.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{CAUSE_HEADINGS[kind]}</span>
        {kind !== "idle" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={fitting.length === 0 || causes.length >= MAX_STATE_CAUSES}
            onClick={addCause}
          >
            <PlusIcon />
            Add cause
          </Button>
        )}
      </div>
      {typeof listError?.message === "string" && (
        <p className="text-sm text-destructive">{listError.message}</p>
      )}
      {causes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {choices.length === 0
            ? "Link the endpoints the page calls first, under Endpoints."
            : "Nothing yet; a network error, for one, has no response."}
        </p>
      )}
      {causes.map((cause, causeIndex) => {
        const key = causeKey(cause);
        const current = choices.find((choice) => choice.key === key);
        // A cause is listed once, so other rows' causes aren't offered.
        const others = new Set(
          causes
            .filter((_, itemIndex) => itemIndex !== causeIndex)
            .map(causeKey),
        );
        const options = (
          current && !fitting.includes(current)
            ? [current, ...fitting]
            : fitting
        ).filter((choice) => !others.has(choice.key));
        const error = (
          get(errors, `${name}.${causeIndex}`) as
            | { message?: string }
            | undefined
        )?.message;
        const causeLabel = `Cause ${causeIndex + 1}`;
        return (
          <div key={key} className="grid gap-1">
            <div className="flex items-center gap-1">
              <Select
                value={current ? key : ""}
                onValueChange={(value) => {
                  const picked = choices.find((choice) => choice.key === value);
                  if (picked) {
                    setCauses(
                      causes.map((item, itemIndex) =>
                        itemIndex === causeIndex ? picked.cause : item,
                      ),
                    );
                  }
                }}
              >
                <SelectTrigger
                  aria-label={causeLabel}
                  className="w-full font-mono text-xs"
                  aria-invalid={error !== undefined}
                >
                  <SelectValue placeholder="Pick what leads here" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((choice) => (
                    <SelectItem
                      key={choice.key}
                      value={choice.key}
                      className="font-mono text-xs"
                    >
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${causeLabel.toLowerCase()}`}
                onClick={() =>
                  setCauses(
                    causes.filter((_, itemIndex) => itemIndex !== causeIndex),
                  )
                }
              >
                <XIcon />
              </Button>
            </div>
            {error && <FieldError>{error}</FieldError>}
          </div>
        );
      })}
    </div>
  );
}
