#!/usr/bin/env node
// Action Pocket 阶段 1 CLI（薄壳：只做参数解析 → 调用 engine；业务规则在 engine）
// 用法见 docs/actionpocket/02-architecture.md §六。数据目录默认 ./.ap-data（可用 AP_DATA_DIR 覆盖）。

import * as fs from 'fs';
import * as path from 'path';
import { FsStore } from './store';
import * as engine from './engine';
import type { ActionCard } from './types';

const dataDir = process.env.AP_DATA_DIR || path.join(process.cwd(), '.ap-data');
const store = new FsStore(dataDir);
const args = process.argv.slice(2);

function fail(msg: string, code = 2): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function usage(): never {
  fail(
    [
      '用法: node cli.js <命令> [参数]',
      '  draft <file>                            解析文件并生成草稿卡（status=draft）',
      '  approve <cardId> --by <owner>           批准（仅 draft/stale 可批准）',
      '  reject <cardId> --by <owner> --reason <r>',
      '  list                                    列出卡片',
      '  show <cardId>                           查看卡片',
      '  run <cardId> --param k=v [--param ...]  启动运行（active；stale 拒绝）',
      '  copy <runId> [--idx N] [--param k=v]    复制当前步第 N(默认1) 条命令（只复制不执行）',
      '  step-done <runId> [--confirm]           勾选完成当前步（危险命令需 --confirm）',
      '  pause <runId> | resume <runId> | abort <runId>',
      '  complete <runId>                        全部步骤完成后执行完成验证',
      '  check-source <cardId>                   重哈希，源变化则置 stale',
      '  events [--tail N]                       查看本地使用流水',
      '',
      '敏感参数可用环境变量 AP_PARAM_<KEY> 逐次提供；参数值不入卡/流水。',
    ].join('\n'),
    2,
  );
}

interface Opts {
  by?: string;
  reason?: string;
  params: Record<string, string>;
  confirm: boolean;
  idx: number;
  tail: number;
  flag?: string;
}

function parseFlags(): Opts {
  const o: Opts = { params: {}, confirm: false, idx: 1, tail: 10 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--by') o.by = args[++i];
    else if (a === '--reason') o.reason = args[++i];
    else if (a === '--confirm') o.confirm = true;
    else if (a === '--idx') o.idx = Number(args[++i]);
    else if (a === '--tail') o.tail = Number(args[++i]);
    else if (a === '--param') {
      const kv = args[++i];
      const eq = kv.indexOf('=');
      if (eq < 1) fail(`非法 --param: ${kv}`, 2);
      o.params[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  return o;
}

function envParams(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('AP_PARAM_')) out[k.slice('AP_PARAM_'.length)] = process.env[k] as string;
  }
  return out;
}

function describeCard(c: ActionCard): void {
  console.log(`[${c.id}] ${c.status}${c.version > 0 ? ` v${c.version}` : ''} 批准=${c.approvedBy ?? '-'}`);
  console.log(`  目标: ${c.goal || '-'}`);
  console.log(`  适用: ${c.appliesWhen || '-'}`);
  console.log(`  参数: ${c.params.map((p) => `${p.key}${p.required ? '*' : ''}${p.sensitive ? '🔒' : ''}`).join(', ') || '-'}`);
  console.log(`  步骤: ${c.steps.length}  验证项: ${c.verifications.length}  风险提示: ${c.risks.length}`);
  console.log(`  来源: ${c.source.path}  hash=${c.source.hash.slice(0, 12)}…`);
}

function main(): void {
  if (args.length === 0) usage();
  const cmd = args[0];
  const rest = args.slice(1);
  const o = parseFlags();
  const arg0 = rest[0];

  switch (cmd) {
    case 'draft': {
      if (!arg0) usage();
      const { cardId, warnings } = engine.draftFromFile(arg0, store);
      const c = engine.showCard(cardId, store);
      describeCard(c);
      for (const w of warnings) console.log(`⚠ ${w}`);
      console.log(`草稿已写入: ${cardId}（待 owner 批准）`);
      return;
    }
    case 'approve': {
      if (!arg0 || !o.by) usage();
      engine.approve(arg0, o.by, store);
      console.log(`✅ 已批准 ${arg0} by ${o.by}`);
      return;
    }
    case 'reject': {
      if (!arg0 || !o.by || !o.reason) usage();
      engine.reject(arg0, o.by, o.reason, store);
      console.log(`已驳回 ${arg0}`);
      return;
    }
    case 'list': {
      for (const c of engine.listCards(store)) describeCard(c);
      return;
    }
    case 'show': {
      if (!arg0) usage();
      const c = engine.showCard(arg0, store);
      describeCard(c);
      console.log('  前置:');
      for (const p of c.prerequisites) console.log(`    · ${p}`);
      console.log('  步骤:');
      for (const s of c.steps) {
        console.log(`    ${s.seq}. ${s.title}  [L${s.startLine}-${s.endLine}]`);
        for (const cm of s.commands) console.log(`        ${cm.risk.toUpperCase()} cmd: ${cm.text.split('\n')[0]}…`);
      }
      console.log('  验证:');
      for (const v of c.verifications) console.log(`    □ ${v}`);
      console.log('  风险:');
      for (const r of c.risks) console.log(`    ! ${r}`);
      return;
    }
    case 'run': {
      if (!arg0) usage();
      const runId = engine.startRun(arg0, { ...o.params, ...envParams() }, store);
      const run = engine.loadRun(runId, store);
      const card = engine.cardOf(run, store);
      const step = engine.stepAt(card, run.stepIndex);
      console.log(`实例: ${runId}`);
      console.log(`卡: ${card.id} v${card.version}  状态: in_progress`);
      if (step) {
        console.log(`第 ${step.seq} 步（共 ${card.steps.length}）: ${step.title}`);
        console.log(`  原文: L${step.startLine}-${step.endLine} | ${step.excerpt}`);
        for (const cm of step.commands) {
          console.log(`  [${cm.risk}] 待复制命令 ${cm.text.split('\n')[0]}${cm.text.split('\n').length > 1 ? ' …' : ''}`);
        }
      }
      return;
    }
    case 'copy': {
      if (!arg0) usage();
      const { text, risk, seq } = engine.copyCommand(arg0, o.idx - 1, store, { ...o.params, ...envParams() });
      console.log(`--- 第 ${seq} 步 · 第 ${o.idx} 条命令 [${risk}]（已置入复制区，未执行）---`);
      console.log(text);
      return;
    }
    case 'step-done': {
      if (!arg0) usage();
      const { nextSeq } = engine.stepDone(arg0, store, o.confirm);
      console.log(nextSeq === null ? '所有步骤已完成，请执行 complete 完成验证' : `下一步: 步骤 ${nextSeq}，用 run 查看或直接 copy`);
      return;
    }
    case 'pause': {
      if (!arg0) usage();
      engine.pause(arg0, store);
      console.log(`已暂停 ${arg0}`);
      return;
    }
    case 'resume': {
      if (!arg0) usage();
      engine.resume(arg0, store);
      console.log(`已续做 ${arg0}`);
      return;
    }
    case 'abort': {
      if (!arg0) usage();
      engine.abort(arg0, store);
      console.log(`已中止 ${arg0}`);
      return;
    }
    case 'complete': {
      if (!arg0) usage();
      engine.complete(arg0, store);
      console.log(`✅ 实例 ${arg0} 已完成（含 ${engine.cardOf(engine.loadRun(arg0, store), store).verifications.length} 项验证）`);
      return;
    }
    case 'check-source': {
      if (!arg0) usage();
      const { changed } = engine.checkSource(arg0, store);
      console.log(changed ? '⚠ 源文件已变化 → 卡片已置 stale，需 owner 重新批准' : '源文件未变化');
      return;
    }
    case 'events': {
      const evs = engine.eventsOf(store);
      for (const e of evs.slice(-o.tail)) {
        console.log(`${e.at}  ${e.kind}  card=${e.cardId ?? '-'}  run=${e.runId ?? '-'}${e.detail ? `  ${e.detail}` : ''}`);
      }
      return;
    }
    default:
      usage();
  }
}

try {
  main();
} catch (e) {
  if (e instanceof engine.EngineError) {
    process.stderr.write(`✗ ${e.message}\n`);
    process.exit(e.code);
  }
  process.stderr.write(`内部错误: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
}
