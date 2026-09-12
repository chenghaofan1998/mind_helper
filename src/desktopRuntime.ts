import { events, init, window as neutralinoWindow } from "@neutralinojs/lib";
import { attemptDesktopHide } from "./desktopRuntimeState";

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
  if (!nativeRuntime) return;
  const hidden = await attemptDesktopHide(
    () => neutralinoWindow.hide(),
    (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      callbacks?.onError(`Esc 隐藏失败：${detail}。请使用窗口 X、系统托盘或 Ctrl+Alt+P。`);
    },
  );
  if (!hidden) nativeRuntime = false;
}

export function isDesktopRuntime(): boolean {
  return nativeRuntime;
}

function connectDesktopRuntime(nextCallbacks: DesktopCallbacks): boolean {
  callbacks = nextCallbacks;
  if (nativeRuntime) return true;
  if (initialized || !hasNativeBridge()) return false;
  initialized = true;
  void events.on("ready", () => { nativeRuntime = true; });
  void events.on("serverOffline", () => {
    nativeRuntime = false;
    callbacks?.onError("桌面桥接已断开；请使用窗口 X、系统托盘或 Ctrl+Alt+P。");
  });
  try {
    init();
  } catch (error) {
    initialized = false;
    const detail = error instanceof Error ? error.message : String(error);
    nextCallbacks.onError(`桌面桥接连接失败：${detail}。请使用窗口 X、系统托盘或 Ctrl+Alt+P。`);
  }
  return nativeRuntime;
}

export function initializeDesktopRuntime(nextCallbacks: DesktopCallbacks): void {
  if (connectDesktopRuntime(nextCallbacks)) return;
  window.setTimeout(() => {
    if (!nativeRuntime) connectDesktopRuntime(nextCallbacks);
    if (!nativeRuntime) nextCallbacks.onError("桌面桥接未就绪；请使用窗口 X、系统托盘或 Ctrl+Alt+P。" );
  }, 250);
}
