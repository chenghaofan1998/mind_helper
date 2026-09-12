import type { SourceDescriptor } from "./knowledge/types.js";

export function effectiveWritePath(relativePath: string, source?: SourceDescriptor): string {
  return relativePath.trim() || source?.defaultWritePath?.trim() || "";
}

export function canSubmitWrite(rawContent: string, relativePath: string, source?: SourceDescriptor): boolean {
  return Boolean(rawContent.trim() && effectiveWritePath(relativePath, source) && source?.capabilities.includes("write"));
}
