export type RiskLevel = "low" | "high" | "critical";

const commandPrefixes = [
  "git ", "docker ", "kubectl ", "npm ", "pnpm ", "yarn ", "node ", "python ", "pip ",
  "find ", "grep ", "awk ", "sed ", "tar ", "curl ", "wget ", "ffmpeg ", "adb ",
  "chmod ", "chown ", "rm ", "mv ", "cp ", "du ", "df ", "lsof ", "sudo ", "ssh ",
];

export function looksLikeCommand(value: string): boolean {
  const line = value.trim().replace(/^(\$|>|PS>)\s*/i, "").toLowerCase();
  return commandPrefixes.some((prefix) => line.startsWith(prefix)) ||
    /^(select|insert|update|delete|drop|truncate)\s+/i.test(line);
}

function commandName(token: string | undefined): string {
  return (token ?? "").toLowerCase().split(/[\\/]/).at(-1) ?? "";
}

function consumeWrapperOptions(tokens: string[], start: number, optionsWithValues: Set<string>): number {
  let index = start;
  while (index < tokens.length) {
    const option = tokens[index];
    if (option === "--") return index + 1;
    if (!option.startsWith("-")) break;
    index += 1;
    const name = option.split("=", 1)[0];
    if (optionsWithValues.has(name) && !option.includes("=")) index += 1;
  }
  return index;
}

function unwrapRm(tokens: string[]): string[] | undefined {
  let index = 0;
  while (index < tokens.length) {
    const wrapper = commandName(tokens[index]);
    if (wrapper === "sudo") {
      index = consumeWrapperOptions(tokens, index + 1, new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--chdir", "-T", "--command-timeout"]));
      continue;
    }
    if (wrapper === "env") {
      index = consumeWrapperOptions(tokens, index + 1, new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]));
      while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index += 1;
      continue;
    }
    break;
  }
  return commandName(tokens[index]) === "rm" ? tokens.slice(index + 1) : undefined;
}

function hasRecursiveRm(command: string): boolean {
  for (const segment of command.split(/[;&|\n]/)) {
    const tokens = segment.trim().replace(/^(\$|>|PS>)\s*/i, "").split(/\s+/).filter(Boolean);
    const arguments_ = unwrapRm(tokens);
    if (!arguments_) continue;
    for (const token of arguments_) {
      if (token === "--") break;
      if (/^--recursive$/i.test(token) || (/^-[a-z]+$/i.test(token) && /r/i.test(token))) return true;
    }
  }
  return false;
}

function isDiskDestructive(command: string): boolean {
  return /\bdd\b[^\n]*\bof=\/dev\//i.test(command) ||
    /\b(mkfs|diskpart|format-volume)\b/i.test(command) ||
    /\bformat\b[^\n]*([a-z]:[\\/]?|volume|\/dev\/(sd|vd|nvme|disk))/i.test(command);
}

export function detectRisk(command: string): RiskLevel {
  if (isDiskDestructive(command) || /\bshutdown\b[^\n]*(-r|-s)\b/i.test(command)) return "critical";
  if (hasRecursiveRm(command)) return "high";
  if (
    /\bRemove-Item\b[^\n]*(-Recurse|-Force)/i.test(command) ||
    /\b(del|rd|rmdir)\s+\/s\b/i.test(command) ||
    /\bgit\s+(push|reset)\b[^\n]*?(--force(-with-lease)?|-f\b|--hard)/i.test(command) ||
    /\bchmod\s+-R\s+777\b/i.test(command) ||
    /\b(drop\s+(table|database|schema|collection)|truncate\s+table|delete\s+from|update\s+\S+\s+set|insert\s+into)\b/i.test(command) ||
    /\bmysql\b[^\n]*<\s*\S+/i.test(command)
  ) return "high";
  return "low";
}

export function isDangerous(command: string): boolean {
  const risk = detectRisk(command);
  return risk === "high" || risk === "critical";
}

export function riskImpact(command: string): string {
  if (/\bgit\s+reset\b[^\n]*--hard/i.test(command)) {
    return "当前分支将移动到指定提交，并丢弃已跟踪文件在暂存区和工作区的未提交修改。";
  }
  if (/\bgit\s+push\b[^\n]*(--force(-with-lease)?|-f\b)/i.test(command)) {
    return "强制推送可能覆盖远端分支历史，并影响其他协作者。";
  }
  if (isDiskDestructive(command)) return "这条命令可能格式化或覆盖磁盘数据。";
  if (hasRecursiveRm(command) || /\bRemove-Item\b[^\n]*(-Recurse|-Force)/i.test(command)) {
    return "这条命令可能递归删除文件或目录。";
  }
  return "这条命令可能删除、覆盖或大范围修改数据。";
}

export function commandForClipboard(excerpt: string): string {
  const fenced = excerpt.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  return (fenced?.[1] ?? excerpt).trim();
}
