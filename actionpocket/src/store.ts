// 存储层：卡/实例 JSON 存取 + 事件流水（jsonl）。
// 规则：本地优先、追加式流水、敏感信息不入事件、原子写卡。

import * as fs from 'fs';
import * as path from 'path';
import { sha256 } from './util';
import type { ActionCard, PipelineEvent, RunInstance } from './types';

export interface Store {
  saveCard(card: ActionCard): void;
  loadCard(id: string): ActionCard | undefined;
  listCards(): ActionCard[];
  saveRun(run: RunInstance): void;
  loadRun(id: string): RunInstance | undefined;
  appendEvent(e: PipelineEvent): void;
  loadEvents(): PipelineEvent[];
}

/** 计算文件 sha256（来源哈希） */
export function fileHash(p: string): string {
  const buf = fs.readFileSync(p);
  return sha256(buf.toString('utf8'));
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function readSourceText(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

/** 原子写：先写临时文件再 rename，避免半截文件 */
function atomicWrite(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

export class FsStore implements Store {
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    fs.mkdirSync(path.join(dataDir, 'cards'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
  }

  private cardFile(id: string): string {
    return path.join(this.dataDir, 'cards', `${id}.json`);
  }

  private runFile(id: string): string {
    return path.join(this.dataDir, 'runs', `${id}.json`);
  }

  private eventFile(): string {
    return path.join(this.dataDir, 'events.jsonl');
  }

  saveCard(card: ActionCard): void {
    atomicWrite(this.cardFile(card.id), JSON.stringify(card, null, 2));
  }

  loadCard(id: string): ActionCard | undefined {
    const f = this.cardFile(id);
    if (!fileExists(f)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8')) as ActionCard;
    } catch {
      return undefined;
    }
  }

  listCards(): ActionCard[] {
    const dir = path.join(this.dataDir, 'cards');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ActionCard);
  }

  saveRun(run: RunInstance): void {
    atomicWrite(this.runFile(run.id), JSON.stringify(run, null, 2));
  }

  loadRun(id: string): RunInstance | undefined {
    const f = this.runFile(id);
    if (!fileExists(f)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8')) as RunInstance;
    } catch {
      return undefined;
    }
  }

  appendEvent(e: PipelineEvent): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.appendFileSync(this.eventFile(), `${JSON.stringify(e)}\n`, 'utf8');
  }

  loadEvents(): PipelineEvent[] {
    const f = this.eventFile();
    if (!fileExists(f)) return [];
    return fs
      .readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as PipelineEvent);
  }
}

export class MemoryStore implements Store {
  private cards = new Map<string, ActionCard>();
  private runs = new Map<string, RunInstance>();
  private events: PipelineEvent[] = [];

  saveCard(card: ActionCard): void {
    this.cards.set(card.id, card);
  }

  loadCard(id: string): ActionCard | undefined {
    return this.cards.get(id);
  }

  listCards(): ActionCard[] {
    return Array.from(this.cards.values());
  }

  saveRun(run: RunInstance): void {
    this.runs.set(run.id, run);
  }

  loadRun(id: string): RunInstance | undefined {
    return this.runs.get(id);
  }

  appendEvent(e: PipelineEvent): void {
    this.events.push(e);
  }

  loadEvents(): PipelineEvent[] {
    return this.events.slice();
  }
}
