import { createInitialState } from "./data";
import type { AppState } from "./types";

const STORAGE_KEY = "command-pocket-library-v2";
const LEGACY_NOTE_KEY = "command-pocket-note-v1";

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AppState>;
  return state.version === 2 && Array.isArray(state.categories) && Array.isArray(state.scenes) && Array.isArray(state.cards);
}

export function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isAppState(parsed)) return parsed;
    }
  } catch {
    // A damaged local snapshot should not prevent the app from opening.
  }

  const initial = createInitialState(localStorage.getItem(LEGACY_NOTE_KEY) ?? "");
  saveState(initial);
  return initial;
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createId(prefix: string): string {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

