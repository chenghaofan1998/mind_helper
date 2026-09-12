import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Capability, KnowledgeSource, ProjectDescriptor, SourceDescriptor } from "../src/knowledge/types.js";
import { KnowledgeSourceError } from "./errors.js";
import { FileGraphSource, type FileGraphScope } from "./sources/fileGraph.js";
import { HttpConnectorSource } from "./sources/httpConnector.js";

const MAX_PROJECT_CONFIG_BYTES = 256 * 1024;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

type ProjectRegistration = ProjectDescriptor & { sourceIds: string[] };
interface ProjectConfigSource { id: string; kind: "markdown-files" | "logseq-files"; scope: FileGraphScope; }
interface ProjectConfigEntry { id: string; name: string; sources: ProjectConfigSource[]; defaultSourceId: string; }
interface ProjectConfig { version: 1; activeProjectId?: string; projects: ProjectConfigEntry[]; }

export class SourceRegistry {
  private readonly sources = new Map<string, KnowledgeSource>();
  private readonly projects = new Map<string, ProjectRegistration>();
  private activeProjectId = "";

  register(source: KnowledgeSource, project?: ProjectDescriptor): void {
    const descriptor = source.descriptor();
    if (this.sources.has(descriptor.id)) throw new Error(`Duplicate knowledge source: ${descriptor.id}`);
    this.sources.set(descriptor.id, source);
    const selectedProject = project ?? {
      id: descriptor.projectId ?? `project-${descriptor.id}`,
      name: descriptor.name,
      sourceIds: [descriptor.id],
      defaultSourceId: descriptor.id,
    };
    this.registerProject(selectedProject);
    if (!this.activeProjectId) this.activeProjectId = selectedProject.id;
  }

  private registerProject(project: ProjectDescriptor): void {
    const existing = this.projects.get(project.id);
    if (existing) {
      for (const sourceId of project.sourceIds) if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId);
      return;
    }
    this.projects.set(project.id, { ...project, sourceIds: [...project.sourceIds] });
  }

  setActiveProject(projectId: string | undefined): void {
    if (projectId && !this.projects.has(projectId)) throw new KnowledgeSourceError("NOT_CONFIGURED", "当前项目不在项目配置中。");
    this.activeProjectId = projectId ?? this.projects.keys().next().value ?? "";
  }

  descriptors(): SourceDescriptor[] {
    return [...this.sources.values()].map((source) => source.descriptor());
  }

  projectDescriptors(): ProjectDescriptor[] {
    return [...this.projects.values()].map((project) => ({ ...project, sourceIds: [...project.sourceIds] }));
  }

  activeProject(): string | undefined { return this.activeProjectId || undefined; }

  require(sourceId: string, capability: "search" | "write" | "locate"): KnowledgeSource {
    const source = this.sources.get(sourceId);
    if (!source) throw new KnowledgeSourceError("NOT_FOUND", "未找到指定知识源。");
    const descriptor = source.descriptor();
    const implementation = capability === "write" ? source.write : capability === "locate" ? source.locate : source.search;
    if (!descriptor.capabilities.includes(capability as Capability) || !implementation) {
      throw new KnowledgeSourceError("CAPABILITY_UNAVAILABLE", `该知识源不支持${capability === "write" ? "写入" : capability === "locate" ? "打开原文" : "检索"}。`);
    }
    return source;
  }

  requireForProject(projectId: string | undefined, sourceId: string | undefined, capability: "search" | "write" | "locate"): KnowledgeSource {
    const projects = this.projectDescriptors();
    const project = projectId ? this.projects.get(projectId) : projects.length === 1 ? projects[0] : undefined;
    if (!project) {
      throw new KnowledgeSourceError(projects.length ? "INVALID_INPUT" : "NOT_CONFIGURED", projects.length ? "请选择项目。" : "尚未配置项目。");
    }
    const selectedSourceId = sourceId ?? project.defaultSourceId;
    if (!project.sourceIds.includes(selectedSourceId)) throw new KnowledgeSourceError("NOT_FOUND", "该项目中没有指定知识源。");
    return this.require(selectedSourceId, capability);
  }
}

function stringField(value: unknown, label: string, maximum = 80): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new KnowledgeSourceError("NOT_CONFIGURED", `${label}无效。`);
  return value.trim();
}

function parseScope(value: unknown): FileGraphScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目 scope 无效。");
  const scope = value as Record<string, unknown>;
  if (scope.kind !== "directory" && scope.kind !== "file") throw new KnowledgeSourceError("NOT_CONFIGURED", "项目 scope.kind 只能是 directory 或 file。");
  const path = stringField(scope.path, "项目路径", 1024);
  if (!isAbsolute(path)) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目路径必须是绝对路径。");
  return { kind: scope.kind, path };
}

function parseProjectConfig(value: unknown): ProjectConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目配置必须是 JSON 对象。");
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !Array.isArray(raw.projects)) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目配置版本无效。");
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  const projects = raw.projects.map((entry): ProjectConfigEntry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目条目无效。");
    const item = entry as Record<string, unknown>;
    const id = stringField(item.id, "项目 id");
    if (!SAFE_ID.test(id) || ids.has(id)) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目 id 必须安全且唯一。");
    ids.add(id);
    if (!Array.isArray(item.sources) || item.sources.length !== 1) throw new KnowledgeSourceError("NOT_CONFIGURED", "当前版本每个项目必须包含一个知识源。");
    const sources = item.sources.map((source): ProjectConfigSource => {
      if (!source || typeof source !== "object" || Array.isArray(source)) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目知识源无效。");
      const candidate = source as Record<string, unknown>;
      const sourceId = stringField(candidate.id, "知识源 id");
      if (!SAFE_ID.test(sourceId) || sourceIds.has(sourceId)) throw new KnowledgeSourceError("NOT_CONFIGURED", "知识源 id 必须安全且唯一。");
      if (candidate.kind !== "markdown-files" && candidate.kind !== "logseq-files") throw new KnowledgeSourceError("NOT_CONFIGURED", "知识源 kind 无效。");
      sourceIds.add(sourceId);
      return { id: sourceId, kind: candidate.kind, scope: parseScope(candidate.scope) };
    });
    const defaultSourceId = stringField(item.defaultSourceId, "默认知识源 id");
    if (!sources.some((source) => source.id === defaultSourceId)) throw new KnowledgeSourceError("NOT_CONFIGURED", "默认知识源不属于项目。");
    return { id, name: stringField(item.name, "项目名称"), sources, defaultSourceId };
  });
  // The native launcher serializes an absent active project as JSON null, so treat null like
  // absent; a zero-project document must stay loadable instead of failing the whole service.
  const activeProjectId = raw.activeProjectId == null ? undefined : stringField(raw.activeProjectId, "当前项目 id");
  if (activeProjectId && !ids.has(activeProjectId)) throw new KnowledgeSourceError("NOT_CONFIGURED", "当前项目不存在。");
  return { version: 1, projects, ...(activeProjectId ? { activeProjectId } : {}) };
}

async function loadProjectConfig(environment: NodeJS.ProcessEnv): Promise<ProjectConfig | undefined> {
  if (!environment.AP_PROJECTS_FILE && !environment.AP_PROJECTS_JSON) return undefined;
  let serialized = environment.AP_PROJECTS_JSON;
  if (environment.AP_PROJECTS_FILE) {
    if (!isAbsolute(environment.AP_PROJECTS_FILE)) throw new KnowledgeSourceError("NOT_CONFIGURED", "AP_PROJECTS_FILE 必须是绝对路径。");
    const info = await stat(environment.AP_PROJECTS_FILE);
    if (!info.isFile() || info.size > MAX_PROJECT_CONFIG_BYTES) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目配置文件无效或过大。");
    serialized = await readFile(environment.AP_PROJECTS_FILE, "utf8");
  }
  if (!serialized || Buffer.byteLength(serialized) > MAX_PROJECT_CONFIG_BYTES) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目配置为空或过大。");
  try { return parseProjectConfig(JSON.parse(serialized)); }
  catch (error) {
    if (error instanceof KnowledgeSourceError) throw error;
    throw new KnowledgeSourceError("NOT_CONFIGURED", "项目配置不是有效 JSON。");
  }
}

async function registerConfiguredProjects(registry: SourceRegistry, config: ProjectConfig): Promise<void> {
  for (const project of config.projects) {
    for (const item of project.sources) {
      const name = item.kind === "logseq-files" ? `${project.name} · Logseq` : project.name;
      const source = new FileGraphSource(item.scope, item.id, name, project.id);
      await source.initialize();
      registry.register(source, { id: project.id, name: project.name, sourceIds: project.sources.map((entry) => entry.id), defaultSourceId: project.defaultSourceId });
    }
  }
  registry.setActiveProject(config.activeProjectId);
}

export async function registryFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Promise<SourceRegistry> {
  const registry = new SourceRegistry();
  const config = await loadProjectConfig(environment);
  if (config) {
    await registerConfiguredProjects(registry, config);
  } else {
    const graphKind = environment.AP_GRAPH_KIND ?? "markdown-files";
    if (!["markdown-files", "logseq-files"].includes(graphKind)) throw new KnowledgeSourceError("NOT_CONFIGURED", "AP_GRAPH_KIND 只能是 markdown-files 或 logseq-files。");
    if (environment.AP_GRAPH_KIND && !environment.AP_GRAPH_DIR) throw new KnowledgeSourceError("NOT_CONFIGURED", "设置 AP_GRAPH_KIND 时必须同时设置 AP_GRAPH_DIR。");
    if (environment.AP_GRAPH_DIR) {
      const sourceName = graphKind === "logseq-files" ? "Logseq 文件 Graph" : "本地 Markdown 知识源";
      const source = new FileGraphSource(environment.AP_GRAPH_DIR, "file-graph", sourceName, "legacy-default");
      await source.initialize();
      registry.register(source, { id: "legacy-default", name: sourceName, sourceIds: ["file-graph"], defaultSourceId: "file-graph" });
    }
  }
  if (environment.AP_CONNECTOR_URL) {
    const source = new HttpConnectorSource(environment.AP_CONNECTOR_URL, environment.AP_CONNECTOR_TOKEN);
    await source.initialize();
    registry.register(source);
  }
  return registry;
}
