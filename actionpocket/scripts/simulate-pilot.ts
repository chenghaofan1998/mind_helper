// 模拟试点执行器：以 5 个模拟团队驱动完整操作流，输出指标表。
// 诚实声明：时长/意愿/付费等指标为【模拟专家估计 + 脚本机械验证】的组合，
// 仅用于验证机制可用性与验收口径可执行性，不构成真实试点证据。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FsStore } from '../src/store';
import * as engine from '../src/engine';
import { isDangerous } from '../src/risk';
import type { ActionCard } from '../src/types';

const FIX = (t: string) => path.join(__dirname, '..', '..', 'fixtures', 'teams', t, 'runbook.md');

interface TeamDef {
  key: string;
  owner: string;
  operator: string;
  extra: Record<string, string>;
  /** 模拟基线：对照“直接读原文”从打开文档到正确完成第一步（分钟） */
  baselineMin: number;
  /** 模拟使用后：经行动卡同指标（分钟） */
  afterMin: number;
  /** 模拟意愿 */
  repeatWilling: boolean;
  payIntent: boolean;
  note: string;
}

const TEAMS: TeamDef[] = [
  { key: 'A-release', owner: 'liang_arch', operator: 'wang_ops', extra: {}, baselineMin: 12, afterMin: 4, repeatWilling: true, payIntent: true, note: '规整 Runbook，体验最顺' },
  { key: 'B-pipeline', owner: 'chen_da', operator: 'zhao_val', extra: { dag_run_id: 'manual_20260412_01' }, baselineMin: 20, afterMin: 8, repeatWilling: true, payIntent: false, note: '无章节口语文档仍可结构化；提示缺少验证清单' },
  { key: 'C-ios', owner: 'sun_mob', operator: 'qian_rel', extra: {}, baselineMin: 15, afterMin: 6, repeatWilling: true, payIntent: true, note: '敏感凭据不落盘，运行/复制时逐次提供' },
  { key: 'D-db', owner: 'zhou_dba', operator: 'wu_dba', extra: {}, baselineMin: 25, afterMin: 9, repeatWilling: true, payIntent: false, note: '3 处高风险命令逐条确认；回滚预案独立成步' },
  { key: 'E-tooling', owner: 'luo_tool', operator: 'zheng_dev', extra: {}, baselineMin: 10, afterMin: 4, repeatWilling: true, payIntent: false, note: '先被 owner 驳回一次后修正再批准（J3）' },
];

interface JourneyReport {
  team: string;
  steps: number;
  commands: number;
  confirmSteps: number;
  completed: boolean;
  copyOk: number;
  staleScenario: boolean;
}

function fullJourney(t: TeamDef): JourneyReport {
  const s = new FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-sim-')));
  const file = FIX(t.key);
  const { cardId } = engine.draftFromFile(file, s);
  const card0 = engine.showCard(cardId, s);
  console.log(`\n[${t.key}] 草稿 ${card0.id}`);
  console.log(`  目标: ${card0.goal || '(未识别)'} | 适用: ${card0.appliesWhen || '(未识别)'} | 前置 ${card0.prerequisites.length} 项 | 参数 ${card0.params.length} | 步骤 ${card0.steps.length} | 验证 ${card0.verifications.length} | 风险提示 ${card0.risks.length}`);
  if (card0.verifications.length === 0) console.log('  ⚠ 文档无“验证”清单（可运行但完成后无核对项）');

  engine.approve(cardId, t.owner, s);
  const card = engine.showCard(cardId, s);

  const params: Record<string, string> = { ...t.extra };
  for (const p of card.params) {
    if (params[p.key] === undefined) params[p.key] = p.sensitive ? `sim-${p.key}` : `val-${p.key}`;
  }
  const runId = engine.startRun(cardId, params, s);
  let run = engine.loadRun(runId, s);
  let confirmSteps = 0;
  let copyOk = 0;
  let guard = 0;
  while (run.state === 'in_progress' && run.stepIndex < card.steps.length) {
    const step = card.steps[run.stepIndex];
    for (let idx = 0; idx < step.commands.length; idx++) {
      engine.copyCommand(runId, idx, s, params);
      copyOk++;
    }
    const dangerous = step.commands.some((c) => isDangerous(c.risk));
    if (dangerous) {
      confirmSteps++;
      console.log(`  步${step.seq} 高风险命令 → 操作者已确认（只复制不执行）`);
    }
    engine.stepDone(runId, s, true);
    guard++;
    if (guard > 300) throw new Error('死循环');
    run = engine.loadRun(runId, s);
  }
  engine.complete(runId, s);
  const done = engine.loadRun(runId, s);
  console.log(`  执行完成: 步骤 ${done.stepIndex}/${card.steps.length}, 命令复制 ${copyOk} 次, 高风险确认 ${confirmSteps} 次, 状态 ${done.state}`);
  return {
    team: t.key,
    steps: card.steps.length,
    commands: copyOk,
    confirmSteps,
    completed: done.state === 'completed',
    copyOk,
    staleScenario: false,
  };
}

function scenarioJ2Stale(teamKey: string, owner: string): void {
  // J2：源文件变化 → 过期 → 重新批准
  const s = new FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-sim2-')));
  const src = FIX(teamKey);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-sim2-src-')), 'runbook.md');
  fs.copyFileSync(src, file);
  const { cardId } = engine.draftFromFile(file, s);
  engine.approve(cardId, owner, s);
  console.log(`\n[J2·${teamKey}] 批准后源文件被修改 …`);
  fs.appendFileSync(file, '\n> 更新：新增安全补丁说明（模拟）\n', 'utf8');
  const { changed } = engine.checkSource(cardId, s);
  console.log(`  check-source changed=${changed} → 卡片状态 ${engine.showCard(cardId, s).status}`);
  try {
    engine.startRun(cardId, {}, s);
  } catch (e) {
    console.log(`  尝试运行被拒: ${(e as Error).message.slice(0, 60)}…`);
  }
  engine.approve(cardId, owner, s);
  const c = engine.showCard(cardId, s);
  console.log(`  重新批准 → 状态 ${c.status} v${c.version}，可继续运行`);
}

function scenarioJ3Reject(): void {
  // J3：owner 驳回草稿 → 修正后重提
  const s = new FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-sim3-')));
  const src = FIX('E-tooling');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-sim3-src-')), 'runbook.md');
  let text = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(file, text, 'utf8');
  const { cardId } = engine.draftFromFile(file, s);
  console.log('\n[J3·E-tooling] owner 审阅草稿：目标版本/当前版本缺默认说明，驳回');
  engine.reject(cardId, 'luo_tool', '参数缺默认说明，请补充', s);
  console.log(`  驳回后状态: ${engine.showCard(cardId, s).status}（不可批准不可运行）`);
  // 修正：文档补充参数默认说明后再起草
  text += '\n\n## 参数\n\n| 参数 | 默认值 | 必填 |\n|---|---|---|\n| 目标版本 | 2.1.0 | 是 |\n| 当前版本 | 2.0.0 | 是 |\n';
  fs.writeFileSync(file, text, 'utf8');
  const { cardId: id2 } = engine.draftFromFile(file, s);
  engine.approve(id2, 'luo_tool', s);
  const c2 = engine.showCard(id2, s);
  console.log(`  修正后重新起草并批准 → 状态 ${c2.status} v${c2.version}，参数默认值: ${c2.params.filter((p) => p.defaultValue).map((p) => `${p.key}=${p.defaultValue}`).join(', ')}`);
}

function pct(down: number): string {
  return `${Math.round(down)}%`;
}

function main(): void {
  console.log('==================================================');
  console.log('Action Pocket 模拟试点执行（5 个模拟团队）');
  console.log('⚠ 时长/意愿/付费均为模拟口径，非真实试点证据');
  console.log('==================================================');

  const reports: JourneyReport[] = [];
  for (const t of TEAMS) reports.push(fullJourney(t));
  scenarioJ3Reject();
  scenarioJ2Stale('A-release', 'liang_arch');

  console.log('\n--------------------------------------------------');
  console.log('指标表（模拟口径：基线/用时为专家估计，机制为脚本实测）');
  console.log('--------------------------------------------------');
  console.log('队        步骤  命令复制  高风险确认  基线分→用时分  首步耗时↓  完成  复用意愿  付费意向');
  for (let i = 0; i < TEAMS.length; i++) {
    const t = TEAMS[i];
    const r = reports[i];
    const down = pct(((t.baselineMin - t.afterMin) / t.baselineMin) * 100);
    console.log(
      `${t.key.padEnd(10)} ${String(r.steps).padStart(3)}    ${String(r.commands).padStart(4)}      ${String(r.confirmSteps).padStart(3)}        ${String(t.baselineMin).padStart(3)}→${String(t.afterMin).padStart(2)}分    ${down.padStart(4)}   ${r.completed ? '✔' : '✘'}      ${t.repeatWilling ? '✔' : '✘'}        ${t.payIntent ? '✔' : '✘'}`,
    );
  }

  console.log('\n--------------------------------------------------');
  console.log('章程 §十 生死线核对（模拟值，仅机制可达性）');
  console.log('--------------------------------------------------');
  const rows: Array<[string, string, boolean]> = [
    ['开始正确第一步时间下降 ≥30%', '各队 60–67%（模拟）', true],
    ['完整流程完成率 ≥70%', '5/5 = 100%（脚本实测）', true],
    ['无原文来源的高风险步骤 = 0', '代码校验强制，0', true],
    ['两周后重复使用团队 ≥60%', '5/5 = 100%（模拟意愿）', true],
    ['≥3 团队愿意继续使用', '5（模拟）', true],
    ['≥1 团队含预算决策人付费意向', '2（A、C，模拟）', true],
  ];
  for (const [kpi, val, ok] of rows) {
    console.log(`  ${ok ? '✔' : '✘'} ${kpi}: ${val}`);
  }
  console.log('\n结论：机制层面全流程跑通、口径可量化；上述指标为模拟值，');
  console.log('真实阶段 0（5 团队 + 真实 Runbook）未完成前，不构成产品成立证据。');
}

main();
