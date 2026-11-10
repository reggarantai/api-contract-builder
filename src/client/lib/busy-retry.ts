import { ApiError } from "./api";

/** How long to keep waiting for a turn. */
const PATIENCE_MS = 60_000;

/**
 * Sends a request again while the server answers that it's busy (503, as
 * when other imports are running): after the wait its Retry-After asks
 * for (a second if it doesn't say), for a minute at most. Other errors
 * aren't retried.
 */
export async function whenNotBusy<T>(
  send: () => Promise<T>,
  {
    sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
  }: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<T> {
  const started = now();
  for (;;) {
    try {
      return await send();
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status !== 503 ||
        now() - started >= PATIENCE_MS
      ) {
        throw error;
      }
      await sleep((error.retryAfter ?? 1) * 1000);
    }
  }
}
