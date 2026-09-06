# agent.md — 本仓库协作约定（Command Pocket）

> 本文档是本工作区（/workspace，对应 F:\txt_parter）内后续开发必须遵守的版本管理约定。
> 每次改动都按此规则归档，保证任何一步可回退、可在 GitHub 追溯。

## 仓库信息

- 远端：`git@github.com:chenghaofan1998/mind_helper.git`（SSH，origin）
- 默认分支：`main`
- 身份：`chenghaofan1998 <chenghaofan1998@users.noreply.github.com>`（仓库级已配置）

## 铁律

1. **模块化改动 → 本地 Git 提交**：完成一个内聚的模块/修一个 bug/调一段逻辑后，立刻 `git add -A && git commit`，不积压、不跨功能混提。
2. **功能改动完成 → 上传 GitHub**：一个功能点完整落地并验证通过后，`git push`。
3. **提交信息规范**（简短中文，一行，`动词 + 对象 + 关键点`）：
   - `P1: 卡片数据模型收敛为 product/kind/aliases，jsonl 存储 + v1 自动迁移`
   - `修复: ManagerForm 分栏在构造函数设 MinSize 导致 SplitterDistance 越界`
   - `导入: 预览改为左侧清单 + 右侧字段化编辑表单`
4. **大改动拆提交**：如果一次改动跨多个模块，按模块拆成多个 commit，方便单独回退。
5. **绝不提交**：
   - 任何 Token / 密钥 / 密码（推 GitHub 前检查）
   - 用户本地数据（%APPDATA%\CommandPocketNative\ 下的 jsonl / 备份，属运行数据不进仓库）
   - node_modules、临时文件（.gitignore 已覆盖）
6. **提交前自检**：`git status` 确认只含预期文件；`git diff` 扫一眼；SelfTest 通过后再提交功能改动。
7. **推送失败先诊断**：SSH key 是否可用（`ssh -T git@github.com`）；网络/代理；不要为绕过认证把凭据写进 URL 留在 remote。

## 标准流程（每次功能迭代）

```bash
# 1. 开发（改代码 + 本地验证：Roslyn parse / SelfTest 逻辑副本）
# 2. 模块完成 → 本地提交
cd /workspace
git add -A
git commit -m "功能: 一句话说明"
# 3. 功能整体验证通过 → 推送（本环境无 GitHub 凭据时，交用户在 F:\txt_parter 执行）
git push
```

## 当前状态（2026 基线）

- 已入库：源码(native/scripts/src) + 文档(docs/MASTER、MVP、ACCEPTANCE) + README + agent.md + .gitignore
- 数据文件（cards.jsonl/profiles.json）在 %APPDATA%，不进库
- 主交付 = native C# WinForms（CommandPocketNative.cs），详见 docs/MASTER.md
