# VISION 执行附录（v3.2）· 可行性矩阵 · UX 规格 · 试点方案

> 主纲见 docs/VISION.md。本文是给"照着做"的执行细节。**v3.2 修订注记（裁判裁定后，与下文冲突处以本节为准）**：
> ① 常驻监听/自动推送/原地注入（旧档2 自动版、档3）**整体移出 v3.x**；v3.x 唯一内容读取面＝S2 "报错即查"（显式键/托盘触发读 1 次，读后即弃、原文零落盘）；② 档1 学习版（用进程名桶数据）降级为**试点通过后才立项**，S1 只做"唤起瞬间 1 次进程名＝场景标签＋种子置顶"，不驻留不落盘；③ 北极星口径改为"**有复制唤起的 Top3 采纳率 ≥60%，样本 <50 不亮灯**"（复制≠用过，粘贴成功不可观测）；④ 里程碑改 S0–S3（见主纲 §4）：S0 先还 v0.4 欠账（危险卡复制确认＋热键返回值检查＋批量写）；⑤ 本附录矩阵中"键盘钩子危险拦截 / 原地注入 / 常驻剪贴板监听"对应行标注 v3.x 不做，仅存档；⑥ 试点先测双入口日频（命令回忆 vs 报错即查），再定窄口。
> 核验基准：`native/CommandPocketNative.cs`（3412 行，WinForms 单文件，纯 csc，仅引用 System/Core/Drawing/Forms，无 System.Net.Http）。

---

## A. 基线事实（源码核验结论）

1. **编译约束**：LLM JSON 请求只能用 `HttpWebRequest/WebClient`（已有 `TimeoutWebClient`），或给 build.ps1 加 `/reference:System.Net.Http.dll`。
2. **可复用资产**：`RegisterHotKey`(Ctrl+Alt+P, id=0xA1B1) 已在 `PocketForm.OnHandleCreated/WndProc`；`PocketForm` 无边框＋TopMost＋`ShowInTaskbar=false`＋圆角 → 可直接派生浮层；`CommandSearch.Search` 空查询已走 `RecScore`（收藏>近期复制>Heat）→ **档1 底座已存在**；`CommandStore` 全量读改写 jsonl（.tmp→File.Replace＋.bak），`BumpCopy` 已有；JSON 按 key 解析、未知 key 忽略（读卡宽容＝回滚兜底）。
3. **缺口**：① 全代码无 LLM/AI HTTP（P4 未落地）；② **危险复制确认未实现**——`CopySelected`(L761) 直接 `Clipboard.SetText`，注释明言"风险仅自标不影响复制"；③ 无前台窗口感知/剪贴板监听/指标文件。
4. 新逻辑全部挂入现有 `--self-test`（临时目录＋合成数据）。

## B. 可行性矩阵（机制 → 技术 → 评级 → 工作量 → 接入点 → 风险）

| 机制 | WinForms/PInvoke 技术 | 级 | 量 | 接入点（现有代码） | 主要风险与规避 |
|---|---|---|---|---|---|
| 前台窗口→场景映射 | `GetForegroundWindow`+`GetWindowText`+`GetWindowThreadProcessId`；内置种子表(标题/进程→场景) | A | S | 新 `SceneAware` 静态类；`PocketAppContext.ShowPocket()` 唤出前调用 | UIPI：管理员窗口读不到标题→"未知场景"兜底；排除自己进程 |
| 档1 预测队列 | 复用现有空查询推荐；唤出时把推断场景写入 `sceneFilter` 再 `SearchNow()` | A | S | `ShowPocket()→Reload()/SearchNow()` | 推荐为空保持现状文案，不新增弹窗 |
| 终端历史导入 | 纯 File IO；PS5: `%APPDATA%\...\PSReadLine\ConsoleHost_history.txt`，**PS7 无 Windows 段**；CMD 无持久历史→提示跳过；WSL ext4 不可读→跳过 | A | M | 新导入向导 Tab（ManagerForm）→现有 `CommandExtractor/Classifier`→`AddCards` | 脱敏正则整行剔除 `(?i)(password\|token\|secret\|api[_-]?key\|BEGIN .*PRIVATE KEY)`；去重＋频率 Top-N 做减法 |
| 剪贴板监听 | `AddClipboardFormatListener(hwnd)`+`WM_CLIPBOARDUPDATE`(0x031D) 进现有 `WndProc` | B | S | PocketForm（隐藏也有 handle）或独立隐藏窗 | 自触发：程序写剪贴板记时间戳，500ms 内忽略；非文本直接返回 |
| 无焦点提示浮层 | 新轻量 Form：`CreateParams` 加 `WS_EX_NOACTIVATE\|TOOLWINDOW\|TOPMOST`；Timer 自缩 | B | M | 独立类（同文件新区域），复用 Ui 配色/圆角 | 无焦点收不到键盘→采纳走全局热键/鼠标（方案已改）；`Screen.GetWorkingArea` 防出屏 |
| 采纳热键 Ctrl+Alt+Enter | 第二个 `RegisterHotKey`（新 id 常量）与 0xA1B1 并存 | A | S | `PocketForm.OnHandleCreated` | **现不检查返回值→补检查**，注册失败回退"点击采纳"并提示 |
| 键盘钩子"危险前缀拦截" | `SetWindowsHookEx(WH_KEYBOARD_LL)` | C→**放弃** | L | — | 杀软误报/逐应用不可控/常驻需消息泵；拦截本身反直觉。**换三件套**：复制危险内容警示＋危险卡复制确认＋v3.2 静态检测 |
| 试用态/生命周期 | `CommandCard` 加 `Lifecycle/firstSeen/promotedAt/lastPromptedAt/suppressScenes[]/failCount`；写追加、读缺省 | A | M | 字段区(L1928)、`WriteCard/ReadCard`(L3222/3296)、`RecScore` 小改 | 衰减计时用现有 `lastUsedAt/copyCount` 惰性计算，不加定时器 |
| 隐式成功信号埋点 | 复制点已有(`CopySelected` L761、预览复制 L1596)；3 天复用＝内存 `lastCopy(卡id,时间)`；复制后 10s 内再搜且不相关→疑似失败 | A | S | `CopySelected`/预览复制/采纳路径＋`SearchNow()` 入口 | **别每次写盘**：内存累计，Hide/退出/30s 批量写；给 `CommandStore` 加批量更新 |
| v3.2 执行管线 | `System.Diagnostics.Process`＋重定向＋退出码＋超时；危险词静态正则；审计＝`File.AppendAllText` 到 `audit.jsonl` | A | M | 复用 `CopySelected` 分支＋"危险确认"Modal；新 `SkillRunner` 区域 | .NET Framework 用 `Process.Exited` 事件/回调防 UI 卡死；`cmd /c` vs `pwsh -Command` 由卡字段决定；审计只追加 |
| v3.3 vault 只读索引 | `FileSystemWatcher`＋纯 C# 行解析（标题/围栏代码块正则），独立 `index.json` | A | M | 新 `VaultIndexer` 区域；命中并入 `CommandSearch` 池(低权重) | 只读不改用户文件；**锚点用内容指纹不用纯偏移**；vault 路径白名单入设置 |
| 指标埋点 | 追加写 `metrics.jsonl`，后台设置页展示 | A | S | 浮层显示/采纳/Esc(`SearchKeyDown`)/自隐 Timer 各一处 | 内存缓冲批量落盘，防高频碎写 |
| LLM 审计/技能草稿（配 key） | `HttpWebRequest` POST JSON | B | M | **前置**：统一 HTTP-AI 客户端＋provider 配置（settings.json） | 与 v2 铁律一致：配 key 才启用；此为 v3.3 前置 |

## C. 工程决策

1. **砍键盘钩子**，危险防线＝复制危险内容警示（剪贴板命中危险词表 rm -rf/drop/format → 警示而非答案）＋危险卡复制确认（还 v2 欠账）＋v3.2 执行静态检测。
2. **两个前置基建**（v3.0 开工第一步）：① `RegisterHotKey` 返回值检查＋第二热键注册；② `CommandStore` 批量更新方法。
3. **读卡宽容即回滚兜底**：新字段纯追加，旧 exe 读新库不崩——符合"每阶段可回退"。
4. **AI 前置封装约 1 天**（HttpWebRequest），之后 P4 抽取/保鲜审计/技能草稿共用，避免重复造轮子。

## D. UX 规格与草图

**档1 · 预测队列首屏（v3.0，改现有紧凑壳内容区）**

```
┌ Command Pocket ─── 520×360 ──────────┐
│ [PowerShell ▾] 🔍 搜索(占位=上次行为)   │
│ ──────────────────────────────────── │
│ 此刻你可能要(命中 86%)                 │
│ ▶ git 撤销已推送提交           [复制]  │ ← 命中1·默认高亮
│ ▶ git push 失败重推           [复制]  │ ← 命中2
│ ──────────────────────────────────── │
│ ⚡今日回放:3 提示·2 采纳 │ 最近:tar…   │
└─────────────────────────────────────┘
```

规则：有预测→置顶、默认高亮第 1 条；↑↓ 移动；**Enter＝复制高亮项（语义永不变）**；无预测→退回 v2 推荐区（永不空屏）。

**档2 · 现场提示**：贴前台窗口右上角外侧 8px（不遮操作区），宽 360、约 2 行（标题＋答案首行预览），右侧 [复制][×]；风险>1 琥珀描边＋⚠。2.5s 后**不消失，缩成右下角 12×12 呼吸点**，悬停恢复 3s。**采纳热键＝写剪贴板＋托盘灯闪 100ms**，零弹窗。浮层本体示例（采纳前）：

```
┌ git push 被拒(failed to push…) ──── [复制][×] ┐
│ 方案: git push --force-with-lease origin main  │
└──────────────────────────────────────────────┘
```

**Ctrl+Alt+P ＝ 今日回放页**（同窗切换）：上＝时间线（每条右缘 [采纳][×噪音]）；中＝一行统计"3 提示·2 采纳·1 噪音"；下＝噪音区全选→一键"教它别再弹"（写 suppressScenes）。噪音闭环 ≤2 击。

**首次 60 秒（零教程）**：种子卡随装 5 条（git 报错 2＋PowerShell 2＋通用 1）。首次启动不弹欢迎，托盘图标闪 1 次→气泡一行"复制一段报错试试"（用**真实**剪贴板）→2s 内档2 提示→采纳热键→灯闪→回放页见"命中 1 次"＋一键"记下＝成了"。5 分钟无复制→托盘出现"放个演示给我看"（自动走全流程），防冷场。

**退出与反悔（托盘右键第一组，≤2 击）**：① 本场景静音（Esc/×，60 天自动解封）；② 暂停提示＝退档1（保留搜索＋回放，图标变灰）；③ 退出进程。窗口内再按 Ctrl+Alt+P 永远可追回刚缩角的提示。

## E. 边界与错误状态

- 空库/无命中：档2 **不弹**任何"没找到"（失败提示本身也是噪音）；档1 首屏一行灰字引导（后台收录 / 导入终端历史）。
- 被 Esc 过的场景：当天不再弹；计数 ≥3 次/周自动移出候选。
- **敏感剪贴板**（密码/私钥/`aws_`/token 高熵命中）：不提示、不计数、不落日志，仅内存静默计数；监听内容只留内存。
- LLM 未配 key/断网：本地规则全照常，仅"兜底草稿"不可用（v2 同款降级）。

## F. 2 周试点与判定线

**被试**：你本人＋1 名开发者同事（全本地埋点，走 audit JSONL 模式）。
**埋点**：每提示一行 `{ts, scene, trigger(clip|ctx), cardId, outcome, 之后10s是否再搜}`；另记 history 导入"删剩几条"。
**outcome 枚举**：`adopt_hotkey / adopt_replay / esc / 3s关闭 / 超时忽略`。
**判定线（≥ 全部满足才续做 v3.1）**：第 2 周日采纳率 ≥60%（分母＝提示条次）· 单日提示 ≤6 条 · 3s 关闭率 <15% · 用户 ≥5 天主动打开回放页。
**不过怎么办**：砍预测队列，退回"仅报错即推＋手动收录"，重审数据再起——2 周可攒 40–100 次采样，足够判方向，本地埋点零成本。

## G. 建议开工顺序（v3.0 模块切分，单文件按区拆）

1. 基建：热键返回值检查＋第二热键 · `CommandStore` 批量更新（≈0.5–1 天）
2. `SceneAware`＋档1 预测队列改造（1 天）
3. 试用态字段＋迁移兜底＋生命周期惰性计算（1–2 天）
4. 隐式成功信号埋点＋批量回写（1 天）
5. history 导入向导（脱敏/去重/Top-N）（2 天）
6. 剪贴板监听＋档2 浮层＋采纳热键（2–3 天）→ 2 周试点

> 每步完成即挂 SelfTest 扩充并提交（遵循 agent.md 协作铁律）。
