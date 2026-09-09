# 商城后端每周发布（Team A）

> 目的：每周三 22:00 把 main 分支稳定版本发布到生产集群（Docker Compose 单机）。
> 适用条件：常规功能发布，无数据库结构变更。
> 责任人：值班发布员；复核人：后端负责人。

## 前置条件

- [ ] 已在生产跳板机登录（`ssh deploy@bastion.prod`）
- [ ] 已确认本周需要发布的版本号（例：`v2.14.0`）
- [ ] 已确认 CI 流水线（GitHub Actions）本周全绿

## 参数

| 参数 | 示例 | 必填 |
|---|---|---|
| 版本号 | v2.14.0 | 是 |
| 环境 | prod | 是 |

## 发布步骤

1. 拉取最新发布分支并打标签

   ```bash
   git fetch origin
   git checkout release/stable
   git pull origin release/stable
   git tag {{版本号}}
   git push origin {{版本号}}
   ```

2. 构建并上传镜像

   ```bash
   docker build -t registry.example.com/shop-api:{{版本号}} .
   docker push registry.example.com/shop-api:{{版本号}}
   ```

3. 登录跳板机并拉取镜像

   ```bash
   ssh deploy@bastion.prod
   docker pull registry.example.com/shop-api:{{版本号}}
   ```

4. 更新 compose 文件中的镜像版本号并滚动重启

   ```bash
   cd /srv/shop
   sed -i "s|shop-api:.*|shop-api:{{版本号}}|" docker-compose.yml
   docker compose up -d --no-deps api
   ```

5. 健康检查

   ```bash
   curl -fsS http://127.0.0.1:8080/actuator/health
   docker compose ps
   ```

## 验证

- [ ] `/actuator/health` 返回 `UP`
- [ ] 生产错误率在发布后 10 分钟无上升（Grafana：`shop_api_errors_total`）

## 风险

- 步骤 4 会重启在线服务，预计 30 秒内完成滚动切换；如健康检查失败需回滚（见回滚 Runbook R-102）。
- 标签若与已有标签冲突将拒绝推送，需先删除远端错误标签（需复核人确认）。
