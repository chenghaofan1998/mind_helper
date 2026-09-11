export type TrayAction = "show" | "toggle-pin" | "exit";

export function trayAction(id: unknown): TrayAction | undefined {
  if (id === "show" || id === "toggle-pin" || id === "exit") return id;
  return undefined;
}
