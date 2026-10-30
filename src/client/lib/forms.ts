import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiError } from "./api";

/**
 * Shows a failed request on the form: field-level API issues go next to their
 * fields, anything else becomes an error toast.
 */
export function showRequestError<T extends FieldValues>(
  error: Error,
  setError: UseFormSetError<T>,
) {
  if (error instanceof ApiError && error.issues.length > 0) {
    for (const issue of error.issues) {
      setError(issue.path as Path<T>, {
        type: "server",
        message: issue.message,
      });
    }
    return;
  }
  toast.error(error.message);
}
