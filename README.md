# Action Pocket

**连接知识库与日常任务的统一轻量入口：随手记进去，需要时拿出来，变成自己看得懂、用得上的内容。**

既是知识输入入口，也是知识输出入口；不绑定某一种知识库软件（Logseq 是当前验证起点，非产品边界），不替代已有知识库，也不另建知识库。首版聚焦快速记录、命令调用和个人理解片段找回。

> **最高优先级文档：[项目纲领](docs/ACTION-POCKET-CHARTER.md)。** 旧团队 Runbook 方向已被替代。以下 Command Pocket、v5-pilot 和模拟试点内容仅说明历史资产与现有实现，不代表新方向已交付。

## 权威文档（按优先级）

| 文档 | 角色 |
|---|---|
| `docs/ACTION-POCKET-CHARTER.md` | **唯一最高优先级项目纲领**（知识输入与输出、首版范围、技术边界和验证方式） |
| `docs/v5pilot/SPEC.md` | Command Pocket v5-pilot 历史试点规格（仅供旧实现参考） |
| `docs/relook/DECISION.md` | v4 战略打回决议 + 四路重想终裁（为什么是"行为记忆"而不是"命令抽屉"） |
| `docs/relook/` | 打回决议与四路提案（A 止损 / B 钉子 / C 场景 / D 市场实证）——决策链存档 |
| `docs/actionpocket/` | **Action Pocket 阶段 1 模拟试点**（产品设计 / 架构 / 模拟五团队 / 模拟试点报告）——机制验证，非真实市场证据 |

> 历史规格（v2 MASTER/MVP、v3 VISION/SCENARIO、v4 PRODUCT/REQUIREMENTS/TESTCASES/ACCEPTANCE 等）已删除——产品方向经 v4 打回后已换代，旧文档不再适用。全部历史仍可在 **git 历史**中追溯（`git log -- docs/`）。

## 目录结构

```text
native/                 主交付源码（C# WinForms）
  CommandPocketPilot.cs   v5-pilot 试点最小单文件（开发中，≤1200 行）
  CommandPocketNative.cs  v4 旧版（已退役，留在 git 历史可回退）
  build.ps1              编译 + 自测（只用 Windows 自带 csc.exe，无第三方依赖）
scripts/                打包脚本
docs/                   文档（Action Pocket 纲领 + v5pilot 规格 + relook 决策链）
src/                    备用 Web 原型（Neutralino，仅界面实验，非主交付）
actionpocket/            Action Pocket 阶段 1 可运行原型（TS，机制验证用，非最终交付；含 CLI/测试/模拟 Runbook）
dist/CommandPocketNative/   旧版现役 exe（v4 时代，待 v5-pilot 替换）
dist-native/                npm run desktop 的开发构建输出
```

## 开发构建（改动 native 源码后）

```powershell
npm run desktop            # 编译旧版 CommandPocketNative（已退役）
npm run desktop:pilot      # 编译 v5-pilot：native\CommandPocketPilot.cs + --self-test → dist-native\CommandPocketPilot.exe
```

> Linux 容器内无法编译/运行 WinForms（不做任何工具链安装）；代码经静态审查 + Node 规则对拍（scripts/pilot-check.js）验证，最终编译与 UI 运行以 Windows `npm run desktop:pilot` 为准。

## 重新打包

```powershell
npm run desktop:package
```

> `desktop:web*` 系列需要 node_modules（npm install），仅供备用 Web 原型实验。

## Action Pocket 阶段 1 原型（本分支新增）

> 因无 5 个真实设计合作团队，按发起人指示以 5 个**模拟团队**驱动完整操作流，见 `docs/actionpocket/`。
> 声明：模拟试点数据不构成产品成立证据；真实阶段 0 仍待补齐。

```bash
npm run ap:test        # TS 编译 + 单元/集成/五队端到端测试（20 项）
npm run ap:simulate    # 模拟试点执行器：5 队完整旅程 + 指标表
```

落地形态：`actionpocket/src`（types/risk/markdown/draft/store/engine/cli）。Windows/.NET 交付映射见 `docs/actionpocket/02-architecture.md` ADR-1。

## 历史 v5-pilot 状态（不作为当前立项与验收依据）

- v5-pilot 试点规格已锁版（`docs/v5pilot/SPEC.md`），待开发最小单文件 + 真机试点
- 试点生死线：连 5 个工作日日均唤起 ≥5 且 唤起→复制中位 ≤10s 且 零打字采纳 ≥40% —— 过线升级为 v5 正式规格；连 3 日零唤起则作废归档
- 真机验证前置：Windows 上 `npm run desktop`（编译 + SelfTest 全绿）+ 编译产物本机 Defender/SAC 实测（详见 SPEC §五）
