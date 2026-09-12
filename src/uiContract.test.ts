import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("desktop shell renders a clear white glass surface in a transparent borderless window (source contract)", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /backdrop-filter: blur\(14px\) saturate\(140%\)/);
  assert.match(css, /background: transparent/);
  assert.match(css, /-webkit-app-region: drag/);
  assert.match(css, /border-radius: 26px/);
  assert.match(css, /rgba\(255, 255, 255, \.70\)/);
  assert.match(css, /@supports not \(backdrop-filter/);
  assert.match(css, /prefers-contrast: more/);
  // The dark app-header bar was the main reason the shell did not read as the white Today AI glass.
  assert.doesNotMatch(css, /\.app-header \{[^}]*rgba\(31, 41, 55/);
  assert.doesNotMatch(css, /#183a32|#276b5d|#43b69b/i);

  const config = JSON.parse(await source("neutralino.config.json")) as { modes: { window: { borderless: boolean; transparent: boolean } } };
  assert.equal(config.modes.window.borderless, true);
  assert.equal(config.modes.window.transparent, true);
});

test("main window keeps a fixed top input row, one scrolling body and a fixed action bar (source contract)", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /\.pocket \{[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.shell-body \{[\s\S]*?overflow-y: auto/);
  assert.match(css, /\.panel-actions \{[\s\S]*?min-height: 56px/);
  assert.match(css, /\.record-input \{[\s\S]*?resize: none/);
  assert.match(css, /\.query-form textarea \{[^}]*resize: none/);
  // The action bar must not be pushed by a scrolling panel margin.
  assert.doesNotMatch(css, /\.panel-actions \{[^}]*margin-top: auto/);

  const main = await source("src/main.tsx");
  assert.match(main, /<div class="shell-top">/);
  assert.match(main, /<section class="shell-body">/);
  assert.match(main, /<div class="panel-actions">/);
});

test("main window only switches configured projects and defers configuration to the tray (source contract)", async () => {
  const main = await source("src/main.tsx");
  assert.equal((main.match(/id="query-input"/g) ?? []).length, 1);
  assert.match(main, /projectSwitcherModel\(projects, projectId\)/);
  assert.match(main, /id="project-select"/);
  assert.match(main, /TRAY_SETTINGS_HINT/);
  // No add-project plus sign and no bottom settings button: the tray owns configuration.
  assert.doesNotMatch(main, /data-action="settings"/);
  assert.doesNotMatch(main, /aria-label="添加项目"/);
  assert.doesNotMatch(main, /renderPinnedReferences|data-action="pin"|data-action="useful"/);
  assert.match(main, /resultKeyboardAction/);
  assert.match(main, /input\.id === "raw-content"[\s\S]*?syncSubmitButtons\(\)/);
  assert.match(main, /canSubmitWrite\(rawContent, relativePath, activeSource\(\)\)/);
});

test("unconfigured search points at the tray settings window without a dead button", async () => {
  const main = await source("src/main.tsx");
  assert.match(main, /projects\.length === 0 \? `<div class="inline-state unconfigured">/);
  assert.match(main, /!projects\.length && !errorMessage\) return `<div class="query-state" role="note"><span>\$\{escapeHtml\(TRAY_SETTINGS_HINT\)\}/);
});

test("result card copy and open actions share one stable grid and stack on narrow windows (source contract)", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /\.result-actions \{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; \}/);
  assert.match(css, /@media \(max-width: 470px\) \{[\s\S]*?\.result-actions \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(css, /\.result-actions \.primary \{ margin-right: auto/);
});

test("toast source contract reserves space above the fixed action bar", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /\.panel-actions \{[\s\S]*?min-height: 56px/);
  assert.match(css, /\.toast-region \{[^}]*bottom: 84px/);
  assert.match(css, /\.toast-region \{[^}]*max-width: calc\(100% - 32px\)/);
});

test("danger modal preserves distinct keyboard-card and clicked-button return targets (source contract)", async () => {
  const main = await source("src/main.tsx");
  assert.match(main, /copyResult\(result, false, "result-card"\)/);
  assert.match(main, /copyResult\(result, false, "copy-button"\)/);
  assert.match(main, /focusRiskReturnTarget\(root\.querySelectorAll/);
});
