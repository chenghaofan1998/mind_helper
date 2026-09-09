// 危险命令判定（只判红不判绿）：命中即要求确认；保守优于漏判。
// 语义对齐 Command Pocket pilot 的实时危险判定（native/CommandPocketPilot.cs IsDanger/GuessRisk），
// 关键基线：rm -r/-rf/-fr/-Rf 递归删除、git 强制改写、写库、磁盘级覆写/格式化一律红。

import type { RiskLevel } from './types';

/** rm 的选项簇判定：短选项含 r（大小写不敏感）或 --recursive 即递归删除 */
function rmRecursive(command: string): boolean {
  const re = /(^|[;&|\n])\s*rm\s+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    const after = command.slice(re.lastIndex).trimStart();
    for (const tok of after.split(/\s+/)) {
      if (!tok.startsWith('-')) break; // 首个非选项即路径，结束本处选项簇
      if (/^--recursive$/i.test(tok)) return true;
      if (/^-[a-zA-Z]+$/.test(tok) && /r/i.test(tok)) return true;
    }
  }
  return false;
}

/** 磁盘/卷级破坏：format 后跟盘符、dd of=/dev/、diskpart、format-volume */
function diskDestructive(command: string): boolean {
  if (/\bdd\b[^\n]*\bof=\/dev\//.test(command)) return true;
  if (/\bdiskpart\b|\bformat-volume\b/i.test(command)) return true;
  if (/\bformat\b[^\n]*([a-zA-Z]:[\\/]?|volume|\/dev\/(sd|vd|nvme|disk))/i.test(command)) return true;
  return false;
}

/** 写库类（一条命令即可判断） */
const DB_WRITE: RegExp[] = [
  /\bmysql\b[^\n]*<\s*\S+/,
  /\bdrop\s+(table|database|schema|collection)\b/i,
  /\btruncate\b/i,
  /\balter\s+table\b[^\n]*\bdrop\b/i,
];

export function classifyRisk(command: string): RiskLevel {
  const c = command;
  if (diskDestructive(c) || /\bshutdown\b[^\n]*(-r|-s)\b/i.test(c)) return 'critical';
  if (rmRecursive(c)) return 'high';
  if (
    /\bRemove-Item\b[^\n]*(-Recurse|-Force)/.test(c) ||
    /\bdel\s+\/s\b/.test(c) ||
    /\brd\s+\/s\b|\brmdir\s+\/s\b/i.test(c) ||
    /\bgit\s+(push|reset)\b[^\n]*?(--force(-with-lease)?|-f\b|--hard)/.test(c) ||
    /\bchmod\s+-R\s+777\b/.test(c) ||
    DB_WRITE.some((r) => r.test(c))
  ) {
    return 'high';
  }
  return 'low';
}

/** 是否属于需要确认的危险命令 */
export function isDangerous(risk: RiskLevel): boolean {
  return risk === 'high' || risk === 'critical';
}
