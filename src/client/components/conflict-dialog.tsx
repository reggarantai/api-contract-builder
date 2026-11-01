import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Asks what to do when a save would overwrite one made elsewhere since. */
export function ConflictDialog({
  what,
  open,
  busy,
  onKeep,
  onLoad,
  onOverwrite,
}: {
  /** "page", "endpoint", … */
  what: string;
  open: boolean;
  busy: boolean;
  onKeep: () => void;
  onLoad: () => void;
  onOverwrite: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onKeep()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            This {what} changed since you started editing
          </AlertDialogTitle>
          <AlertDialogDescription>
            It was saved somewhere else, like another tab or window. Load the
            saved version to see it, which drops your changes here, or save
            yours over it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Keep editing</AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onLoad}
          >
            Load the saved version
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={onOverwrite}
          >
            Save mine anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
