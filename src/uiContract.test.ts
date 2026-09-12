import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("desktop shell uses a restrained accessible glass surface", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /backdrop-filter: blur\(24px\) saturate\(135%\)/);
  assert.match(css, /background: transparent/);
  assert.match(css, /-webkit-app-region: drag/);
  assert.match(css, /@supports not \(backdrop-filter/);
  assert.match(css, /prefers-contrast: more/);
  assert.doesNotMatch(css, /#183a32|#276b5d|#43b69b/i);

  const config = JSON.parse(await source("neutralino.config.json")) as { modes: { window: { borderless: boolean; transparent: boolean } } };
  assert.equal(config.modes.window.borderless, true);
  assert.equal(config.modes.window.transparent, true);
});

test("query keeps one question box, an always-visible project switcher, and no obstructing mode or pin UI", async () => {
  const main = await source("src/main.tsx");
  assert.equal((main.match(/id="query-input"/g) ?? []).length, 1);
  assert.match(main, /id="project-select"/);
  assert.match(main, /当前项目/);
  assert.match(main, /projectId, sourceId/);
  assert.doesNotMatch(main, /source-mode|renderPinnedReferences|data-action="pin"|data-action="useful"/);
  assert.match(main, /resultKeyboardAction/);
  assert.match(main, /尚未添加项目/);
  assert.doesNotMatch(main, /知识源暂不可用/);
  assert.match(main, /input\.id === "raw-content"[\s\S]*?syncSubmitButtons\(\)/);
  assert.match(main, /canSubmitWrite\(rawContent, relativePath, activeSource\(\)\)/);
});

test("toast is positioned above the action bar at the 440 by 560 minimum layout", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /\.panel-actions \{[\s\S]*?min-height: 56px/);
  assert.match(css, /\.toast-region \{[^}]*bottom: 84px/);
  assert.match(css, /\.toast-region \{[^}]*max-width: calc\(100% - 32px\)/);
});

test("danger modal preserves distinct keyboard-card and clicked-button return targets", async () => {
  const main = await source("src/main.tsx");
  assert.match(main, /copyResult\(result, false, "result-card"\)/);
  assert.match(main, /copyResult\(result, false, "copy-button"\)/);
  assert.match(main, /focusRiskReturnTarget\(root\.querySelectorAll/);
});
