export type RiskLevel = "low" | "medium" | "high" | "critical";

export type CardKind = "command" | "guide" | "note" | "warning";

export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  builtIn?: boolean;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  categoryIds: string[];
  accent: string;
  icon: string;
  builtIn?: boolean;
}

export interface KnowledgeCard {
  id: string;
  title: string;
  content: string;
  description: string;
  categoryId: string;
  sceneIds: string[];
  tags: string[];
  kind: CardKind;
  riskLevel: RiskLevel;
  source: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastCopiedAt?: string;
}

export interface AppState {
  version: 2;
  categories: Category[];
  scenes: Scene[];
  cards: KnowledgeCard[];
}

