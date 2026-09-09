import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRisk, isDangerous } from '../src/risk';

test('rm -rf / rm -fr 判为高风险', () => {
  assert.equal(classifyRisk('rm -rf /tmp/build'), 'high');
  assert.equal(classifyRisk('rm -fr cache dir'), 'high');
  assert.ok(isDangerous(classifyRisk('rm -rf /srv/shop')));
});

test('rm -f 单文件保持 low', () => {
  assert.equal(classifyRisk('rm -f temp.log'), 'low');
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
