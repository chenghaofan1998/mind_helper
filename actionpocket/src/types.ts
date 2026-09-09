// 领域模型契约：Action Pocket 阶段 1（唯一数据契约，见 docs/actionpocket/02-architecture.md）

export type RiskLevel = 'low' | 'high' | 'critical';
export type CardStatus = 'draft' | 'active' | 'stale' | 'discarded' | 'archived';
export type RunState = 'not_started' | 'in_progress' | 'paused' | 'completed' | 'aborted';

/** 来源引用：批准时的文件哈希，用于过期检测 */
export interface SourceRef {
  path: string;
  hash: string;
  hashAt: string;
}

/** 步骤内的一段命令（只复制不执行） */
export interface CommandRef {
  text: string;
  risk: RiskLevel;
}

/** 原文中的一个执行步骤 */
export interface Step {
  id: string;
  seq: number;
  title: string;
  /** 完整步骤文本（含嵌套说明） */
  text: string;
  /** 原文摘录（来源可定位，高风险步骤必须非空） */
  excerpt: string;
  startLine: number;
  endLine: number;
  commands: CommandRef[];
}

export interface ParamDef {
  key: string;
  label: string;
  required: boolean;
  sensitive: boolean;
  defaultValue?: string;
}

/** 行动卡：草稿或经批准的正式卡 */
export interface ActionCard {
  id: string;
  version: number;
  status: CardStatus;
  source: SourceRef;
  goal: string;
  appliesWhen: string;
  prerequisites: string[];
  params: ParamDef[];
  steps: Step[];
  risks: string[];
  verifications: string[];
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectReason?: string;
}

/** 运行实例：只保存当前进度与非敏感参数值 */
export interface RunInstance {
  id: string;
  cardId: string;
  state: RunState;
  stepIndex: number;
  paramValues: Record<string, string>;
  /** 敏感参数仅记录“已提供”，不落值 */
  sensitiveProvided: Record<string, boolean>;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface PipelineEvent {
  at: string;
  kind: string;
  cardId?: string;
  runId?: string;
  detail?: string;
}

/** 解析（markdown.ts）产出的中间结构 */
export interface ParsedStep {
  seq: number;
  title: string;
  text: string;
  excerpt: string;
  startLine: number;
  endLine: number;
  commands: CommandRef[];
}

export interface ParsedDocument {
  path: string;
  title: string;
  goal: string | null;
  appliesWhen: string | null;
  prerequisites: string[];
  params: ParamDef[];
  steps: ParsedStep[];
  risks: string[];
  verifications: string[];
}
