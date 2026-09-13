import type { SearchIntent } from "./types.js";

export type EntryMode = "capture" | "query" | "clarify";
export type ExplicitEntryMode = Exclude<EntryMode, "clarify">;

export interface RouteDecision {
  mode: EntryMode;
  intent?: SearchIntent;
  confidence: number;
  /** Stable diagnostic code. It must never contain the submitted text. */
  reasonCode: string;
  needsConfirmation: boolean;
}

export interface IntentRouter {
  classify(text: string, signal?: AbortSignal): Promise<RouteDecision>;
}

export interface IntentModelClassifier {
  /** Receives only the current user entry, never knowledge-source evidence or history. */
  classify(text: string, signal: AbortSignal): Promise<unknown>;
}

export interface ModelFallbackRouterOptions {
  enabled?: boolean;
  timeoutMs?: number;
  minimumModelConfidence?: number;
}

const MAX_ROUTING_CHARACTERS = 2_000;
const MODEL_TIMEOUT_MS = 1_000;
const QUERY_INTENTS = new Set<SearchIntent>(["find", "command", "understanding", "task", "decision"]);

function validatedText(text: string): string {
  if (typeof text !== "string") throw new TypeError("待辨识内容必须是字符串。");
  const clean = text.trim();
  if (!clean || clean.length > MAX_ROUTING_CHARACTERS) {
    throw new RangeError("待辨识内容必须为 1–2000 个字符。");
  }
  return clean;
}

function decision(mode: EntryMode, confidence: number, reasonCode: string, intent?: SearchIntent): RouteDecision {
  return { mode, intent, confidence, reasonCode, needsConfirmation: mode !== "query" };
}

export function localRoute(text: string): RouteDecision {
  const clean = validatedText(text);
  const capture = /^(记一下|记录(?:一下)?|保存(?:一下|这段)?|存一下|收下|加入知识库)(?:[：:,，。\s]|$)/i.test(clean);
  const startsLikeQuestion = /^(怎么|如何|为什么|为何|什么|哪里|哪条|查找|查询|找回|帮我找|有没有)/i.test(clean);
  const question = /[?？]$/.test(clean) || startsLikeQuestion;
  if (capture && question) return decision("clarify", 0.45, "mixed-capture-query");
  if (capture) return decision("capture", 0.96, "explicit-capture");
  if (clean.includes("\n") && question && !startsLikeQuestion) return decision("clarify", 0.4, "mixed-paste-question");

  if (/取舍|权衡|比较|对比|选哪个|如何选择|决策|利弊|pros?\s+and\s+cons?/i.test(clean)) {
    return decision("query", 0.92, "decision-question", "decision");
  }
  if (/待办|未完成|还没做|TODO|任务列表|下一步做什么/i.test(clean)) {
    return decision("query", 0.92, "task-question", "task");
  }
  if (/\b(git|docker|kubectl|npm|pnpm|yarn|find|grep|curl|ssh|sudo|powershell)\b|命令|参数|怎么执行/i.test(clean)) {
    return decision("query", 0.92, "command-question", "command");
  }
  if (/为什么|原理|概念|怎么理解|如何理解|解释|区别|意思是|例子/i.test(clean)) {
    return decision("query", 0.92, "understanding-question", "understanding");
  }
  if (question) return decision("query", 0.84, "general-question", "find");
  if (clean.includes("\n") || clean.length <= 6) return decision("clarify", 0.35, "ambiguous-entry");
  return decision("clarify", 0.5, "no-explicit-intent");
}

export function applyExplicitMode(route: RouteDecision, mode: ExplicitEntryMode): RouteDecision {
  if (mode === "capture") return decision("capture", 1, "explicit-capture-override");
  return decision("query", 1, "explicit-query-override", route.mode === "query" ? route.intent ?? "find" : "find");
}

function mayContainSecret(text: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text)
    || /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+/i.test(text)
    || /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(text)
    || /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|bearer[_ -]?token|token|password|passwd|client[_ -]?secret|secret[_ -]?key|密码|密钥)\s*[:=]\s*\S+/i.test(text)
    || /\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{16})\b/.test(text);
}

function modelDecision(value: unknown): RouteDecision | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!(["capture", "query", "clarify"] as unknown[]).includes(candidate.mode)) return undefined;
  if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) return undefined;
  const mode = candidate.mode as EntryMode;
  const intent = candidate.intent === undefined ? undefined : candidate.intent;
  if (mode === "query" && (typeof intent !== "string" || !QUERY_INTENTS.has(intent as SearchIntent))) return undefined;
  if (mode !== "query" && intent !== undefined) return undefined;
  return decision(mode, candidate.confidence, "model-classification", intent as SearchIntent | undefined);
}

/**
 * Runs local rules first, and consults an explicitly enabled model only for low-confidence input.
 * Any model error, invalid payload, cancellation, or timeout falls back to the local decision.
 */
export class ModelFallbackIntentRouter implements IntentRouter {
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly minimumModelConfidence: number;

  constructor(private readonly model?: IntentModelClassifier, options: ModelFallbackRouterOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.timeoutMs = options.timeoutMs ?? MODEL_TIMEOUT_MS;
    this.minimumModelConfidence = options.minimumModelConfidence ?? 0.75;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 50 || this.timeoutMs > 1_500) {
      throw new RangeError("模型辨识超时必须为 50–1500 毫秒。");
    }
    if (!Number.isFinite(this.minimumModelConfidence) || this.minimumModelConfidence < 0 || this.minimumModelConfidence > 1) {
      throw new RangeError("模型置信度阈值必须在 0–1 之间。");
    }
  }

  async classify(text: string, signal?: AbortSignal): Promise<RouteDecision> {
    const clean = validatedText(text);
    const fallback = localRoute(clean);
    if (!this.enabled || !this.model || fallback.confidence >= 0.9) return fallback;
    if (signal?.aborted) return { ...fallback, reasonCode: "model-cancelled-fallback" };
    if (mayContainSecret(clean)) return { ...fallback, reasonCode: "sensitive-local-only" };

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new DOMException("辨识已取消。", "AbortError")), { once: true });
    });
    if (signal?.aborted) abort();
    try {
      const modelCall = Promise.resolve().then(() => this.model!.classify(clean, controller.signal));
      const candidate = modelDecision(await Promise.race([modelCall, aborted]));
      if (!candidate || candidate.confidence < this.minimumModelConfidence) {
        return { ...fallback, reasonCode: candidate ? "model-low-confidence-fallback" : "model-invalid-fallback" };
      }
      return candidate;
    } catch {
      const reasonCode = controller.signal.aborted
        ? signal?.aborted ? "model-cancelled-fallback" : "model-timeout-fallback"
        : "model-error-fallback";
      return { ...fallback, reasonCode };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
}
