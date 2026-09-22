# agent.md — Action Pocket 仓库协作约定

## 产品与范围

- 产品范围以 [`docs/ACTION-POCKET-CHARTER.md`](docs/ACTION-POCKET-CHARTER.md) 为最高依据。
- 当前实现是根目录下的 Web UI、本机服务、知识源 Connector、Logseq 文件型 Graph 接入与意图路由。
- Windows 桌面链由 `native/*.cs`、Neutralino 配置及 `scripts/prepare-windows-release.ps1` 组成。
- 不执行用户查询出的命令，不把派生内容伪装成知识源原文，不默认采集剪贴板、屏幕、键盘或麦克风。

## 变更规则

1. 保持改动窄且可验证；不在未批准时扩大产品或架构范围。
2. 不提交 Token、密钥、密码、用户知识库内容、本地运行数据、依赖目录或可重建产物。
3. 只有在任务明确要求时才创建提交或推送；操作前检查差异与仓库状态。
4. 当前验证入口为：

```bash
npm test
npm run typecheck
npm run build
npm run server:build
git diff --check
```

Windows 启动器、热键、托盘和发布包还需按 [`docs/P0-RELEASE-CHECKLIST.md`](docs/P0-RELEASE-CHECKLIST.md) 在真机验收。

## 三项目协作上下文

本仓库只承担知识链的**消费与入口**层。完整链路由三个独立项目组成：

- 本仓库（Action Pocket）—— 随手记入与快速找回原文，自身不成为知识库。
- `/mounts/ai-collab-agent-workspace` —— 知识加工与检索引擎（源笔记只读，产出可写）。
- `/mounts/ai-collab-output-logseq` —— 可写输出图谱，供 Logseq 阅读与人工审阅。

三方的定位、数据流、接口差距（含 6 个硬失败点）与集成路径见
[`THREE-PROJECT-RELATIONSHIP-ANALYSIS.md`](THREE-PROJECT-RELATIONSHIP-ANALYSIS.md)。该文档是后续设计与实现的基线。

改动前必须遵守的两条边界：

1. 输出图谱的 `pages/knowledge-pipeline/{30-summaries,40-review,50-knowledge}` 由加工引擎独占写入，本仓库不得写入；本仓库只写 `journals/` 等非管线目录。
2. 本仓库对 Connector 只声明自己真正支持的能力，并且不返回无引用的流畅回答（详见 `design/CONNECTOR-API.md`）。

若三方定位、数据边界或接口契约发生变化，必须同步更新上述基线文档。
