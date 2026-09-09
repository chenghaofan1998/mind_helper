# 核心库数据库变更发布（Team D）

> 目的：把已评审的数据库迁移脚本发布到生产核心库。
> 适用条件：变更脚本已通过 pre-prod 演练与 DBA 评审（评审号必填）。
> ⚠ 高危流程：涉及生产核心数据，任何一步都必须确认后再执行。

## 参数

| 参数 | 示例 | 必填 | 说明 |
|---|---|---|---|
| 评审号 | CR-2026-018 | 是 | DBA 评审工单号 |
| 迁移文件 | 20260401_add_txn_index.sql | 是 | 已评审脚本文件名 |
| 目标库 | core_prod | 是 | 固定 core_prod，禁止写其他库 |

## 前置条件

- [ ] 变更脚本已提交到 `db/migrations/` 并合入 main
- [ ] 评审号存在且状态为 Approved
- [ ] 备份磁盘剩余空间 > 20GB（`df -h /backup`）

## 执行步骤

1. 创建变更会话并生成备份

   ```sql
   -- 先做逻辑备份，中途失败可回滚
   ```

   ```bash
   mysqldump --single-transaction --routines --triggers \
     -u deploy -p core_prod > /backup/core_prod_pre_CR2026018.sql
   ```

   > 风险确认：该命令会读取生产库全部数据，建议在低峰执行；失败不影响线上写入。

2. 在事务里先做语法与影响面检查（dry-run）

   ```bash
   mysql -u deploy -p core_prod < db/migrations/{{迁移文件}} --dry-run
   ```

3. 正式执行迁移（在事务中，失败自动回滚）

   ```bash
   mysql -u deploy -p core_prod < db/migrations/{{迁移文件}}
   ```

4. 校验变更生效

   ```sql
   SHOW INDEX FROM core_prod.txn WHERE Key_name = 'idx_txn_created';
   ```

5. 回滚预案（仅在步骤 3 失败且自动回滚未生效时使用，需 DBA 在场）：

   ```bash
   mysql -u deploy -p core_prod < /backup/core_prod_pre_CR2026018.sql
   ```

## 验证

- [ ] 新索引可见且类型正确
- [ ] 生产慢查询日志中该表全表扫描消失（观察 30 分钟）
- [ ] 监控无告警：主从延迟 < 5s、连接数无突刺

## 风险

- 本流程为**临界风险**：误操作会改动生产数据；一切写库操作必须以评审脚本为唯一来源，禁止现场手写 SQL。
- `-p` 后跟的密码来自密钥管理，禁止明文出现在终端历史。
