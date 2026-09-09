数据管道重跑手册（Team B）

背景：Airflow 凌晨调度经常因为上游 API 抖动失败，白天值班的人要手动重跑。这份是给值班同学用的快速手册。写得不讲究，能用就行。

先看是哪种失败：
1. 先打开 Airflow，找到失败的那个 DAG run（一般名字是 etl_core_daily）
2. 点进 Task Instance，看失败任务是不是 fetch_orders / transform_orders / load_dw 这三个之一
3. 如果是 load_dw 失败，先别重跑，找数据组确认 DW 有没有半截数据

fetch 失败的处理：
4. 这种通常是上游慢，直接重试就行

   ```bash
   airflow dags trigger etl_core_daily
   ```

5. 等两分钟，看是不是还是 fetch 失败。还是失败的话，把上游 API 状态页截图发群里

transform 失败的处理：
6. 先看日志里有没有 "schema mismatch"，有的话说明上游改字段了，需要找数据组出新的 mapping

   ```bash
   airflow tasks logs etl_core_daily {{dag_run_id}} transform_orders --tail 200
   ```

7. 没有 schema mismatch 的话，多半是偶发，重跑 transform 这一个任务就行

   ```bash
   airflow tasks clear etl_core_daily -t transform_orders
   airflow tasks run etl_core_daily transform_orders {{dag_run_id}}
   ```

load_dw 失败的处理：
8. 数据组确认没有半截数据后，清掉 load 任务重跑
9. 全部跑完后必须核对行数：

   ```bash
   airflow dags test etl_core_daily {{dag_run_id}}
   psql "$DW_CONN" -c "select count(*) from dw.daily_orders"
   ```

10. 行数跟昨天差超过 5% 要立刻停下来找数据组，不要自己补数

收尾：
11. 在群公告里发一条：今天谁重跑的、最终行数多少、有没有遗留问题
12. 如果一天内同一个 DAG 失败三次以上，提一个工单给数据组排查

注意：千万不要直接往 dw 库手工 insert 数据，出过事故。
