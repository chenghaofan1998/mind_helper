import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("./ui/", import.meta.url);
const C = { bg: "#111827", panel: "#1F2937", card: "#F8FAFC", ink: "#172033", muted: "#526071", line: "#CBD5E1", primary: "#2563EB", accent: "#60A5FA", pale: "#DBEAFE", red: "#C54B43", redPale: "#FBECEA", amber: "#D99A42", white: "#FFFFFF" };
const font = "Inter,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif";
const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const r = (x,y,w,h,fill,rx=18,stroke="none",sw=1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const t = (x,y,s,size=18,color=C.ink,weight=400,anchor="start") => `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`;
const ln = (x1,y1,x2,y2,color=C.line,sw=1,dash="") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" ${dash?`stroke-dasharray="${dash}"`:""}/>`;
const pill = (x,y,label,fill=C.pale,color=C.primary,w=0) => { const width=w||Math.max(72,label.length*15+28); return r(x,y,width,32,fill,16)+t(x+width/2,y+22,label,14,color,600,"middle"); };
const button = (x,y,w,label,primary=true) => r(x,y,w,48,primary?C.primary:C.white,14,primary?C.primary:C.line)+t(x+w/2,y+31,label,16,primary?C.white:C.ink,650,"middle");
const icon = (x,y,glyph,fill=C.pale,color=C.primary) => r(x,y,42,42,fill,13)+t(x+21,y+28,glyph,18,color,700,"middle");

function svg(title, subtitle, body, width=1440, height=1000) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#0F172A" flood-opacity=".45"/></filter><linearGradient id="glow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1E293B"/><stop offset="1" stop-color="#0F172A"/></linearGradient></defs>
  ${r(0,0,width,height,"url(#glow)",0)}
  <circle cx="170" cy="100" r="240" fill="#2563EB" opacity=".11"/><circle cx="1320" cy="930" r="330" fill="#60A5FA" opacity=".07"/>
  ${t(72,74,"ACTION POCKET · PRODUCT DESIGN",14,"#93C5FD",700)}${t(72,116,title,34,C.white,700)}${t(72,148,subtitle,17,"#CBD5E1",400)}
  ${body}
  ${t(width-72,height-38,"DESIGN BASELINE · 2026",12,"#94A3B8",600,"end")}
</svg>`;
}

function miniWindow(content, footer="Ctrl  Alt  P · 隐藏") {
  return `${r(438,190,564,704,C.card,26,"#475569",1)}<g filter="url(#shadow)">${r(438,190,564,704,C.card,26)}</g>
  ${r(438,190,564,64,C.panel,26)}${r(438,228,564,26,C.panel,0)}
  ${icon(458,201,"AP",C.primary,C.white)}${t(512,224,"Action Pocket",18,C.white,700)}${t(512,244,"连接你的知识库",12,"#CBD5E1")}
  ${pill(866,206,"已连接",C.pale,C.primary,112)}
  ${content}
  ${ln(462,842,978,842)}${t(466,870,footer,12,C.muted,500)}${t(974,870,"本地 · 不执行命令",12,C.muted,500,"end")}`;
}

const capture = miniWindow(`
  ${pill(462,278,"记入",C.primary,C.white,78)}${pill(548,278,"查询",C.white,C.muted,78)}
  ${t(462,342,"先接住，不打断当前事情",25,C.ink,700)}${t(462,371,"原文会写入你选择的知识库位置",14,C.muted)}
  ${r(462,397,516,214,C.white,18,C.line)}${t(486,431,"原始内容",13,C.primary,650)}
  ${t(486,468,"今天终于理解了 Adam：",18,C.ink,500)}${t(486,500,"动量像带方向的惯性，二阶矩像路况…",17,C.ink)}${t(486,541,"保留困惑、类比和纠错过程。",17,C.ink)}
  ${pill(486,565,"纯文本",C.pale,C.primary)}${pill(578,565,"用户显式输入",C.pale,C.primary,128)}
  ${t(462,650,"写入位置",13,C.muted,600)}${r(462,664,516,48,C.white,12,C.line)}${t(480,695,"Logseq / pages/action-pocket-inbox.md",15,C.ink,500)}
  ${button(462,738,516,"保存到知识库   Ctrl + Enter",true)}
  ${t(462,812,"只有知识库确认写入成功后，才会清空输入。",13,C.muted)}
`);

const search = miniWindow(`
  ${pill(462,278,"记入",C.white,C.muted,78)}${pill(548,278,"查询",C.primary,C.white,78)}
  ${t(462,342,"现在遇到什么问题？",25,C.ink,700)}${t(462,371,"不必记住标题，用你此刻的说法描述",14,C.muted)}
  ${r(462,401,516,94,C.white,18,C.primary,2)}${t(486,438,"我以前为什么觉得 Adam 的动量容易理解？",17,C.ink,500)}${pill(486,454,"抽象想法",C.pale,C.primary,96)}${t(950,468,"↵",19,C.primary,700,"end")}
  ${r(462,521,516,74,"#EEF2F7",16)}${icon(478,537,"R",C.primary,C.white)}${t(534,553,"知识库 RAG",15,C.ink,650)}${t(534,576,"混合检索 · rerank · 索引 2 分钟前更新",13,C.muted)}${pill(866,541,"健康",C.pale,C.primary,88)}
  ${t(462,638,"你也可以问",13,C.muted,600)}
  ${r(462,656,246,62,C.white,14,C.line)}${t(480,682,"Docker 日志怎么缩小范围？",13,C.ink,600)}${t(480,703,"命令 · 参数 · 来源",12,C.muted)}
  ${r(732,656,246,62,C.white,14,C.line)}${t(750,682,"那次架构取舍依据是什么？",13,C.ink,600)}${t(750,703,"决策 · 限制 · 缺口",12,C.muted)}
  ${t(462,790,"结果优先返回你保存过的内容，不自动生成新答案。",13,C.muted)}
`);

const results = miniWindow(`
  ${pill(462,275,"← 返回查询",C.white,C.muted,116)}${pill(852,275,"RAG · 0.91",C.pale,C.primary,126)}
  ${t(462,336,"找到 3 段相关原文",24,C.ink,700)}${t(462,365,"知识库已完成语义检索和 rerank",14,C.muted)}
  ${r(462,392,516,252,C.white,18,C.primary,2)}${pill(482,410,"我理解过的解释",C.pale,C.primary,138)}${pill(846,410,"原文",C.primary,C.white,108)}
  ${t(482,466,"动量像带方向的惯性：如果梯度只是短暂抖动，",16,C.ink,500)}${t(482,494,"它不会马上掉头；二阶矩更像路况，让步子在陡峭",16,C.ink,500)}${t(482,522,"方向自动缩小。",16,C.ink,500)}
  ${ln(482,548,958,548)}${t(482,576,"必要上文",12,C.muted,650)}${t(482,600,"当时我卡在“为什么同时需要两个平均值”…",13,C.muted)}
  ${t(482,626,"pages/Adam.md · L18 · block a83f · v24",12,C.primary,600)}
  ${button(462,664,244,"复制原文",false)}${button(718,664,260,"打开知识库原文",true)}
  ${r(462,730,516,72,"#EEF2F7",14)}${t(480,758,"派生提示",12,C.amber,700)}${t(480,782,"可按当前问题转换为解释，但不会替代上方原文。",13,C.ink)}
  ${t(462,826,"☆ 固定",13,C.muted,600)}${t(550,826,"有用",13,C.primary,650)}${t(620,826,"没解决",13,C.muted,600)}
`);

const risk = miniWindow(`
  ${pill(462,276,"查询结果",C.white,C.muted,98)}${t(462,337,"重置到上一个 Git 状态",24,C.ink,700)}
  ${r(462,368,516,108,C.white,16,C.line)}${t(482,397,"原文命令",12,C.muted,650)}${t(482,432,"git reset --hard HEAD~1",19,C.ink,650)}${t(482,459,"pages/git-recovery.md · L42",12,C.primary,600)}
  ${r(486,506,468,250,C.redPale,22,C.red,2)}${icon(510,528,"!",C.red,C.white)}${t(568,549,"复制前确认",22,C.red,750)}
  ${t(510,590,"这条命令会丢弃未提交修改。",16,C.ink,650)}${t(510,619,"Action Pocket 只会复制，不会执行。",14,C.muted)}
  ${r(510,646,420,44,C.white,10,"#E8BBB7")}${t(526,674,"请先确认仓库和备份状态",14,C.ink,500)}
  ${button(510,708,196,"取消   Esc",false)}${button(718,708,212,"仍然复制",true)}
  ${t(462,810,"默认焦点在“取消”；Tab 不会离开确认框。",13,C.muted)}
`);

function adminWindow() {
  return `${r(104,184,1232,728,C.card,28,"#475569")}<g filter="url(#shadow)">${r(104,184,1232,728,C.card,28)}</g>
  ${r(104,184,250,728,C.panel,28)}${r(326,184,28,728,C.panel,0)}${icon(132,214,"AP",C.primary,C.white)}${t(184,239,"Action Pocket",19,C.white,700)}
  ${t(132,305,"后台",12,"#94A3B8",700)}${pill(126,326,"知识源",C.primary,C.white,190)}${t(150,396,"全局热键",15,"#CBD5E1",550)}${t(150,444,"隐私与权限",15,"#CBD5E1",550)}${t(150,492,"观察能力",15,"#CBD5E1",550)}${t(150,540,"诊断",15,"#CBD5E1",550)}
  ${t(392,239,"知识源连接",28,C.ink,700)}${t(392,270,"正文与 RAG 留在知识库，Action Pocket 只连接能力。",15,C.muted)}${button(1110,216,180,"+ 添加连接器",true)}
  ${r(392,306,896,166,C.white,18,C.line)}${icon(418,332,"L",C.pale,C.primary)}${t(476,350,"工作知识库",18,C.ink,700)}${t(476,376,"https://knowledge.local/action-pocket/v1",13,C.muted)}${pill(1136,330,"健康",C.pale,C.primary,116)}
  ${pill(418,408,"RAG",C.primary,C.white,72)}${pill(498,408,"写入",C.pale,C.primary,78)}${pill(584,408,"原文定位",C.pale,C.primary,106)}${pill(698,408,"状态",C.pale,C.primary,78)}${t(1264,431,"测试连接  ·  编辑",13,C.primary,650,"end")}
  ${r(392,492,896,144,"#EEF2F7",18)}${icon(418,518,"F",C.white,C.primary)}${t(476,536,"文件型 Graph（降级）",18,C.ink,700)}${t(476,563,"本地词法 fallback · D:\Notes\Logseq",13,C.muted)}${pill(1110,516,"可写",C.pale,C.primary,86)}${pill(1204,516,"降级",C.redPale,C.red,66)}${t(418,606,"当 RAG 来源不可用时明确提示，不冒充语义检索。",13,C.muted)}
  ${t(392,692,"连接器能力",18,C.ink,700)}${r(392,714,896,142,C.white,18,C.line)}${t(418,748,"检索模式",13,C.muted)}${t(600,748,"混合 RAG + rerank",14,C.ink,650)}${t(418,782,"索引状态",13,C.muted)}${t(600,782,"2 分钟前更新 · 权限已裁剪",14,C.ink,650)}${t(418,816,"认证",13,C.muted)}${t(600,816,"系统凭据库 · Token 不进入前端",14,C.ink,650)}`;
}
const admin = adminWindow();

const hotkey = `${r(112,210,1216,644,C.card,28,"#475569")}<g filter="url(#shadow)">${r(112,210,1216,644,C.card,28)}</g>
${t(160,270,"全局热键与窗口生命周期",28,C.ink,700)}${t(160,301,"只有一个窗口实例；启动不自动读取任何内容。",15,C.muted)}
${pill(1060,244,"Ctrl + Alt + P",C.primary,C.white,210)}
${icon(168,370,"○",C.pale,C.primary)}${t(222,391,"后台驻留",17,C.ink,700)}${t(222,416,"托盘可见 · 不监听内容",13,C.muted)}${ln(354,391,448,391,C.primary,3)}
${icon(462,370,"⌨",C.pale,C.primary)}${t(516,391,"用户手势",17,C.ink,700)}${t(516,416,"热键或托盘点击",13,C.muted)}${ln(650,391,744,391,C.primary,3)}
${icon(758,370,"▣",C.primary,C.white)}${t(812,391,"小窗显示",17,C.ink,700)}${t(812,416,"置顶并聚焦输入",13,C.muted)}${ln(946,391,1040,391,C.primary,3)}
${icon(1054,370,"✓",C.pale,C.primary)}${t(1108,391,"完成/隐藏",17,C.ink,700)}${t(1108,416,"Esc 或再次热键",13,C.muted)}
${r(160,490,1120,264,"#EEF2F7",20)}${t(190,532,"键盘规则",17,C.ink,700)}
${pill(190,556,"Ctrl+Alt+P",C.white,C.primary,132)}${t(338,578,"显示 / 隐藏",14,C.ink,600)}
${pill(190,610,"Esc",C.white,C.primary,70)}${t(276,632,"关闭模态；否则隐藏小窗",14,C.ink,600)}
${pill(650,556,"Enter",C.white,C.primary,78)}${t(744,578,"查询 / 结果主操作",14,C.ink,600)}
${pill(650,610,"Ctrl+Enter",C.white,C.primary,118)}${t(784,632,"确认写入",14,C.ink,600)}
${t(190,704,"注册失败时明确提示并保留托盘入口；不降级为键盘钩子。",14,C.red,650)}`;

const monitoring = `${r(300,190,840,704,C.card,28,"#475569")}<g filter="url(#shadow)">${r(300,190,840,704,C.card,28)}</g>
${pill(340,226,"未来能力 · 默认关闭",C.redPale,C.red,174)}${t(340,292,"开始一次可见的观察会话",28,C.ink,700)}${t(340,325,"视觉识别与小模型只有在你明确授权后工作。",15,C.muted)}
${r(340,366,760,88,C.white,16,C.line)}${icon(362,389,"▣",C.pale,C.primary)}${t(418,408,"观察范围",14,C.muted,600)}${t(418,433,"仅指定应用窗口 · 不采集其他桌面内容",16,C.ink,650)}
${r(340,470,760,88,C.white,16,C.line)}${icon(362,493,"⌛",C.pale,C.primary)}${t(418,512,"保留策略",14,C.muted,600)}${t(418,537,"原始帧仅会话内存 · 默认只保留结构化事件",16,C.ink,650)}
${r(340,574,760,88,C.white,16,C.line)}${icon(362,597,"↗",C.pale,C.primary)}${t(418,616,"数据去向",14,C.muted,600)}${t(418,641,"本机小模型 · 不发送云端 · 不自动写知识库",16,C.ink,650)}
${r(340,686,760,54,C.redPale,14)}${t(364,719,"● 观察中必须持续显示托盘与小窗状态，可一键停止",14,C.red,700)}
${button(340,774,260,"取消",false)}${button(620,774,480,"我理解并开始本次会话",true)}
${t(340,858,"该页面是扩展预留，不代表 MVP 已实现监控。",13,C.muted)}`;

const architecture = `${r(90,202,1260,650,C.card,28,"#475569")}<g filter="url(#shadow)">${r(90,202,1260,650,C.card,28)}</g>
${t(140,258,"输入 → 连接器 → 知识源 → 可信输出",27,C.ink,700)}${t(140,291,"能力通过协商扩展，数据边界保持不变。",15,C.muted)}
${r(138,342,238,386,"#EEF2F7",20)}${t(166,383,"输入信封",18,C.ink,700)}${pill(166,406,"文字 · MVP",C.primary,C.white,130)}${pill(166,454,"图片 · 预留",C.white,C.muted,130)}${pill(166,502,"屏幕 · 预留",C.white,C.muted,130)}${pill(166,550,"事件 · 预留",C.white,C.muted,130)}${t(166,610,"意图",13,C.muted,700)}${t(166,638,"capture / query / observe",13,C.ink,600)}${t(166,680,"显式授权 · 来源 · 保留期",13,C.muted)}
${t(406,540,"→",34,C.primary,700)}
${r(474,342,250,386,C.white,20,C.line)}${t(502,383,"Connector Gateway",18,C.ink,700)}${t(502,420,"能力发现",14,C.muted)}${t(502,452,"认证与超时",14,C.muted)}${t(502,484,"字段校验",14,C.muted)}${t(502,516,"来源版本",14,C.muted)}${t(502,548,"错误归一化",14,C.muted)}${ln(502,580,696,580)}${pill(502,606,"search",C.pale,C.primary,84)}${pill(594,606,"write",C.pale,C.primary,78)}${pill(502,650,"locate",C.pale,C.primary,84)}${pill(594,650,"status",C.pale,C.primary,78)}
${t(754,540,"→",34,C.primary,700)}
${r(822,342,238,386,"#EEF2F7",20)}${t(850,383,"知识库拥有",18,C.ink,700)}${t(850,425,"正文与权限",14,C.ink,600)}${t(850,461,"Embedding / RAG",14,C.ink,600)}${t(850,497,"Rerank",14,C.ink,600)}${t(850,533,"索引新鲜度",14,C.ink,600)}${t(850,569,"原文定位",14,C.ink,600)}${pill(850,622,"不重复建设",C.primary,C.white,142)}
${t(1090,540,"→",34,C.primary,700)}
${r(1158,342,142,386,C.white,20,C.line)}${t(1182,383,"输出",18,C.ink,700)}${pill(1180,414,"原文",C.pale,C.primary,96)}${pill(1180,458,"上下文",C.pale,C.primary,96)}${pill(1180,502,"来源",C.pale,C.primary,96)}${pill(1180,546,"命令",C.pale,C.primary,96)}${pill(1180,590,"步骤",C.pale,C.primary,96)}${t(1180,650,"原始证据",13,C.ink,650)}${t(1180,676,"≠ 派生结果",13,C.red,650)}
${t(140,796,"未来 observe 只增加一种显式输入会话，不改变知识源、证据和权限边界。",14,C.muted,600)}`;

const files = {
  "01-quick-capture.svg": svg("快速记入", "热键唤起后 3 秒内接住原始想法", capture),
  "02-rag-search.svg": svg("抽象问题查询", "把语义检索交还给具备 RAG 的知识库", search),
  "03-rag-results.svg": svg("证据优先的结果", "原文、上下文、定位与派生提示严格分层", results),
  "04-command-risk.svg": svg("危险命令确认", "只复制、不执行；默认焦点选择安全路径", risk),
  "05-backstage-connectors.svg": svg("后台 · 知识源", "低频配置连接器、能力、健康与真实检索模式", admin),
  "06-hotkey-lifecycle.svg": svg("全局热键", "单实例小窗 + 后台驻留，不使用键盘钩子", hotkey),
  "07-monitoring-consent.svg": svg("未来观察能力", "显式授权、持续可见、随时停止、默认不留原始帧", monitoring),
  "08-input-output-architecture.svg": svg("输入输出架构", "扩展模态，不扩张数据所有权", architecture),
};

await mkdir(OUT, { recursive: true });
await Promise.all(Object.entries(files).map(([name, content]) => writeFile(new URL(name, OUT), content, "utf8")));
console.log(`generated ${Object.keys(files).length} SVG files`);
