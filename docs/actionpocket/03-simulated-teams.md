# Action Pocket 模拟试点 — 五团队档案与旅程（03）

> 目的：在无真实设计合作团队的情况下，按发起人指示**模拟 5 个团队**驱动并跑通 Action Pocket 完整操作流。
> 诚实声明：以下团队、Runbook、反馈、指标均为**模拟数据**，仅为验证机制可用性与验收口径可执行性；不代表任何真实组织。

## 模拟方法与边界

- 每个模拟团队提供 1 份风格各异的 Markdown Runbook（见 `actionpocket/fixtures/teams/*/runbook.md`），覆盖首发场景“重复发布与环境配置”及其相邻故障处理。
- 角色：每队设“文档拥有者（owner）”与“操作者（operator）”两类 persona，均由模拟执行（同一数据目录，分角色命名以体现批准与使用分离）。
- 每队跑一条完整旅程（J1 主流程）+ 至少一条异常路径（J2 源文件变化过期 / J3 owner 驳回）。
- 结果与指标记入 `04-simulated-pilot.md`，全程标注“模拟值”。

## 团队档案

| 队 | 名称 | 规模/栈 | Owner | Operator | Runbook |
|---|---|---|---|---|---|
| A | 商城后端 | 12 人 · Java/Docker | liang_arch | wang_ops | `A-release/runbook.md` |
| B | 数据平台 | 8 人 · Airflow/Python | chen_da | zhao_val | `B-pipeline/runbook.md` |
| C | 移动端 | 15 人 · iOS | sun_mob | qian_rel | `C-ios/runbook.md` |
| D | 金融核心 | 9 人 · .NET/SQL | zhou_dba | wu_dba | `D-db/runbook.md` |
| E | 内部工具 | 6 人 · Node | luo_tool | zheng_dev | `E-tooling/runbook.md` |

## 各队模拟旅程要点

- **A 商城发版（主）**：解析规整章节 → 参数 `版本号/环境` 必填 → 正常批准执行至完成。
- **B 管道重跑（风格压力）**：验证“少章节、多命令混排、中文口语”文档仍可抽出有序步骤与来源；路径含“负载 DW 手工 insert 禁止”的风险提示。
- **C iOS 发版（敏感参数）**：`{{api_key}}` 为敏感参数 → 填写后不回显、事件流水不落明文；含参数表带默认值。
- **D 数据库变更（临界风险）**：高风险命令（mysqldump/正式执行）必须逐条 confirm；owner 批准前先过一次“无来源高风险=0”校验。
- **E 工具升级（异常路径 ×2）**：J3 先由 owner 驳回一次草稿（参数缺失/表述歧义）→ 修正重提；J2 模拟源 Runbook 变化 → 卡置 stale → 重新批准后才可启动。

## 各队模拟指标口径（模拟）

- 基线耗时：**对照直接读原文方式**估算每队常规流程“从打开文档到正确完成第一步”的分钟数（模拟专家估计）。
- 试用后耗时：用 Action Pocket 完成同一流程的分钟数（模拟）。
- 完成率、重复使用意愿、付费意向：模拟值，见 `04`。

> 在真实阶段 0 补齐前，本模拟仅用于工程内自洽验证。
