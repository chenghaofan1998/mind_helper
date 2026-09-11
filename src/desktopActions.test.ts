import assert from "node:assert/strict";
import test from "node:test";
import { trayAction } from "./desktopActions.js";

test("tray actions reject unknown event identifiers", () => {
  assert.equal(trayAction("show"), "show");
  assert.equal(trayAction("toggle-pin"), "toggle-pin");
  assert.equal(trayAction("exit"), "exit");
  assert.equal(trayAction("unknown"), undefined);
  assert.equal(trayAction(undefined), undefined);
});
