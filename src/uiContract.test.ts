import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("desktop shell renders a clear white glass surface in a transparent borderless window (source contract)", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /backdrop-filter: blur\(14px\) saturate\(140%\)/);
  assert.match(css, /background: transparent/);
  assert.doesNotMatch(css, /-webkit-app-region:/);
  assert.match(css, /border-radius: 26px/);
  assert.match(css, /--glass: rgba\(255, 255, 255, \.84\)/);
  assert.doesNotMatch(css, /box-shadow:\s*0 26px 60px/);
  assert.match(css, /@supports not \(backdrop-filter/);
  assert.match(css, /prefers-contrast: more/);
  // The dark app-header bar was the main reason the shell did not read as the white Today AI glass.
  assert.doesNotMatch(css, /\.app-header \{[^}]*rgba\(31, 41, 55/);
  assert.doesNotMatch(css, /#183a32|#276b5d|#43b69b/i);

  const config = JSON.parse(await source("neutralino.config.json")) as { modes: { window: { borderless: boolean; transparent: boolean } } };
  assert.equal(config.modes.window.borderless, true);
  assert.equal(config.modes.window.transparent, true);
});

test("primary navigation and knowledge actions use one accessible inline icon system", async () => {
  const main = await source("src/main.tsx");
  const icons = await source("src/icons.ts");
  const css = await source("src/styles.css");
  assert.match(main, /<span class="app-mark"><img src="\.\/action-pocket\.png" alt="">/);
  for (const name of ["record", "search", "save", "copy", "open", "edit", "file", "folder"]) {
    assert.match(icons, new RegExp(`${name}:`));
  }
  assert.match(icons, /aria-hidden="true"/);
  assert.match(main, /icon\("save"\)/);
  assert.match(main, /icon\(canLocate \? "open" : "copy"\)/);
  assert.match(css, /\.icon \{[^}]*stroke: currentColor/);
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

test("desktop chrome manually moves the native window without allowing labels into query input (source contract)", async () => {
  const main = await source("src/main.tsx");
  const bridge = await source("src/desktopRuntime.ts");
  const drag = await source("src/windowDrag.ts");
  const css = await source("src/styles.css");
  assert.match(bridge, /neutralinoWindow\.getPosition\(\)/);
  assert.match(bridge, /computer\.getMousePosition\(\)/);
  assert.match(bridge, /neutralinoWindow\.move\(Math\.round\(x\), Math\.round\(y\)\)/);
  assert.doesNotMatch(bridge, /neutralinoWindow\.beginDrag/);
  assert.match(drag, /class ManualWindowDrag/);
  assert.match(drag, /private moveInFlight = false/);
  assert.match(main, /new ManualWindowDrag\(\s*desktopWindowPosition,\s*desktopMousePosition,/);
  assert.match(main, /shouldBeginWindowDrag\(event\.button, inHeader, inInteractiveControl\)/);
  assert.match(main, /root\.addEventListener\("pointerdown", beginWindowDragFromPointer\)/);
  assert.match(main, /root\.addEventListener\("mousedown", beginWindowDragFromPointer\)/);
  assert.match(main, /root\.addEventListener\("pointerup", \(\) => manualWindowDrag\.end\(\)\)/);
  assert.match(main, /document\.addEventListener\("pointercancel", \(\) => manualWindowDrag\.end\(\)\)/);
  assert.match(main, /window\.addEventListener\("blur", \(\) => manualWindowDrag\.end\(\)\)/);
  assert.doesNotMatch(main, /devicePixelRatio/);
  const config = JSON.parse(await source("neutralino.config.json")) as {
    nativeAllowList: string[];
    modes: { window: { injectGlobals: boolean; injectClientLibrary: boolean } };
  };
  assert.ok(config.nativeAllowList.includes("computer.*"), "the bundled 5.6.0 runtime requires computer.* for cursor polling");
  assert.equal(config.modes.window.injectGlobals, true, "an external HTTP UI needs Neutralino globals for native APIs");
  assert.equal(config.modes.window.injectClientLibrary, false, "Vite already bundles the Neutralino client library");
  assert.doesNotMatch(main, /function beginWindowDragFromPointer[\s\S]*?if \(!isDesktopRuntime\(\)\) return/);
  assert.match(main, /target\.closest\("\.app-header, \.mode-tabs, \.query-form > label"\)/);
  assert.match(main, /autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"/);
  assert.match(css, /\.app-header \{[\s\S]*?touch-action: none;[\s\S]*?user-select: none/);
  assert.match(css, /\.mode-tabs \{[\s\S]*?user-select: none/);
});

test("main window only switches configured projects and defers configuration to the tray (source contract)", async () => {
  const main = await source("src/main.tsx");
  assert.equal((main.match(/id="query-input"/g) ?? []).length, 1);
  assert.match(main, /projectSwitcherModel\(projects, projectId\)/);
  assert.match(main, /id="project-select"/);
  assert.match(main, /<header class="app-header">[\s\S]*?\$\{renderProjectSwitcher\(\)\}/);
  assert.doesNotMatch(main, /source-status/);
  assert.doesNotMatch(main, /<div class="shell-top">\s*\$\{renderTabs\(\)\}\s*\$\{renderProjectSwitcher\(\)\}/);
  assert.match(main, /TRAY_SETTINGS_HINT/);
  // No add-project plus sign and no bottom settings button: the tray owns configuration.
  assert.doesNotMatch(main, /data-action="settings"/);
  assert.doesNotMatch(main, /aria-label="添加项目"/);
  assert.doesNotMatch(main, /renderPinnedReferences|data-action="pin"|data-action="useful"/);
  assert.match(main, /resultKeyboardAction/);
  assert.match(main, /input\.id === "raw-content"[\s\S]*?syncSubmitButtons\(\)/);
  assert.match(main, /canSubmitWrite\(rawContent, relativePath, activeSource\(\)\)/);
});

test("long project names and write paths adapt without covering header controls", async () => {
  const main = await source("src/main.tsx");
  const css = await source("src/styles.css");
  assert.match(main, /id="project-select" title="\$\{escapeHtml\(selectedName\)\}"/);
  assert.match(main, /class="target-summary" title="\$\{escapeHtml\(targetSummary\)\}"/);
  assert.match(css, /\.project-switcher select \{[^}]*width: 100%;[^}]*max-width: 100%/);
  assert.match(css, /\.target-card > span \{[^}]*overflow-wrap: anywhere;[^}]*white-space: normal/);
  assert.match(css, /@media \(max-width: 470px\) \{[\s\S]*?\.header-spacer[\s\S]*?display: none;[\s\S]*?\.app-header \.project-switcher \{[^}]*width: 0;[^}]*flex: 1 1 0/);
});

test("unconfigured search points at the tray settings window without a dead button", async () => {
  const main = await source("src/main.tsx");
  assert.match(main, /projects\.length === 0 \? `<div class="inline-state unconfigured">/);
  assert.match(main, /!projects\.length && !errorMessage\) return `<div class="query-state" role="note"><span>\$\{escapeHtml\(TRAY_SETTINGS_HINT\)\}/);
});

test("query results render sanitized Markdown and embedded HTML", async () => {
  const main = await source("src/main.tsx");
  const renderer = await source("src/richText.ts");
  const css = await source("src/styles.css");
  assert.match(main, /renderRichText\(result\.excerpt\)/);
  assert.match(main, /renderRichText\(result\.contextBefore\)/);
  assert.match(renderer, /DOMPurify\.sanitize/);
  assert.match(renderer, /marked\.parse/);
  assert.match(renderer, /FORBID_TAGS: \["style", "img", "svg"/);
  assert.match(renderer, /noopener noreferrer/);
  assert.match(css, /\.markdown-body table/);
  assert.match(css, /\.markdown-body pre code/);
});

test("result card copy and open actions share one stable grid and stack on narrow windows (source contract)", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /\.result-actions \{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; \}/);
  assert.match(css, /@media \(max-width: 470px\) \{[\s\S]*?\.result-actions \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.result-actions button \{[\s\S]*?height: 36px;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap/);
  assert.doesNotMatch(css, /\.result-actions \.primary \{ margin-right: auto/);
});

test("toast source contract reserves space above the fixed action bar", async () => {
  const css = await source("src/styles.css");
  assert.match(css, /\.panel-actions \{[\s\S]*?min-height: 56px/);
  assert.match(css, /\.toast-region \{[^}]*bottom: 84px/);
  assert.match(css, /\.toast-region \{[^}]*max-width: calc\(100% - 32px\)/);
});

test("copy handler source contract retains scroll state and danger-modal return-target wiring", async () => {
  // This checks implementation wiring only; Windows/WebView scroll and focus remain runtime acceptance items.
  const main = await source("src/main.tsx");
  assert.match(main, /copyResult\(result, false, "result-card"\)/);
  assert.match(main, /copyResult\(result, false, "copy-button"\)/);
  assert.match(main, /const scrollTop = root\.querySelector<HTMLElement>\("\.shell-body"\)\?\.scrollTop \?\? 0;[\s\S]*?render\(\);[\s\S]*?shellBody\.scrollTop = scrollTop/);
  assert.match(main, /clipboardError = "";\s*renderPreservingShellScroll\(\);\s*focusRiskModal\(\)/);
  assert.match(main, /if \(riskResultId\) closeRiskModal\(\);\s*showToast/);
  assert.doesNotMatch(main, /if \(riskResultId\) closeRiskModal\(\); else render\(\)/);
  assert.match(main, /focusRiskReturnTarget\(root\.querySelectorAll/);
});
