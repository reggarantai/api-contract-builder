import { Button } from "@/components/ui/button";

/** Reset and Save buttons for a settings form; disabled until it has changes. */
export function SaveButtons({
  isDirty,
  isSaving,
  onReset,
}: {
  isDirty: boolean;
  isSaving: boolean;
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
      <Button type="submit" disabled={!isDirty || isSaving}>
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </>
  );
}
