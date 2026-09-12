import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("P0 styles use the approved solid color tokens and window geometry", async () => {
  const css = await source("src/styles.css");
  for (const declaration of [
    "--shell: #183a32", "--primary: #276b5d", "--surface: #fafaf7",
    "--text: #202823", "--muted: #53635c", "--danger: #c54b43", "--accent: #43b69b",
    "width: min(560px", "height: min(680px", "height: 40px", "min-height: 56px", "padding: 16px",
  ]) assert.ok(css.includes(declaration), `missing UI contract declaration: ${declaration}`);
  assert.doesNotMatch(css, /gradient|backdrop-filter/);
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
});

test("danger modal preserves distinct keyboard-card and clicked-button return targets", async () => {
  const main = await source("src/main.tsx");
  assert.match(main, /copyResult\(result, false, "result-card"\)/);
  assert.match(main, /copyResult\(result, false, "copy-button"\)/);
  assert.match(main, /focusRiskReturnTarget\(root\.querySelectorAll/);
});
