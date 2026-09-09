import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/markdown';
import { buildDraft } from '../src/draft';
import { sha256 } from '../src/util';

function makeSource(text: string) {
  const path = '/tmp/fake.md';
  return { path, hash: sha256(text), hashAt: new Date().toISOString() };
}

test('普通文档 → 草稿卡字段齐备', () => {
  const text = [
    '# 发版',
    '> 目的：完成每周发布。',
    '> 适用条件：无结构变更。',
    '## 前置条件',
    '- [ ] 已登录',
    '## 步骤',
    '1. 打标签并推送',
    '```bash',
    'git tag v1.0 && git push origin v1.0',
    '```',
    '## 验证',
    '- [ ] 健康检查 UP',
  ].join('\n');
  const parsed = parseMarkdown(text, '/tmp/fake.md');
  const { card, errors, warnings } = buildDraft(parsed, makeSource(text));
  assert.deepEqual(errors, []);
  assert.equal(card.status, 'draft');
  assert.equal(card.version, 0);
  assert.equal(card.steps.length, 1);
  assert.equal(card.prerequisites.length, 1);
  assert.equal(card.verifications.length, 1);
  assert.ok(card.steps[0].excerpt.length > 0);
  assert.ok(card.steps[0].commands[0].text.includes('git tag'));
});

test('无任何有序步骤 → 校验拒绝', () => {
  const text = ['# 没有步骤的文档', '这里只有介绍文字。'].join('\n');
  const parsed = parseMarkdown(text, '/tmp/empty.md');
  const { errors } = buildDraft(parsed, makeSource(text));
  assert.ok(errors.some((e) => /未解析到任何可执行步骤/.test(e)));
});

test('高风险代码块且无摘录 → 无来源高风险拒绝', () => {
  const text = ['# 危险', '## 步骤', '1. ', '```bash', 'rm -rf /x', '```'].join('\n');
  const parsed = parseMarkdown(text, '/tmp/danger.md');
  const { errors } = buildDraft(parsed, makeSource(text));
  assert.ok(errors.some((e) => /高风险命令但无原文摘录/.test(e)), errors.join(','));
});
