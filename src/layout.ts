import type { ProjectDescriptor } from "./knowledge/types.js";

/** Main window only points at the tray for configuration; it never edits the config file itself. */
export const TRAY_SETTINGS_HINT = "请从系统托盘打开设置";

export type ProjectSwitcherModel =
  | { kind: "empty" }
  | { kind: "single"; label: string; name: string }
  | { kind: "multiple"; label: string; selectedId: string; options: Array<{ id: string; name: string; selected: boolean }> };

/**
 * The main window only switches between already configured projects. A single project
 * collapses to a compact label; multiple projects need the real select control.
 */
export function projectSwitcherModel(projects: ProjectDescriptor[], activeProjectId: string): ProjectSwitcherModel {
  if (projects.length === 0) return { kind: "empty" };
  if (projects.length === 1) return { kind: "single", label: "当前项目", name: projects[0].name };
  return {
    kind: "multiple",
    label: "当前项目",
    selectedId: activeProjectId,
    options: projects.map((project) => ({ id: project.id, name: project.name, selected: project.id === activeProjectId })),
  };
}
