import assert from "node:assert/strict";
import test from "node:test";
import { applyExplicitMode, localRoute, ModelFallbackIntentRouter } from "./intentRouter.js";

test("local intent rules conservatively distinguish capture, query kinds, and ambiguity", () => {
  assert.equal(localRoute("保存这段").mode, "capture");
  assert.equal(localRoute("怎么用 find 找文件").intent, "command");
  assert.equal(localRoute("为什么 Adam 要估计动量？").intent, "understanding");
  assert.equal(localRoute("还有哪些未完成事项？").intent, "task");
  assert.equal(localRoute("这两个方案如何取舍？").intent, "decision");
  assert.equal(localRoute("一段粘贴内容\n但也许是问题？").mode, "clarify");
  assert.equal(localRoute("Adam").mode, "clarify");
  assert.equal(localRoute("保存这段：为什么会失败？").mode, "clarify");
});

test("explicit user mode always overrides classification without silently writing", () => {
  assert.deepEqual(applyExplicitMode(localRoute("保存这段"), "query"), {
    mode: "query", intent: "find", confidence: 1, reasonCode: "explicit-query-override", needsConfirmation: false,
  });
  assert.equal(applyExplicitMode(localRoute("为什么 Adam 有动量？"), "capture").mode, "capture");
});

test("router is disabled by default and validates external input", async () => {
  let calls = 0;
  const router = new ModelFallbackIntentRouter({ classify: async () => { calls += 1; return { mode: "query", intent: "find", confidence: 1 }; } });
  assert.equal((await router.classify("这是一段意图不明确的内容")).mode, "clarify");
  assert.equal(calls, 0);
  await assert.rejects(router.classify("   "), /1–2000/);
  await assert.rejects(router.classify("x".repeat(2_001)), /1–2000/);
  assert.throws(() => new ModelFallbackIntentRouter(undefined, { minimumModelConfidence: Number.NaN }), /置信度/);
});

test("enabled model receives only current text and valid fixed-schema output", async () => {
  let received = "";
  const router = new ModelFallbackIntentRouter({
    classify: async (text) => {
      received = text;
      return { mode: "query", intent: "find", confidence: 0.91, reasonCode: text };
    },
  }, { enabled: true });
  const route = await router.classify("这是一段需要模型辨识的当前输入");
  assert.equal(received, "这是一段需要模型辨识的当前输入");
  assert.equal(route.reasonCode, "model-classification");
  assert.equal(route.mode, "query");
});

test("invalid, failed, timed-out, and sensitive model routing falls back locally", async () => {
  const invalid = new ModelFallbackIntentRouter({ classify: async () => ({ answer: "not schema" }) }, { enabled: true });
  assert.equal((await invalid.classify("这是一段意图不明确的内容")).reasonCode, "model-invalid-fallback");

  const failed = new ModelFallbackIntentRouter({ classify: async () => { throw new Error("provider body must not escape"); } }, { enabled: true });
  assert.equal((await failed.classify("这是一段意图不明确的内容")).reasonCode, "model-error-fallback");

  const timedOut = new ModelFallbackIntentRouter({
    classify: () => new Promise(() => { /* deliberately ignores AbortSignal */ }),
  }, { enabled: true, timeoutMs: 50 });
  assert.equal((await timedOut.classify("这是一段意图不明确的内容")).reasonCode, "model-timeout-fallback");
  let cancelledCalls = 0;
  const cancelledRouter = new ModelFallbackIntentRouter({
    classify: async () => { cancelledCalls += 1; return { mode: "query", intent: "find", confidence: 1 }; },
  }, { enabled: true });
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal((await cancelledRouter.classify("这是一段意图不明确的内容", cancelled.signal)).reasonCode, "model-cancelled-fallback");
  assert.equal(cancelledCalls, 0);

  let secretCalls = 0;
  const sensitive = new ModelFallbackIntentRouter({ classify: async () => { secretCalls += 1; return {}; } }, { enabled: true });
  for (const secret of [
    "api_key=top-secret-value",
    "token=plain-secret-value",
    "Authorization: Bearer abcdefghijklmnop",
    "client_secret: do-not-send-this",
    "sk-abcdefghijklmnopqrstu",
  ]) {
    assert.equal((await sensitive.classify(secret)).reasonCode, "sensitive-local-only");
  }
  assert.equal(secretCalls, 0);
});
