import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { parseMarkdown } from '../src/markdown';

const TEAM = (t: string) =>
  path.join(__dirname, '..', '..', 'fixtures', 'teams', t, 'runbook.md');

function parse(team: string) {
  const file = TEAM(team);
  const text = fs.readFileSync(file, 'utf8');
  return parseMarkdown(text, file);
}

test('A 商城发版：规整章节', () => {
  const d = parse('A-release');
  assert.equal(d.title, '商城后端每周发布（Team A）');
  assert.match(d.goal || '', /每周三 22:00/);
  assert.match(d.appliesWhen || '', /常规功能发布/);
  assert.equal(d.prerequisites.length, 3);
  assert.equal(d.steps.length, 5);
  assert.ok(d.steps.every((s) => s.startLine <= s.endLine && s.startLine > 0));
  assert.ok(d.steps.every((s) => s.excerpt.length > 0));
  const keys = d.params.map((p) => p.key);
  assert.ok(keys.includes('版本号') && keys.includes('环境'));
  assert.equal(d.verifications.length, 2);
  assert.ok(d.risks.length >= 2);
  // 步骤 1 的命令来自代码块，且第 1 步含 git push 标签（low）
  assert.ok(d.steps[0].commands.length >= 1);
});

test('B 管道重跑：少章节口语文档仍能抽步骤', () => {
  const d = parse('B-pipeline');
  assert.equal(d.title, '数据管道重跑手册（Team B）');
  assert.equal(d.steps.length, 12);
  // 步骤有来源行号，且能从“找到步骤”定位
  assert.ok(d.steps.some((s) => /airflow dags trigger/.test(s.text)));
});

test('C iOS：参数表 + 占位符 + 敏感参数', () => {
  const d = parse('C-ios');
  assert.equal(d.steps.length, 4);
  const p = new Map(d.params.map((x) => [x.key, x]));
  assert.ok(p.has('branch') && p.has('build_number') && p.has('signing_cert'));
  const api = p.get('api_key');
  assert.ok(api && api.sensitive && api.required);
  const build = p.get('build_number');
  assert.ok(build && build.required);
  assert.equal(d.prerequisites.length, 3);
  assert.ok(d.verifications.length >= 3);
});

test('中文密钥 key 与“敏感”列也判为敏感参数', () => {
  const text = [
    '# 发布',
    '## 参数',
    '| 参数 | 说明 | 敏感 | 必填 |',
    '|---|---|---|---|',
    '| 部署口令 | 跳板机口令 | 是 | 是 |',
    '| 版本号 | 发版版本 | 否 | 是 |',
    '| access_token | OAuth | 是 | 是 |',
    '## 步骤',
    '1. 使用口令登录',
    '```bash',
    'echo {{部署口令}} | ssh deploy@host',
    '```',
  ].join('\n');
  const d = parseMarkdown(text, '/tmp/zh-secret.md');
  const p = new Map(d.params.map((x) => [x.key, x]));
  assert.equal(p.get('部署口令')?.sensitive, true, '中文“部署口令”应敏感');
  assert.equal(p.get('版本号')?.sensitive, false, '“版本号”不应敏感');
  assert.equal(p.get('access_token')?.sensitive, true);
});

test('D 数据库变更：高危命令逐条携带风险', () => {
  const d = parse('D-db');
  assert.equal(d.steps.length, 5);
  assert.ok(d.verifications.length >= 3);
  assert.ok(d.risks.length >= 2);
  const cmdRisk: Array<[number, string]> = d.steps.flatMap((s) =>
    s.commands.map((c) => [s.seq, c.risk] as [number, string]),
  );
  // 步骤 1 的 mysqldump 是只读备份 => low；步骤 2/3/5 的 mysql < 写入 => high
  const riskOf = (seq: number) => d.steps[seq - 1].commands.map((c) => c.risk);
  assert.deepEqual(riskOf(1), ['low', 'low']);
  assert.deepEqual(riskOf(2), ['high']);
  assert.deepEqual(riskOf(3), ['high']);
  assert.deepEqual(riskOf(5), ['high']);
  assert.equal(d.params.find((x) => x.key === '评审号')?.required, true);
});

test('E 工具升级：前置校验区不当作步骤', () => {
  const d = parse('E-tooling');
  // 前置校验 3 条 → prerequisites；分步升级 4 条 → steps
  assert.equal(d.prerequisites.length, 3);
  assert.equal(d.steps.length, 4);
  assert.ok(d.risks.length >= 3);
  const keys = d.params.map((x) => x.key);
  assert.ok(keys.includes('目标版本') && keys.includes('当前版本'));
});
