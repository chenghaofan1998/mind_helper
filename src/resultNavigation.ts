export type ResultKeyboardAction = "previous" | "next" | "primary";

export function resultKeyboardAction(key: string): ResultKeyboardAction | undefined {
  if (key === "ArrowUp") return "previous";
  if (key === "ArrowDown") return "next";
  if (key === "Enter") return "primary";
  return undefined;
}

export function nextResultIndex(currentIndex: number, count: number, direction: "previous" | "next"): number | undefined {
  if (count <= 0) return undefined;
  const normalized = currentIndex >= 0 && currentIndex < count ? currentIndex : 0;
  return direction === "next"
    ? (normalized + 1) % count
    : (normalized - 1 + count) % count;
}
