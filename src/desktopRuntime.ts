import { events, init, window as neutralinoWindow } from "@neutralinojs/lib";

interface DesktopCallbacks {
  onPinnedChange(value: boolean): void;
  onError(message: string): void;
}

let nativeRuntime = false;
let initialized = false;
let pinned = false;
let callbacks: DesktopCallbacks | undefined;

function hasNativeBridge(): boolean {
  const runtime = window as Window & { NL_PORT?: number | string; NL_TOKEN?: string };
  return Number.isFinite(Number(runtime.NL_PORT)) && Number(runtime.NL_PORT) > 0 && typeof runtime.NL_TOKEN === "string";
}

export async function toggleDesktopPin(): Promise<boolean> {
  if (!nativeRuntime) return false;
  pinned = !pinned;
  await neutralinoWindow.setAlwaysOnTop(pinned);
  callbacks?.onPinnedChange(pinned);
  return pinned;
}

export async function showDesktopWindow(): Promise<void> {
  if (!nativeRuntime) return;
  await neutralinoWindow.show();
  await neutralinoWindow.focus();
}

export async function hideDesktopWindow(): Promise<void> {
  if (nativeRuntime) await neutralinoWindow.hide();
}

export function isDesktopRuntime(): boolean {
  return nativeRuntime;
}

function connectDesktopRuntime(nextCallbacks: DesktopCallbacks): boolean {
  if (initialized || !hasNativeBridge()) return initialized;
  initialized = true;
  nativeRuntime = true;
  callbacks = nextCallbacks;
  init();
  void events.on("windowClose", () => {
    void hideDesktopWindow().catch((error) => nextCallbacks.onError(`隐藏窗口失败：${String(error)}`));
  });
  return true;
}

export function initializeDesktopRuntime(nextCallbacks: DesktopCallbacks): void {
  if (connectDesktopRuntime(nextCallbacks)) return;
  window.setTimeout(() => {
    if (!connectDesktopRuntime(nextCallbacks)) nextCallbacks.onError("桌面桥接未就绪；仍可从系统托盘退出。" );
  }, 250);
}
