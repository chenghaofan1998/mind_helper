import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { FsStore } from '../src/store';
import * as engine from '../src/engine';
import { isDangerous } from '../src/risk';

const TEAM = (t: string) => path.join(__dirname, '..', '..', 'fixtures', 'teams', t, 'runbook.md');
const CLI = path.join(__dirname, '..', 'src', 'cli.js');

interface JourneyTeam {
  key: string;
  owner: string;
  operator: string;
  extraParams: Record<string, string>;
  pauseAfterSeq?: number;
}

const TEAMS: JourneyTeam[] = [
  { key: 'A-release', owner: 'liang_arch', operator: 'wang_ops', extraParams: {}, pauseAfterSeq: 1 },
  { key: 'B-pipeline', owner: 'chen_da', operator: 'zhao_val', extraParams: { dag_run_id: 'manual_001' } },
  { key: 'C-ios', owner: 'sun_mob', operator: 'qian_rel', extraParams: {} },
  { key: 'D-db', owner: 'zhou_dba', operator: 'wu_dba', extraParams: {} },
  { key: 'E-tooling', owner: 'luo_tool', operator: 'zheng_dev', extraParams: {} },
];

test('五队端到端：draft→approve→run→逐命令复制→勾选→完成', () => {
  for (const team of TEAMS) {
    const s = new FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-e2e-')));
    const file = TEAM(team.key);
    const { cardId } = engine.draftFromFile(file, s);
    engine.approve(cardId, team.owner, s);

    // 生成参数：非敏感取 {key}; 敏感取 secret-{key}
    const card = engine.showCard(cardId, s);
    const params: Record<string, string> = { ...team.extraParams };
    for (const p of card.params) {
      if (params[p.key] === undefined) params[p.key] = p.sensitive ? `secret-${p.key}` : `val-${p.key}`;
    }

    const runId = engine.startRun(cardId, params, s);
    let run = engine.loadRun(runId, s);
    let guard = 0;
    let firstCopyStep = 0;
    while (run.state === 'in_progress' && run.stepIndex < card.steps.length) {
      const step = card.steps[run.stepIndex];
      for (let idx = 0; idx < step.commands.length; idx++) {
        engine.copyCommand(runId, idx, s, params); // 全部参数（含敏感）提供以完成替换
        if (firstCopyStep === 0) firstCopyStep = run.stepIndex + 1;
      }
      const dangerous = step.commands.some((c) => isDangerous(c.risk));
      if (dangerous) {
        assert.throws(() => engine.stepDone(runId, s, false), /高风险命令/);
      }
      engine.stepDone(runId, s, true);
      if (team.pauseAfterSeq && run.stepIndex === team.pauseAfterSeq) {
        engine.pause(runId, s);
        engine.resume(runId, s);
      }
      guard++;
      if (guard > 200) assert.fail('死循环保护');
      run = engine.loadRun(runId, s);
    }
    assert.equal(run.stepIndex, card.steps.length, `${team.key}: 应走完全部步骤`);
    engine.complete(runId, s);
    assert.equal(engine.loadRun(runId, s).state, 'completed');
    assert.ok(firstCopyStep > 0, `${team.key}: 至少复制过命令`);
    assert.ok(
      engine.eventsOf(s).some((e) => e.kind === 'run_completed' && e.runId === runId),
      `${team.key}: 有完成事件`,
    );
  }
});

test('CLI 冒烟：draft/approve/run/危险门/check-source/events', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cli-'));
  const file = TEAM('D-db');
  const env = { ...process.env, AP_DATA_DIR: dataDir };

  const runCli = (cmd: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...cmd], { encoding: 'utf8', env, timeout: 30000 });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };

  const draft = runCli(['draft', file]);
  assert.equal(draft.code, 0, draft.out);
  const m = draft.out.match(/\[(\S+)\] draft/);
  assert.ok(m, draft.out);
  const cardId = m[1];

  // 缺 --by 视为用法错误
  const bad = runCli(['approve', cardId]);
  assert.equal(bad.code, 2, bad.out);

  const approve = runCli(['approve', cardId, '--by', 'zhou_dba']);
  assert.equal(approve.code, 0, approve.out);

  // 少必填参数 → 业务拒绝(3)
  const missing = runCli(['run', cardId]);
  assert.equal(missing.code, 3, missing.out);

  const okRun = runCli([
    'run',
    cardId,
    '--param',
    '评审号=CR-2026-018',
    '--param',
    '迁移文件=20260401_add_txn_index.sql',
    '--param',
    '目标库=core_prod',
  ]);
  assert.equal(okRun.code, 0, okRun.out);
  const runM = okRun.out.match(/实例: (\S+)/);
  assert.ok(runM, okRun.out);
  const runId = runM[1];

  // 步骤 1（备份，low）无确认直接完成
  const step1 = runCli(['step-done', runId]);
  assert.equal(step1.code, 0, step1.out);
  // 步骤 2（mysql < dry-run → high）：不确认被拒，确认通过
  const noConfirm = runCli(['step-done', runId]);
  assert.equal(noConfirm.code, 3, noConfirm.out);
  assert.match(noConfirm.out, /高风险命令/);
  const confirm = runCli(['step-done', runId, '--confirm']);
  assert.equal(confirm.code, 0, confirm.out);

  // check-source 未变化
  const check = runCli(['check-source', cardId]);
  assert.equal(check.code, 0, check.out);
  assert.match(check.out, /未变化/);

  const events = runCli(['events', '--tail', '20']);
  assert.equal(events.code, 0);
  assert.ok(/step_done/.test(events.out));
  assert.ok(/card_approved/.test(events.out));
});
