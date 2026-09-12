import assert from "node:assert/strict";
import test from "node:test";
import { observeShellExit, requestShow, requestToggle } from "./shellLifecycleState.js";

test("show recovers hidden and minimized shells without starting duplicates", () => {
  assert.deepEqual(requestShow("hidden"), { state: "visible", action: "show-existing" });
  assert.deepEqual(requestShow("minimized"), { state: "visible", action: "show-existing" });
});

test("show starts exactly one replacement only after process exit", () => {
  assert.deepEqual(observeShellExit(), { state: "exited", action: "none" });
  assert.deepEqual(requestShow("exited"), { state: "starting", action: "start-shell" });
  assert.deepEqual(requestShow("starting"), { state: "visible", action: "show-existing" });
});

test("hotkey toggle uses the same show transition as tray actions", () => {
  assert.deepEqual(requestToggle("visible"), { state: "hidden", action: "hide" });
  assert.deepEqual(requestToggle("hidden"), requestShow("hidden"));
  assert.deepEqual(requestToggle("exited"), requestShow("exited"));
});
