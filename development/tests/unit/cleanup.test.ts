import { describe, expect, test } from "bun:test";
import { CleanupStack } from "../../../src/capture/cleanup";
import { DebuggerSession, classifyAttachError } from "../../../src/capture/debugger-session";
import { FakeTransport } from "./helpers";

describe("CleanupStack", () => {
  test("runs undo steps last-in, first-out", async () => {
    const order: string[] = [];
    const stack = new CleanupStack();
    stack.add("a", async () => order.push("a"));
    stack.add("b", async () => order.push("b"));
    stack.add("c", async () => order.push("c"));
    await stack.runAll();
    expect(order).toEqual(["c", "b", "a"]);
  });

  test("a failing step does not stop the others and is reported by name", async () => {
    const ran: string[] = [];
    const failed: string[] = [];
    const stack = new CleanupStack();
    stack.add("first", async () => ran.push("first"));
    stack.add("broken", async () => {
      throw new Error("boom");
    });
    stack.add("last", async () => ran.push("last"));
    await stack.runAll((name) => failed.push(name));
    expect(ran).toEqual(["last", "first"]);
    expect(failed).toEqual(["broken"]);
  });

  test("runs each step only once", async () => {
    let count = 0;
    const stack = new CleanupStack();
    stack.add("once", async () => {
      count += 1;
    });
    await stack.runAll();
    await stack.runAll();
    expect(count).toBe(1);
  });
});

describe("DebuggerSession ownership", () => {
  test("never detaches a session it did not attach", async () => {
    const fake = new FakeTransport();
    const session = new DebuggerSession(fake, 7);
    await session.detach();
    expect(fake.detachCount).toBe(0);
  });

  test("detaches exactly once after a successful attach", async () => {
    const fake = new FakeTransport();
    const session = new DebuggerSession(fake, 7);
    await session.attach();
    await session.detach();
    await session.detach();
    expect(fake.detachCount).toBe(1);
  });

  test("refuses to attach when another debugger already holds the tab", async () => {
    const fake = new FakeTransport();
    fake.targets = [{ tabId: 7, attached: true }];
    const session = new DebuggerSession(fake, 7);
    await expect(session.attach()).rejects.toMatchObject({ code: "DEBUGGER_BUSY" });
    expect(fake.attachCalls).toEqual([]);
  });

  test("refuses commands once the browser has detached us", async () => {
    const fake = new FakeTransport();
    const session = new DebuggerSession(fake, 7);
    await session.attach();
    fake.emitDetach(7, "canceled_by_user");
    await expect(session.send("Page.getLayoutMetrics")).rejects.toMatchObject({ code: "DETACHED" });
    expect(session.detachedBy).toBe("canceled_by_user");
  });
});

describe("classifyAttachError", () => {
  test("maps enterprise policy text to POLICY_BLOCKED", () => {
    expect(classifyAttachError(new Error("Screenshot capture is restricted by policy.")).code).toBe("POLICY_BLOCKED");
  });

  test("never echoes the raw browser message, which may contain a URL", () => {
    const err = classifyAttachError(new Error("Cannot access https://private.example/account"));
    expect(err.code).toBe("RESTRICTED_URL");
    expect(err.message).not.toContain("private.example");
  });

  test("anything unknown becomes a generic attach failure", () => {
    expect(classifyAttachError(new Error("weird")).code).toBe("ATTACH_FAILED");
  });
});
