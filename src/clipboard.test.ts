import assert from "node:assert/strict";
import test from "node:test";
import { copyText } from "./clipboard.js";

test("copyText prefers native clipboard and stops after success", async () => {
  const calls: string[] = [];
  await copyText("command", {
    nativeWrite: async (value) => { calls.push(`native:${value}`); },
    webWrite: async (value) => { calls.push(`web:${value}`); },
  });
  assert.deepEqual(calls, ["native:command"]);
});

test("copyText falls back and reports an explicit failure", async () => {
  const calls: string[] = [];
  await copyText("source", {
    webWrite: async () => { throw new Error("denied"); },
    legacyWrite: (value) => { calls.push(value); return true; },
  });
  assert.deepEqual(calls, ["source"]);
  await assert.rejects(copyText("x", { legacyWrite: () => false }), /不支持剪贴板/);
});
