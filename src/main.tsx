import "./styles.css";
import { listSources, searchKnowledge, writeKnowledge } from "./knowledge/client";
import type { KnowledgeResult, SourceDescriptor, SourceLocation, WriteReceipt } from "./knowledge/types";
import { clearDraft, loadDraft, saveDraft } from "./draftStore";
import { focusTarget, modalKeyboardAction, wrappedFocusIndex } from "./focusTrap";
import { feedbackForLocation, loadPreferences, locationKey, savePreferences, setFeedback, togglePin } from "./preferenceStore";
import { commandForClipboard, detectRisk, isDangerous } from "./search";

type Mode = "record" | "query";

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
let errorMessage = "";
let successReceipt: WriteReceipt | null = null;
let riskResultId = "";
let riskReturnResultId = "";
let toastTimer = 0;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function activeSource(): SourceDescriptor | undefined {
  return sources.find((source) => source.id === sourceId);
}

function locationLabel(location: SourceLocation): string {
  return `${location.path}${location.line ? `:${location.line}` : ""}`;
}

function pinFor(location: SourceLocation) {
  const key = locationKey(location);
  return preferences.pins.find((pin) => locationKey(pin.location) === key);
}

function renderModeTabs(): string {
  return `<div class="mode-tabs" role="tablist" aria-label="选择意图">
    <button type="button" role="tab" aria-selected="${mode === "record"}" class="${mode === "record" ? "active" : ""}" data-action="mode" data-mode="record">记入</button>
    <button type="button" role="tab" aria-selected="${mode === "query"}" class="${mode === "query" ? "active" : ""}" data-action="mode" data-mode="query">查询</button>
  </div>`;
}

function renderPinnedReferences(): string {
  if (!preferences.pins.length) return "";
  return `<aside class="pinned-references"><div><strong>已固定来源</strong><small>仅保存定位；重新查询后查看最新正文</small></div>${preferences.pins.map((pin) => `<span><code>${escapeHtml(pin.location.sourceId)} / ${escapeHtml(locationLabel(pin.location))}</code><button data-action="unpin" data-key="${escapeHtml(locationKey(pin.location))}">取消固定</button></span>`).join("")}</aside>`;
}

function renderSourceSelect(requireWrite = false): string {
  const eligible = sources.filter((source) => !requireWrite || source.capabilities.includes("write"));
  return `<label class="field compact"><span>知识源</span><select id="source-select" ${busy || !eligible.length ? "disabled" : ""}>
    ${eligible.map((source) => `<option value="${escapeHtml(source.id)}" ${source.id === sourceId ? "selected" : ""}>${escapeHtml(source.name)}</option>`).join("")}
  </select></label>`;
}

function renderRecord(): string {
  const source = activeSource();
  const canWrite = source?.capabilities.includes("write") ?? false;
  return `<form id="record-form" class="intent-panel">
    <div class="intent-heading"><div><span class="eyebrow">原始记录</span><h1>保存到已有知识源</h1></div><span class="privacy">正文不存入浏览器资料库</span></div>
    <label class="field"><span>原始内容</span><textarea id="raw-content" maxlength="262144" rows="7" required placeholder="粘贴文字或 AI 对话；写入时保持原文，不自动拆卡。" ${busy ? "disabled" : ""}>${escapeHtml(rawContent)}</textarea><small>临时草稿会保存在本机浏览器；真正写入成功后才清除。</small></label>
    <div class="target-grid">${renderSourceSelect(true)}<label class="field compact"><span>知识源内位置</span><input id="relative-path" value="${escapeHtml(relativePath || source?.defaultWritePath || "")}" maxlength="240" required placeholder="journals/2025_01_01.md" ${busy ? "disabled" : ""}/></label></div>
    <p class="target-note">明确写入：<strong>${escapeHtml(source?.name ?? "未配置")}</strong> / <code>${escapeHtml(relativePath || source?.defaultWritePath || "请选择位置")}</code></p>
    <button class="primary" type="submit" ${busy || !canWrite ? "disabled" : ""}>${busy ? "正在写入并校验…" : "确认记入"}</button>
  </form>`;
}

function renderResult(result: KnowledgeResult): string {
  const pinned = pinFor(result.location);
  const stale = Boolean(pinned && pinned.sourceVersion && pinned.sourceVersion !== result.location.version);
  const savedFeedback = preferences.feedback.find((item) => locationKey(item.location) === locationKey(result.location));
  const feedback = feedbackForLocation(preferences, result.location);
  const feedbackStale = Boolean(savedFeedback && !feedback);
  const risk = result.kind === "command" ? detectRisk(commandForClipboard(result.excerpt)) : "low";
  return `<article class="result-card">
    <div class="result-heading"><div><span class="kind ${result.kind}">${result.kind === "command" ? "命令原文" : result.kind === "understanding" ? "理解片段" : "原文摘录"}</span><h2>${escapeHtml(result.title)}</h2></div><button class="icon-button ${pinned ? "active" : ""}" data-action="pin" data-id="${escapeHtml(result.id)}" aria-label="${pinned ? "取消固定" : "固定此来源引用"}" title="${pinned ? "取消固定" : "固定"}">★</button></div>
    ${stale ? `<p class="stale">来源版本已变化；此固定引用不可视为最新正文。</p>` : ""}
    ${feedbackStale ? `<p class="stale">来源已变化；请重新确认这段内容是否有用。</p>` : ""}
    <pre class="excerpt"><code>${escapeHtml(result.excerpt)}</code></pre>
    ${result.contextBefore || result.contextAfter ? `<details><summary>展开相邻原文上下文</summary>${result.contextBefore ? `<div class="context"><b>前一段</b><pre>${escapeHtml(result.contextBefore)}</pre></div>` : ""}${result.contextAfter ? `<div class="context"><b>后一段</b><pre>${escapeHtml(result.contextAfter)}</pre></div>` : ""}</details>` : ""}
    <div class="source-line"><span title="来源版本 ${escapeHtml(result.location.version ?? "未知")}">来源：${escapeHtml(result.location.sourceId)} / ${escapeHtml(locationLabel(result.location))}</span><button data-action="locate" data-id="${escapeHtml(result.id)}">复制原文定位</button></div>
    <div class="result-actions"><span class="derived">派生提示：词法匹配分 ${result.score ?? 0}</span><button class="quiet ${feedback?.value === "useful" ? "active" : ""}" data-action="useful" data-id="${escapeHtml(result.id)}">有用</button>${result.kind === "command" ? `<button class="copy" data-action="copy" data-id="${escapeHtml(result.id)}">${risk === "low" ? "复制命令" : "确认后复制"}</button>` : ""}</div>
  </article>`;
}

function renderQuery(): string {
  const source = activeSource();
  return `<section class="intent-panel">
    <form id="query-form"><div class="intent-heading"><div><span class="eyebrow">找回原文</span><h1>用自然语言查询</h1></div><span class="limit">最多 5 条</span></div>
      <div class="query-row"><input id="query-input" type="search" maxlength="500" required value="${escapeHtml(query)}" placeholder="例如：Docker 怎么清理未使用镜像？" ${busy ? "disabled" : ""}/><button class="primary" type="submit" ${busy || !source ? "disabled" : ""}>${busy ? "查询中…" : "查询"}</button></div>
      <div class="query-meta">${renderSourceSelect()}<p>${escapeHtml(source?.searchDescription ?? "请先配置知识源")}</p></div>
    </form>
    ${renderPinnedReferences()}
    <div class="results" aria-live="polite">${!query && !results.length ? `<div class="empty"><strong>找回你保存过的内容</strong><span>结果来自知识源，不生成新的聊天答案。</span></div>` : results.length ? results.map(renderResult).join("") : !busy && !errorMessage ? `<div class="empty"><strong>没有找到有依据的片段</strong><span>可换用原文里的关键词；当前不会用生成内容掩盖检索缺口。</span></div>` : ""}</div>
  </section>`;
}

function renderRiskModal(): string {
  const result = results.find((item) => item.id === riskResultId);
  if (!result) return "";
  const command = commandForClipboard(result.excerpt);
  return `<div class="modal-backdrop"><section class="risk-modal" role="alertdialog" aria-modal="true" aria-labelledby="risk-title"><div class="risk-mark">!</div><span class="eyebrow danger">${detectRisk(command) === "critical" ? "极高风险" : "高风险"}</span><h2 id="risk-title">复制前确认</h2><p>内容可能删除、覆盖或大范围修改数据。Action Pocket 只会复制，绝不执行。</p><pre><code>${escapeHtml(command)}</code></pre><footer><button data-action="close-risk" data-risk-initial-focus>取消</button><button class="danger-button" data-action="confirm-copy" data-id="${escapeHtml(result.id)}">仍然复制</button></footer></section></div>`;
}

function render(): void {
  root.innerHTML = `<main class="pocket"><header class="app-header"><div class="brand-mark">AP</div><div><strong>Action Pocket</strong><span>知识随手记，需要时拿出来</span></div><span class="connection ${sources.length ? "ready" : ""}">${loading ? "连接中" : sources.length ? "本机知识源" : "未配置"}</span></header>
    ${renderModeTabs()}
    ${errorMessage ? `<div class="notice error" role="alert">${escapeHtml(errorMessage)}</div>` : ""}
    ${successReceipt?.ok ? `<div class="notice success">已写入并校验：${escapeHtml(locationLabel(successReceipt.location))}</div>` : ""}
    ${mode === "record" ? renderRecord() : renderQuery()}
    <footer class="app-footer">开发态本机 API · 不执行命令 · 原文以知识源为准</footer>
    <div class="toast-region" aria-live="polite"></div>${renderRiskModal()}</main>`;
}

function updateDraft(): void {
  saveDraft({ rawContent, sourceId, relativePath });
}

function focusRiskModal(): void {
  requestAnimationFrame(() => focusTarget(root.querySelector<HTMLElement>("[data-risk-initial-focus]")));
}

function restoreRiskTrigger(): void {
  const resultId = riskReturnResultId;
  riskReturnResultId = "";
  requestAnimationFrame(() => focusTarget([...root.querySelectorAll<HTMLElement>('[data-action="copy"]')].find((button) => button.dataset.id === resultId)));
}

function closeRiskModal(): void {
  riskResultId = "";
  render();
  restoreRiskTrigger();
}

function showToast(message: string): void {
  const region = root.querySelector(".toast-region");
  if (!region) return;
  region.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { region.innerHTML = ""; }, 1800);
}

async function writeClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function copyResult(result: KnowledgeResult, confirmed = false): Promise<void> {
  const command = commandForClipboard(result.excerpt);
  if (!confirmed && isDangerous(command)) {
    riskResultId = result.id;
    riskReturnResultId = result.id;
    render();
    focusRiskModal();
    return;
  }
  await writeClipboard(command);
  if (riskResultId) {
    closeRiskModal();
  } else {
    render();
  }
  showToast("已复制；未执行任何命令");
}

async function submitRecord(): Promise<void> {
  busy = true;
  errorMessage = "";
  successReceipt = null;
  render();
  try {
    const receipt = await writeKnowledge({ rawContent, target: { sourceId, relativePath } });
    if (!receipt.ok) throw new Error(receipt.message);
    successReceipt = receipt;
    rawContent = "";
    clearDraft();
  } catch (error) {
    errorMessage = error instanceof Error ? `保存失败：${error.message} 草稿已保留。` : "保存失败，草稿已保留。";
    updateDraft();
  } finally {
    busy = false;
    render();
  }
}

async function submitQuery(): Promise<void> {
  busy = true;
  errorMessage = "";
  successReceipt = null;
  render();
  try {
    results = await searchKnowledge({ query, sourceId, limit: 5 });
  } catch (error) {
    results = [];
    errorMessage = error instanceof Error ? error.message : "查询失败。";
  } finally {
    busy = false;
    render();
  }
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
  const source = activeSource();
  if (mode === "record" && !relativePath) relativePath = source?.defaultWritePath ?? "";
  updateDraft();
  render();
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
  if (action === "mode") {
    mode = button.dataset.mode === "record" ? "record" : "query";
    const requiredCapability = mode === "record" ? "write" : "search";
    if (!activeSource()?.capabilities.includes(requiredCapability)) {
      sourceId = sources.find((source) => source.capabilities.includes(requiredCapability))?.id ?? "";
      if (mode === "record") relativePath = activeSource()?.defaultWritePath ?? relativePath;
    }
    errorMessage = "";
    successReceipt = null;
    updateDraft();
    render();
  } else if (action === "pin" && result) {
    const pinned = togglePin(preferences, result.location);
    savePreferences(preferences);
    render();
    showToast(pinned ? "已固定来源引用" : "已取消固定");
  } else if (action === "unpin") {
    const pin = preferences.pins.find((item) => locationKey(item.location) === button.dataset.key);
    if (pin) {
      togglePin(preferences, pin.location);
      savePreferences(preferences);
      render();
      showToast("已取消固定");
    }
  } else if (action === "useful" && result) {
    setFeedback(preferences, result.location, "useful");
    savePreferences(preferences);
    render();
    showToast("已记录为有用（仅保存来源引用）");
  } else if (action === "locate" && result) {
    void writeClipboard(`${result.location.sourceId} / ${locationLabel(result.location)}`).then(() => showToast("原文定位已复制"));
  } else if (action === "copy" && result) {
    void copyResult(result);
  } else if (action === "confirm-copy" && result) {
    void copyResult(result, true);
  } else if (action === "close-risk") {
    closeRiskModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (!riskResultId) return;
  const action = modalKeyboardAction(event.key);
  if (action === "close") {
    event.preventDefault();
    closeRiskModal();
    return;
  }
  if (action !== "trap-focus") return;
  const focusable = [...root.querySelectorAll<HTMLElement>(".risk-modal button:not([disabled])")];
  const nextIndex = wrappedFocusIndex(focusable.indexOf(document.activeElement as HTMLElement), focusable.length, event.shiftKey);
  if (nextIndex === undefined) return;
  event.preventDefault();
  focusable[nextIndex]?.focus();
});

async function initialize(): Promise<void> {
  render();
  try {
    sources = await listSources();
    const selected = sources.find((source) => source.id === sourceId);
    if (!selected || (mode === "record" && !selected.capabilities.includes("write"))) {
      sourceId = (mode === "record" ? sources.find((source) => source.capabilities.includes("write")) : sources[0])?.id ?? "";
    }
    if (!relativePath) relativePath = activeSource()?.defaultWritePath ?? "";
    if (!sources.length) errorMessage = "未配置知识源。请用 AP_GRAPH_DIR 指定 Graph 目录并运行 npm run dev。";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "无法连接本地知识源。";
  } finally {
    loading = false;
    render();
  }
}

void initialize();
