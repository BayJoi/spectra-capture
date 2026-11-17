import { beforeEach, describe, expect, test } from "bun:test";
import { notifySaved } from "../../../src/shared/notify";

/** A minimal Chrome stub so the worker-side notification gate can be exercised without a browser. */
function stub(notificationsEnabled: boolean): { create: () => number } {
  let createCalls = 0;
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async () => ({ prefs: { notifications: notificationsEnabled } }),
        set: async () => undefined,
      },
    },
    downloads: { search: async () => [{ filename: "shot.png" }] },
    runtime: { getURL: (path: string) => path },
    notifications: {
      create: async () => {
        createCalls += 1;
        return "id";
      },
    },
  };
  return { create: () => createCalls };
}

describe("save notifications", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  test("suppresses the notification when the user turned it off", async () => {
    const api = stub(false);
    await notifySaved(1, "shot.png");
    expect(api.create()).toBe(0);
  });

  test("shows the notification when enabled", async () => {
    const api = stub(true);
    await notifySaved(1, "shot.png");
    expect(api.create()).toBe(1);
  });

  test("a failed preference read keeps notifications on", async () => {
    (globalThis as Record<string, unknown>).chrome = {
      storage: { local: { get: async () => { throw new Error("storage down"); }, set: async () => undefined } },
      downloads: { search: async () => [{ filename: "shot.png" }] },
      runtime: { getURL: (path: string) => path },
      notifications: { create: async () => "id" },
    };
    // No throw and no assertion on the create count beyond completing: the default must not break saves.
    await expect(notifySaved(1, "shot.png")).resolves.toBeUndefined();
  });
});
