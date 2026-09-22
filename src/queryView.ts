import { icon } from "./icons.js";
import { TRAY_SETTINGS_HINT } from "./layout.js";
import { renderRichText } from "./richText.js";
import { commandForClipboard, isDangerous, riskImpact } from "./search.js";
import type { KnowledgeResult, KnowledgeSearchResults, SourceDescriptor, SourceLocation } from "./knowledge/types.js";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function locationLabel(location: SourceLocation): string {
  const anchor = location.line ? `第 ${location.line} 行` : location.blockId ? `块 ${location.blockId}` : "位置未提供";
  return `${location.path} · ${anchor}`;
}

export function sourceVersion(location: SourceLocation): string {
  return location.version ? `来源版本 ${location.version}` : "来源未提供版本";
}

function renderExcerpt(result: KnowledgeResult): string {
  if (result.kind === "command") return `<pre class="command-block"><code>${escapeHtml(commandForClipboard(result.excerpt))}</code></pre>`;
  return `<div class="evidence-text markdown-body">${renderRichText(result.excerpt)}</div>`;
}

function resultKindLabel(result: KnowledgeResult): string {
  if (result.kind === "command") return "命令";
  if (result.kind === "task") return "待办";
  if (result.kind === "understanding") return "概念";
  if (result.kind === "decision") return "决策";
  return "原文";
}

function renderResult(result: KnowledgeResult, index: number, sources: SourceDescriptor[], selectedResultIndex: number): string {
  const canLocate = sources.find((source) => source.id === result.location.sourceId)?.capabilities.includes("locate") ?? false;
  const dangerous = result.kind === "command" && isDangerous(commandForClipboard(result.excerpt));
  const selected = index === selectedResultIndex;
  return `<article class="result-card ${selected ? "selected" : ""}" data-result-index="${index}" data-id="${escapeHtml(result.id)}" data-risk-return="result-card" tabindex="${selected ? "0" : "-1"}" ${selected ? 'aria-current="true"' : ""}>
    <header class="result-heading"><div><span class="evidence-label">${icon("file")}<span>知识库原文</span></span><h2>${escapeHtml(result.title)}</h2></div><span class="result-kind">${resultKindLabel(result)}</span></header>
    ${renderExcerpt(result)}
    ${result.contextBefore || result.contextAfter ? `<details class="context-details"><summary>展开必要上下文</summary>${result.contextBefore ? `<div><b>前文</b><section class="markdown-body">${renderRichText(result.contextBefore)}</section></div>` : ""}${result.contextAfter ? `<div><b>后文</b><section class="markdown-body">${renderRichText(result.contextAfter)}</section></div>` : ""}</details>` : ""}
    <p class="source-line">${escapeHtml(locationLabel(result.location))}<br><span>${escapeHtml(sourceVersion(result.location))}</span></p>
    ${dangerous ? `<p class="risk-note">${escapeHtml(riskImpact(commandForClipboard(result.excerpt)))}</p>` : ""}
    <footer class="result-actions">
      <button class="primary" data-action="copy" data-id="${escapeHtml(result.id)}" data-risk-return="copy-button">${icon("copy")}<span>${result.kind === "command" ? "复制命令" : "复制原文"}${dangerous ? " · 需确认" : ""}</span></button>
      <button data-action="${canLocate ? "locate" : "copy-location"}" data-id="${escapeHtml(result.id)}">${icon(canLocate ? "open" : "copy")}<span>${canLocate ? "打开原文" : "复制定位"}</span></button>
    </footer>
  </article>`;
}

export function renderQueryState(state: { loading: boolean; projectCount: number; errorMessage: string; busy: boolean; results: KnowledgeSearchResults; hasSearched: boolean; sources: SourceDescriptor[]; selectedResultIndex: number }): string {
  const { loading, projectCount, errorMessage, busy, results, hasSearched, sources, selectedResultIndex } = state;
  if (loading) return `<div class="query-state" role="status"><b>正在连接知识源…</b><span>连接完成前不会发送问题。</span></div>`;
  if (!projectCount && !errorMessage) return `<div class="query-state" role="note"><span>${escapeHtml(TRAY_SETTINGS_HINT)}</span></div>`;
  if (errorMessage) return `<div class="query-state error" role="alert"><b>项目访问失败</b><span>${escapeHtml(errorMessage)} 问题已保留。</span></div>`;
  if (busy) return `<div class="query-state" role="status"><b>正在查询知识源…</b><span>问题会保留到查询完成。</span></div>`;
  const warnings = renderSearchWarnings(results);
  if (results.length) return `${warnings}<div class="results" aria-label="查询结果">${results.map((result, index) => renderResult(result, index, sources, selectedResultIndex)).join("")}</div>`;
  if (hasSearched) return `${warnings}<div class="query-state"><b>未找到相关原文</b><span>可修改问题后重试，或按知识源定位自行查找。</span></div>`;
  return `<div class="query-spacer" aria-hidden="true"></div>`;
}

export function renderRiskModal(results: KnowledgeSearchResults, riskResultId: string, clipboardError: string): string {
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

export function renderSearchWarnings(results: KnowledgeSearchResults): string {
  return (results.warnings ?? []).map((warning) =>
    `<div class="inline-state unconfigured" role="status"><b>!</b><span>${escapeHtml(warning)}</span></div>`
  ).join("");
}
