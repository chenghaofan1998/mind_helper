# agent.md — Action Pocket 仓库协作约定

## 产品与范围

- 产品范围以 [`docs/ACTION-POCKET-CHARTER.md`](docs/ACTION-POCKET-CHARTER.md) 为最高依据。
- 当前实现是根目录下的 Web UI、本机服务、知识源 Connector、Logseq 文件型 Graph 接入与意图路由。
- Windows 桌面链由 `native/ActionPocketLauncher.cs`、Neutralino 配置及 `scripts/prepare-windows-release.ps1` 组成。
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
