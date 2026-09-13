export interface DesktopWindowSize { width: number; height: number; }

export function fittedDesktopWindowSize(availableWidth: number, availableHeight: number): DesktopWindowSize {
  const safeWidth = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : 560;
  const safeHeight = Number.isFinite(availableHeight) && availableHeight > 0 ? availableHeight : 680;
  return {
    width: Math.max(360, Math.min(560, Math.floor(safeWidth - 32))),
    height: Math.max(480, Math.min(680, Math.floor(safeHeight - 32))),
  };
}

export async function attemptDesktopHide(
  hide: () => Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  try {
    await hide();
    return true;
  } catch (error) {
    onFailure(error);
    return false;
  }
}
