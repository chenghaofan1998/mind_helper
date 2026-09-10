import type { PinnedResult, SourceLocation, UsefulFeedback } from "./knowledge/types.js";

const PREFERENCE_KEY = "action-pocket-preferences-v1";
const LEGACY_BODY_KEY = "command-pocket-library-v2";

interface Preferences {
  pins: PinnedResult[];
  feedback: UsefulFeedback[];
}

const emptyPreferences = (): Preferences => ({ pins: [], feedback: [] });

function validLocation(value: unknown): value is SourceLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<SourceLocation>;
  return typeof location.sourceId === "string" && typeof location.documentId === "string" && typeof location.path === "string";
}

function referenceOnly(location: SourceLocation): SourceLocation {
  return {
    sourceId: location.sourceId,
    documentId: location.documentId,
    path: location.path,
    ...(typeof location.line === "number" ? { line: location.line } : {}),
    ...(location.blockId ? { blockId: location.blockId } : {}),
    ...(location.uri ? { uri: location.uri } : {}),
    ...(location.version ? { version: location.version } : {}),
  };
}

function sanitize(value: unknown): Preferences {
  if (!value || typeof value !== "object") return emptyPreferences();
  const data = value as Partial<Preferences>;
  const pins = Array.isArray(data.pins)
    ? data.pins.filter((pin) => validLocation(pin?.location) && typeof pin.pinnedAt === "string")
      .map((pin) => ({ location: referenceOnly(pin.location), pinnedAt: pin.pinnedAt, sourceVersion: pin.sourceVersion }))
    : [];
  const feedback = Array.isArray(data.feedback)
    ? data.feedback.filter((item) => validLocation(item?.location) && (item.value === "useful" || item.value === "not-useful"))
      .map((item) => ({ location: referenceOnly(item.location), value: item.value, at: item.at }))
    : [];
  return { pins, feedback };
}

export function locationKey(location: SourceLocation): string {
  // File sources may regenerate block hashes when text changes; path + line lets the UI
  // conservatively flag the saved version as stale instead of displaying an old body.
  return [location.sourceId, location.documentId, String(location.line ?? location.blockId ?? "")].join(":");
}

export function loadPreferences(storage: Storage = localStorage): Preferences {
  try {
    storage.removeItem(LEGACY_BODY_KEY);
    const raw = storage.getItem(PREFERENCE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : emptyPreferences();
  } catch {
    return emptyPreferences();
  }
}

export function savePreferences(preferences: Preferences, storage: Storage = localStorage): void {
  storage.setItem(PREFERENCE_KEY, JSON.stringify(sanitize(preferences)));
}

export function togglePin(preferences: Preferences, location: SourceLocation): boolean {
  const key = locationKey(location);
  const index = preferences.pins.findIndex((pin) => locationKey(pin.location) === key);
  if (index >= 0) {
    preferences.pins.splice(index, 1);
    return false;
  }
  preferences.pins.push({ location: referenceOnly(location), pinnedAt: new Date().toISOString(), sourceVersion: location.version });
  return true;
}

export function feedbackForLocation(preferences: Preferences, location: SourceLocation): UsefulFeedback | undefined {
  const saved = preferences.feedback.find((item) => locationKey(item.location) === locationKey(location));
  if (!saved) return undefined;
  // Feedback is active only for the exact source revision and block that the user
  // confirmed. Missing identity metadata is not enough to inherit a prior choice.
  if (!saved.location.version || !location.version || saved.location.version !== location.version) return undefined;
  if (!saved.location.blockId || !location.blockId || saved.location.blockId !== location.blockId) return undefined;
  return saved;
}

export function setFeedback(preferences: Preferences, location: SourceLocation, value: UsefulFeedback["value"]): void {
  const key = locationKey(location);
  preferences.feedback = preferences.feedback.filter((item) => locationKey(item.location) !== key);
  preferences.feedback.push({ location: referenceOnly(location), value, at: new Date().toISOString() });
}

export type { Preferences };
