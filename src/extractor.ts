import { createId } from "./store";
import { detectRisk, inferCategoryId, looksLikeCommand } from "./search";
import type { CardKind, KnowledgeCard } from "./types";

interface ExtractOptions {
  title: string;
  categoryId: string;
  sceneIds: string[];
  source: string;
}

function cleanLine(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)、]\s+/, "")
    .trim();
}

function titleFor(content: string, context: string, index: number): string {
  if (context) return context.slice(0, 42);
  if (/git reset/i.test(content)) return "回退 Git 提交或状态";
  if (/docker.+prune/i.test(content)) return "清理 Docker 未使用资源";
  if (/lsof|netstat|ss\s+-/i.test(content)) return "查看端口或网络占用";
  if (/ffmpeg/i.test(content)) return "处理媒体文件";
  const compact = content.replace(/\s+/g, " ");
  return compact.length > 36 ? `${compact.slice(0, 36)}…` : compact || `整理条目 ${index + 1}`;
}

function kindFor(original: string, content: string): CardKind {
  if (/注意|警告|风险|不要|warning|danger/i.test(original)) return "warning";
  if (looksLikeCommand(content)) return "command";
  if (/^\d+[.)、]\s+/.test(original) || /^步骤/i.test(original)) return "guide";
  return "note";
}

export function extractCards(raw: string, options: ExtractOptions): KnowledgeCard[] {
  const source = raw.trim();
  if (!source) return [];

  const originalLines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const usefulLines = originalLines.filter((line) => cleanLine(line).length >= 4);
  const now = new Date().toISOString();

  if (usefulLines.length < 3 && !usefulLines.some((line) => looksLikeCommand(cleanLine(line)))) {
    const categoryId = options.categoryId === "auto" ? inferCategoryId(source) : options.categoryId;
    return [{
      id: createId("card"),
      title: options.title.trim() || titleFor(source, "", 0),
      content: source,
      description: "从导入资料中整理的可复用内容。",
      categoryId,
      sceneIds: options.sceneIds,
      tags: [categoryId],
      kind: kindFor(source, source),
      riskLevel: detectRisk(source),
      source: options.source.trim() || "手动导入",
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    }];
  }

  const cards: KnowledgeCard[] = [];
  const seen = new Set<string>();
  let heading = options.title.trim();

  for (const original of usefulLines) {
    if (/^#{1,6}\s+/.test(original)) {
      heading = cleanLine(original);
      continue;
    }
    const content = cleanLine(original);
    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const categoryId = options.categoryId === "auto" ? inferCategoryId(content) : options.categoryId;
    const kind = kindFor(original, content);
    cards.push({
      id: createId("card"),
      title: titleFor(content, heading, cards.length),
      content,
      description: kind === "command" ? "从资料中识别出的可复制命令。" : kind === "warning" ? "执行或采用前需要留意的风险信息。" : "从资料中整理出的行动要点。",
      categoryId,
      sceneIds: options.sceneIds,
      tags: [categoryId, kind],
      kind,
      riskLevel: detectRisk(content),
      source: options.source.trim() || "手动导入",
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    });
    if (cards.length >= 48) break;
  }

  return cards;
}

