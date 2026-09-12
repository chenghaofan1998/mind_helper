export type ShellWindowState = "starting" | "visible" | "hidden" | "minimized" | "exited";
export type ShellAction = "show-existing" | "start-shell" | "hide" | "none";

export function requestShow(state: ShellWindowState): { state: ShellWindowState; action: ShellAction } {
  if (state === "exited") return { state: "starting", action: "start-shell" };
  return { state: "visible", action: "show-existing" };
}

export function requestToggle(state: ShellWindowState): { state: ShellWindowState; action: ShellAction } {
  if (state === "visible") return { state: "hidden", action: "hide" };
  return requestShow(state);
}

export function observeShellExit(): { state: ShellWindowState; action: ShellAction } {
  return { state: "exited", action: "none" };
}
