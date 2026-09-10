import type { KnowledgeSource, SourceDescriptor } from "../src/knowledge/types.js";
import { KnowledgeSourceError } from "./errors.js";
import { FileGraphSource } from "./sources/fileGraph.js";

export class SourceRegistry {
  private readonly sources = new Map<string, KnowledgeSource>();

  register(source: KnowledgeSource): void {
    const descriptor = source.descriptor();
    if (this.sources.has(descriptor.id)) throw new Error(`Duplicate knowledge source: ${descriptor.id}`);
    this.sources.set(descriptor.id, source);
  }

  descriptors(): SourceDescriptor[] {
    return [...this.sources.values()].map((source) => source.descriptor());
  }

  require(sourceId: string, capability: "search" | "write"): KnowledgeSource {
    const source = this.sources.get(sourceId);
    if (!source) throw new KnowledgeSourceError("NOT_FOUND", "未找到指定知识源。");
    if (!source.descriptor().capabilities.includes(capability) || (capability === "write" && !source.write)) {
      throw new KnowledgeSourceError("CAPABILITY_UNAVAILABLE", `该知识源不支持${capability === "write" ? "写入" : "检索"}。`);
    }
    return source;
  }
}

export async function registryFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Promise<SourceRegistry> {
  const registry = new SourceRegistry();
  if (environment.AP_GRAPH_DIR) {
    const source = new FileGraphSource(environment.AP_GRAPH_DIR);
    await source.initialize();
    registry.register(source);
  }
  return registry;
}
