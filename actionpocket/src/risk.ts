// 危险命令判定（只判红不判绿）：命中即要求确认；保守优于漏判。
// 规则沿用 Command Pocket pilot 的“实时危险判定”思路，见 native/CommandPocketPilot.cs IsDanger/GuessRisk。

import type { RiskLevel } from './types';

/** 高风险（需确认）：删除/强制改写/批量写库等 */
const HIGH: RegExp[] = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r\b/,
  /\bRemove-Item\b[^\n]*(-Recurse|-Force)/,
  /\bdel\s+\/s\b/,
  /\brmdir\s+\/s\b/,
  /\bgit\s+(push|reset)\b[^\n]*?(--force(-with-lease)?|-f\b|--hard)/,
  /\bmysql\b[^\n]*<\s*\S+/,
  /\bdrop\s+(table|database|schema|collection)\b/i,
  /\btruncate\b/i,
  /\balter\s+table\b[^\n]*\bdrop\b/i,
  /\bchmod\s+-R\s+777\b/,
];

/** 临界（双重确认语义）：破坏面最大，仍走同一确认门，仅用于分级展示 */
const CRITICAL: RegExp[] = [
  /\bformat\b[^\n]*(\/q|drive|disk)/i,
  /\bshutdown\b[^\n]*(-r|-s)\b/i,
];

export function classifyRisk(command: string): RiskLevel {
  const c = command;
  if (CRITICAL.some((r) => r.test(c))) return 'critical';
  if (HIGH.some((r) => r.test(c))) return 'high';
  return 'low';
}

/** 是否属于需要确认的危险命令 */
export function isDangerous(risk: RiskLevel): boolean {
  return risk === 'high' || risk === 'critical';
}
