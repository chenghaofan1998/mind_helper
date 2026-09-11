import { app, events, init, os, window as neutralinoWindow } from "@neutralinojs/lib";
import { trayAction } from "./desktopActions";

interface DesktopCallbacks {
  onPinnedChange(value: boolean): void;
  onError(message: string): void;
}

let nativeRuntime = false;
let initialized = false;
let pinned = false;
let callbacks: DesktopCallbacks | undefined;

function trayOptions() {
  return {
    icon: "/action-pocket.png",
    menuItems: [
      { id: "show", text: "打开 Action Pocket" },
      { id: "toggle-pin", text: "窗口置顶", isChecked: pinned },
      { id: "exit", text: "退出" },
    ],
  };
}

async function updateTray(): Promise<void> {
  await os.setTray(trayOptions());
}

export async function toggleDesktopPin(): Promise<boolean> {
  if (!nativeRuntime) return false;
  pinned = !pinned;
  await neutralinoWindow.setAlwaysOnTop(pinned);
  await updateTray();
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

export function initializeDesktopRuntime(nextCallbacks: DesktopCallbacks): void {
  if (initialized || typeof window.NL_PORT !== "number") return;
  initialized = true;
  nativeRuntime = true;
  callbacks = nextCallbacks;
  init();
  void events.on("windowClose", () => { void hideDesktopWindow(); });
  void events.on("trayMenuItemClicked", (event) => {
    const action = trayAction((event.detail as { id?: unknown } | undefined)?.id);
    if (action === "show") void showDesktopWindow();
    if (action === "toggle-pin") void toggleDesktopPin().catch((error) => nextCallbacks.onError(String(error)));
    if (action === "exit") void app.exit();
  });
  void updateTray().catch((error) => nextCallbacks.onError(`托盘初始化失败：${String(error)}`));
}
