import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FsStore } from '../src/store';
import * as engine from '../src/engine';
import { isDangerous } from '../src/risk';

const TEAM = (t: string) => path.join(__dirname, '..', '..', 'fixtures', 'teams', t, 'runbook.md');

function tempStore(): FsStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-store-'));
  return new FsStore(dir);
}

test('全生命周期：draft→approve→run→勾选→完成', () => {
  const s = tempStore();
  const file = TEAM('A-release');
  const { cardId } = engine.draftFromFile(file, s);
  const c0 = engine.showCard(cardId, s);
  assert.equal(c0.status, 'draft');

  // 未批准不能运行
  assert.throws(() => engine.startRun(cardId, { 版本号: 'v1', 环境: 'prod' }, s), /批准/);

  engine.approve(cardId, 'liang_arch', s);
  const c1 = engine.showCard(cardId, s);
  assert.equal(c1.status, 'active');
  assert.equal(c1.approvedBy, 'liang_arch');
  assert.equal(c1.version, 1);

  const runId = engine.startRun(cardId, { 版本号: 'v2.14.0', 环境: 'prod' }, s);
  const card = engine.showCard(cardId, s);

  // 逐步执行：复制命令（只复制不执行）+ 危险确认
  let run = engine.loadRun(runId, s);
  let guard = 0;
  while (run.state === 'in_progress' && run.stepIndex < card.steps.length) {
    const step = card.steps[run.stepIndex];
    for (let idx = 0; idx < step.commands.length; idx++) {
      const { text, risk } = engine.copyCommand(runId, idx, s);
      assert.ok(text.length > 0);
      assert.equal(typeof risk, 'string');
    }
    const dangerous = step.commands.some((c) => isDangerous(c.risk));
    // 模拟先无确认被拒，再确认通过
    if (dangerous) {
      assert.throws(() => engine.stepDone(runId, s, false), /高风险命令/);
    }
    engine.stepDone(runId, s, true);
    guard++;
    if (guard > 100) assert.fail('死循环保护');
    run = engine.loadRun(runId, s);
  }
  assert.equal(run.stepIndex, card.steps.length);

  // 未全部完成的 complete 校验在别处；此处直接完成
  engine.complete(runId, s);
  const done = engine.loadRun(runId, s);
  assert.equal(done.state, 'completed');
  assert.ok(done.completedAt);

  // 事件流水不含敏感内容（本卡无敏感参数，仅验证事件存在）
  const evs = engine.eventsOf(s);
  assert.ok(evs.some((e) => e.kind === 'run_completed' && e.runId === runId));
  assert.ok(evs.some((e) => e.kind === 'card_approved'));
});

test('暂停/续做/中止', () => {
  const s = tempStore();
  const file = TEAM('A-release');
  const { cardId } = engine.draftFromFile(file, s);
  engine.approve(cardId, 'liang_arch', s);
  const runId = engine.startRun(cardId, { 版本号: 'v2.14.0', 环境: 'prod' }, s);

  engine.stepDone(runId, s, true); // 完成步骤 1
  engine.pause(runId, s);
  assert.equal(engine.loadRun(runId, s).state, 'paused');
  assert.throws(() => engine.stepDone(runId, s, true), /paused/);
  engine.resume(runId, s);
  assert.equal(engine.loadRun(runId, s).state, 'in_progress');
  engine.abort(runId, s);
  assert.equal(engine.loadRun(runId, s).state, 'aborted');
});

test('源文件变化 → stale → 拒绝运行 → 重新批准后恢复', () => {
  const s = tempStore();
  // 复制到临时文件，避免污染共享 fixture（多测试文件可能并发读）
  const src = TEAM('D-db');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-src-')), 'migrate.md');
  fs.copyFileSync(src, file);
  const { cardId } = engine.draftFromFile(file, s);
  engine.approve(cardId, 'zhou_dba', s);
  assert.equal(engine.showCard(cardId, s).version, 1);

  // 修改源文件
  fs.appendFileSync(file, '\n<!-- 模拟源文件后续被修改 -->\n', 'utf8');
  const { changed } = engine.checkSource(cardId, s);
  assert.equal(changed, true);
  assert.equal(engine.showCard(cardId, s).status, 'stale');

  const params = { 评审号: 'CR-2026-018', 迁移文件: 'x.sql', 目标库: 'core_prod' };
  assert.throws(() => engine.startRun(cardId, params, s), /过期/);

  // 重新批准（更新 hash/版本）
  engine.approve(cardId, 'zhou_dba', s);
  const c = engine.showCard(cardId, s);
  assert.equal(c.status, 'active');
  assert.equal(c.version, 2);
});

test('敏感参数不持久化、不进流水；运行前必须提供', () => {
  const s = tempStore();
  const file = TEAM('C-ios');
  const { cardId } = engine.draftFromFile(file, s);
  engine.approve(cardId, 'sun_mob', s);

  // 必填敏感参数未提供 → 拒绝
  assert.throws(
    () => engine.startRun(cardId, { branch: 'develop', build_number: '200', signing_cert: 'c', api_key: '' }, s),
    /api_key/,
  );

  const runId = engine.startRun(
    cardId,
    { branch: 'develop', build_number: '200', signing_cert: 'c', api_key: 'sk-test-123', api_issuer: 'iss-9' },
    s,
  );
  let run = engine.loadRun(runId, s);
  // 敏感值不得出现在实例持久化参数中
  assert.equal(run.paramValues['api_key'], undefined);
  assert.equal(run.sensitiveProvided['api_key'], true);

  // 推进到使用 api_key 的第 4 步并复制命令：必须显式提供
  const card = engine.showCard(cardId, s);
  while (run.stepIndex < 3) {
    engine.stepDone(runId, s, true);
    run = engine.loadRun(runId, s);
  }
  // 不提供敏感参数 → 复制被拒（不落任何参数值）
  assert.throws(() => engine.copyCommand(runId, 0, s), /api_key/);
  const { text } = engine.copyCommand(runId, 0, s, { api_key: 'sk-test-123', api_issuer: 'iss-9' });
  assert.ok(text.includes('sk-test-123'));

  // 事件流水不得出现敏感值
  const all = engine.eventsOf(s).map((e) => JSON.stringify(e)).join('\n');
  assert.ok(!all.includes('sk-test-123'));
  assert.ok(!all.includes('iss-9'));
});
