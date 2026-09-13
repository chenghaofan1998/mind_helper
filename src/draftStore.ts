const DRAFT_KEY = "action-pocket-write-drafts-v3";
const PREVIOUS_DRAFT_KEY = "action-pocket-write-draft-v2";
const LEGACY_DRAFT_KEY = "action-pocket-write-draft-v1";
const MAX_DRAFT_LENGTH = 262_144;
const UNASSIGNED_PROJECT = "__unassigned__";

export interface WriteDraft {
  rawContent: string;
  projectId: string;
  sourceId: string;
  relativePath: string;
  relativePathExplicit: boolean;
}

interface DraftDocument {
  version: 3;
  activeProjectId: string;
  drafts: Record<string, WriteDraft>;
}

function emptyDraft(projectId = ""): WriteDraft {
  return { rawContent: "", projectId, sourceId: "", relativePath: "", relativePathExplicit: false };
}

function projectKey(projectId: string): string {
  return projectId || UNASSIGNED_PROJECT;
}

function normalizeDraft(value: Partial<WriteDraft>, projectId = "", migrated = false): WriteDraft {
  const rawContent = typeof value.rawContent === "string" ? value.rawContent.slice(0, MAX_DRAFT_LENGTH) : "";
  const relativePath = typeof value.relativePath === "string" ? value.relativePath : "";
  return {
    rawContent,
    projectId: typeof value.projectId === "string" ? value.projectId : projectId,
    sourceId: typeof value.sourceId === "string" ? value.sourceId : "",
    // Empty legacy drafts commonly contain a derived daily path. Do not migrate that path as a permanent override.
    relativePath: migrated && !rawContent ? "" : relativePath,
    relativePathExplicit: migrated
      ? Boolean(rawContent && relativePath)
      : value.relativePathExplicit === true,
  };
}

function readDocument(storage: Storage): DraftDocument {
  const serialized = storage.getItem(DRAFT_KEY);
  if (serialized) {
    const value = JSON.parse(serialized) as Partial<DraftDocument>;
    if (value.version !== 3 || !value.drafts || typeof value.drafts !== "object") throw new Error("Invalid draft store");
    const drafts: Record<string, WriteDraft> = {};
    for (const [key, draft] of Object.entries(value.drafts)) {
      if (draft && typeof draft === "object") drafts[key] = normalizeDraft(draft, key === UNASSIGNED_PROJECT ? "" : key);
    }
    return { version: 3, activeProjectId: typeof value.activeProjectId === "string" ? value.activeProjectId : "", drafts };
  }

  const previous = storage.getItem(PREVIOUS_DRAFT_KEY) ?? storage.getItem(LEGACY_DRAFT_KEY);
  if (!previous) return { version: 3, activeProjectId: "", drafts: {} };
  const value = JSON.parse(previous) as Partial<WriteDraft>;
  const draft = normalizeDraft(value, "", true);
  return { version: 3, activeProjectId: draft.projectId, drafts: { [projectKey(draft.projectId)]: draft } };
}

export function loadDraft(storage: Storage = localStorage): WriteDraft {
  try {
    const document = readDocument(storage);
    return document.drafts[projectKey(document.activeProjectId)] ?? emptyDraft(document.activeProjectId);
  } catch {
    return emptyDraft();
  }
}

export function loadProjectDraft(projectId: string, storage: Storage = localStorage): WriteDraft {
  try {
    const document = readDocument(storage);
    return document.drafts[projectKey(projectId)] ?? emptyDraft(projectId);
  } catch {
    return emptyDraft(projectId);
  }
}

export function saveDraft(draft: WriteDraft, storage: Storage = localStorage): void {
  let document: DraftDocument;
  try { document = readDocument(storage); }
  catch { document = { version: 3, activeProjectId: "", drafts: {} }; }
  const normalized = normalizeDraft(draft, draft.projectId);
  document.activeProjectId = normalized.projectId;
  document.drafts[projectKey(normalized.projectId)] = normalized;
  storage.setItem(DRAFT_KEY, JSON.stringify(document));
  storage.removeItem(PREVIOUS_DRAFT_KEY);
  storage.removeItem(LEGACY_DRAFT_KEY);
}

export function switchDraftProject(outgoing: WriteDraft, nextProjectId: string, storage: Storage = localStorage): WriteDraft {
  saveDraft(outgoing, storage);
  return loadProjectDraft(nextProjectId, storage);
}

export function clearDraft(projectId?: string, storage: Storage = localStorage): void {
  if (projectId === undefined) {
    storage.removeItem(DRAFT_KEY);
  } else {
    try {
      const document = readDocument(storage);
      delete document.drafts[projectKey(projectId)];
      storage.setItem(DRAFT_KEY, JSON.stringify(document));
    } catch {
      storage.removeItem(DRAFT_KEY);
    }
  }
  storage.removeItem(PREVIOUS_DRAFT_KEY);
  storage.removeItem(LEGACY_DRAFT_KEY);
}
