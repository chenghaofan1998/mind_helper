import "./styles.css";
import { extractCards } from "./extractor";
import { detectRisk, searchCards } from "./search";
import { createId, loadState, saveState } from "./store";
import type { Category, KnowledgeCard, RiskLevel, Scene } from "./types";

type ModalType = "import" | "edit" | "settings" | "risk" | null;
type AdminTab = "import" | "organize";

interface NeutralinoApi {
  init: () => void;
  clipboard?: { writeText: (value: string) => Promise<unknown> };
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");
const root: HTMLElement = rootElement;

const neutralino = (window as unknown as { Neutralino?: NeutralinoApi }).Neutralino;
if (neutralino) neutralino.init();

let state = loadState();
let activeSceneId = state.scenes[0]?.id ?? "";
let activeCategoryId = "all";
let selectedCardId = "";
let query = "";
let modal: ModalType = null;
let editingCardId = "";
let riskCardId = "";
let toastTimer = 0;
let adminTab: AdminTab = "import";
let adminOpen = true;

const iconPaths: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path>',
  terminal: '<path d="m4 7 4 4-4 4M10 17h7"></path><rect x="2" y="3" width="20" height="18" rx="3"></rect>',
  branch: '<circle cx="6" cy="5" r="2"></circle><circle cx="18" cy="6" r="2"></circle><circle cx="6" cy="19" r="2"></circle><path d="M6 7v10M8 7c4 0 3 5 8 5h2M18 8v7a4 4 0 0 1-4 4H8"></path>',
  box: '<path d="m21 8-9 5-9-5 9-5 9 5Z"></path><path d="m3 8 9 5 9-5v9l-9 5-9-5V8Z"></path><path d="M12 13v9"></path>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m10 9 5 3-5 3V9Z"></path>',
  game: '<path d="M8 10h8a5 5 0 0 1 4.7 6.7l-.5 1.3a2 2 0 0 1-3.4.6L15 16H9l-1.8 2.6a2 2 0 0 1-3.4-.6l-.5-1.3A5 5 0 0 1 8 10Z"></path><path d="M8 13v4M6 15h4M16 14h.01M18 16h.01"></path>',
  checklist: '<rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="m8 9 1.5 1.5L12 8M14 9h3M8 15l1.5 1.5L12 14M14 15h3"></path>',
  code: '<path d="m9 18-6-6 6-6M15 6l6 6-6 6M14 3l-4 18"></path>',
  sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
  star: '<path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9L12 3Z"></path>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"></path>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  chevron: '<path d="m9 18 6-6-6-6"></path>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"></path>',
  alert: '<path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v4M12 17h.01"></path>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5M3 17l9 5 9-5"></path>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
};

function icon(name: string, size = 18, filled = false): string {
  const path = iconPaths[name] ?? iconPaths.layers;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}

function activeScene(): Scene {
  return state.scenes.find((scene) => scene.id === activeSceneId) ?? state.scenes[0];
}

function categoryById(id: string): Category | undefined {
  return state.categories.find((category) => category.id === id);
}

function cardsForScene(scene: Scene): KnowledgeCard[] {
  return state.cards.filter((card) => card.sceneIds.includes(scene.id) && scene.categoryIds.includes(card.categoryId));
}

function visibleCards(): KnowledgeCard[] {
  const scene = activeScene();
  let cards = cardsForScene(scene);
  if (activeCategoryId !== "all") cards = cards.filter((card) => card.categoryId === activeCategoryId);
  return searchCards(cards, query);
}

function persist(): void {
  saveState(state);
}

function riskLabel(risk: RiskLevel): string {
  return ({ low: "低风险", medium: "需留意", high: "高风险", critical: "极高风险" })[risk];
}

function kindLabel(card: KnowledgeCard): string {
  return ({ command: "命令", guide: "步骤", note: "要点", warning: "警告" })[card.kind];
}

function renderSceneButton(scene: Scene, index: number): string {
  const selected = scene.id === activeSceneId;
  const count = cardsForScene(scene).length;
  return `<button class="scene-button${selected ? " is-active" : ""}" data-action="scene" data-id="${escapeHtml(scene.id)}" aria-pressed="${selected}" style="--button-accent:${escapeHtml(scene.accent)}">
    <span class="scene-icon">${icon(scene.icon, 19)}</span>
    <span class="scene-copy"><strong>${escapeHtml(scene.name)}</strong><small>${escapeHtml(scene.description)}</small></span>
    <span class="scene-meta"><span>${count}</span><kbd>${index + 1}</kbd></span>
  </button>`;
}

function renderCategoryButton(category: Category, count: number): string {
  const selected = activeCategoryId === category.id;
  return `<button class="category-chip${selected ? " is-active" : ""}" data-action="category" data-id="${escapeHtml(category.id)}" aria-pressed="${selected}" style="--category-color:${escapeHtml(category.color)}">
    <span class="category-dot"></span>${icon(category.icon, 16)}<span>${escapeHtml(category.name)}</span><small>${count}</small>
  </button>`;
}

function renderCard(card: KnowledgeCard): string {
  const category = categoryById(card.categoryId);
  const selected = card.id === selectedCardId;
  const content = card.content.replace(/\s+/g, " ");
  return `<article class="knowledge-card${selected ? " is-selected" : ""}" data-action="select-card" data-id="${escapeHtml(card.id)}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(card.title)}">
    <div class="card-topline">
      <span class="kind-label">${kindLabel(card)}</span>
      ${card.riskLevel !== "low" ? `<span class="risk-badge risk-${card.riskLevel}">${icon("alert", 14)}${riskLabel(card.riskLevel)}</span>` : ""}
      <button class="icon-button favorite-button${card.isFavorite ? " is-active" : ""}" data-action="favorite" data-id="${escapeHtml(card.id)}" aria-label="${card.isFavorite ? "取消收藏" : "收藏"}">${icon("star", 17, card.isFavorite)}</button>
    </div>
    <h3>${escapeHtml(card.title)}</h3>
    <p>${escapeHtml(card.description)}</p>
    <code>${escapeHtml(content.length > 108 ? `${content.slice(0, 108)}…` : content)}</code>
    <footer>
      <span class="mini-category" style="--category-color:${escapeHtml(category?.color ?? "#60706A")}"><i></i>${escapeHtml(category?.name ?? "未分类")}</span>
      <span>${escapeHtml(card.source)}</span>
      <span class="card-arrow">${icon("chevron", 16)}</span>
    </footer>
  </article>`;
}

function renderDetail(card: KnowledgeCard | undefined): string {
  if (!card) {
    return `<aside class="detail-panel empty-detail" aria-label="内容预览">
      <div class="empty-illustration">${icon("layers", 30)}</div>
      <h2>选择一条资料</h2>
      <p>这里会显示完整内容、来源和可执行操作。</p>
    </aside>`;
  }
  const category = categoryById(card.categoryId);
  const scenes = card.sceneIds.map((id) => state.scenes.find((scene) => scene.id === id)?.name).filter(Boolean).join(" · ");
  return `<aside class="detail-panel" aria-label="内容预览">
    <div class="detail-header">
      <span class="detail-category" style="--category-color:${escapeHtml(category?.color ?? "#60706A")}">${icon(category?.icon ?? "layers", 17)}${escapeHtml(category?.name ?? "未分类")}</span>
      <button class="icon-button${card.isFavorite ? " is-active" : ""}" data-action="favorite" data-id="${escapeHtml(card.id)}" aria-label="${card.isFavorite ? "取消收藏" : "收藏"}">${icon("star", 18, card.isFavorite)}</button>
    </div>
    <div class="detail-scroll">
      <div class="detail-eyebrow"><span>${kindLabel(card)}</span><span class="risk-text risk-${card.riskLevel}">${riskLabel(card.riskLevel)}</span></div>
      <h2>${escapeHtml(card.title)}</h2>
      <p class="detail-description">${escapeHtml(card.description)}</p>
      <pre><code>${escapeHtml(card.content)}</code></pre>
      ${card.tags.length ? `<div class="tag-list">${card.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <dl class="detail-meta">
        <div><dt>出现于</dt><dd>${escapeHtml(scenes || "未加入场景")}</dd></div>
        <div><dt>来源</dt><dd>${escapeHtml(card.source)}</dd></div>
      </dl>
    </div>
    <div class="detail-actions">
      <button class="secondary-button" data-action="edit" data-id="${escapeHtml(card.id)}">${icon("edit", 17)}编辑</button>
      <button class="secondary-button danger-hover" data-action="delete" data-id="${escapeHtml(card.id)}" aria-label="删除资料">${icon("trash", 17)}</button>
      <button class="primary-button copy-button" data-action="copy" data-id="${escapeHtml(card.id)}">${icon("copy", 18)}复制内容 <kbd>Enter</kbd></button>
    </div>
  </aside>`;
}

function renderImportModal(): string {
  const scene = activeScene();
  return `<div class="modal-backdrop" data-action="close-modal">
    <section class="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" data-modal-panel>
      <header class="modal-header"><div><span class="eyebrow">ADD TO POCKET</span><h2 id="import-title">添加并整理资料</h2><p>粘贴命令、步骤或一段资料，系统会拆成可检索卡片。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("close", 20)}</button></header>
      <form id="import-form">
        <div class="form-grid">
          <label class="field"><span>资料标题 <small>可选</small></span><input name="title" placeholder="例如：服务器排查笔记" /></label>
          <label class="field"><span>默认分类</span><select name="categoryId"><option value="auto">自动识别</option>${state.categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>资料内容</span><textarea name="content" rows="10" required placeholder="粘贴网页正文、Markdown、教程步骤或命令…"></textarea><small>短内容保存为一张卡片；多行资料会自动拆分，最多 48 条。</small></label>
        <div class="field"><span>展示场景</span><div class="check-grid">${state.scenes.map((item) => `<label class="check-card"><input type="checkbox" name="sceneIds" value="${escapeHtml(item.id)}" ${item.id === scene.id ? "checked" : ""}/><span style="--check-accent:${escapeHtml(item.accent)}">${icon(item.icon, 17)}<b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description)}</small></span></label>`).join("")}</div></div>
        <label class="field"><span>来源 <small>可选</small></span><input name="source" placeholder="网页名称、文件名或个人笔记" /></label>
        <footer class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button">${icon("arrow", 18)}整理并保存</button></footer>
      </form>
    </section>
  </div>`;
}

function renderEditModal(card: KnowledgeCard): string {
  return `<div class="modal-backdrop" data-action="close-modal">
    <section class="modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title" data-modal-panel>
      <header class="modal-header"><div><span class="eyebrow">EDIT CARD</span><h2 id="edit-title">编辑资料</h2></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("close", 20)}</button></header>
      <form id="edit-form" data-id="${escapeHtml(card.id)}">
        <label class="field"><span>标题</span><input name="title" required value="${escapeHtml(card.title)}" /></label>
        <label class="field"><span>说明</span><input name="description" value="${escapeHtml(card.description)}" /></label>
        <label class="field"><span>完整内容</span><textarea name="content" rows="8" required>${escapeHtml(card.content)}</textarea></label>
        <div class="form-grid">
          <label class="field"><span>分类</span><select name="categoryId">${state.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === card.categoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select></label>
          <label class="field"><span>来源</span><input name="source" value="${escapeHtml(card.source)}" /></label>
        </div>
        <div class="field"><span>展示场景</span><div class="check-grid compact">${state.scenes.map((scene) => `<label class="check-card"><input type="checkbox" name="sceneIds" value="${escapeHtml(scene.id)}" ${card.sceneIds.includes(scene.id) ? "checked" : ""}/><span style="--check-accent:${escapeHtml(scene.accent)}">${icon(scene.icon, 17)}<b>${escapeHtml(scene.name)}</b></span></label>`).join("")}</div></div>
        <footer class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button">保存修改</button></footer>
      </form>
    </section>
  </div>`;
}

function renderSettingsModal(): string {
  return `<div class="modal-backdrop" data-action="close-modal">
    <section class="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-modal-panel>
      <header class="modal-header"><div><span class="eyebrow">ORGANIZE</span><h2 id="settings-title">分类与场景</h2><p>分类决定资料放在哪里；场景决定你切换时看见哪些分类。</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon("close", 20)}</button></header>
      <div class="settings-layout">
        <section><div class="section-heading"><div><h3>场景包含的分类</h3><p>勾选后，该分类会出现在对应场景中。</p></div></div>
          <div class="scene-config-list">${state.scenes.map((scene) => `<article class="scene-config" style="--config-accent:${escapeHtml(scene.accent)}"><header>${icon(scene.icon, 18)}<div><strong>${escapeHtml(scene.name)}</strong><small>${escapeHtml(scene.description)}</small></div></header><div class="toggle-grid">${state.categories.map((category) => `<label><input type="checkbox" data-scene-category data-scene-id="${escapeHtml(scene.id)}" data-category-id="${escapeHtml(category.id)}" ${scene.categoryIds.includes(category.id) ? "checked" : ""}/><span><i style="--category-color:${escapeHtml(category.color)}"></i>${escapeHtml(category.name)}</span></label>`).join("")}</div></article>`).join("")}</div>
        </section>
        <aside class="create-panel">
          <form id="scene-form"><h3>新建场景</h3><p>组合一组你会同时使用的分类。</p><label class="field"><span>场景名称</span><input name="name" required maxlength="14" placeholder="例如：服务器维护" /></label><button class="secondary-button full-width" type="submit">${icon("plus", 17)}新建场景</button></form>
          <form id="category-form"><h3>新建分类</h3><p>为新的知识主题留一个独立入口。</p><label class="field"><span>分类名称</span><input name="name" required maxlength="14" placeholder="例如：Kubernetes" /></label><button class="secondary-button full-width" type="submit">${icon("plus", 17)}新建分类</button></form>
        </aside>
      </div>
    </section>
  </div>`;
}

function renderRiskModal(card: KnowledgeCard): string {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal risk-modal" role="alertdialog" aria-modal="true" aria-labelledby="risk-title" data-modal-panel>
    <div class="risk-mark">${icon("alert", 28)}</div><span class="eyebrow">${riskLabel(card.riskLevel)}</span><h2 id="risk-title">复制前确认内容</h2><p>这条内容可能删除、覆盖或大范围修改数据。请确认目标环境和参数。</p><pre><code>${escapeHtml(card.content)}</code></pre><footer class="modal-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="danger-button" data-action="confirm-copy" data-id="${escapeHtml(card.id)}">仍然复制</button></footer>
  </section></div>`;
}

function renderModal(): string {
  if (modal === "edit") {
    const card = state.cards.find((item) => item.id === editingCardId);
    return card ? renderEditModal(card) : "";
  }
  if (modal === "risk") {
    const card = state.cards.find((item) => item.id === riskCardId);
    return card ? renderRiskModal(card) : "";
  }
  return "";
}

function renderAdminImport(scene: Scene): string {
  return `<form id="import-form" class="admin-form">
    <label class="field"><span>资料标题 <small>可选</small></span><input name="title" placeholder="例如：服务器排查笔记" /></label>
    <label class="field"><span>资料内容</span><textarea name="content" rows="10" required placeholder="粘贴网页正文、Markdown、教程步骤或命令…"></textarea><small>短内容保存为一张卡片；多行资料会自动拆分，最多 48 条。</small></label>
    <div class="form-grid">
      <label class="field"><span>默认分类</span><select name="categoryId"><option value="auto">自动识别</option>${state.categories.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join("")}</select></label>
      <label class="field"><span>来源 <small>可选</small></span><input name="source" placeholder="网页名称、文件名或个人笔记" /></label>
    </div>
    <div class="field"><span>展示场景</span><div class="check-grid">${state.scenes.map((item) => `<label class="check-card"><input type="checkbox" name="sceneIds" value="${escapeHtml(item.id)}" ${item.id === scene.id ? "checked" : ""}/><span style="--check-accent:${escapeHtml(item.accent)}">${icon(item.icon, 17)}<b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description)}</small></span></label>`).join("")}</div></div>
    <button type="submit" class="primary-button full-width">${icon("arrow", 18)}整理并保存</button>
  </form>`;
}

function renderAdminOrganize(): string {
  return `<div class="admin-organize">
    <section>
      <div class="section-heading"><h3>场景包含的分类</h3><p>勾选后，该分类会出现在对应场景中。</p></div>
      <div class="scene-config-list">${state.scenes.map((scene) => `<article class="scene-config" style="--config-accent:${escapeHtml(scene.accent)}"><header>${icon(scene.icon, 18)}<div><strong>${escapeHtml(scene.name)}</strong><small>${escapeHtml(scene.description)}</small></div></header><div class="toggle-grid">${state.categories.map((category) => `<label><input type="checkbox" data-scene-category data-scene-id="${escapeHtml(scene.id)}" data-category-id="${escapeHtml(category.id)}" ${scene.categoryIds.includes(category.id) ? "checked" : ""}/><span><i style="--category-color:${escapeHtml(category.color)}"></i>${escapeHtml(category.name)}</span></label>`).join("")}</div></article>`).join("")}</div>
    </section>
    <section class="create-panel">
      <form id="scene-form"><h3>新建场景</h3><label class="field"><span>场景名称</span><input name="name" required maxlength="14" placeholder="例如：服务器维护" /></label><button class="secondary-button full-width" type="submit">${icon("plus", 17)}新建场景</button></form>
      <form id="category-form"><h3>新建分类</h3><label class="field"><span>分类名称</span><input name="name" required maxlength="14" placeholder="例如：Kubernetes" /></label><button class="secondary-button full-width" type="submit">${icon("plus", 17)}新建分类</button></form>
    </section>
  </div>`;
}

function renderTaskButton(action: string, label: string, iconName: string, active = false): string {
  return `<button class="task-button${active ? " is-active" : ""}" data-action="${action}" aria-label="${label}" title="${label}">${icon(iconName, 20)}<span>${label}</span></button>`;
}

function render(preserveSearch = false): void {
  const scene = activeScene();
  if (!scene.categoryIds.includes(activeCategoryId)) activeCategoryId = "all";
  const cards = visibleCards();
  if (!cards.some((card) => card.id === selectedCardId)) selectedCardId = cards[0]?.id ?? "";
  const selectedCard = cards.find((card) => card.id === selectedCardId);
  const sceneCards = cardsForScene(scene);
  const categoryIds = scene.categoryIds.filter((id) => categoryById(id));

  root.innerHTML = `<a class="skip-link" href="#knowledge-list">跳到资料列表</a><div class="app-shell${adminOpen ? "" : " admin-collapsed"}" style="--scene-accent:${escapeHtml(scene.accent)}">
    <main class="display-area" id="main-content">
      <section class="display-list" aria-label="展示区">
        <header class="display-header">
          <div class="brand"><span class="brand-mark">CP</span><div><strong>Command Pocket</strong><small>${escapeHtml(scene.name)} · ${cards.length}/${sceneCards.length}</small></div></div>
          <div class="search-box">${icon("search", 19)}<input id="search-input" type="search" value="${escapeHtml(query)}" placeholder="搜索当前场景…" autocomplete="off" aria-label="搜索当前场景"/><kbd>Ctrl K</kbd>${query ? `<button class="clear-search" data-action="clear-search" aria-label="清空搜索">${icon("close", 17)}</button>` : ""}</div>
        </header>
        <div class="category-list"><button class="category-chip${activeCategoryId === "all" ? " is-active" : ""}" data-action="category" data-id="all" aria-pressed="${activeCategoryId === "all"}">${icon("filter", 16)}<span>全部</span><small>${sceneCards.length}</small></button>${categoryIds.map((id) => { const category = categoryById(id)!; return renderCategoryButton(category, sceneCards.filter((card) => card.categoryId === id).length); }).join("")}</div>
        <section class="library-section" id="knowledge-list" aria-labelledby="library-title">
          <div class="library-heading"><h1 id="library-title">${query ? `“${escapeHtml(query)}”的结果` : activeCategoryId === "all" ? "当前场景资料" : categoryById(activeCategoryId)?.name ?? "分类资料"}</h1><span>${cards.length} 条</span></div>
          <div class="card-list">${cards.length ? cards.map(renderCard).join("") : `<div class="empty-state">${icon("search", 28)}<h3>没有匹配资料</h3><p>${query ? "换一个关键词，或清空搜索查看当前场景。" : "从后台配置栏导入资料，或为场景勾选分类。"}</p><button class="secondary-button" data-action="${query ? "clear-search" : "import"}">${query ? "清空搜索" : "导入资料"}</button></div>`}</div>
        </section>
      </section>
      ${renderDetail(selectedCard)}
    </main>
    <aside class="taskbar" aria-label="任务栏">
      <nav class="scene-rail" aria-label="使用场景">${state.scenes.map((item, index) => `<button class="rail-scene${item.id === scene.id ? " is-active" : ""}" data-action="scene" data-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}" aria-label="${escapeHtml(item.name)}" style="--button-accent:${escapeHtml(item.accent)}">${icon(item.icon, 20)}<kbd>${index + 1}</kbd></button>`).join("")}</nav>
      <div class="task-actions">
        ${renderTaskButton("focus-search", "搜索", "search")}
        ${renderTaskButton("import", "导入", "plus", adminOpen && adminTab === "import")}
        ${renderTaskButton("settings", "配置", "settings", adminOpen && adminTab === "organize")}
        ${renderTaskButton("toggle-admin", adminOpen ? "收起" : "展开", adminOpen ? "chevron" : "layers")}
      </div>
    </aside>
    <aside class="admin-panel" aria-label="后台配置栏">
      <header class="admin-header"><div><span class="eyebrow">BACKSTAGE</span><h2>${adminTab === "import" ? "导入资料" : "分类与场景"}</h2></div><button class="icon-button" data-action="toggle-admin" aria-label="收起后台配置栏">${icon("close", 19)}</button></header>
      <div class="admin-tabs"><button class="${adminTab === "import" ? "is-active" : ""}" data-action="admin-tab" data-id="import">导入</button><button class="${adminTab === "organize" ? "is-active" : ""}" data-action="admin-tab" data-id="organize">配置</button></div>
      <div class="admin-scroll">${adminTab === "import" ? renderAdminImport(scene) : renderAdminOrganize()}</div>
    </aside>
    <div class="toast-region" aria-live="polite"></div>
    ${renderModal()}
  </div>`;

  if (preserveSearch) {
    requestAnimationFrame(() => {
      const input = document.getElementById("search-input") as HTMLInputElement | null;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }
  if (modal) requestAnimationFrame(() => (root.querySelector(".modal input, .modal textarea, .modal button") as HTMLElement | null)?.focus());
}

function showToast(message: string): void {
  const region = root.querySelector(".toast-region");
  if (!region) return;
  region.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (region) region.innerHTML = ""; }, 1800);
}

async function writeClipboard(value: string): Promise<void> {
  if (neutralino?.clipboard) {
    await neutralino.clipboard.writeText(value);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function copyCard(cardId: string, confirmed = false): Promise<void> {
  const card = state.cards.find((item) => item.id === cardId);
  if (!card) return;
  if (!confirmed && (card.riskLevel === "high" || card.riskLevel === "critical")) {
    riskCardId = card.id;
    modal = "risk";
    render();
    return;
  }
  await writeClipboard(card.content);
  card.lastCopiedAt = new Date().toISOString();
  persist();
  modal = null;
  render();
  showToast("内容已复制");
}

function formSceneIds(form: HTMLFormElement): string[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[name="sceneIds"]:checked')).map((input) => input.value);
}

root.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.matches(".modal-backdrop") && !target.closest("[data-modal-panel]")) {
    modal = null;
    render();
    return;
  }
  const actionElement = target.closest<HTMLElement>("[data-action]");
  if (!actionElement) return;
  const action = actionElement.dataset.action;
  const id = actionElement.dataset.id ?? "";

  if (action === "scene") {
    activeSceneId = id;
    activeCategoryId = "all";
    query = "";
    selectedCardId = "";
    render();
  } else if (action === "category") {
    activeCategoryId = id;
    selectedCardId = "";
    render();
  } else if (action === "select-card") {
    selectedCardId = id;
    render();
  } else if (action === "favorite") {
    event.stopPropagation();
    const card = state.cards.find((item) => item.id === id);
    if (card) {
      card.isFavorite = !card.isFavorite;
      card.updatedAt = new Date().toISOString();
      persist();
      render();
      showToast(card.isFavorite ? "已加入收藏" : "已取消收藏");
    }
  } else if (action === "copy") {
    void copyCard(id);
  } else if (action === "confirm-copy") {
    void copyCard(id, true);
  } else if (action === "edit") {
    editingCardId = id;
    modal = "edit";
    render();
  } else if (action === "delete") {
    const card = state.cards.find((item) => item.id === id);
    if (card && window.confirm(`删除“${card.title}”？此操作无法撤销。`)) {
      state.cards = state.cards.filter((item) => item.id !== id);
      persist();
      selectedCardId = "";
      render();
      showToast("资料已删除");
    }
  } else if (action === "import") {
    adminTab = "import";
    adminOpen = true;
    render();
  } else if (action === "settings") {
    adminTab = "organize";
    adminOpen = true;
    render();
  } else if (action === "admin-tab") {
    adminTab = id === "organize" ? "organize" : "import";
    adminOpen = true;
    render();
  } else if (action === "toggle-admin") {
    adminOpen = !adminOpen;
    render();
  } else if (action === "focus-search") {
    (document.getElementById("search-input") as HTMLInputElement | null)?.focus();
    render(true);
  } else if (action === "close-modal") {
    modal = null;
    render();
  } else if (action === "clear-search") {
    query = "";
    render(true);
  }
});

root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id !== "search-input") return;
  query = input.value;
  selectedCardId = "";
  render(true);
});

root.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.matches("[data-scene-category]")) return;
  const scene = state.scenes.find((item) => item.id === input.dataset.sceneId);
  const categoryId = input.dataset.categoryId;
  if (!scene || !categoryId) return;
  if (input.checked && !scene.categoryIds.includes(categoryId)) scene.categoryIds.push(categoryId);
  if (!input.checked) scene.categoryIds = scene.categoryIds.filter((id) => id !== categoryId);
  persist();
  showToast("场景分类已更新");
});

root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);

  if (form.id === "import-form") {
    const sceneIds = formSceneIds(form);
    if (!sceneIds.length) {
      showToast("至少选择一个展示场景");
      return;
    }
    const cards = extractCards(String(data.get("content") ?? ""), {
      title: String(data.get("title") ?? ""),
      categoryId: String(data.get("categoryId") ?? "auto"),
      sceneIds,
      source: String(data.get("source") ?? ""),
    });
    state.cards = [...cards, ...state.cards];
    persist();
    modal = null;
    selectedCardId = cards[0]?.id ?? "";
    render();
    showToast(`已整理并保存 ${cards.length} 条资料`);
  } else if (form.id === "edit-form") {
    const card = state.cards.find((item) => item.id === form.dataset.id);
    const sceneIds = formSceneIds(form);
    if (!card || !sceneIds.length) {
      showToast("至少选择一个展示场景");
      return;
    }
    card.title = String(data.get("title") ?? "").trim();
    card.description = String(data.get("description") ?? "").trim();
    card.content = String(data.get("content") ?? "").trim();
    card.categoryId = String(data.get("categoryId") ?? card.categoryId);
    card.source = String(data.get("source") ?? "").trim() || "手动编辑";
    card.sceneIds = sceneIds;
    card.riskLevel = detectRisk(card.content);
    card.updatedAt = new Date().toISOString();
    persist();
    modal = null;
    render();
    showToast("资料已更新");
  } else if (form.id === "scene-form") {
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const newScene: Scene = {
      id: createId("scene"), name, description: "自定义使用场景", categoryIds: [], accent: "#2F7168", icon: "layers",
    };
    state.scenes.push(newScene);
    persist();
    render();
    showToast("场景已创建，请为它选择分类");
  } else if (form.id === "category-form") {
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const newCategory: Category = {
      id: createId("category"), name, description: "自定义资料分类", color: "#52736A", icon: "layers",
    };
    state.categories.push(newCategory);
    persist();
    render();
    showToast("分类已创建");
  }
});

document.addEventListener("keydown", (event) => {
  const keyTarget = event.target as HTMLElement;
  if (!modal && (event.key === "Enter" || event.key === " ") && keyTarget.matches(".knowledge-card")) {
    event.preventDefault();
    selectedCardId = keyTarget.dataset.id ?? selectedCardId;
    render();
    return;
  }
  if (event.key === "Escape" && modal) {
    modal = null;
    render();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    (document.getElementById("search-input") as HTMLInputElement | null)?.focus();
    return;
  }
  if (!modal && /^[1-9]$/.test(event.key) && !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName)) {
    const scene = state.scenes[Number(event.key) - 1];
    if (scene) {
      activeSceneId = scene.id;
      activeCategoryId = "all";
      selectedCardId = "";
      render();
    }
  }
  if (!modal && event.key === "Enter" && document.activeElement?.id === "search-input" && selectedCardId) {
    event.preventDefault();
    void copyCard(selectedCardId);
  }
  if (!modal && (event.key === "ArrowDown" || event.key === "ArrowUp") && document.activeElement?.id === "search-input") {
    event.preventDefault();
    const cards = visibleCards();
    if (!cards.length) return;
    const current = cards.findIndex((card) => card.id === selectedCardId);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + cards.length) % cards.length;
    selectedCardId = cards[next].id;
    render(true);
  }
});

render();
