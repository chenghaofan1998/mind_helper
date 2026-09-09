// 行动引擎：草稿 → 批准 → 参数填写 → 步骤执行（只复制不执行）→ 暂停/续做 → 完成。
// 安全线：stale 卡禁启动；高风险步骤需显式确认；敏感参数不持久化、不进流水。

import { buildDraft } from './draft';
import { isDangerous } from './risk';
import { parseMarkdown } from './markdown';
import {
  fileExists,
  fileHash,
  MemoryStore,
  readSourceText,
  type Store,
} from './store';
import type {
  ActionCard,
  RunInstance,
  Step,
} from './types';
import { nowIso, shortId, sha256 } from './util';

export class EngineError extends Error {
  code: number;
  constructor(message: string, code = 3) {
    super(message);
    this.code = code;
  }
}

function mustCard(id: string, s: Store): ActionCard {
  const c = s.loadCard(id);
  if (!c) throw new EngineError(`卡片不存在: ${id}`, 4);
  return c;
}

function mustRun(id: string, s: Store): RunInstance {
  const r = s.loadRun(id);
  if (!r) throw new EngineError(`运行实例不存在: ${id}`, 4);
  return r;
}

function event(s: Store, kind: string, cardId?: string, runId?: string, detail?: string): void {
  s.appendEvent({ at: nowIso(), kind, cardId, runId, detail });
}

/** 读取并重算来源哈希（文件缺失视为已变化） */
function currentHashOf(card: ActionCard): string | null {
  if (!fileExists(card.source.path)) return null;
  return fileHash(card.source.path);
}

function ensureSourceCurrent(card: ActionCard): void {
  const h = currentHashOf(card);
  if (h !== card.source.hash) {
    throw new EngineError(
      `源文件已变化或缺失（${card.source.path}），卡片已置为过期，需文档拥有者重新批准`,
    );
  }
}

/** 生成草稿卡（写入 store，status=draft；校验不通过则抛错） */
export function draftFromFile(filePath: string, s: Store): { cardId: string; warnings: string[] } {
  if (!fileExists(filePath)) throw new EngineError(`文件不存在: ${filePath}`, 4);
  const text = readSourceText(filePath);
  const parsed = parseMarkdown(text, filePath);
  const source = { path: filePath, hash: sha256(text), hashAt: nowIso() };
  const { card, errors, warnings } = buildDraft(parsed, source);
  if (errors.length > 0) {
    throw new EngineError(`草稿校验未通过：\n${errors.join('\n')}`, 3);
  }
  s.saveCard(card);
  event(s, 'card_drafted', card.id, undefined, `steps=${card.steps.length}`);
  return { cardId: card.id, warnings };
}

/** 批准：草稿或过期卡 → active；重算并记录当前来源哈希/版本/批准人 */
export function approve(cardId: string, by: string, s: Store): void {
  if (!by) throw new EngineError('缺少批准人（--by）', 2);
  const c = mustCard(cardId, s);
  if (c.status === 'active') throw new EngineError('该卡已是 active', 3);
  if (c.status === 'discarded' || c.status === 'archived') {
    throw new EngineError('已废弃卡片不可批准，请基于最新源文件重新起草', 3);
  }
  const h = currentHashOf(c);
  if (!h) throw new EngineError(`源文件不存在，无法批准: ${c.source.path}`, 4);
  c.source.hash = h;
  c.source.hashAt = nowIso();
  c.status = 'active';
  c.version = c.version + 1;
  c.approvedBy = by;
  c.approvedAt = nowIso();
  c.updatedAt = nowIso();
  s.saveCard(c);
  event(s, 'card_approved', c.id, undefined, `by=${by} version=${c.version}`);
}

/** 驳回：draft → discarded */
export function reject(cardId: string, by: string, reason: string, s: Store): void {
  if (!by) throw new EngineError('缺少操作人（--by）', 2);
  const c = mustCard(cardId, s);
  if (c.status !== 'draft') throw new EngineError('仅草稿可驳回', 3);
  c.status = 'discarded';
  c.rejectReason = reason;
  c.updatedAt = nowIso();
  s.saveCard(c);
  event(s, 'card_rejected', c.id, undefined, `by=${by} reason=${reason}`);
}

export function listCards(s: Store): ActionCard[] {
  return s.listCards();
}

export function showCard(cardId: string, s: Store): ActionCard {
  return mustCard(cardId, s);
}

/** 启动运行：仅 active；敏感参数只记“已提供”不落值 */
export function startRun(cardId: string, params: Record<string, string>, s: Store): string {
  const c = mustCard(cardId, s);
  if (c.status === 'draft') throw new EngineError('草稿未经批准，不能运行', 3);
  if (c.status === 'stale') throw new EngineError('卡片已过期，需重新批准后才能运行', 3);
  if (c.status !== 'active') throw new EngineError(`状态 ${c.status} 不可运行`, 3);
  ensureSourceCurrent(c);

  const values: Record<string, string> = {};
  const sensitive: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const p of c.params) {
    const given = params[p.key];
    const resolved = given !== undefined ? given : p.defaultValue;
    if (p.required && (resolved === undefined || resolved === '')) missing.push(p.key);
    if (p.sensitive) {
      sensitive[p.key] = given !== undefined;
    } else if (resolved !== undefined) {
      values[p.key] = resolved;
    }
  }
  if (missing.length > 0) {
    throw new EngineError(`缺少必填参数: ${missing.join(', ')}（敏感参数不持久化，运行后逐次提供）`, 3);
  }

  const run: RunInstance = {
    id: `run-${shortId(cardId + nowIso())}`,
    cardId,
    state: 'in_progress',
    stepIndex: 0,
    paramValues: values,
    sensitiveProvided: sensitive,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  s.saveRun(run);
  event(s, 'run_started', c.id, run.id, `steps=${c.steps.length}`);
  return run.id;
}

export function loadRun(runId: string, s: Store): RunInstance {
  return mustRun(runId, s);
}

export function cardOf(run: RunInstance, s: Store): ActionCard {
  return mustCard(run.cardId, s);
}

export function stepAt(card: ActionCard, index: number): Step | null {
  return card.steps[index] ?? null;
}

export function stepDone(runId: string, s: Store, confirm: boolean): { nextSeq: number | null } {
  const run = mustRun(runId, s);
  if (run.state !== 'in_progress') throw new EngineError(`实例状态为 ${run.state}，无法推进`, 3);
  const card = cardOf(run, s);
  const step = stepAt(card, run.stepIndex);
  if (!step) throw new EngineError('所有步骤已完成，请执行完成（complete）', 3);

  const dangerous = step.commands.some((c) => isDangerous(c.risk));
  if (dangerous && !confirm) {
    throw new EngineError('步骤含高风险命令：请先确认风险后再标记完成（--confirm）', 3);
  }
  run.stepIndex += 1;
  run.updatedAt = nowIso();
  s.saveRun(run);
  event(s, 'step_done', card.id, run.id, `seq=${step.seq} risk=${dangerous ? 'confirm' : 'normal'}`);
  const next = stepAt(card, run.stepIndex);
  return { nextSeq: next ? next.seq : null };
}

/** 复制当前步第 idx 条命令（只复制不执行；敏感占位符缺失则拒绝） */
export function copyCommand(
  runId: string,
  idx: number,
  s: Store,
  provided: Record<string, string> = {},
): { text: string; risk: string; seq: number } {
  const run = mustRun(runId, s);
  if (run.state !== 'in_progress') throw new EngineError(`实例状态为 ${run.state}，无法复制`, 3);
  const card = cardOf(run, s);
  const step = stepAt(card, run.stepIndex);
  if (!step) throw new EngineError('没有待执行步骤', 3);
  const cmd = step.commands[idx];
  if (!cmd) throw new EngineError(`步骤 ${step.seq} 无第 ${idx + 1} 条命令`, 2);
  const merged: Record<string, string> = { ...run.paramValues, ...provided };
  let text = cmd.text;
  const unresolved: string[] = [];
  text = text.replace(/\{\{\s*([^}\n]+?)\s*\}\}/g, (whole, keyRaw: string) => {
    const key = keyRaw.trim();
    const v = merged[key];
    if (v !== undefined && v !== '') return v;
    unresolved.push(key);
    return whole;
  });
  if (unresolved.length > 0) {
    throw new EngineError(
      `敏感/缺失参数未提供: ${unresolved.join(', ')}（命令未落任何参数值；请通过 --param 或环境变量提供）`,
      3,
    );
  }
  event(s, 'command_copied', card.id, run.id, `seq=${step.seq} idx=${idx + 1}`);
  return { text, risk: cmd.risk, seq: step.seq };
}

export function pause(runId: string, s: Store): void {
  const run = mustRun(runId, s);
  if (run.state !== 'in_progress') throw new EngineError(`状态 ${run.state} 不可暂停`, 3);
  run.state = 'paused';
  run.updatedAt = nowIso();
  s.saveRun(run);
  event(s, 'run_paused', run.cardId, run.id, `step=${run.stepIndex}`);
}

export function resume(runId: string, s: Store): void {
  const run = mustRun(runId, s);
  if (run.state !== 'paused') throw new EngineError(`状态 ${run.state} 不可续做`, 3);
  run.state = 'in_progress';
  run.updatedAt = nowIso();
  s.saveRun(run);
  event(s, 'run_resumed', run.cardId, run.id, `step=${run.stepIndex}`);
}

export function abort(runId: string, s: Store): void {
  const run = mustRun(runId, s);
  if (run.state === 'completed' || run.state === 'aborted') {
    throw new EngineError(`状态 ${run.state} 不可中止`, 3);
  }
  run.state = 'aborted';
  run.updatedAt = nowIso();
  s.saveRun(run);
  event(s, 'run_aborted', run.cardId, run.id, `step=${run.stepIndex}`);
}

/** 完成：所有步骤勾选完成后由操作者确认验证项 */
export function complete(runId: string, s: Store): void {
  const run = mustRun(runId, s);
  if (run.state !== 'in_progress') throw new EngineError(`状态 ${run.state} 不可完成`, 3);
  const card = cardOf(run, s);
  if (run.stepIndex < card.steps.length) {
    throw new EngineError(`尚有 ${card.steps.length - run.stepIndex} 步未完成`, 3);
  }
  run.state = 'completed';
  run.completedAt = nowIso();
  run.updatedAt = nowIso();
  s.saveRun(run);
  event(s, 'run_completed', card.id, run.id, `verified=${card.verifications.length}`);
}

/** 过期检测：active/stale → 源文件变化则置 stale */
export function checkSource(cardId: string, s: Store): { changed: boolean; currentHash: string | null } {
  const c = mustCard(cardId, s);
  const h = currentHashOf(c);
  const changed = h !== c.source.hash;
  if (changed && c.status === 'active') {
    c.status = 'stale';
    c.updatedAt = nowIso();
    s.saveCard(c);
    event(s, 'card_stale', c.id, undefined, `source=${c.source.path}`);
  }
  return { changed, currentHash: h };
}

export function eventsOf(s: Store) {
  return s.loadEvents();
}

export { MemoryStore };
