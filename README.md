# Command Pocket

本地优先的个人"行动记忆口袋"：Windows 托盘常驻 + 全局热键（`Ctrl+Alt+P`）小窗。
**v5-pilot 定位**：行为记忆"再来一次"——不让你想起、不让你搜索，把你上次干成过的命令在按热键的 3 秒内送到手边，回车复制走人。

## 权威文档（按优先级）

| 文档 | 角色 |
|---|---|
| `docs/v5pilot/SPEC.md` | **v5-pilot 试点规格 · 试点期唯一执行依据**（定位/场景/功能 F1-F10/合规红线/生死线） |
| `docs/relook/DECISION.md` | v4 战略打回决议 + 四路重想终裁（为什么是"行为记忆"而不是"命令抽屉"） |
| `docs/relook/` | 打回决议与四路提案（A 止损 / B 钉子 / C 场景 / D 市场实证）——决策链存档 |

> 历史规格（v2 MASTER/MVP、v3 VISION/SCENARIO、v4 PRODUCT/REQUIREMENTS/TESTCASES/ACCEPTANCE 等）已删除——产品方向经 v4 打回后已换代，旧文档不再适用。全部历史仍可在 **git 历史**中追溯（`git log -- docs/`）。

## 目录结构

```text
native/                 主交付源码（C# WinForms）
  CommandPocketPilot.cs   v5-pilot 试点最小单文件（开发中，≤1200 行）
  CommandPocketNative.cs  v4 旧版（已退役，留在 git 历史可回退）
  build.ps1              编译 + 自测（只用 Windows 自带 csc.exe，无第三方依赖）
scripts/                打包脚本
docs/                   文档（v5pilot 规格 + relook 决策链）
src/                    备用 Web 原型（Neutralino，仅界面实验，非主交付）
dist/CommandPocketNative/   旧版现役 exe（v4 时代，待 v5-pilot 替换）
dist-native/                npm run desktop 的开发构建输出
```

## 开发构建（改动 native 源码后）

```powershell
npm run desktop
```

→ 编译 → 跑 `--self-test` 自测 → 输出 `dist-native\`

## 重新打包

```powershell
npm run desktop:package
```

> `desktop:web*` 系列需要 node_modules（npm install），仅供备用 Web 原型实验。

## 当前状态

- v5-pilot 试点规格已锁版（`docs/v5pilot/SPEC.md`），待开发最小单文件 + 真机试点
- 试点生死线：连 5 个工作日日均唤起 ≥5 且 唤起→复制中位 ≤10s 且 零打字采纳 ≥40% —— 过线升级为 v5 正式规格；连 3 日零唤起则作废归档
- 真机验证前置：Windows 上 `npm run desktop`（编译 + SelfTest 全绿）+ 编译产物本机 Defender/SAC 实测（详见 SPEC §五）
