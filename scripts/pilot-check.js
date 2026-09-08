#!/usr/bin/env node
// Command Pocket v5-pilot · 规则逻辑对拍台（Linux 容器内验证用，不入交付）
// 与 native/CommandPocketPilot.cs 中 Rules/History 保持同一套规则文本；C# 侧 --self-test 为权威。
// 跑法：node scripts/pilot-check.js
'use strict';

let failures = 0;
function ok(cond, name) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

// ---------- 复刻 Rules.GuessRisk（needles 与 C# 一致，改必须同步） ----------
const HIGH_NEEDLES = [
  'rm -rf', 'rm -r', 'rm -fr', 'rm -f -r',
  'remove-item -recurse', 'remove-item -r',
  'format c:', 'format d:', 'format /fs',
  'format-volume',
  'diskpart',
  'dd if=',
  'git push -f', 'git push --force', 'git push --force-with-lease',
  'drop table', 'drop database', 'truncate table', 'truncate database',
  'rd /s', 'del /s /q',
  'reset --hard',
];
function guessRisk(body) {
  if (!body) return 'low';
  const t = body.trim();
  if (t.length === 0) return 'low';
  const lower = t.toLowerCase();
  return HIGH_NEEDLES.some(n => lower.includes(n)) ? 'high' : 'low';
}

// ---------- 复刻 Rules.IsSensitive ----------
const SENSITIVE = ['password', 'passwd', 'pwd=', 'token', 'secret', 'api_key', 'apikey',
  'authorization:', 'bearer ', 'private key', 'id_rsa', 'aws_access', 'client_secret', 'connectionstring'];
function isSensitive(line) {
  if (!line) return false;
  const lower = line.toLowerCase();
  return SENSITIVE.some(m => lower.includes(m));
}

// ---------- 复刻 Rules.IsCommandish ----------
function containsCjk(s) {
  for (const ch of s) { const c = ch.codePointAt(0); if (c >= 0x4E00 && c <= 0x9FFF) return true; }
  return false;
}
function isCommandish(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length === 0 || t.length > 800) return false;
  let newlines = 0;
  for (const ch of t) if (ch === '\n') newlines++;
  if (newlines > 6) return false;
  const trimmed = t.trimEnd();
  const last = trimmed[trimmed.length - 1];
  if (['。', '？', '！', '，'].includes(last)) return false;
  const hasSpace = t.includes(' ') || t.includes('\t') || t.includes('=');
  if (!hasSpace && containsCjk(t) && t.length > 12) return false;
  return true;
}

// ---------- 复刻排序语义 CompareRecent（含 UpdatedAt 第三键） ----------
function tsOf(c) { return c.lastUsedAt || c.createdAt || 0; }
function compareRecent(a, b) {
  const ta = tsOf(a), tb = tsOf(b);
  if (tb !== ta) return tb - ta;
  const ca = a.copies || 0, cb = b.copies || 0;
  if (cb !== ca) return cb - ca;
  const ua = a.updatedAt || 0, ub = b.updatedAt || 0;
  if (ub !== ua) return ub - ua;
  return String(a.title).localeCompare(String(b.title));
}

// ---------- 复刻 History.CollectSuggestions ----------
function bodyKey(s) { return (s || '').trim().toLowerCase(); }
function collectSuggestions(historyLines, existing, topN, minFreq) {
  const result = [];
  if (!historyLines) return result;
  const inLib = new Set();
  for (const c of existing) inLib.add(bodyKey(c.body));
  const count = new Map();
  const lastSeen = new Map();
  const lastIdx = new Map();
  const order = [];
  for (let i = 0; i < historyLines.length; i++) {
    const raw = historyLines[i];
    if (isSensitive(raw)) continue;
    const key = bodyKey(raw);
    if (!key) continue;
    if (inLib.has(key)) continue;
    if (!count.has(key)) order.push(key);
    count.set(key, (count.get(key) || 0) + 1);
    lastSeen.set(key, raw);
    lastIdx.set(key, i);
  }
  order.sort((a, b) => {
    const ca = count.get(a), cb = count.get(b);
    if (cb !== ca) return cb - ca;
    return lastIdx.get(b) - lastIdx.get(a);
  });
  for (const k of order) {
    if (result.length >= topN) break;
    if (count.get(k) >= minFreq) result.push({ body: lastSeen.get(k), freq: count.get(k) });
  }
  return result;
}

console.log('== GuessRisk ==');
ok(guessRisk('rm -rf /tmp/build') === 'high', 'rm -rf -> high');
ok(guessRisk('git push --force-with-lease origin main') === 'high', 'force-with-lease -> high');
ok(guessRisk('git reset --hard HEAD~1') === 'high', 'reset --hard -> high');
ok(guessRisk('git reset --soft HEAD~1') === 'low', 'reset --soft -> low');
ok(guessRisk('taskkill /PID 8080 /F') === 'low', 'taskkill /F stays low');
ok(guessRisk('netstat -ano | findstr :8080') === 'low', 'netstat low');
ok(guessRisk('ls -la') === 'low', 'ls low');
ok(guessRisk('Remove-Item -Recurse -Force .\\node_modules') === 'high', 'Remove-Item -Recurse high');
ok(guessRisk('del /s /q C:\\temp\\*') === 'high', 'del /s high');
ok(guessRisk('') === 'low', 'empty low');
ok(guessRisk('rm -f notes.txt') === 'low', 'rm -f single file stays low');

console.log('== IsSensitive ==');
ok(isSensitive('export AWS_SECRET_KEY=abc'), 'aws key');
ok(isSensitive('ssh host "cat ~/.ssh/id_rsa"'), 'private key file');
ok(!isSensitive('npm run dev'), 'npm run dev clean');
ok(!isSensitive('git status'), 'git status clean');
ok(!isSensitive('docker compose up -d'), 'docker clean');

console.log('== IsCommandish ==');
ok(isCommandish('docker compose down && docker compose up -d'), 'chained cmd');
ok(isCommandish('netstat -ano | findstr :8080'), 'pipe cmd');
ok(isCommandish('ssh deploy@10.0.0.5 \'cd /app && git pull\''), 'ssh cmd');
ok(!isCommandish('今天天气不错我们去公园散步吧'), 'cjk sentence rejected');
ok(!isCommandish(''), 'empty rejected');
ok(!isCommandish('a'.repeat(900)), 'too long rejected');
ok(!isCommandish('这是一段普通中文文本用来测试剪贴板过滤'), 'cjk long text rejected');
ok(isCommandish('git commit -m "fix: 中文提交信息"'), 'cmd with cjk message ok');
ok(!isCommandish('明天记得买牛奶和鸡蛋还有面包。'), 'sentence ending rejected');

console.log('== CompareRecent ==');
const now = Date.now(), d = 86400000;
const old = { title: 'old', lastUsedAt: now - 30 * d, copies: 5 };
const recent = { title: 'now', lastUsedAt: now - 3600e3, copies: 1 };
const never = { title: 'never', lastUsedAt: 0, createdAt: now - 100 * d };
const arr = [old, recent, never].sort(compareRecent);
ok(arr[0] === recent && arr[1] === old && arr[2] === never, 'order recent > old > never');
const tieA = { title: 'a', lastUsedAt: now, copies: 2 };
const tieB = { title: 'b', lastUsedAt: now, copies: 7 };
ok(compareRecent(tieA, tieB) > 0, 'same time: more copies first');

console.log('== CollectSuggestions ==');
const hist = [
  'ssh deploy@10.0.0.5 \'cd /app && git pull\'',
  'ssh deploy@10.0.0.5 \'cd /app && git pull\'',
  'ssh deploy@10.0.0.5 \'cd /app && git pull\'',
  'ssh deploy@10.0.0.5 \'cd /app && git pull\'',
  'npm run dev', 'npm run dev', 'npm run dev',
  'cat ~/.aws/credentials',
  'git status', 'git status',
];
const lib = [{ body: 'npm run dev', copies: 9 }];
const sug = collectSuggestions(hist, lib, 3, 3);
ok(sug.length === 1, 'only ssh freq>=3 & not in lib, count=' + sug.length);
ok(sug[0] && sug[0].body.includes('ssh deploy'), 'suggestion body ok');
ok(sug[0].freq === 4, 'freq=4, got ' + (sug[0] && sug[0].freq));

const emptyLib = [];
const sug2 = collectSuggestions(hist, emptyLib, 3, 3);
ok(sug2.length === 2, 'empty lib: ssh+npm both freq>=3 -> 2, got ' + sug2.length);
const sug3 = collectSuggestions(hist, lib, 3, 5);
ok(sug3.length === 0, 'minFreq 5 -> none');

console.log('== 原始大小写 + 同频稳定 ==');
const mixed = collectSuggestions(['Git Status', 'Git Status', 'Git Status', 'git log --oneline'], [], 3, 3);
ok(mixed.length === 1 && mixed[0].body === 'Git Status', 'original case preserved: ' + (mixed[0] && mixed[0].body));
const tie = collectSuggestions(['bolder cmd', 'bolder cmd', 'newer cmd', 'newer cmd'], [], 3, 2);
ok(tie.length === 2 && tie[0].body === 'newer cmd', 'tie newest-first: ' + (tie[0] && tie[0].body));
const danger = s => { let b = s.toLowerCase(); return ['rm -rf','rm -r','rm -fr','rm -f -r','remove-item -recurse','remove-item -r','format c:','format d:','format /fs','format-volume','diskpart','dd if=','git push -f','git push --force','git push --force-with-lease','drop table','drop database','truncate table','truncate database','rd /s','del /s /q','reset --hard'].some(n => b.includes(n)) ? 'high' : 'low'; };
ok(danger('rm -rf /tmp/x') === 'high' && danger('netstat -ano') === 'low', 'danger needle parity');

console.log('');
if (failures === 0) { console.log('ALL GREEN'); process.exit(0); }
console.log(failures + ' FAILED'); process.exit(1);
