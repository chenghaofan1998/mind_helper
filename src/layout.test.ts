import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectDescriptor } from "./knowledge/types.js";
import { projectSwitcherModel, TRAY_SETTINGS_HINT } from "./layout.js";

function project(id: string, name: string): ProjectDescriptor {
  return { id, name, sourceIds: [`source-${id}`], defaultSourceId: `source-${id}` };
}

test("project switcher collapses a single configured project into a compact label", () => {
  assert.deepEqual(projectSwitcherModel([], ""), { kind: "empty" });
  assert.deepEqual(projectSwitcherModel([project("a", "日记")], "a"), { kind: "single", label: "当前项目", name: "日记" });
});

test("project switcher offers a select only when several projects are configured", () => {
  const model = projectSwitcherModel([project("a", "日记"), project("b", "工作")], "b");
  assert.equal(model.kind, "multiple");
  if (model.kind !== "multiple") return;
  assert.equal(model.selectedId, "b");
  assert.deepEqual(model.options, [
    { id: "a", name: "日记", selected: false },
    { id: "b", name: "工作", selected: true },
  ]);
});

test("the main window points unconfigured users at the tray settings entry", () => {
  assert.equal(TRAY_SETTINGS_HINT, "请从系统托盘打开设置");
});
