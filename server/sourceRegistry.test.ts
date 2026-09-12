import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registryFromEnvironment } from "./sourceRegistry.js";

test("explicit Logseq file profile reuses the provider-neutral file graph source", async () => {
  const root = await mkdtemp(join(tmpdir(), "action-pocket-logseq-"));
  await mkdir(join(root, "pages"));
  await mkdir(join(root, "journals"));
  await mkdir(join(root, "logseq", "bak"), { recursive: true });
  await writeFile(join(root, "pages", "adam.md"), "# Adam\n\n动量用于平滑梯度方向。\n");
  await writeFile(join(root, "logseq", "bak", "ignored.md"), "private-backup-marker\n");

  const registry = await registryFromEnvironment({ AP_GRAPH_DIR: root, AP_GRAPH_KIND: "logseq-files" });
  const descriptor = registry.descriptors()[0];
  assert.equal(descriptor.name, "Logseq 文件 Graph");
  assert.deepEqual(descriptor.capabilities, ["read", "search", "write", "locate"]);
  assert.equal((await registry.require(descriptor.id, "search").search("动量", 5)).length, 1);
  assert.equal((await registry.require(descriptor.id, "search").search("private backup marker", 5)).length, 0);

  const receipt = await registry.require(descriptor.id, "write").write!({
    rawContent: "逐字保存的 Logseq journal 内容",
    target: { sourceId: descriptor.id, relativePath: "journals/2025_01_02.md" },
  });
  assert.equal(receipt.ok, true);
  assert.equal(await readFile(join(root, "journals", "2025_01_02.md"), "utf8"), "逐字保存的 Logseq journal 内容\n");
});

test("graph profile configuration is explicit and validated", async () => {
  await assert.rejects(registryFromEnvironment({ AP_GRAPH_KIND: "logseq-files" }), /AP_GRAPH_DIR/);
  await assert.rejects(registryFromEnvironment({ AP_GRAPH_KIND: "logseq-db" }), /AP_GRAPH_KIND/);
});

test("validated multi-project configuration isolates project membership", async () => {
  const first = await mkdtemp(join(tmpdir(), "action-pocket-project-a-"));
  const second = await mkdtemp(join(tmpdir(), "action-pocket-project-b-"));
  const config = {
    version: 1,
    activeProjectId: "project-a",
    projects: [
      { id: "project-a", name: "A", defaultSourceId: "source-a", sources: [{ id: "source-a", kind: "markdown-files", scope: { kind: "directory", path: first } }] },
      { id: "project-b", name: "B", defaultSourceId: "source-b", sources: [{ id: "source-b", kind: "markdown-files", scope: { kind: "directory", path: second } }] },
    ],
  };
  const registry = await registryFromEnvironment({ AP_PROJECTS_JSON: JSON.stringify(config), AP_GRAPH_DIR: "/ignored/by-explicit-projects" });
  assert.deepEqual(registry.projectDescriptors().map((project) => project.id), ["project-a", "project-b"]);
  assert.equal(registry.activeProject(), "project-a");
  assert.equal(registry.requireForProject("project-a", "source-a", "search").descriptor().id, "source-a");
  assert.throws(() => registry.requireForProject("project-a", "source-b", "search"), /该项目中没有/);
  assert.throws(() => registry.requireForProject(undefined, undefined, "search"), /请选择项目/);
});

test("multi-project configuration rejects duplicate ids and relative paths", async () => {
  const invalid = (scopePath: string) => ({
    version: 1,
    projects: [{ id: "same", name: "A", defaultSourceId: "same", sources: [{ id: "same", kind: "markdown-files", scope: { kind: "directory", path: scopePath } }] }],
  });
  await assert.rejects(registryFromEnvironment({ AP_PROJECTS_JSON: JSON.stringify(invalid("relative")) }), /绝对路径/);
  const root = await mkdtemp(join(tmpdir(), "action-pocket-project-invalid-"));
  const duplicate = invalid(root);
  duplicate.projects.push({ ...duplicate.projects[0], name: "B" });
  await assert.rejects(registryFromEnvironment({ AP_PROJECTS_JSON: JSON.stringify(duplicate) }), /项目 id/);
});

test("a zero-project projects.v1.json written by the launcher still loads", async () => {
  const root = await mkdtemp(join(tmpdir(), "action-pocket-empty-projects-"));
  const configPath = join(root, "projects.v1.json");
  await writeFile(configPath, JSON.stringify({ version: 1, activeProjectId: null, projects: [] }));
  const registry = await registryFromEnvironment({ AP_PROJECTS_FILE: configPath });
  assert.deepEqual(registry.projectDescriptors(), []);
  assert.equal(registry.activeProject(), undefined);
  assert.throws(() => registry.requireForProject(undefined, undefined, "search"), /尚未配置项目/);
});

test("an added folder project and an added single-file project stay switchable and isolated", async () => {
  const folder = await mkdtemp(join(tmpdir(), "action-pocket-mixed-folder-"));
  await writeFile(join(folder, "folder-note.md"), "folder alpha marker\n");
  const fileRoot = await mkdtemp(join(tmpdir(), "action-pocket-mixed-file-"));
  const single = join(fileRoot, "single-note.md");
  await writeFile(single, "single beta marker\n");
  await writeFile(join(fileRoot, "sibling.md"), "sibling gamma marker\n");

  const config = {
    version: 1,
    activeProjectId: "project-folder",
    projects: [
      { id: "project-folder", name: "Folder", defaultSourceId: "source-folder", sources: [{ id: "source-folder", kind: "markdown-files", scope: { kind: "directory", path: folder } }] },
      { id: "project-file", name: "File", defaultSourceId: "source-file", sources: [{ id: "source-file", kind: "markdown-files", scope: { kind: "file", path: single } }] },
    ],
  };
  const registry = await registryFromEnvironment({ AP_PROJECTS_JSON: JSON.stringify(config), AP_GRAPH_DIR: "/ignored/by-explicit-projects" });
  assert.deepEqual(registry.projectDescriptors().map((project) => project.id), ["project-folder", "project-file"]);
  assert.equal((await registry.requireForProject("project-folder", "source-folder", "search").search("folder alpha", 5)).length, 1);
  assert.equal((await registry.requireForProject("project-file", "source-file", "search").search("single beta", 5)).length, 1);
  assert.equal((await registry.requireForProject("project-file", "source-file", "search").search("sibling gamma", 5)).length, 0);
  assert.throws(() => registry.requireForProject("project-file", "source-folder", "search"), /该项目中没有/);
});
