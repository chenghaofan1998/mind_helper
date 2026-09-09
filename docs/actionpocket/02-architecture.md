# Action Pocket 阶段 1 架构设计（模拟试点版）

> 配套产品设计：`01-product-design.md`。目标：用**纯本地、零第三方依赖、可运行可测试**的实现跑通纲领 §8.1 的最小架构，并给出 Windows/.NET 落地映射。

## 一、设计原则

- KISS/YAGNI：仅实现阶段 1 P0；不引入 DI、插件、事件总线、RAG、数据库服务。
- 安全：只复制不执行；无来源的高风险步骤禁入；敏感参数不回显、不入日志。
- 本地优先：卡、实例、流水均为本地文件；授权即“用户显式传入的文件路径”。
- 可测：核心逻辑与 IO 分离，Node 24 `node:test` 单测 + 端到端旅程测试。

## 二、模块划分（TypeScript，模拟落地）

```text
actionpocket/
  package.json           type=commonjs，零运行时依赖
  tsconfig.json          strict，编译到 dist/
  src/
    types.ts             领域模型与类型守卫（唯一数据契约）
    risk.ts              危险命令判定（低/高/临界，只判红不判绿）
    markdown.ts          Markdown/纯文本 → 结构化步骤+来源行号
    draft.ts             草稿生成 + 规则校验（高风险必须带来源）
    store.ts             卡/实例 JSON 存取 + 文件哈希(sha256) + 事件流水(jsonl)
    engine.ts            行动引擎：批准/启动/勾选/暂停/续做/完成/过期检测
    cli.ts               薄 CLI（单入口，只调 engine，不含业务逻辑）
  fixtures/teams/        5 个模拟团队 Runbook + 旅程脚本
```

## 三、数据模型（契约：`types.ts`）

```text
ActionCard(draft 或 approved)
  id, source{path,hash,hashAt}, goal, appliesWhen, prerequisites[],
  params: ParamDef[], steps: Step[], risks: string[], verification[],
  status: draft|active|stale|discarded|archived,
  approvedBy?, approvedAt?, version?,  // 批准记录（仅 active/stale 卡存在）
Step
  id, seq, title, text, excerpt(原文摘录), source{startLine,endLine},
  commands?: {text, risk}[], verify?: string
ParamDef { key, label?, required, sensitive? }
RunInstance
  cardId, state: not_started|in_progress|paused|completed|aborted,
  paramValues{...}, stepIndex, startedAt?, completedAt?
Event(jsonl 一行) { at, kind, cardId?, runId?, detail? }
```

存储布局（`dataDir` 参数化，便于测试用临时目录）：

```text
<dataDir>/cards/<id>.json        卡
<dataDir>/runs/<id>.json         运行实例
<dataDir>/events.jsonl           本地使用流水（追加式）
```

## 四、安全红线（可审计项）

1. **只复制不执行**：引擎从不执行 `commands`；CLI/测试只产出“待复制文本”，复制动作属于桌面壳。
2. **无来源高风险 = 0**：`draft.build` 校验——任一 high/critical 步骤若 `excerpt` 为空则整卡拒绝进入批准。
3. **危险门**：high/critical 命令在**标记步骤完成前**必须显式确认（模拟：`step-done --confirm`，UI 层对应确认对话框）。
4. **敏感参数**：`sensitive:true` 的参数值不写入卡 JSON 之外的回显/事件；运行日志只记 `***`。
5. **授权最小化**：只读调用方显式传入的文件路径；不扫描目录、无监听、无网络。
6. **事件流水**：`events.jsonl` 仅事件元数据，不含命令体与参数值。

## 五、关键机制

- **来源定位**：解析时逐行记录；列表项/代码块得到 `startLine/endLine`，摘录保持原文 1–3 行。
- **过期检测**：批准时记录文件 `sha256 + mtime`；`engine.checkSource(id)` 重算比对，不一致 → `active→stale`；`stale` 卡启动/续做被拒绝。重新批准时以当前源文件重解析，卡内容与源**语义一致**才可直接批准，不一致须基于最新源文件重新起草（防卡内容漂移）。
- **参数抽取**：优先识别参数表（表格含“参数/变量/说明”），其次代码块/正文中的 `{{x}}` `${x}` 占位符；去重合并。
- **续做**：实例持久化 `stepIndex + paramValues`；`resume` 从暂停步恢复，不丢上下文，且续做前复查卡状态与源哈希（暂停期源变化 → 置 stale 拒绝续做）。

## 六、CLI 契约（`cli.ts`）

```text
node dist/cli.js draft   <file>                      # 解析文件并生成草稿卡（写入 cards/）
node dist/cli.js approve <cardId> --by <owner>        # owner 批准 → active（记录版本/hash）
node dist/cli.js reject  <cardId> --by <owner>        # owner 驳回 → discarded
node dist/cli.js list                                # 卡清单（含状态）
node dist/cli.js show    <cardId>
node dist/cli.js run     <cardId> --param k=v ...     # 启动实例；stale/高风险无来源拒绝
node dist/cli.js step-done <runId> [--confirm]      # 勾选完成当前步（危险命令需 --confirm）
node dist/cli.js pause <runId> | resume <runId> | abort <runId>
node dist/cli.js complete <runId>                    # 全部步骤完成后执行完成验证（原文验证项由操作者核对）
node dist/cli.js check-source <cardId>                # 重哈希 → stale 提示
node dist/cli.js events [--tail N]                    # 查看本地使用流水
```

退出码：0 成功；2 用法错误；3 业务拒绝（stale/风险/校验）；4 文件 IO。危险步须经 `--confirm` 后方可标记完成（只复制不执行）。

## 七、测试策略

| 层 | 覆盖 |
|---|---|
| 单元 | risk 判定矩阵；markdown 解析（5 种文档风格）；参数抽取；draft 校验拒绝无来源高风险；过期检测 |
| 集成 | 批准→运行→暂停→续做→完成 全生命周期；事件流水字段；敏感参数脱敏 |
| 端到端 | 5 个模拟团队各跑完整旅程（脚本化，见 `scripts/simulate-pilot.js`） |

运行：`npm run ap:test`（先 `tsc -p actionpocket` 再 `node --test actionpocket/dist/`）。

## 八、Windows/.NET 落地映射（ADR-1）

本模拟实现是机制验证与验收口径的“可运行规格”。正式 Windows 交付仍遵循纲领“C# 单文件不沿用”：

```text
src/ActionPocket.Core          ← actionpocket/src（模型/解析/引擎，逐模块直译）
src/ActionPocket.Storage       ← store.ts（SQLite/JSON + sha256）
src/ActionPocket.Desktop.Win   ← 托盘/热键/侧栏/剪贴板复制（复用 Pilot 外壳经验）
src/ActionPocket.Cli           ← cli.ts
tests/*                        ← test/（解析夹具/状态机/安全线）
```

TS 先行的理由：本环境无 .NET 工具链且仓库约定不安装；TS 版本零依赖、可在 Linux 全量自动测试。**TS 原型 ≠ 交付本体**，机制与验收口径经模拟验证后，再在 Windows 侧按上表落地 .NET 版本并跑真机验证点。

## 九、需用户拍板的开放项（ADR-2）

1. 无账号约束下“团队批准与分发”落地形态：本设计采用**批准后导出卡文件 + 人工文件共享（复制 .json 给操作者）**。若需正式化（版本目录、只读共享、操作者身份），超出阶段 1，立项另议。
2. “完成 = 用户确认验证步骤”是否足够代表真实成功（不自动探测命令结果）。
3. 模拟试点数据不替代真实阶段 0；后续仍按章程补 5 个真实团队。
