// Markdown/纯文本 → 结构化文档：标题/前置/步骤(含代码块命令与来源行号)/参数表/风险/验证。
// 目标：对风格差异大的 Runbook 仍能抽出“有序步骤 + 原文摘录 + 行号定位”。

import type {
  CommandRef,
  ParamDef,
  ParsedDocument,
  ParsedStep,
  RiskLevel,
} from './types';
import { classifyRisk } from './risk';

const ORDERED = /^\s*(\d{1,3})[.、)]\s+/;
const CHECKBOX = /^\s*[-*]\s*\[[ xX]\]\s+/;
const BULLET = /^\s*[-*]\s+/;
const FENCE = /^```/;
const BLOCKQUOTE = /^\s*>\s*(.*)$/;

type SectionClass = 'prereq' | 'verify' | 'risk' | 'params' | 'steps';

function classifyHeading(text: string): SectionClass {
  if (/前置/.test(text)) return 'prereq';
  if (/验证/.test(text)) return 'verify';
  if (/风险/.test(text)) return 'risk';
  if (/参数/.test(text)) return 'params';
  return 'steps';
}

function stripMarker(line: string): string {
  return line.replace(ORDERED, '').replace(CHECKBOX, '').replace(BULLET, '').trim();
}

/** 取步骤中第一段“正文文字”（跳过代码块/围栏），无正文则返回空 */
function pickTextLine(itemLines: string[]): string {
  let inFence = false;
  for (const line of itemLines) {
    const t = line.trim();
    if (FENCE.test(t)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (t) return t;
  }
  return '';
}

/** 从一组行中抽代码块命令（整块视为一条命令，风险按整块判定） */
function extractCommands(itemLines: string[]): CommandRef[] {
  const commands: CommandRef[] = [];
  let inFence = false;
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length === 0) return;
    const text = buf.join('\n').trim();
    if (text) commands.push({ text, risk: classifyRisk(text) });
    buf = [];
  };
  for (const line of itemLines) {
    if (FENCE.test(line.trim())) {
      if (inFence) flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) buf.push(line);
  }
  if (inFence) flush(); // 未闭合围栏也尽量保留（容错）
  return commands;
}

/** 解析“| a | b |”表格为单元格数组 */
function cellsOf(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim().replace(/^`|`$/g, ''));
}

const SENSITIVE_HINT =
  /(key|token|secret|passwd|password|credential|issuer|access|口令|密码|密钥|令牌|凭据|授权)/i;

/** 抽取参数表 + 全文占位符 {{x}}，去重合并（表优先） */
function collectParams(
  lines: string[],
  allText: string,
): ParamDef[] {
  const byKey = new Map<string, ParamDef>();

  // 1) 参数表
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const header = cellsOf(lines[i]);
    const isHeader =
      header.length > 0 &&
      header.some((c) => /参数|变量|key|key/i.test(c)) &&
      i + 1 < lines.length &&
      /^\s*\|[\s\-:|]+\|?\s*$/.test(lines[i + 1]);
    if (!isHeader) continue;

    const idx = (h: RegExp): number => header.findIndex((c) => h.test(c));
    const paramCol = Math.max(idx(/^(参数|变量|key|名称)$/i), 0);
    const labelCol = idx(/说明|含义/);
    const defaultCol = idx(/默认/);
    const requiredCol = idx(/必填|required/i);
    const sensitiveCol = idx(/敏感|sensitive|secret/i);

    // 跳过表头与分隔行，消费连续行
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const row = lines[j];
      if (/^\s*\|[\s\-:|]+\|?\s*$/.test(row)) continue;
      const cs = cellsOf(row);
      const key = (cs[paramCol] || '').trim();
      if (!key) continue;
      const existing = byKey.get(key) || {
        key,
        label: key,
        required: false,
        sensitive: false,
      };
      if (labelCol >= 0 && cs[labelCol]) existing.label = cs[labelCol];
      if (defaultCol >= 0 && cs[defaultCol]) {
        const d = cs[defaultCol];
        if (!/自动|\(|（/.test(d)) existing.defaultValue = d;
      }
      if (requiredCol >= 0) existing.required = /是|必填|true/i.test(cs[requiredCol] || '');
      if (!existing.required) existing.required = false;
      if (sensitiveCol >= 0 && cs[sensitiveCol]) {
        existing.sensitive = /是|敏感|sensitive|true|y/i.test(cs[sensitiveCol] || '');
      }
      existing.sensitive =
        existing.sensitive || SENSITIVE_HINT.test(key) || SENSITIVE_HINT.test(existing.label);
      byKey.set(key, existing);
    }
  }

  // 2) 占位符补漏
  const re = /\{\{\s*([^}\n]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allText)) !== null) {
    const key = m[1].trim();
    if (!key || byKey.has(key)) continue;
    const def = {
      key,
      label: key,
      required: true,
      sensitive: SENSITIVE_HINT.test(key),
    };
    // 若 key 只是别名（表内已声明同义标签列），此处保持占位符语义
    byKey.set(key, def);
  }
  return Array.from(byKey.values());
}

export function parseMarkdown(text: string, path: string): ParsedDocument {
  const lines = text.split(/\r?\n/);
  const allText = text;

  let title = '';
  let goal: string | null = null;
  let appliesWhen: string | null = null;
  const prerequisites: string[] = [];
  const risks: string[] = [];
  const verifications: string[] = [];
  const steps: ParsedStep[] = [];
  let sectionClass: SectionClass = 'steps';
  let firstHeading = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // 标题（#..#####）
    if (/^#{1,6}\s+/.test(trimmed)) {
      const hText = trimmed.replace(/^#{1,6}\s+/, '').trim();
      if (!firstHeading) firstHeading = hText;
      if (!title && /^#{1}\s/.test(trimmed)) title = hText;
      sectionClass = classifyHeading(hText);
      continue;
    }

    // 行首 `> 目的/适用条件`（A/D/E/C 文档风格）
    const bq = raw.match(BLOCKQUOTE);
    if (bq) {
      const bqText = bq[1];
      const goalM = bqText.match(/目的[:：]\s*(.+)/);
      const appM = bqText.match(/适用条件[:：]\s*(.+)/);
      if (goalM) goal = goalM[1].trim();
      if (appM) appliesWhen = appM[1].trim();
      continue;
    }

    // 纯文本开头的“适用条件：…/目的：…”（无 # 也无 > 的容错）
    if (!goal) {
      const g2 = trimmed.match(/^目的[:：]\s*(.+)/);
      if (g2) goal = g2[1].trim();
    }
    if (!appliesWhen) {
      const a2 = trimmed.match(/^适用条件[:：]\s*(.+)/);
      if (a2) appliesWhen = a2[1].trim();
    }

    const content = stripMarker(raw);
    const isOrdered = ORDERED.test(raw);
    const isCheck = CHECKBOX.test(raw);
    const isBullet = BULLET.test(raw) && !isCheck;

    // 分类区内的条目 → 收集到对应清单
    if (sectionClass === 'prereq' && (isOrdered || isCheck || isBullet)) {
      if (content) prerequisites.push(content);
      continue;
    }
    if (sectionClass === 'verify' && (isOrdered || isCheck || isBullet)) {
      if (content) verifications.push(content);
      continue;
    }
    if (sectionClass === 'risk' && (isOrdered || isBullet || isCheck)) {
      if (content) risks.push(content);
      continue;
    }
    if (sectionClass === 'params' && isBullet) {
      continue; // 参数区描述性内容忽略
    }

    // 步骤：有序列表项开始 → 收集到下一有序项/标题前
    if (sectionClass === 'steps' && isOrdered) {
      let j = i;
      const itemLines: string[] = [content];
      let startLine = i + 1;
      j++;
      while (j < lines.length) {
        const l = lines[j];
        const t = l.trim();
        if (ORDERED.test(l)) break;
        if (/^#{1,6}\s+/.test(t)) break;
        itemLines.push(l);
        j++;
      }
      const textBody = itemLines.join('\n').trim();
      const textLine = pickTextLine(itemLines);
      steps.push({
        seq: steps.length + 1,
        title: textLine.slice(0, 60),
        text: textBody,
        excerpt: textLine.slice(0, 120),
        startLine,
        endLine: j, // j 已停在边界行（含）——endLine 语义为最后归属行
        commands: extractCommands(itemLines),
      });
      i = j - 1;
      continue;
    }
  }

  // 无标题时退化为文档首行（B 类口语文档）
  if (!title) {
    for (const l of lines) {
      const t = l.trim();
      if (t && t.length < 80 && !ORDERED.test(l) && !/^```/.test(t)) {
        title = t;
        break;
      }
    }
  }
  if (!goal && firstHeading) goal = firstHeading;

  return {
    path,
    title: title || path,
    goal,
    appliesWhen,
    prerequisites,
    params: collectParams(lines, allText),
    steps,
    risks,
    verifications,
  };
}
