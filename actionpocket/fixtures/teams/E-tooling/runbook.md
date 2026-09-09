# 内部 Node 工具链季度升级（Team E）

> 目的：把内部脚手架（@corp/cli）从当前版本升级到目标版本。
> 适用条件：目标版本已发布 ≥ 2 周、无已知 blocker、升级窗口为每季度第一个周四。
> 操作者：工具组值班人；审批：工具组负责人。

## 前置校验

1. 确认当前版本与目标版本

   ```bash
   node --version
   npm ls -g @corp/cli
   npm view @corp/cli versions --json
   ```

2. 确认无阻塞性 issue（打开 GitHub milestone 页面核对）

3. 检查 CI 基线（`@corp/cli` 仓库 main 分支徽章为绿色）

## 分步升级

4. 全局更新脚手架

   ```bash
   npm install -g @corp/cli@{{目标版本}}
   ```

5. 用新版本重新生成一次“hello world”工程做冒烟

   ```bash
   cd /tmp && rm -rf smoke-corp && npx @corp/cli init smoke-corp --template base
   cd smoke-corp && npm install && npm run build
   ```

6. 抽查 3 个在制品仓库的兼容性（示例仓库为 test-repo-a / test-repo-b / test-repo-c）

   ```bash
   for repo in test-repo-a test-repo-b test-repo-c; do
     cd /workspace/$repo && @corp/cli doctor
   done
   ```

7. 升级说明发到 #tooling 频道并置顶一周

## 验证

- [ ] 冒烟工程构建成功
- [ ] 抽查仓库 doctor 无 error 级输出
- [ ] 目标版本已在频道公布

## 风险

- 步骤 5 中 `rm -rf smoke-corp` 仅作用于 `/tmp` 下的临时目录，安全。
- 若抽查仓库出现破坏性变更，立即回退 `npm install -g @corp/cli@{{当前版本}}` 并在频道说明。
- `@corp/cli doctor` 只读检查，可放心执行。
