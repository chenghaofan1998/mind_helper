const DRAFT_KEY = "action-pocket-write-draft-v1";
const MAX_DRAFT_LENGTH = 262_144;

export interface WriteDraft {
  rawContent: string;
  sourceId: string;
  relativePath: string;
}

export function loadDraft(storage: Storage = localStorage): WriteDraft {
  try {
    const value = JSON.parse(storage.getItem(DRAFT_KEY) ?? "{}") as Partial<WriteDraft>;
    return {
      rawContent: typeof value.rawContent === "string" ? value.rawContent.slice(0, MAX_DRAFT_LENGTH) : "",
      sourceId: typeof value.sourceId === "string" ? value.sourceId : "",
      relativePath: typeof value.relativePath === "string" ? value.relativePath : "",
    };
  } catch {
    return { rawContent: "", sourceId: "", relativePath: "" };
  }
}

export function saveDraft(draft: WriteDraft, storage: Storage = localStorage): void {
  storage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, rawContent: draft.rawContent.slice(0, MAX_DRAFT_LENGTH) }));
}

export function clearDraft(storage: Storage = localStorage): void {
  storage.removeItem(DRAFT_KEY);
}
