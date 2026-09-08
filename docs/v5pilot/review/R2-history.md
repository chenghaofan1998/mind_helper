# R2 · 终端历史读取专项审查

范围：History / ImportHistory / RefreshRows / SelfTest × SPEC F6/F7。
用户反馈"命令不全、是很久以前的"＝源缺＋内容旧＋时间戳误导三症叠加。

## 一、根因（★＝需真机确认）

1. **[a] 单源且天然陈旧**：DefaultPath() 是全产品唯一来源（导入/建议/首次引导三处同路）。PSReadLine 仅在 PowerShell 干净退出时落盘：长挂窗口/强杀/断电期间新命令只在内存，文件 mtime＝上次退出时刻。活跃 shell 若为 Git Bash/CMD/WSL，文件可几周不动→整库陈旧。CMD 无持久历史；WSL `\\wsl$\…` 退出才写★；Git Bash `%USERPROFILE%\.bash_history`★。文件缺失时 MaybeOfferImport 直接 return、托盘"导入"静默无效——"不全"无解释。
2. **[f] 导入伪造时间戳＋无衰减**：Cards.New 置 LastUsedAt=now→历史导入卡全标"上次:今天"(导入时刻非真实使用)，挤占 F2 Top6；F6 按全文件累计频次取 Top20，老高频恒占优、近期低频落选→首屏旧命令却标"今天"。F7 同病(minFreq≥3 全窗口计频)。
3. **[f] 同频并列失效**：导入/建议的 sort 同频返 0，List.Sort 不稳定（注释"并列按最近出现"不成立）。
4. **[f] 读锁不一致**：≤4MB 走 File.ReadAllText(FileShare.Read)，>4MB 才 ReadWrite；PSReadLine 写盘瞬间被锁→catch 吞掉→导入/建议静默全无（"不全"直接命中点）。尾部仅一次 fs.Read（可 short-read）。
5. **[b] 编码**：UTF16LE(BOM)/UTF8 均能解（SelfTest#8 覆盖）。缺陷：无 BOM UTF-16 按 UTF-8 解出含 \0 行（Trim 不去 \0）；不认 UTF-8 BOM；Git Bash 中文若 GBK 混排乱码★。
6. **[c] 4MB 尾部**：尾＝最新，通常不致"旧"；仅 short-read 边缘丢行，次要。
7. **[d] 多行拆碎**：PSReadLine 一物理行＝一条，安全；扩源到 bash 后反斜杠续行/heredoc 被拆成碎片行计频→虚高/残行进建议，扩源前必修。
8. **[e] PSReadLine 结构★**：HistoryNoDuplicates 默认值、退出"重写或追加"、上限 4096。若默认去重→文件内频次≈1→F6 按频率、F7 minFreq≥3 全哑或任选。

## 二、修复方案

**多源探测**（存在者按 LastWriteTime 取最新为主源，失败降级；只读）：
- `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`（现状）
- `%USERPROFILE%\.bash_history`（Git Bash★）；CMD 不探测；WSL/VS Code 集成终端路径★确认前不列入、文案说明。

**UI 明示**：全源缺失→首次引导改"未找到可读终端历史，已检查：<逐路径 有/无>"；导入成功 toast："自 <路径> 收 N 条（文件时间 MM-dd HH:mm）"。

**来源时间戳可见化（最小改）**：历史导入新卡 LastUsedAt 置 MinValue（不伪造"用过"，排真实使用之后）；建议副行与 toast 带源路径＋文件 mtime，可自证新旧。

**SPEC F6/F7 最小改动**：F6"PSReadLine 历史"→"终端历史多源探测（取最后写入最新）；新卡不伪造使用时间、展示来源文件时间"；F7 补"计频限最近写入尾部区段"。红线不变（只读、无监听）。

## 三、判定线（自测＝修好）

真机（pwsh 与 Git Bash 各敲 3 条新命令并正常退出后开小窗）：① 今天命令在建议/导入结果中且旧命令不排其前；② 副行来源文件时间为今天；③ 删光候选文件→启动见明示文案而非静默空库；④ 构造 >4MB 含续行文件→无碎片建议、尾部最新 3 条在列。SelfTest/对拍台补：续行合并、同频取新、无 BOM UTF-16 无 \0、源选择纯函数（改 History 后同步 pilot-check.js 复刻）。
