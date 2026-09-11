import "./styles.css";
import { copyText } from "./clipboard";
import { hideDesktopWindow, initializeDesktopRuntime, isDesktopRuntime, toggleDesktopPin } from "./desktopRuntime";
import { clearDraft, loadDraft, saveDraft } from "./draftStore";
import { focusTarget, modalKeyboardAction, wrappedFocusIndex } from "./focusTrap";
import { listSources, searchKnowledge, writeKnowledge } from "./knowledge/client";
import type { KnowledgeResult, SourceDescriptor, SourceLocation, WriteReceipt } from "./knowledge/types";
import { feedbackForLocation, loadPreferences, locationKey, savePreferences, setFeedback, togglePin } from "./preferenceStore";
import { commandForClipboard, isDangerous, riskImpact } from "./search";

type Mode = "record" | "query";
type RuntimeWindow = Window & {
  Neutralino?: {
    clipboard?: { writeText(value: string): Promise<unknown> };
    os?: { open(value: string): Promise<unknown> };
  };
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");
const root: HTMLElement = rootElement;

const draft = loadDraft();
const preferences = loadPreferences();
let mode: Mode = draft.rawContent ? "record" : "query";
let sources: SourceDescriptor[] = [];
let sourceId = draft.sourceId;
let relativePath = draft.relativePath;
let rawContent = draft.rawContent;
let query = "";
let results: KnowledgeResult[] = [];
let busy = false;
let loading = true;
let hasSearched = false;
let errorMessage = "";
let successReceipt: WriteReceipt | null = null;
let riskResultId = "";
let riskReturnResultId = "";
let clipboardError = "";
let editingTarget = false;
let windowPinned = false;
let toastTimer = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function activeSource(): SourceDescriptor | undefined {
  return sources.find((source) => source.id === sourceId);
}

function locationLabel(location: SourceLocation): string {
  const anchor = location.line ? `第 ${location.line} 行` : location.blockId ? `块 ${location.blockId}` : "位置未提供";
  return `${location.path} · ${anchor}`;
}

function sourceVersion(location: SourceLocation): string {
  return location.version ? `来源版本 ${location.version}` : "来源未提供版本";
}

function sourceSearchMode(source?: SourceDescriptor): string {
  if (!source) return "未配置知识源";
  if (source.searchMode === "lexical-fallback") return "本地词法检索，未使用 RAG";
  return source.searchDescription || "知识源原生检索";
}

function pinFor(location: SourceLocation) {
  const key = locationKey(location);
  return preferences.pins.find((pin) => locationKey(pin.location) === key);
}

function renderTabs(): string {
  return `<nav class="mode-tabs" role="tablist" aria-label="选择意图">
    <button type="button" role="tab" aria-selected="${mode === "record"}" class="${mode === "record" ? "active" : ""}" data-action="mode" data-mode="record">记入</button>
    <button type="button" role="tab" aria-selected="${mode === "query"}" class="${mode === "query" ? "active" : ""}" data-action="mode" data-mode="query">查询</button>
  </nav>`;
}

function renderSourceOptions(requireWrite = false): string {
  return sources.filter((source) => !requireWrite || source.capabilities.includes("write"))
    .map((source) => `<option value="${escapeHtml(source.id)}" ${source.id === sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>`).join("");
}

function renderTargetEditor(): string {
  if (!editingTarget) return "";
  return `<div class="target-editor">
    <label><span>知识源</span><select id="source-select" ${busy ? "disabled" : ""}>${renderSourceOptions(true)}</select></label>
    <label><span>知识源内位置</span><input id="relative-path" value="${escapeHtml(relativePath)}" maxlength="240" required ${busy ? "disabled" : ""}></label>
  </div>`;
}

function renderRecord(): string {
  const source = activeSource();
  const canWrite = Boolean(source?.capabilities.includes("write") && rawContent.trim() && relativePath.trim());
  return `<form id="record-form" class="intent-panel record-panel">
    <label class="sr-only" for="raw-content">原始内容</label>
    <textarea class="record-input" id="raw-content" maxlength="262144" required placeholder="输入或粘贴想保存的原始内容…" ${busy ? "disabled" : ""}>${escapeHtml(rawContent)}</textarea>
    <section class="target-card" aria-label="写入位置">
      <span><strong>${escapeHtml(source?.name ?? "未配置知识源")}</strong> · ${escapeHtml(relativePath || "未设置写入位置")}</span>
      <button class="text-button" type="button" data-action="edit-target" ${busy ? "disabled" : ""}>${editingTarget ? "收起" : "更改"}</button>
    </section>
    ${renderTargetEditor()}
    ${errorMessage ? `<div class="inline-state error" role="alert"><b>!</b><span>${escapeHtml(errorMessage)}</span></div>` : ""}
    ${successReceipt?.ok ? `<div class="inline-state success" role="status"><b>✓</b><span>已写入并校验：${escapeHtml(locationLabel(successReceipt.location))}</span></div>` : ""}
    <div class="panel-actions"><button class="settings-button" type="button" data-action="settings">⚙ <span>设置</span></button><button class="primary" type="submit" ${busy || !canWrite ? "disabled" : ""}>${busy ? "正在保存…" : errorMessage ? "重试保存" : "保存到知识库"}<kbd>Ctrl+Enter</kbd></button></div>
  </form>`;
}

function renderPinnedReferences(): string {
  if (!preferences.pins.length) return "";
  return `<details class="pinned-references"><summary>已固定来源（${preferences.pins.length}）</summary>${preferences.pins.map((pin) => `<div><code>${escapeHtml(locationLabel(pin.location))}</code><button data-action="unpin" data-key="${escapeHtml(locationKey(pin.location))}">取消固定</button></div>`).join("")}</details>`;
}

function renderExcerpt(result: KnowledgeResult): string {
  if (result.kind === "command") return `<pre class="command-block"><code>${escapeHtml(commandForClipboard(result.excerpt))}</code></pre>`;
  return `<blockquote class="evidence-text">${escapeHtml(result.excerpt)}</blockquote>`;
}

function renderResult(result: KnowledgeResult): string {
  const pinned = pinFor(result.location);
  const stale = Boolean(pinned?.sourceVersion && pinned.sourceVersion !== result.location.version);
  const feedback = feedbackForLocation(preferences, result.location);
  const dangerous = result.kind === "command" && isDangerous(commandForClipboard(result.excerpt));
  return `<article class="result-card">
    <header class="result-heading"><div><span class="evidence-label">知识库原文</span><h2>${escapeHtml(result.title)}</h2></div><span class="result-kind">${result.kind === "command" ? "命令" : "原文"}</span></header>
    ${stale ? `<p class="stale">来源版本已变化；此固定引用不可视为最新正文。</p>` : ""}
    ${renderExcerpt(result)}
    ${result.contextBefore || result.contextAfter ? `<details class="context-details"><summary>展开必要上下文</summary>${result.contextBefore ? `<div><b>前文</b><p>${escapeHtml(result.contextBefore)}</p></div>` : ""}${result.contextAfter ? `<div><b>后文</b><p>${escapeHtml(result.contextAfter)}</p></div>` : ""}</details>` : ""}
    <p class="source-line">${escapeHtml(locationLabel(result.location))}<br><span>${escapeHtml(sourceVersion(result.location))}</span></p>
    ${dangerous ? `<p class="risk-note">${escapeHtml(riskImpact(commandForClipboard(result.excerpt)))}</p>` : ""}
    <footer class="result-actions">
      <button class="primary" data-action="copy" data-id="${escapeHtml(result.id)}">${result.kind === "command" ? "复制命令" : "复制原文"}${dangerous ? " · 需确认" : ""}</button>
      <button data-action="locate" data-id="${escapeHtml(result.id)}">${result.location.uri ? "打开原文" : "复制定位"}</button>
      <button class="${pinned ? "active" : ""}" data-action="pin" data-id="${escapeHtml(result.id)}">${pinned ? "已固定" : "固定"}</button>
      <button class="${feedback?.value === "useful" ? "active" : ""}" data-action="useful" data-id="${escapeHtml(result.id)}">${feedback ? "已有用" : "有用"}</button>
    </footer>
  </article>`;
}

function renderQueryState(): string {
  if (errorMessage) return `<div class="query-state error" role="alert"><b>知识源暂不可用</b><span>${escapeHtml(errorMessage)} 问题已保留。</span><button data-action="settings">打开设置</button></div>`;
  if (busy) return `<div class="query-state"><b>正在查询知识源…</b><span>问题会保留到查询完成。</span></div>`;
  if (results.length) return `<div class="results">${results.map(renderResult).join("")}</div>`;
  if (hasSearched) return `<div class="query-state"><b>未找到相关原文</b><span>可修改问题后重试，或按知识源定位自行查找。</span></div>`;
  return `<div class="query-spacer" aria-hidden="true"></div>`;
}

function renderQuery(): string {
  const source = activeSource();
  return `<section class="intent-panel query-panel">
    <form id="query-form" class="query-form">
      <label for="query-input">现在遇到什么问题？</label>
      <textarea id="query-input" rows="${hasSearched || busy ? 2 : 7}" maxlength="500" required placeholder="例如：我以前怎么理解 Adam 的一阶矩？" ${busy ? "disabled" : ""}>${escapeHtml(query)}</textarea>
    </form>
    ${renderQueryState()}
    ${renderPinnedReferences()}
    <div class="source-mode">${escapeHtml(source?.name ?? "未配置知识源")} · ${escapeHtml(sourceSearchMode(source))}</div>
    <div class="panel-actions"><button class="settings-button" type="button" data-action="settings">⚙ <span>设置</span></button><button class="primary" type="submit" form="query-form" ${busy || !source || !query.trim() ? "disabled" : ""}>${busy ? "查询中…" : errorMessage ? "重试查询" : "查询"}<kbd>Enter</kbd></button></div>
  </section>`;
}

function renderRiskModal(): string {
  const result = results.find((item) => item.id === riskResultId);
  if (!result) return "";
  const command = commandForClipboard(result.excerpt);
  return `<div class="modal-backdrop"><section class="risk-modal" role="alertdialog" aria-modal="true" aria-labelledby="risk-title">
    <header><span class="risk-mark">!</span><h2 id="risk-title">复制前确认</h2></header>
    <p>你即将复制以下命令：</p><pre><code>${escapeHtml(command)}</code></pre>
    <p class="modal-source">${escapeHtml(locationLabel(result.location))} · ${escapeHtml(sourceVersion(result.location))}</p>
    <p class="modal-warning"><b>!</b>${escapeHtml(riskImpact(command))}</p>
    ${clipboardError ? `<p class="modal-error" role="alert"><b>!</b>复制失败：${escapeHtml(clipboardError)}</p>` : ""}
    <p>Action Pocket 只会复制，不会执行。</p>
    <footer><button data-action="close-risk" data-risk-initial-focus>取消</button><button class="primary" data-action="confirm-copy" data-id="${escapeHtml(result.id)}">${clipboardError ? "重试复制" : "仍然复制"}</button></footer>
    <small>Esc 取消 · Tab / Shift+Tab 切换焦点</small>
  </section></div>`;
}

function render(): void {
  const source = activeSource();
  root.innerHTML = `<main class="pocket">
    <header class="app-header"><strong>AP</strong><span class="source-status ${source ? "ready" : ""}">${loading ? "连接中" : source?.name ?? "未配置"}</span>${isDesktopRuntime() ? `<button class="pin-button ${windowPinned ? "active" : ""}" data-action="toggle-window-pin" aria-pressed="${windowPinned}" title="${windowPinned ? "取消窗口置顶" : "窗口置顶"}">◆</button>` : ""}</header>
    ${renderTabs()}${mode === "record" ? renderRecord() : renderQuery()}
    <div class="toast-region" aria-live="polite"></div>${renderRiskModal()}
  </main>`;
}

function updateDraft(): void {
  saveDraft({ rawContent, sourceId, relativePath });
}

function showToast(message: string): void {
  const region = root.querySelector(".toast-region");
  if (!region) return;
  region.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { region.innerHTML = ""; }, 2200);
}

function legacyWrite(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);
  textarea.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { textarea.remove(); }
}

async function writeClipboard(value: string): Promise<void> {
  const runtime = window as RuntimeWindow;
  await copyText(value, {
    nativeWrite: runtime.Neutralino?.clipboard?.writeText.bind(runtime.Neutralino.clipboard),
    webWrite: navigator.clipboard?.writeText.bind(navigator.clipboard),
    legacyWrite,
  });
}

function focusRiskModal(): void {
  requestAnimationFrame(() => focusTarget(root.querySelector<HTMLElement>("[data-risk-initial-focus]")));
}

function closeRiskModal(): void {
  const returnId = riskReturnResultId;
  riskResultId = "";
  riskReturnResultId = "";
  clipboardError = "";
  render();
  requestAnimationFrame(() => focusTarget([...root.querySelectorAll<HTMLElement>('[data-action="copy"]')].find((button) => button.dataset.id === returnId)));
}

async function copyResult(result: KnowledgeResult, confirmed = false): Promise<void> {
  const value = result.kind === "command" ? commandForClipboard(result.excerpt) : result.excerpt;
  if (!confirmed && result.kind === "command" && isDangerous(value)) {
    riskResultId = result.id;
    riskReturnResultId = result.id;
    clipboardError = "";
    render();
    focusRiskModal();
    return;
  }
  try {
    await writeClipboard(value);
    if (riskResultId) closeRiskModal(); else render();
    showToast(result.kind === "command" ? "已复制；未执行任何命令" : "原文已复制");
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法访问剪贴板，请重试。";
    if (riskResultId) {
      clipboardError = message;
      render();
      focusRiskModal();
    } else {
      render();
      showToast(`复制失败：${message}`);
    }
  }
}

async function locateResult(result: KnowledgeResult): Promise<void> {
  const runtime = window as RuntimeWindow;
  if (result.location.uri && runtime.Neutralino?.os?.open) {
    try { await runtime.Neutralino.os.open(result.location.uri); return; } catch { /* fall back to a copied locator */ }
  }
  try {
    await writeClipboard(`${result.location.sourceId} · ${locationLabel(result.location)} · ${sourceVersion(result.location)}`);
    showToast(result.location.uri ? "无法打开原文，已复制定位" : "原文定位已复制");
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法访问剪贴板，请重试。";
    render();
    showToast(`复制定位失败：${message}`);
  }
}

async function submitRecord(): Promise<void> {
  busy = true; errorMessage = ""; successReceipt = null; render();
  try {
    const receipt = await writeKnowledge({ rawContent, target: { sourceId, relativePath } });
    if (!receipt.ok) throw new Error(receipt.message);
    successReceipt = receipt;
    rawContent = "";
    clearDraft();
  } catch (error) {
    errorMessage = error instanceof Error ? `写入失败：${error.message} 输入已保留。` : "写入失败，输入已保留。";
    updateDraft();
  } finally { busy = false; render(); }
}

async function submitQuery(): Promise<void> {
  busy = true; errorMessage = ""; successReceipt = null; hasSearched = true; render();
  try { results = await searchKnowledge({ query, sourceId, limit: 5 }); }
  catch (error) { results = []; errorMessage = error instanceof Error ? error.message : "查询失败。"; }
  finally { busy = false; render(); }
}

function selectMode(nextMode: Mode): void {
  mode = nextMode;
  const capability = mode === "record" ? "write" : "search";
  if (!activeSource()?.capabilities.includes(capability)) sourceId = sources.find((source) => source.capabilities.includes(capability))?.id ?? "";
  if (mode === "record" && !relativePath) relativePath = activeSource()?.defaultWritePath ?? "";
  errorMessage = ""; successReceipt = null; updateDraft(); render();
}

root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (input.id === "raw-content") { rawContent = input.value; updateDraft(); }
  if (input.id === "relative-path") { relativePath = input.value; updateDraft(); }
  if (input.id === "query-input") query = input.value;
});

root.addEventListener("change", (event) => {
  const input = event.target as HTMLSelectElement;
  if (input.id !== "source-select") return;
  sourceId = input.value;
  relativePath = activeSource()?.defaultWritePath ?? relativePath;
  updateDraft(); render();
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) return;
  if ((event.target as HTMLFormElement).id === "record-form") void submitRecord();
  if ((event.target as HTMLFormElement).id === "query-form") void submitQuery();
});

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const result = results.find((item) => item.id === button.dataset.id);
  if (action === "mode") selectMode(button.dataset.mode === "record" ? "record" : "query");
  else if (action === "edit-target") { editingTarget = !editingTarget; render(); }
  else if (action === "settings") showToast("当前开发版通过 AP_GRAPH_DIR 配置知识源");
  else if (action === "toggle-window-pin") void toggleDesktopPin().catch((error) => showToast(`置顶切换失败：${String(error)}`));
  else if (action === "pin" && result) { const value = togglePin(preferences, result.location); savePreferences(preferences); render(); showToast(value ? "已固定来源引用" : "已取消固定"); }
  else if (action === "unpin") { const pin = preferences.pins.find((item) => locationKey(item.location) === button.dataset.key); if (pin) { togglePin(preferences, pin.location); savePreferences(preferences); render(); } }
  else if (action === "useful" && result) { setFeedback(preferences, result.location, "useful"); savePreferences(preferences); render(); showToast("已记录为有用（仅保存来源引用）"); }
  else if (action === "locate" && result) void locateResult(result);
  else if (action === "copy" && result) void copyResult(result);
  else if (action === "confirm-copy" && result) void copyResult(result, true);
  else if (action === "close-risk") closeRiskModal();
});

document.addEventListener("keydown", (event) => {
  if (riskResultId) {
    const action = modalKeyboardAction(event.key);
    if (action === "close") { event.preventDefault(); closeRiskModal(); return; }
    if (action === "trap-focus") {
      const focusable = [...root.querySelectorAll<HTMLElement>(".risk-modal button:not([disabled])")];
      const next = wrappedFocusIndex(focusable.indexOf(document.activeElement as HTMLElement), focusable.length, event.shiftKey);
      if (next !== undefined) { event.preventDefault(); focusable[next]?.focus(); }
    }
    return;
  }
  if (event.key === "Escape" && isDesktopRuntime()) { event.preventDefault(); void hideDesktopWindow(); return; }
  if (mode === "record" && event.key === "Enter" && (event.ctrlKey || event.metaKey) && !busy) {
    const form = root.querySelector<HTMLFormElement>("#record-form");
    if (activeSource()?.capabilities.includes("write") && form?.reportValidity()) { event.preventDefault(); void submitRecord(); }
  }
  if (mode === "query" && event.key === "Enter" && !event.shiftKey && !busy && document.activeElement?.id === "query-input") {
    const form = root.querySelector<HTMLFormElement>("#query-form");
    if (activeSource()?.capabilities.includes("search") && form?.reportValidity()) { event.preventDefault(); void submitQuery(); }
  }
});

async function initialize(): Promise<void> {
  render();
  try {
    sources = await listSources();
    const selected = sources.find((source) => source.id === sourceId);
    if (!selected || (mode === "record" && !selected.capabilities.includes("write"))) sourceId = (mode === "record" ? sources.find((source) => source.capabilities.includes("write")) : sources[0])?.id ?? "";
    if (!relativePath) relativePath = activeSource()?.defaultWritePath ?? "";
    if (!sources.length) errorMessage = "未配置知识源。";
  } catch (error) { errorMessage = error instanceof Error ? error.message : "无法连接知识源。"; }
  finally { loading = false; render(); }
}

initializeDesktopRuntime({
  onPinnedChange(value) { windowPinned = value; render(); },
  onError(message) { showToast(message); },
});
void initialize();
