import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeSearchResults } from "./knowledge/types.js";
import { renderQueryState, renderRiskModal } from "./queryView.js";

const state = { loading: false, projectCount: 1, errorMessage: "", busy: false,
  hasSearched: true, sources: [], selectedResultIndex: 0 };

test("empty results still display source warnings as escaped text", () => {
  const results = [] as KnowledgeSearchResults;
  results.warnings = ["语义服务不可用，已降级。", "<img src=x onerror=alert(1)>"];
  const html = renderQueryState({ ...state, results });
  assert.ok(html.includes("已降级"));
  assert.ok(html.includes("未找到相关原文"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(!renderQueryState({ ...state, results, busy: true }).includes("已降级"));
});

test("result rendering keeps copy-only actions and danger confirmation", () => {
  const results: KnowledgeSearchResults = [{ id: "r1", title: "Command", kind: "command",
    excerpt: "rm -rf /tmp/example", location: { sourceId: "remote", documentId: "note", path: "note.md" } }];
  results.warnings = ["来源已变化"];
  const html = renderQueryState({ ...state, results });
  assert.ok(html.includes("来源已变化"));
  assert.ok(html.includes("复制定位"));
  assert.ok(html.includes("需确认"));
  assert.ok(!html.includes('data-action="locate"'));
  const modal = renderRiskModal(results, "r1", "");
  assert.ok(modal.includes('role="alertdialog"'));
  assert.ok(modal.includes("不会执行"));
});
