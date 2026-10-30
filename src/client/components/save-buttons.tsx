import { Button } from "@/components/ui/button";

/** Discard and Save buttons for a form; disabled until it has changes. */
export function SaveButtons({
  isDirty,
  isSaving,
  canSave = true,
  onReset,
}: {
  isDirty: boolean;
  isSaving: boolean;
  /** False while the form has a problem that blocks saving. */
  canSave?: boolean;
  onReset: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={!isDirty || isSaving}
        onClick={onReset}
      >
        Discard changes
      </Button>
      <Button type="submit" disabled={!isDirty || isSaving || !canSave}>
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </>
  );
}
