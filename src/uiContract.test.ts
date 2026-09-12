import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("P0 styles use the approved non-green tokens and window geometry", async () => {
  const css = await source("src/styles.css");
  for (const declaration of [
    "--shell: #1f2937", "--primary: #2563eb", "--surface: #f8fafc",
    "--text: #172033", "--muted: #526071", "--danger: #c54b43", "--accent: #60a5fa",
    "width: min(560px", "height: min(680px", "height: 40px", "min-height: 56px", "padding: 16px",
  ]) assert.ok(css.includes(declaration), `missing UI contract declaration: ${declaration}`);
  assert.doesNotMatch(css, /#183a32|#276b5d|#43b69b|rgba\((?:24, 58, 50|67, 182, 155|39, 107, 93)/i);
  assert.doesNotMatch(css, /gradient|backdrop-filter/);

  const index = await source("index.html");
  assert.match(index, /name="theme-color" content="#1f2937"/);

  const prompts = await source("design/gpt-image-2-prompts.json");
  const generator = await source("design/generate-ui-mocks.mjs");
  for (const authority of [prompts, generator]) {
    assert.match(authority, /#1F2937/);
    assert.match(authority, /#2563EB/);
    assert.doesNotMatch(authority, /#183a32|#276b5d|#43b69b/i);
  }
  assert.doesNotMatch(generator, /\bgreen\b|\bmint\b/i);

  for (const path of [
    "design/ui/01-quick-capture.svg", "design/ui/02-rag-search.svg",
    "design/ui/03-rag-results.svg", "design/ui/04-command-risk.svg",
    "design/ui/05-backstage-connectors.svg", "design/ui/06-hotkey-lifecycle.svg",
    "design/ui/07-monitoring-consent.svg", "design/ui/08-input-output-architecture.svg",
  ]) assert.doesNotMatch(await source(path), /#183a32|#276b5d|#43b69b/i, `stale green token in ${path}`);
});

test("P0 query remains one question box without chips, examples, or source selector", async () => {
  const main = await source("src/main.tsx");
  assert.equal((main.match(/id="query-input"/g) ?? []).length, 1);
  assert.doesNotMatch(main, /SEARCH_OPTIONS|search-intent|query-example|query-source-select/);
  assert.match(main, /resultKeyboardAction/);
  assert.match(main, /focusRiskModal/);
  assert.match(main, /输入已保留/);
  assert.match(main, /results\.retrievalMode === "rag"/);
  assert.match(main, /RAG 检索/);
  assert.match(main, /尚未配置知识源/);
  assert.match(main, /这不是连接故障/);
});

test("danger modal preserves distinct keyboard-card and clicked-button return targets", async () => {
  const main = await source("src/main.tsx");
  assert.match(main, /copyResult\(result, false, "result-card"\)/);
  assert.match(main, /copyResult\(result, false, "copy-button"\)/);
  assert.match(main, /focusRiskReturnTarget\(root\.querySelectorAll/);
});
