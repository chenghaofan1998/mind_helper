import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRisk, isDangerous } from '../src/risk';

test('rm -rf / rm -fr 判为高风险', () => {
  assert.equal(classifyRisk('rm -rf /tmp/build'), 'high');
  assert.equal(classifyRisk('rm -fr cache dir'), 'high');
  assert.ok(isDangerous(classifyRisk('rm -rf /srv/shop')));
});

test('递归删除的等价写法均判高（对齐 pilot 基线）', () => {
  for (const c of ['rm -r /srv/old', 'rm -f -r /data/x', 'rm -r -f /data/x', 'rm -Rf /x', 'rm -r /tmp && npm i', 'rm --recursive /x']) {
    assert.ok(isDangerous(classifyRisk(c)), `应为高/临界: ${c}`);
  }
  assert.equal(classifyRisk('rm -d emptydir'), 'low', 'rm -d 仅删空目录');
});

test('磁盘/卷级破坏判为临界（对齐 pilot）', () => {
  for (const c of ['format c:', 'format d: /q', 'format volume E', 'dd if=/dev/zero of=/dev/sdb bs=4M', 'diskpart', 'format-volume D:']) {
    assert.equal(classifyRisk(c), 'critical', c);
  }
  assert.ok(isDangerous(classifyRisk('rd /s /q C:\\old')), 'rd /s');
});

test('rm -f 单文件保持 low', () => {
  assert.equal(classifyRisk('rm -f temp.log'), 'low');
  assert.equal(classifyRisk('rm file.txt'), 'low');
});

test('git reset --hard / push --force 高风险', () => {
  assert.equal(classifyRisk('git reset --hard HEAD~2'), 'high');
  assert.equal(classifyRisk('git push --force origin main'), 'high');
  assert.equal(classifyRisk('git push --force-with-lease origin main'), 'high');
  assert.equal(classifyRisk('git push origin main'), 'low');
});

test('写库类：mysql < 高风险，mysqldump 只读为 low', () => {
  assert.equal(classifyRisk('mysql -u deploy -p core_prod < migrate.sql'), 'high');
  assert.equal(classifyRisk('mysqldump --single-transaction core_prod > /backup/dump.sql'), 'low');
  assert.equal(classifyRisk('psql "$DW_CONN" -c "select count(*) from t"'), 'low');
});

test('drop table / truncate 高风险', () => {
  assert.equal(classifyRisk('DROP TABLE IF EXISTS txn;'), 'high');
  assert.equal(classifyRisk('truncate table logs;'), 'high');
});

test('普通命令 low', () => {
  for (const c of ['ls -la', 'docker compose up -d', 'netstat -ano', 'curl -fsS http://x/health']) {
    assert.equal(classifyRisk(c), 'low', c);
  }
});
