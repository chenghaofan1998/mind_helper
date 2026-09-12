import "./styles.css";
import { copyText } from "./clipboard";
import { hideDesktopWindow, initializeDesktopRuntime, isDesktopRuntime, toggleDesktopPin } from "./desktopRuntime";
import { loadDraft, loadProjectDraft, saveDraft } from "./draftStore";
import { focusRiskReturnTarget, focusTarget, modalKeyboardAction, wrappedFocusIndex } from "./focusTrap";
import type { RiskReturnKind, RiskReturnTarget } from "./focusTrap";
import { applyExplicitMode, localRoute } from "./knowledge/intentRouter";
import { projectSwitcherModel, TRAY_SETTINGS_HINT } from "./layout";
import { listProjects, listSources, locateKnowledge, searchKnowledge, writeKnowledge } from "./knowledge/client";
import type { KnowledgeResult, KnowledgeSearchResults, ProjectDescriptor, SearchIntent, SourceDescriptor, SourceLocation, WriteReceipt } from "./knowledge/types";
import { nextResultIndex, resultKeyboardAction } from "./resultNavigation";
import { commandForClipboard, isDangerous, riskImpact } from "./search";
import { canSubmitWrite, effectiveWritePath } from "./writeTarget";

type Mode = "record" | "query";
type RuntimeWindow = Window & {
  Neutralino?: {
    clipboard?: { writeText(value: string): Promise<unknown> };
  };
};

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");
const root: HTMLElement = rootElement;

const draft = loadDraft();
let mode: Mode = draft.rawContent ? "record" : "query";
let projects: ProjectDescriptor[] = [];
let sources: SourceDescriptor[] = [];
let projectId = draft.projectId;
let sourceId = draft.sourceId;
let relativePath = draft.relativePath;
let relativePathExplicit = draft.relativePathExplicit;
let rawContent = draft.rawContent;
let query = "";
let searchIntent: SearchIntent = "find";
let results: KnowledgeSearchResults = [];
let busy = false;
let loading = true;
let hasSearched = false;
let errorMessage = "";
let successReceipt: WriteReceipt | null = null;
let lastSavedContent = "";
let selectedResultIndex = 0;
let riskResultId = "";
let riskReturnTarget: RiskReturnTarget | null = null;
let clipboardError = "";
let editingTarget = false;
let windowPinned = false;
let toastTimer = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function activeProject(): ProjectDescriptor | undefined {
  return projects.find((project) => project.id === projectId);
}

function activeSource(): SourceDescriptor | undefined {
  const project = activeProject();
  return sources.find((source) => source.id === sourceId && project?.sourceIds.includes(source.id));
}

function effectiveTargetPath(): string {
  return effectiveWritePath(relativePath, activeSource());
}

function locationLabel(location: SourceLocation): string {
  const anchor = location.line ? `第 ${location.line} 行` : location.blockId ? `块 ${location.blockId}` : "位置未提供";
  return `${location.path} · ${anchor}`;
}

function sourceVersion(location: SourceLocation): string {
  return location.version ? `来源版本 ${location.version}` : "来源未提供版本";
}

function sourceForResult(result: KnowledgeResult): SourceDescriptor | undefined {
  return sources.find((source) => source.id === result.location.sourceId);
}

function renderTabs(): string {
  return `<nav class="mode-tabs" role="tablist" aria-label="选择意图">
    <button type="button" role="tab" aria-selected="${mode === "record"}" class="${mode === "record" ? "active" : ""}" data-action="mode" data-mode="record">记入</button>
    <button type="button" role="tab" aria-selected="${mode === "query"}" class="${mode === "query" ? "active" : ""}" data-action="mode" data-mode="query">查询</button>
  </nav>`;
}

function renderProjectSwitcher(): string {
  const model = projectSwitcherModel(projects, projectId);
  if (model.kind === "empty") return "";
  if (model.kind === "single") {
    return `<div class="project-switcher single"><span class="project-switcher-label">${model.label}</span><span class="project-chip" title="${escapeHtml(model.name)}">${escapeHtml(model.name)}</span></div>`;
  }
  const options = model.options.map((option) => `<option value="${escapeHtml(option.id)}" ${option.selected ? "selected" : ""}>${escapeHtml(option.name)}</option>`).join("");
  return `<div class="project-switcher"><label for="project-select">${model.label}</label><select id="project-select" ${busy ? "disabled" : ""}>${options}</select></div>`;
}

function renderSourceOptions(requireWrite = false): string {
  const allowed = new Set(activeProject()?.sourceIds ?? []);
  return sources.filter((source) => allowed.has(source.id) && (!requireWrite || source.capabilities.includes("write")))
    .map((source) => `<option value="${escapeHtml(source.id)}" ${source.id === sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>`).join("");
}

function renderTargetEditor(): string {
  if (!editingTarget) return "";
  return `<div class="target-editor">
    <label><span>知识源</span><select id="source-select" ${busy ? "disabled" : ""}>${renderSourceOptions(true)}</select></label>
    <label><span>知识源内位置</span><input id="relative-path" value="${escapeHtml(effectiveTargetPath())}" maxlength="240" required ${busy ? "disabled" : ""}></label>
  </div>`;
}

function renderRecordInput(): string {
  const targetPath = effectiveTargetPath();
  const project = activeProject();
  return `<form id="record-form" class="intent-form record-form">
    <label class="sr-only" for="raw-content">原始内容</label>
    <textarea class="record-input" id="raw-content" maxlength="262144" required placeholder="输入或粘贴想保存的原始内容…" ${busy ? "disabled" : ""}>${escapeHtml(rawContent)}</textarea>
    <section class="target-card" aria-label="写入位置">
      <span><strong>${escapeHtml(project?.name ?? "未配置项目")}</strong> · ${escapeHtml(targetPath || "未设置写入位置")}</span>
      ${project ? `<button class="text-button" type="button" data-action="edit-target" ${busy ? "disabled" : ""}>${editingTarget ? "收起" : "更改"}</button>` : ""}
    </section>
  </form>`;
}

function renderRecordBody(): string {
  return `<div class="record-body">
    ${renderTargetEditor()}
    ${!loading && !errorMessage && projects.length === 0 ? `<div class="inline-state unconfigured"><b>i</b><span>${escapeHtml(TRAY_SETTINGS_HINT)}</span></div>` : ""}
    ${!loading && !errorMessage && activeProject() && !activeProject()?.sourceIds.some((id) => sources.find((item) => item.id === id)?.capabilities.includes("write")) ? `<div class="inline-state error" role="alert"><b>!</b><span>当前项目不支持写入；当前输入会保留。</span></div>` : ""}
    ${errorMessage ? `<div class="inline-state error" role="alert"><b>!</b><span>${escapeHtml(errorMessage)}</span></div>` : ""}
    ${successReceipt?.ok ? `<section class="saved-confirmation" role="status">
      <header><b>✓ 刚刚保存的原文</b><span>${escapeHtml(locationLabel(successReceipt.location))}</span></header>
      <blockquote>${escapeHtml(lastSavedContent)}</blockquote>
    </section>` : ""}
  </div>`;
}

function renderRecordActions(): string {
  const canWrite = canSubmitWrite(rawContent, relativePath, activeSource());
  return `<button id="record-submit" class="primary" type="submit" form="record-form" ${busy || !canWrite ? "disabled" : ""}>${busy ? "正在保存…" : errorMessage ? "重试保存" : "保存到知识库"}<kbd>Ctrl+Enter</kbd></button>`;
}

function renderExcerpt(result: KnowledgeResult): string {
  if (result.kind === "command") return `<pre class="command-block"><code>${escapeHtml(commandForClipboard(result.excerpt))}</code></pre>`;
  return `<blockquote class="evidence-text">${escapeHtml(result.excerpt)}</blockquote>`;
}

function resultKindLabel(result: KnowledgeResult): string {
  if (result.kind === "command") return "命令";
  if (result.kind === "task") return "待办";
  if (result.kind === "understanding") return "概念";
  if (result.kind === "decision") return "决策";
  return "原文";
}

function renderResult(result: KnowledgeResult, index: number): string {
  const canLocate = sourceForResult(result)?.capabilities.includes("locate") ?? false;
  const dangerous = result.kind === "command" && isDangerous(commandForClipboard(result.excerpt));
  const selected = index === selectedResultIndex;
  return `<article class="result-card ${selected ? "selected" : ""}" data-result-index="${index}" data-id="${escapeHtml(result.id)}" data-risk-return="result-card" tabindex="${selected ? "0" : "-1"}" ${selected ? 'aria-current="true"' : ""}>
    <header class="result-heading"><div><span class="evidence-label">知识库原文</span><h2>${escapeHtml(result.title)}</h2></div><span class="result-kind">${resultKindLabel(result)}</span></header>
    ${renderExcerpt(result)}
    ${result.contextBefore || result.contextAfter ? `<details class="context-details"><summary>展开必要上下文</summary>${result.contextBefore ? `<div><b>前文</b><p>${escapeHtml(result.contextBefore)}</p></div>` : ""}${result.contextAfter ? `<div><b>后文</b><p>${escapeHtml(result.contextAfter)}</p></div>` : ""}</details>` : ""}
    <p class="source-line">${escapeHtml(locationLabel(result.location))}<br><span>${escapeHtml(sourceVersion(result.location))}</span></p>
    ${dangerous ? `<p class="risk-note">${escapeHtml(riskImpact(commandForClipboard(result.excerpt)))}</p>` : ""}
    <footer class="result-actions">
      <button class="primary" data-action="copy" data-id="${escapeHtml(result.id)}" data-risk-return="copy-button">${result.kind === "command" ? "复制命令" : "复制原文"}${dangerous ? " · 需确认" : ""}</button>
      <button data-action="${canLocate ? "locate" : "copy-location"}" data-id="${escapeHtml(result.id)}">${canLocate ? "打开原文" : "复制定位"}</button>
    </footer>
  </article>`;
}

function renderQueryState(): string {
  if (loading) return `<div class="query-state" role="status"><b>正在连接知识源…</b><span>连接完成前不会发送问题。</span></div>`;
  if (!projects.length && !errorMessage) return `<div class="query-state" role="note"><span>${escapeHtml(TRAY_SETTINGS_HINT)}</span></div>`;
  if (errorMessage) return `<div class="query-state error" role="alert"><b>项目访问失败</b><span>${escapeHtml(errorMessage)} 问题已保留。</span></div>`;
  if (busy) return `<div class="query-state" role="status"><b>正在查询知识源…</b><span>问题会保留到查询完成。</span></div>`;
  if (results.length) return `<div class="results" aria-label="查询结果">${results.map(renderResult).join("")}</div>`;
  if (hasSearched) return `<div class="query-state"><b>未找到相关原文</b><span>可修改问题后重试，或按知识源定位自行查找。</span></div>`;
  return `<div class="query-spacer" aria-hidden="true"></div>`;
}

function renderQueryInput(): string {
  return `<form id="query-form" class="intent-form query-form">
    <label for="query-input">现在遇到什么问题？</label>
    <textarea id="query-input" rows="2" maxlength="500" required placeholder="例如：我以前怎么理解 Adam 的一阶矩？" ${busy ? "disabled" : ""}>${escapeHtml(query)}</textarea>
  </form>`;
}

function renderQueryActions(): string {
  const canSearch = Boolean(activeSource()?.capabilities.includes("search"));
  return `<button id="query-submit" class="primary" type="submit" form="query-form" ${loading || busy || !canSearch || !query.trim() ? "disabled" : ""}>${busy ? "查询中…" : errorMessage ? "重试查询" : "查询"}<kbd>Enter</kbd></button>`;
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
    <header class="app-header"><strong>AP</strong><span class="product-name">Action Pocket</span><span class="source-status ${source ? "ready" : ""}">${loading ? "连接中" : source?.name ?? "未配置"}</span>${isDesktopRuntime() ? `<button class="pin-button ${windowPinned ? "active" : ""}" data-action="toggle-window-pin" aria-pressed="${windowPinned}" title="${windowPinned ? "取消窗口置顶" : "窗口置顶"}"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 3h6l-1 5 3 3v1H5v-1l3-3-1-5Zm3 9v5"/></svg></button>` : ""}</header>
    <div class="shell-top">
      ${renderTabs()}
      ${renderProjectSwitcher()}
      ${mode === "record" ? renderRecordInput() : renderQueryInput()}
    </div>
    <section class="shell-body">
      ${mode === "record" ? renderRecordBody() : renderQueryState()}
    </section>
    <div class="panel-actions">${mode === "record" ? renderRecordActions() : renderQueryActions()}</div>
    <div class="toast-region" aria-live="polite"></div>${renderRiskModal()}
  </main>`;
}

function updateDraft(): void {
  saveDraft({
    rawContent,
    projectId,
    sourceId,
    relativePath: relativePathExplicit ? relativePath : "",
    relativePathExplicit,
  });
}

function restoreProjectDraft(nextProjectId: string): void {
  const incoming = loadProjectDraft(nextProjectId);
  projectId = nextProjectId;
  rawContent = incoming.rawContent;
  const project = activeProject();
  sourceId = project?.sourceIds.includes(incoming.sourceId) ? incoming.sourceId : project?.defaultSourceId ?? "";
  relativePath = incoming.relativePathExplicit ? incoming.relativePath : "";
  relativePathExplicit = incoming.relativePathExplicit;
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

function focusSelectedResult(): void {
  focusTarget(root.querySelector<HTMLElement>(`[data-result-index="${selectedResultIndex}"]`));
}

function closeRiskModal(): void {
  const returnTarget = riskReturnTarget;
  riskResultId = "";
  riskReturnTarget = null;
  clipboardError = "";
  render();
  requestAnimationFrame(() => focusRiskReturnTarget(root.querySelectorAll<HTMLElement>("[data-risk-return]"), returnTarget));
}

async function copyResult(result: KnowledgeResult, confirmed = false, returnKind: RiskReturnKind = "copy-button"): Promise<void> {
  const value = result.kind === "command" ? commandForClipboard(result.excerpt) : result.excerpt;
  if (!confirmed && result.kind === "command" && isDangerous(value)) {
    riskResultId = result.id;
    riskReturnTarget = { resultId: result.id, kind: returnKind };
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

function resultLocator(result: KnowledgeResult): string {
  return `${activeProject()?.name ?? projectId} · ${result.location.sourceId} · ${locationLabel(result.location)} · ${sourceVersion(result.location)}`;
}

async function copyResultLocation(result: KnowledgeResult): Promise<void> {
  try {
    await writeClipboard(resultLocator(result));
    showToast("原文定位已复制");
  } catch (error) {
    showToast(`复制定位失败：${error instanceof Error ? error.message : "请重试"}`);
  }
}

async function locateResult(result: KnowledgeResult): Promise<void> {
  try {
    await locateKnowledge({ projectId, sourceId: result.location.sourceId, documentId: result.location.documentId });
    showToast("已在文件管理器中定位原文");
  } catch (error) {
    const message = error instanceof Error ? error.message : "请复制定位后手动打开";
    showToast(`打开原文失败：${message}`);
  }
}

// A derived default such as today's journal is computed by the source at fetch time, so a long-lived
// session must refresh it before writing instead of reusing the path fetched at startup.
async function refreshSourceDefaults(): Promise<void> {
  if (relativePathExplicit) return;
  try {
    const fresh = await listSources();
    if (fresh.length) sources = fresh;
  } catch { /* keep the descriptors already loaded */ }
}

async function submitRecord(): Promise<void> {
  const source = activeSource();
  if (!canSubmitWrite(rawContent, relativePath, source) || !projectId) return;
  const contentToSave = rawContent;
  updateDraft();
  busy = true; errorMessage = ""; successReceipt = null; render();
  try {
    await refreshSourceDefaults();
    const targetPath = effectiveTargetPath();
    if (!targetPath) throw new Error("未设置写入位置。");
    const receipt = await writeKnowledge({ rawContent: contentToSave, projectId, target: { sourceId, relativePath: targetPath } });
    if (!receipt.ok) throw new Error(receipt.message);
    successReceipt = receipt;
    lastSavedContent = contentToSave;
    // Keep an explicit target so the next entry still lands where the user chose; only the body is cleared.
    rawContent = "";
    updateDraft();
  } catch (error) {
    errorMessage = error instanceof Error ? `写入失败：${error.message} 输入已保留。` : "写入失败，输入已保留。";
    updateDraft();
  } finally { busy = false; render(); }
}

async function submitQuery(): Promise<void> {
  const explicitRoute = applyExplicitMode(localRoute(query), "query");
  // Local lexical matching treats inferred intent as too lossy; source-native retrieval may use it as a routing hint.
  searchIntent = activeSource()?.searchMode === "source" ? explicitRoute.intent ?? "find" : "find";
  busy = true; errorMessage = ""; successReceipt = null; hasSearched = true; render();
  try {
    if (!query.trim() || !projectId || !activeSource()?.capabilities.includes("search")) return;
    results = await searchKnowledge({ query, projectId, sourceId, limit: 5, intent: searchIntent });
    selectedResultIndex = 0;
  }
  catch (error) { results = []; errorMessage = error instanceof Error ? error.message : "查询失败。"; }
  finally {
    busy = false; render();
    if (results.length) requestAnimationFrame(focusSelectedResult);
  }
}

function selectMode(nextMode: Mode): void {
  mode = nextMode;
  const capability = mode === "record" ? "write" : "search";
  if (!activeSource()?.capabilities.includes(capability)) {
    const allowed = new Set(activeProject()?.sourceIds ?? []);
    sourceId = sources.find((source) => allowed.has(source.id) && source.capabilities.includes(capability))?.id ?? "";
  }
  if (activeSource()) errorMessage = "";
  else if (!errorMessage && sources.length) errorMessage = `已连接的知识源不支持${mode === "record" ? "写入" : "检索"}。`;
  successReceipt = null; updateDraft(); render();
}

function syncSubmitButtons(): void {
  const recordButton = root.querySelector<HTMLButtonElement>("#record-submit");
  if (recordButton) recordButton.disabled = busy || !canSubmitWrite(rawContent, relativePath, activeSource());
  const queryButton = root.querySelector<HTMLButtonElement>("#query-submit");
  if (queryButton) queryButton.disabled = loading || busy || !query.trim() || !activeSource()?.capabilities.includes("search");
}

root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (input.id === "raw-content") { rawContent = input.value; updateDraft(); }
  if (input.id === "relative-path") { relativePath = input.value; relativePathExplicit = true; updateDraft(); }
  if (input.id === "query-input") query = input.value;
  syncSubmitButtons();
});

root.addEventListener("change", (event) => {
  const input = event.target as HTMLSelectElement;
  if (input.id === "project-select") {
    updateDraft();
    restoreProjectDraft(input.value);
    results = []; hasSearched = false; selectedResultIndex = 0; errorMessage = "";
    updateDraft(); render();
    return;
  }
  if (input.id !== "source-select") return;
  sourceId = input.value;
  relativePath = "";
  relativePathExplicit = false;
  updateDraft(); render();
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) return;
  if ((event.target as HTMLFormElement).id === "record-form" && canSubmitWrite(rawContent, relativePath, activeSource())) void submitRecord();
  if ((event.target as HTMLFormElement).id === "query-form" && query.trim() && activeSource()?.capabilities.includes("search")) void submitQuery();
});

root.addEventListener("focusin", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-result-index]");
  if (card) selectedResultIndex = Number(card.dataset.resultIndex) || 0;
});

root.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const result = results.find((item) => item.id === button.dataset.id);
  if (action === "mode") selectMode(button.dataset.mode === "record" ? "record" : "query");
  else if (action === "edit-target") { editingTarget = !editingTarget; render(); }
  else if (action === "toggle-window-pin") void toggleDesktopPin().catch((error) => showToast(`置顶切换失败：${String(error)}`));
  else if (action === "locate" && result) void locateResult(result);
  else if (action === "copy-location" && result) void copyResultLocation(result);
  else if (action === "copy" && result) void copyResult(result, false, "copy-button");
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
  if (event.key === "Escape" && isDesktopRuntime()) { void hideDesktopWindow(); return; }
  const target = event.target as HTMLElement;
  const resultAction = mode === "query" && results.length && target.closest(".results") ? resultKeyboardAction(event.key) : undefined;
  if (resultAction === "previous" || resultAction === "next") {
    const nextIndex = nextResultIndex(selectedResultIndex, results.length, resultAction);
    if (nextIndex !== undefined) {
      event.preventDefault();
      selectedResultIndex = nextIndex;
      root.querySelectorAll<HTMLElement>("[data-result-index]").forEach((card, index) => {
        card.classList.toggle("selected", index === selectedResultIndex);
        card.tabIndex = index === selectedResultIndex ? 0 : -1;
        if (index === selectedResultIndex) card.setAttribute("aria-current", "true"); else card.removeAttribute("aria-current");
      });
      focusSelectedResult();
    }
    return;
  }
  if (resultAction === "primary" && target.matches(".result-card")) {
    const result = results[selectedResultIndex];
    if (result) { event.preventDefault(); void copyResult(result, false, "result-card"); }
    return;
  }
  if (mode === "record" && event.key === "Enter" && (event.ctrlKey || event.metaKey) && !busy) {
    const form = root.querySelector<HTMLFormElement>("#record-form");
    if (canSubmitWrite(rawContent, relativePath, activeSource()) && form?.reportValidity()) { event.preventDefault(); void submitRecord(); }
  }
  if (mode === "query" && event.key === "Enter" && !event.shiftKey && !busy && document.activeElement?.id === "query-input") {
    const form = root.querySelector<HTMLFormElement>("#query-form");
    if (activeSource()?.capabilities.includes("search") && form?.reportValidity()) { event.preventDefault(); void submitQuery(); }
  }
});

async function initialize(): Promise<void> {
  render();
  try {
    const [sourceList, projectList] = await Promise.all([listSources(), listProjects()]);
    sources = sourceList;
    projects = projectList.projects;
    if (!projects.some((project) => project.id === projectId)) {
      restoreProjectDraft(projectList.activeProjectId ?? projects[0]?.id ?? "");
    }
    const project = activeProject();
    const requiredCapability = mode === "record" ? "write" : "search";
    const selected = activeSource();
    if (!selected?.capabilities.includes(requiredCapability)) {
      sourceId = project?.sourceIds.map((id) => sources.find((source) => source.id === id)).find((source) => source?.capabilities.includes(requiredCapability))?.id ?? project?.defaultSourceId ?? "";
    }
    updateDraft();
    if (!activeSource() && projects.length) errorMessage = `当前项目不支持${mode === "record" ? "写入" : "检索"}。`;
  } catch (error) { errorMessage = error instanceof Error ? error.message : "无法连接知识源。"; }
  finally { loading = false; render(); }
}

initializeDesktopRuntime({
  onPinnedChange(value) { windowPinned = value; render(); },
  onError(message) { showToast(message); },
});
void initialize();
