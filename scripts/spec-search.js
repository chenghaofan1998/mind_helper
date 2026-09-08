// Command Pocket 逻辑对拍台（规格镜像，仅验证算法设计，不验证 C# 语法）
// 镜像 native/CommandPocketNative.cs 中 CommandSearch.Score/Search 的同一规格，
// 用例对应 docs/TESTCASES.md C 组与 PRODUCT.md §6.3。
'use strict';

const TermMap = [
  ['压缩', '打包', '解压', 'tar', 'zip', 'gzip'],
  ['端口', '占用', 'lsof', 'netstat'],
  ['撤销', '回退', '回滚', 'reset', 'revert'],
  ['清理', 'prune', 'clean'],
  ['查找', '搜索', 'find', 'grep', 'rg'],
  ['删除', '移除', 'rm', 'delete', 'del'],
  ['复制', '拷贝', 'cp', 'copy'],
  ['移动', '重命名', 'mv', 'rename'],
  ['权限', 'chmod', 'chown'],
  ['进程', 'ps', 'kill', 'top', 'htop'],
  ['网络', 'curl', 'wget', 'ping', 'ssh'],
  ['创建目录', 'mkdir'],
  ['日志', 'tail', 'log'],
  ['提交', 'commit'],
  ['推送', '拉取', 'push', 'pull', 'fetch'],
];

const normalize = (v) => (v || '').toLowerCase().trim();
const hasAny = (text, tokens) => tokens.some((t) => text.includes(t));

function card(o) {
  return Object.assign({
    product: 'Linux', title: '', aliases: '', body: '', desc: '', tags: '', source: '',
    purpose: '', risk: 'low', kind: 'command', fav: false, heat: 0, copies: 0,
    used: new Date('2026-08-01'), updated: new Date('2026-08-01')
  }, o);
}

function searchPool(c) {
  return normalize([c.title, c.aliases, c.body, c.desc, c.tags, c.product, c.source, c.purpose].join(' '));
}

function recScore(c, now) {
  let s = c.fav ? 5 : 0;
  if (c.copies > 0) {
    const days = Math.max(0, (now - c.used) / 86400000);
    if (days < 30) s += Math.min(3, c.copies);
    else if (days < 90) s += 1;
  }
  s += Math.min(Math.max(c.heat, 0), 5);
  return s;
}

function score(c, q) {
  const pool = searchPool(c);
  if (q.length === 0) return recScore(c, new Date());
  let s = 0;
  if (pool.includes(q)) s += 40;
  const terms = q.split(/[ ，,、]/).filter(Boolean);
  for (const term of terms) {
    if (pool.includes(term)) s += 10;
    if (normalize(c.body).includes(term)) s += 12;
    const aliases = (c.aliases || '').split(',').map(normalize);
    if (aliases.some((a) => a === term)) s += 15;
    if (normalize(c.purpose).includes(term)) s += 14; // 目的句 ≥ 标题
    if (normalize(c.title).includes(term)) s += 12;   // 标题单独
  }
  for (const group of TermMap) {
    if (!hasAny(q, group)) continue;
    if (hasAny(pool, group)) s += 8;
    if (hasAny(normalize(c.body), group)) s += 8;
  }
  if (s === 0) return 0;
  if (c.kind === 'command' || c.kind === 'prompt') s += 10;
  else if (c.kind === 'guide') s += 5;
  else if (c.kind === 'doc') s -= 8;
  return s;
}

function search(cards, q, product, limit) {
  const now = new Date();
  const out = cards
    .filter((c) => !product || product === '全部' || c.product === product)
    .map((c) => ({ c, s: score(c, q) }))
    .filter((x) => x.s > 0 || q.length === 0)
    .sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      const ra = recScore(a.c, now), rb = recScore(b.c, now);
      if (rb !== ra) return rb - ra;
      return b.c.updated - a.c.updated;
    });
  return out.slice(0, limit).map((x) => x.c.title);
}

// ---------- 夹具（对应 TESTCASES 素材） ----------
const lib = [
  card({ title: 'netstat 查端口', aliases: 'netstat,端口,占用', body: 'netstat -tulnp | grep :8080',
    purpose: '查端口被谁占着', copies: 9, used: new Date('2026-08-20'), updated: new Date('2026-08-20'), heat: 2 }),
  card({ title: 'lsof 看占用进程', aliases: 'lsof', body: 'lsof -i :8080', purpose: '看哪个程序占着端口', copies: 3, used: new Date('2026-09-01'), updated: new Date('2026-09-01') }),
  card({ title: 'tar 打包', aliases: 'tar,压缩,打包', body: 'tar -czf x.tar.gz mydir', purpose: '把文件夹打包成压缩包发给别人', copies: 12, used: new Date('2026-09-05'), updated: new Date('2026-09-05') }),
  card({ title: 'git push 失败重推', aliases: 'git,push,force', body: 'git push --force-with-lease origin main', risk: 'high', purpose: '推送被拒后强制推上去', copies: 2, used: new Date('2026-08-30'), updated: new Date('2026-08-30') }),
  card({ title: '查磁盘占用', aliases: 'df,磁盘,du', body: 'df -h', purpose: '看磁盘满了没有', copies: 1, used: new Date('2026-07-01'), updated: new Date('2026-07-01') }),
  card({ title: 'cp 复制文件', aliases: 'cp,复制,拷贝', body: 'cp a.txt b.txt', purpose: '复制一份文件', copies: 0, used: new Date('2026-09-06'), updated: new Date('2026-09-06') }),
  card({ title: 'tail 看日志', aliases: 'tail,日志,log', body: 'tail -f app.log', purpose: '实时看程序日志', copies: 0, used: new Date('2026-09-06'), updated: new Date('2026-09-06') }),
];

// ---------- 用例 ----------
let pass = 0, fail = 0;
function expect(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  ← ' + detail); }
}

// T1 目的句整句命中 → 首屏第 1（C1 主验收线）
expect('T1 用话整句找回命中 netstat 卡第1位',
  search(lib, '查端口被谁占着', '全部', 3)[0] === 'netstat 查端口',
  JSON.stringify(search(lib, '查端口被谁占着', '全部', 3)));

// T2 碎片词（在目的句里而非标题）也能命中
expect('T2 碎片"占着"命中 netstat 卡', search(lib, '占着', '全部', 3)[0] === 'netstat 查端口', JSON.stringify(search(lib, '占着', '全部', 3)));
expect('T2b 碎片"占着"排在标题无关卡前', search(lib, '占着', '全部', 3).includes('netstat 查端口'));

// T3 别名命中不退化（回归 C3）
expect('T3 别名 lsof 命中', search(lib, 'lsof', '全部', 3)[0] === 'lsof 看占用进程', JSON.stringify(search(lib, 'lsof', '全部', 3)));
expect('T3b 中文"端口"命中（组/别名）', search(lib, '端口', '全部', 3)[0] === 'netstat 查端口', JSON.stringify(search(lib, '端口', '全部', 3)));
expect('T3c 中文"复制"命中 cp 卡', search(lib, '复制', '全部', 3)[0] === 'cp 复制文件', JSON.stringify(search(lib, '复制', '全部', 3)));
expect('T3d 中文"日志"命中 tail 卡', search(lib, '日志', '全部', 3)[0] === 'tail 看日志', JSON.stringify(search(lib, '日志', '全部', 3)));

// T4 目的句与标题命中比较：目的句权重 ≥ 标题
const clash = lib.slice(0, 1).concat(card({ title: '查看被占用的端口', aliases: '', body: 'echo x', purpose: '', copies: 1 }));
expect('T4 目的句命中卡排在纯标题命中卡前',
  search(clash, '占着', '全部', 3)[0] === 'netstat 查端口', JSON.stringify(search(clash, '占着', '全部', 3)));

// T5 中文一句话（术语组兜底）：把文件夹打包发人 → tar 类命中
expect('T5 一句话"把文件夹打包发人"命中 tar 卡',
  search(lib, '把文件夹打包发人', '全部', 3)[0] === 'tar 打包', JSON.stringify(search(lib, '把文件夹打包发人', '全部', 3)));

// T6 空查询=预测（频率×热度×收藏），永不空屏且顺序合理：netstat 复制9次+热度2 → 第一
expect('T6 空查询按 RecScore 排序且非空', (() => {
  const r = search(lib, '', '全部', 10);
  return r.length > 0 && r[0] === 'netstat 查端口';
})(), JSON.stringify(search(lib, '', '全部', 10)));

// T7 产品过滤
expect('T7 产品过滤生效', search(lib, '', '不存在的产品', 10).length === 0);

// T8 无命中 → 空结果（零命中出口判定依据）
expect('T8 无命中返回空', search(lib, 'qqqzzz', '全部', 10).length === 0);

console.log('\n对拍结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
