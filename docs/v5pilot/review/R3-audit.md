# R3-audit：红线/副测审计（SPEC §五/§八）
对象 CommandPocketPilot.cs(1555 行，静态审查)；Node 对拍 ALL GREEN；编译/Defender/热键/DPI 为真机项，静态不可验。

绿①零网络 PASS：无 Http/WebClient/Socket/Uri。
绿②零钩子 PASS：DllImport 仅 RegisterHotKey(892，带返回检查+失败托盘提示)；无 SetWindowsHookEx/AddClipboardFormatListener/FileSystemWatcher/Timer/线程。
绿③纯本地 PASS：cards/metrics.jsonl、settings.ini 全在 %APPDATA%\CommandPocketNative(580)；历史只读不锁；jsonl 宽容读写。
绿④读后即弃 PASS：剪贴板文本仅判形/查重/成行，不入盘不入日志；历史行先 IsSensitive。
黄⑤读取唯一 PASS：GetText 仅 1137；SetText 仅 1335。
黄⑥风险：调用仅 1083(RefreshRows、q空、clip=on)，但 RefreshRows 被启动/托盘/热键/存后/清空搜索触发→启动即读、单次唤出可多次读。改：仅 WM_HOTKEY 读+每显示一次。
黄⑦可关 PASS：托盘开关⇄clip=off(601-622)，off 不读；try/catch 静默。
黄⑧FAIL 首启明示：仅"空库导入"引导(861)，未告知剪贴板读取与关闭。改：首启弹一次说明。
黄⑨第二入口 PASS：无此代码，默认关。
黄⑩FAIL 审计流水：metrics 仅 esc/copy/save/adopt(1281-1357)，读取无流水行。改：生成 ClipSave/Suggest 行处记 Metric("peek")，不含内容。
红⑪只判红 PASS：GuessRisk 仅 high/low(107-125)，UI 无绿标/“安全”。
红⑫全覆盖 PASS：唯一 SetText 在 CopySelected，Enter/双击/搜索 Enter 汇聚，Danger 先弹(1323-1331)。
红⑬FAIL 绕过：门与 1161 只信 c.Risk∈high/critical，容错读把旧卡缺省 risk 置 low(299)→命中现行规则的旧危险卡免确认直拷。改：1161+确认处加 ||Rules.GuessRisk(body)!="low"（复制时实时判）。
红⑭ClipSave/Suggest 回车=存非复制，高亮恒 Card 行，无误存路径。
文案⑮PASS：确认语"粘贴/执行前请再确认一次"、空态"没有这张卡—去问 AI 或搜一下吧"、"常敲未入库"合 SPEC；偏差：零命中自隐改 Esc 收起。
数据⑯PASS：.tmp 原子替换、.bak 单代同目录；metrics 无命令体。风险：手动+/粘贴即存不过 IsSensitive（仅导入过滤），口令命令可主动存卡落本地明文。
