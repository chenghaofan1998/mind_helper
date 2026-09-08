#!/usr/bin/env node
// Command Pocket · 从 C# 单文件剥离 UI/入口类型 → 纯逻辑 Program.cs（供 net8 真跑 SelfTest）
// 用法：node strip-logic.js <源.cs> <输出.cs>
import fs from 'node:fs';
const srcPath = process.argv[2];
const outPath = process.argv[3];
if (!srcPath || !outPath) { console.error('用法: node strip-logic.js <源.cs> <输出.cs>'); process.exit(2); }

let src = fs.readFileSync(srcPath, 'utf8');
// 去掉 Forms/Drawing 的 using（net8 无这些程序集）
src = src.split('\n').filter(l =>
  !l.includes('using System.Drawing') && !l.includes('using System.Windows.Forms')).join('\n');

// 按大括号配对删除指定类型
function dropType(code, name) {
  const re = new RegExp('(^|\n)[ \\t]*internal (static |sealed )*class ' + name + '[^\\n]*\n');
  const m = re.exec(code);
  if (!m) return code;
  let i = code.indexOf('{', m.index);
  if (i < 0) return code;
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}') { depth--; if (depth === 0) return code.slice(0, m.index) + code.slice(j + 1); }
  }
  return code;
}
for (const n of ['Ui', 'PilotAppContext', 'PilotForm', 'ManualDialog', 'Program'])
  src = dropType(src, n);

if (/class (Ui|PilotAppContext|PilotForm|ManualDialog|Program)\b/.test(src))
  console.error('WARN: 仍有 UI/入口类型残留（剥离不完整）');

src = src.replace(/\}\s*$/, `
    internal static class PilotLogicRunner
    {
        private static int Main()
        {
            return SelfTest.Run();
        }
    }
}
`);
fs.writeFileSync(outPath, src);
console.log('剥离完成: ' + outPath + ' (' + src.split('\n').length + ' 行)');
