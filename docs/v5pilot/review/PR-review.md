# PR-review · v5-pilot 合并前独立审查（近 6 笔）

裁决：**APPROVE**——无静态阻塞项；合并后须过 3 项真机闸门。

审查基线：ef1d450 / 01746ad / 523f52b / 3cb15de / 12ea7ab 逐 diff；65c0fac 属已归档 R 轮收敛不回述。`node scripts/pilot-check.js` 本容器实跑 **ALL GREEN**。

## 问题清单（按严重度）

**无阻塞项**：五笔改动未见高/中功能级新缺陷——无越权、资源泄漏、空引用、绘制越界（各列矩形自洽，Empty/选中/危险点路径完整）；存卡停留后 ExistsInLibrary + offeredClip 双保险，同文不再复 offer；新卡置顶链路（Upsert→Reload→RenderRows 选首卡）成立。

**中 · 口径（非功能缺陷）**：523f52b 存卡停留走 Reload→BuildSnapshots，同次唤出内会再次 `Clipboard.GetText`（AddManual/托盘导入后同理，每存一次多读一次；好在不随击键重读）。SPEC 黄线自证"每次唤出内一次"字面破口。缓解：均在可见动作内、clip=on 才读、逐次记 peek 流水、敏感不预填。建议：会话快照——唤出读一次存字段、会话内 Reload 复用；或 SPEC 措辞改为"每次可见动作一次"。

**低**
1. 01746ad 注释"id 0xA1B1/0xA1B2 错开、允许并存调试"不成立：RegisterHotKey 跨进程同键位（Ctrl+Alt+P）后注册方必败。旧 Native 与 Pilot 并存时先启者独占，后者启动即弹"注册失败"且本会话热键失效（托盘可回退）——真机验证并存场景。
2. 热键注册失败弹窗由"首次唤出"提前到开机即弹（无手势前置），且无重试；可接受，真机复核时机。
3. 523f52b `bool added = store.Upsert(...)` 死变量（未消费；若意图"重复收录不置顶/不提示"应使用之）。
4. DrawRow 自绘后选中行右缘 gutter（列总宽 500 < 列表 520，约 5–20px）不再覆盖选中底色——纯视觉，真机目检。
5. ef1d450 领先 origin 1 笔未推送，合并前先 push。

## 构建链 / 打包 / 红线核实（PASS）

- build.ps1 `-Name` 参数化正确，desktop:pilot 指向 CommandPocketPilot.cs；`--self-test` 分支先于单实例 Mutex；winexe 下 Console.WriteLine 不抛、build.ps1 只认 ExitCode——链自洽（本容器无 csc，编译真跑留 Windows 闸门）。
- git ls-files：Pilot exe 已除名并入 .gitignore（`dist/`、`dist-native/`）；跟踪二进制仅剩历史遗留 Native 两枚；本 PR 未新增敏感/数据/产物文件。
- docs 换代正确：MASTER/MVP/ACCEPTANCE/PRODUCT/REQUIREMENTS/SCENARIO/VISION/VISION-EXEC/PROGRESS/TESTCASES 十份已删；relook/ + v5pilot/SPEC + R1–R4 保留。
- 红线：`Clipboard.GetText` 全仓唯一（1390），仅 BuildSnapshots 内、clip=on、唤出/可见动作路径；无 Http/WebClient/Socket/SetWindowsHookEx/AddClipboardFormatListener/FileSystemWatcher/Process。

## 风险残留（静态审不到）

真机 UI（DrawRow 悬停/选中观感、存卡停留手感、多屏/DPI）；Defender/SAC/SmartScreen 对无签名 exe；第三方或旧 Native 热键冲突；C# 编译与 SelfTest 退出码仅 Windows 可证。

## 合并闸门

**合并前**：push ef1d450；其余静态零阻塞。
**合并后跟进**：① Windows 跑 desktop:pilot（csc 编译 + SelfTest + 首启托盘体验）② Defender/SAC 实测 ③ 真机 UI + 热键并存目检；低 1–4 随试点收敛。
