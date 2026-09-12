import { events, init, window as neutralinoWindow } from "@neutralinojs/lib";
import { attemptDesktopHide } from "./desktopRuntimeState";

interface DesktopCallbacks {
  onPinnedChange(value: boolean): void;
  onError(message: string): void;
}

type BridgeState = "idle" | "connecting" | "ready" | "offline" | "failed";
let state: BridgeState = "idle";
let pinned = false;
let callbacks: DesktopCallbacks | undefined;
let hideFailureReported = false;
let listenersRegistered = false;

function hasNativeBridge(): boolean {
  const runtime = window as Window & { NL_PORT?: number | string; NL_TOKEN?: string };
  return Number.isFinite(Number(runtime.NL_PORT)) && Number(runtime.NL_PORT) > 0 && typeof runtime.NL_TOKEN === "string";
}

export async function toggleDesktopPin(): Promise<boolean> {
  if (state !== "ready") return false;
  pinned = !pinned;
  await neutralinoWindow.setAlwaysOnTop(pinned);
  callbacks?.onPinnedChange(pinned);
  return pinned;
}

export async function showDesktopWindow(): Promise<void> {
  if (state !== "ready") return;
  await neutralinoWindow.show();
  await neutralinoWindow.focus();
}

export async function hideDesktopWindow(): Promise<void> {
  if (state !== "ready") return;
  await attemptDesktopHide(
    () => neutralinoWindow.hide(),
    (error) => {
      if (hideFailureReported) return;
      hideFailureReported = true;
      const detail = error instanceof Error ? error.message : String(error);
      callbacks?.onError(`暂时无法隐藏窗口（${detail}），请使用托盘或 Ctrl+Alt+P。`);
    },
  );
}

export function isDesktopRuntime(): boolean {
  return state === "ready";
}

async function registerBridgeListeners(): Promise<void> {
  if (listenersRegistered) return;
  listenersRegistered = true;
  await Promise.all([
    events.on("ready", () => {
      state = "ready";
      hideFailureReported = false;
      callbacks?.onPinnedChange(pinned);
    }),
    events.on("serverOffline", () => { state = "offline"; }),
  ]);
}

async function connectDesktopRuntime(): Promise<void> {
  state = "connecting";
  try {
    await registerBridgeListeners();
    init();
  } catch {
    state = "failed";
  }
}

export function initializeDesktopRuntime(nextCallbacks: DesktopCallbacks): void {
  callbacks = nextCallbacks;
  if (!hasNativeBridge() || state === "connecting" || state === "ready") return;
  void connectDesktopRuntime();
}
