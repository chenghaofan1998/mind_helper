// 草稿生成与规则校验：解析结果 → ActionCard（status=draft）。
// 校验红线：无原文来源的高风险步骤 = 0（硬性拒绝整卡）。

import type { ActionCard, ParsedDocument, SourceRef, Step } from './types';
import { isDangerous } from './risk';
import { nowIso, shortId, slugOf } from './util';

export interface BuildResult {
  card: ActionCard;
  errors: string[];
  warnings: string[];
}

/** 由解析结果构造步骤（带来源行号/摘录/命令风险） */
function buildSteps(parsed: ParsedDocument, cardId: string): Step[] {
  return parsed.steps.map((ps) => ({
    id: `${cardId}-s${ps.seq}`,
    seq: ps.seq,
    title: ps.title,
    text: ps.text,
    excerpt: ps.excerpt,
    startLine: ps.startLine,
    endLine: ps.endLine,
    commands: ps.commands,
  }));
}

/** 校验：草稿能否进入批准（违反红线 → errors 非空） */
function validate(parsed: ParsedDocument, steps: Step[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (steps.length === 0) errors.push('未解析到任何可执行步骤（有序列表为空）');
  for (const s of steps) {
    const dangerous = s.commands.some((c) => isDangerous(c.risk));
    if (dangerous && (!s.excerpt || s.excerpt.trim().length < 6)) {
      errors.push(`步骤 ${s.seq} 含高风险命令但无原文摘录（来源不可定位）`);
    }
  }
  if (!parsed.goal) warnings.push('未识别到“目的/目标”，建议核对');
  if (!parsed.appliesWhen) warnings.push('未识别到“适用条件”，建议核对');
  if (parsed.prerequisites.length === 0) warnings.push('未识别到“前置条件”，建议核对');
  if (parsed.verifications.length === 0) warnings.push('未识别到“验证”清单，运行后无完成验证项');
  return { errors, warnings };
}

/** 解析结果 → 草稿卡 */
export function buildDraft(parsed: ParsedDocument, source: SourceRef): BuildResult {
  const slug = slugOf(parsed.title || parsed.path);
  const cardId = `${slug}-${shortId(source.hash)}`;
  const steps = buildSteps(parsed, cardId);
  const { errors, warnings } = validate(parsed, steps);
  const now = nowIso();

  const card: ActionCard = {
    id: cardId,
    version: 0,
    status: 'draft',
    source,
    goal: parsed.goal || '',
    appliesWhen: parsed.appliesWhen || '',
    prerequisites: parsed.prerequisites,
    params: parsed.params,
    steps,
    risks: parsed.risks,
    verifications: parsed.verifications,
    createdAt: now,
    updatedAt: now,
  };
  return { card, errors, warnings };
}
