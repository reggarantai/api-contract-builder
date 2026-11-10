import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { whenNotBusy } from "./busy-retry";

const busy = (retryAfter?: number) =>
  new ApiError(503, { error: "Another import is running" }, retryAfter);

describe("a request the server is too busy for", () => {
  it("is sent again after the wait the server asks for, until it goes through", async () => {
    const waits: number[] = [];
    let tries = 0;
    const result = await whenNotBusy(
      async () => {
        tries++;
        if (tries < 3) throw busy(tries === 1 ? 2 : undefined);
        return "done";
      },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        now: () => 0,
      },
    );
    expect(result).toBe("done");
    // Retry-After: 2, then none given: a second.
    expect(waits).toEqual([2_000, 1_000]);
  });

  it("gives up after a minute, and never retries other errors", async () => {
    let clock = 0;
    let tries = 0;
    await expect(
      whenNotBusy(
        async () => {
          tries++;
          throw busy(5);
        },
        {
          sleep: async (ms) => {
            clock += ms;
          },
          now: () => clock,
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(tries).toBe(13);
    tries = 0;
    await expect(
      whenNotBusy(
        async () => {
          tries++;
          throw new ApiError(400, { error: "No" });
        },
        { sleep: async () => {}, now: () => 0 },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(tries).toBe(1);
  });
});
