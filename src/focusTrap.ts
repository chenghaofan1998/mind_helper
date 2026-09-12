export interface FocusTarget { focus(): void; }

export type RiskReturnKind = "result-card" | "copy-button";
export interface RiskReturnTarget { resultId: string; kind: RiskReturnKind; }
interface RiskFocusable extends FocusTarget { dataset: { id?: string; riskReturn?: string }; }

export function focusTarget(target: FocusTarget | null | undefined): boolean {
  if (!target) return false;
  target.focus();
  return true;
}

export function focusRiskReturnTarget(targets: Iterable<RiskFocusable>, returnTarget: RiskReturnTarget | null): boolean {
  if (!returnTarget) return false;
  const target = [...targets].find((candidate) => candidate.dataset.id === returnTarget.resultId
    && candidate.dataset.riskReturn === returnTarget.kind);
  return focusTarget(target);
}

export function modalKeyboardAction(key: string): "close" | "trap-focus" | undefined {
  if (key === "Escape") return "close";
  if (key === "Tab") return "trap-focus";
  return undefined;
}

export function wrappedFocusIndex(currentIndex: number, count: number, backward: boolean): number | undefined {
  if (count <= 0) return undefined;
  if (currentIndex < 0) return backward ? count - 1 : 0;
  if (backward && currentIndex === 0) return count - 1;
  if (!backward && currentIndex === count - 1) return 0;
  return undefined;
}
