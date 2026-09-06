# Command Pocket

本地优先的个人行动知识库：按**产品**组织，小窗 3 秒给出可复制的答案。

- **方案主纲**（一页，一切以它为准）：`docs/MASTER.md`
- **MVP 详案**（流程 / 首屏推荐 / 原料→JSON / 界面草图 / 验收）：`docs/MVP.md`

## 目录结构

```text
native/                 主交付源码（C# WinForms，托盘+小窗+后台）
  CommandPocketNative.cs
  build.ps1             编译 + 自测（只用 Windows 自带 csc.exe，无第三方依赖）
scripts/                打包脚本
docs/                   方案文档（MASTER 主纲 / MVP 详案）
src/                    备用 Web 原型（Neutralino，仅界面实验，非主交付）
dist/CommandPocketNative/   现役主程序 CommandPocket.exe
dist-native/                npm run desktop 的最新开发构建
```

## 运行现役版

```powershell
dist\CommandPocketNative\CommandPocket.exe
```

启动后常驻托盘：速查小窗 / 后台收录 / 产品管理。

## 开发构建（改动 native 源码后）

```powershell
npm run desktop
```

→ 编译 `native\CommandPocketNative.cs` → 跑 `--self-test` 自测 → 输出 `dist-native\CommandPocketNative.exe`

## 重新打包

```powershell
npm run desktop:package
```

→ 产出 `dist\CommandPocketNative\CommandPocket.exe` + `dist\CommandPocket-native.zip`

> 注：`desktop:web*` 系列需要 node_modules（npm install），仅供备用 Web 原型实验。

## 下一步（按 MVP 详案执行）

P1：Card 新模型 + v1 数据迁移（cards.tsv → jsonl，带备份）→ P2 Profile 化 → P4 原料→JSON 管道 → 首屏推荐 + 全局热键。详见 docs/MVP.md。
