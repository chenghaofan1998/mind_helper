import type { KnowledgeCard, RiskLevel } from "./types";

const commandPrefixes = [
  "git ", "docker ", "kubectl ", "npm ", "pnpm ", "yarn ", "node ", "python ", "pip ",
  "find ", "grep ", "awk ", "sed ", "tar ", "curl ", "wget ", "ffmpeg ", "adb ",
  "chmod ", "chown ", "rm ", "mv ", "cp ", "du ", "df ", "lsof ", "netstat ", "ss ",
  "mysql ", "psql ", "sqlite3 ", "sudo ", "ssh ", "scp ", "rsync ", "brew ", "winget ",
];

export function looksLikeCommand(value: string): boolean {
  const line = value.trim().replace(/^(\$|>|PS>)\s*/i, "").toLowerCase();
  return commandPrefixes.some((prefix) => line.startsWith(prefix)) ||
    /^(select|insert|update|delete|drop|truncate)\s+/i.test(line) ||
    /^\/(gamemode|give|tp|time|weather|effect)\b/i.test(line);
}

export function detectRisk(value: string): RiskLevel {
  const content = value.toLowerCase();
  if (/rm\s+-rf\s+\//.test(content) || content.includes("mkfs") || content.includes("dd if=") || content.includes("drop database") || content.includes("truncate table")) return "critical";
  if (/rm\s+-rf/.test(content) || content.includes("delete from") || content.includes("chown -r") || content.includes("git clean -fd")) return "high";
  if (content.includes("sudo") || content.includes("docker system prune") || content.includes("git reset") || content.includes("chmod") || content.includes("update ")) return "medium";
  return "low";
}

export function inferCategoryId(value: string): string {
  const content = value.toLowerCase();
  if (/\b(git|commit|branch|rebase|merge)\b/.test(content)) return "git";
  if (/\b(docker|container|image|compose)\b/.test(content)) return "docker";
  if (/\b(select|insert|update|delete|drop|truncate|postgres|mysql|sqlite|sql)\b/.test(content)) return "database";
  if (/\b(ffmpeg|adb|video|audio|codec)\b/.test(content) || /视频|音频|媒体/.test(content)) return "media";
  if (/\/(gamemode|give|tp|time|weather|effect)\b/.test(content) || /游戏|攻略|任务|存档|minecraft|gta/.test(content)) return "game";
  if (/\b(linux|sudo|chmod|lsof|grep|find|ssh|curl|wget|tar)\b/.test(content) || /端口|进程|目录|权限/.test(content)) return "linux";
  return "workflow";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function searchCards(cards: KnowledgeCard[], query: string): KnowledgeCard[] {
  const q = normalize(query);
  const terms = q.split(" ").filter(Boolean);

  return cards
    .map((card) => {
      const title = normalize(card.title);
      const body = normalize(`${card.description} ${card.content} ${card.tags.join(" ")} ${card.source}`);
      let score = card.isFavorite ? 4 : 0;
      if (!q) score += new Date(card.updatedAt).getTime() / 1e13;
      if (title === q) score += 80;
      if (title.includes(q) && q) score += 40;
      if (body.includes(q) && q) score += 24;
      for (const term of terms) {
        if (title.includes(term)) score += 12;
        if (body.includes(term)) score += 5;
      }
      return { card, score };
    })
    .filter(({ score }) => !q || score > 0)
    .sort((a, b) => b.score - a.score || b.card.updatedAt.localeCompare(a.card.updatedAt))
    .map(({ card }) => card);
}

