# AI Collab 知识库部署与验收

本文是三个项目的统一操作入口，只保留建设、启动、验收和回滚所需信息。

## 1. 系统组成

不要把三个项目打包成一个目录。

| 组件 | 用途 | 是否必需 |
| --- | --- | --- |
| Action Pocket（A） | 桌面查询、记入和定位 | 可选消费端 |
| Output Logseq（B） | 保存总结、审核候选和正式知识 | 必需 |
| Agent Workspace（C） | 加工、Embedding、查询服务和 Connector | 必需 |
| 输入 Logseq | 原始知识，只读 | 必需 |
| Runtime | chunks、vectors、state、logs | 必需 |

```text
输入 Logseq（只读） → C → B（输出 Logseq）
                        └→ Runtime
Action Pocket → Connector :8788 → Query Service :8787
Action Pocket ─────────────→ B（关键词读取和 journals 记入）
```

## 2. 强制边界

三个数据根目录必须存在、互不重叠且不是父子目录：

```text
LOGSEQ_REPO_PATH          输入图谱，只读
OUTPUT_LOGSEQ_REPO_PATH   输出图谱，可写
PIPELINE_RUNTIME_PATH     运行时，可写且不提交 Git
```

仅允许 C 写入 B 的以下路径：

```text
pages/knowledge-pipeline/30-summaries/
pages/knowledge-pipeline/40-review/
pages/knowledge-pipeline/50-knowledge/
pages/knowledge-pipeline/AI Knowledge Index.md
```

Action Pocket 只允许向 B 的 `journals/` 记入内容。禁止把密钥、Runtime、向量库或模型原始响应提交到 Git。

## 3. 环境要求

本地运行：

- Python 3.10+
- Node.js 22+
- Logseq
- 语义检索需要 Embedding 服务和 Qdrant

服务器运行：

- Linux、Git、Bash、curl、flock
- Docker 与 Docker Compose v2
- systemd
- 推荐独立非 root 服务账户和 Rootless Docker

## 4. 目录初始化

Linux 示例：

```bash
mkdir -p /srv/ai-collab-logseq/{pages,journals,knowledge-pipeline/00-inbox,knowledge-pipeline/05-notes}
mkdir -p /srv/ai-collab-output-logseq/{logseq,journals}
mkdir -p /srv/ai-collab-output-logseq/pages/knowledge-pipeline/{30-summaries,40-review,50-knowledge}
mkdir -p /var/lib/ai-collab-pipeline
printf '%s\n' '{:meta/version 1}' > /srv/ai-collab-output-logseq/logseq/config.edn
```

Windows 示例：

```powershell
$inputGraph = "F:\ai-collab-logseq"
$outputGraph = "F:\ai-collab-output-logseq"
$runtime = "F:\ai-collab-pipeline-runtime"

New-Item -ItemType Directory -Force -Path `
  "$inputGraph\pages", `
  "$inputGraph\journals", `
  "$inputGraph\knowledge-pipeline\00-inbox", `
  "$inputGraph\knowledge-pipeline\05-notes", `
  "$outputGraph\logseq", `
  "$outputGraph\journals", `
  "$outputGraph\pages\knowledge-pipeline\30-summaries", `
  "$outputGraph\pages\knowledge-pipeline\40-review", `
  "$outputGraph\pages\knowledge-pipeline\50-knowledge", `
  $runtime
```

## 5. 本地配置

在 C 仓库执行：

```bash
cp pipeline/config.example.yaml pipeline/config.yaml
```

配置文件只保存非敏感参数。设置路径：

```bash
export LOGSEQ_REPO_PATH=/srv/ai-collab-logseq
export OUTPUT_LOGSEQ_REPO_PATH=/srv/ai-collab-output-logseq
export PIPELINE_RUNTIME_PATH=/var/lib/ai-collab-pipeline
```

总结模型可选：

```text
SUMMARY_BASE_URL=<HTTPS endpoint>
SUMMARY_MODEL=<model>
SUMMARY_API_KEY=<安全注入>
```

Embedding 与 Qdrant：

```text
EMBEDDING_BASE_URL=<HTTPS endpoint>
EMBEDDING_MODEL=<model>
EMBEDDING_API_KEY=<安全注入>
QDRANT_URL=<HTTPS 或回环地址>
QDRANT_API_KEY=<需要时安全注入>
```

Qdrant collection 名称必须与配置一致，向量维度必须匹配 Embedding 模型，距离类型使用 Cosine。

本地凭据文件权限应为 `0600`。不得上传 `.env`；生产优先使用 `*_API_KEY_FILE` 和 Token 文件。

## 6. 建立知识库

### 6.1 验证配置

```bash
python pipeline/run.py --config pipeline/config.yaml validate
```

必须确认输入可读、输出和 Runtime 可写、三个根目录互不重叠。

### 6.2 生成切片

```bash
python pipeline/run.py --config pipeline/config.yaml process
python pipeline/run.py --config pipeline/config.yaml status
```

Runtime 应包含：

```text
normalized/
chunks/chunks.jsonl
state/manifest.jsonl
logs/last-run.json
```

### 6.3 关键词检索

```bash
python pipeline/run.py --config pipeline/config.yaml query \
  --search-mode keyword --text "唯一测试文本" --limit 5
```

结果必须包含正确的 `source_path`、`chunk_id` 和原文切片。

### 6.4 总结与审核

```bash
python pipeline/run.py --config pipeline/config.yaml summarize
```

B 应生成：

```text
30-summaries/<run-id>/summary-*.md
30-summaries/<run-id>/sources-*.md
40-review/<run-id>/candidates-*.md
```

主要陈述必须带证据。未经批准的候选不得成为正式知识。

### 6.5 Embedding

```bash
python pipeline/run.py --config pipeline/config.yaml embed-plan
python pipeline/run.py --config pipeline/config.yaml embed
```

先检查模型、维度、预计 Token 和迁移提示，再执行写入。

### 6.6 语义和混合检索

```bash
python pipeline/run.py --config pipeline/config.yaml query \
  --search-mode semantic --text "同义但不同措辞的问题" --limit 5

python pipeline/run.py --config pipeline/config.yaml query \
  --search-mode hybrid --text "概念与精确代号" --limit 8
```

生产推荐 `hybrid`。语义依赖故障时，hybrid 必须明确标记降级，不能冒充正常语义检索。

## 7. 启动查询服务和 Connector

查询服务：

```bash
python -m pipeline.server --config pipeline/config.yaml \
  --host 127.0.0.1 --port 8787
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8787/health/live
curl -fsS http://127.0.0.1:8787/health/ready
curl -fsS 'http://127.0.0.1:8787/health/ready?require=semantic'
```

第三项成功后，才能声明语义/混合检索上线。

Connector 推荐配置：

```text
AP_QUERY_URL=http://127.0.0.1:8787
AP_QUERY_MODE=hybrid
AP_CONNECTOR_PORT=8788
AP_SOURCE_ID=logseq-workspace
AP_CONNECTOR_TOKEN_FILE=<受保护文件>
QUERY_API_TOKEN_FILE=<受保护文件>
```

启动：

```bash
node connector/server.mjs
curl -fsS http://127.0.0.1:8788/health/live
```

Connector 不提供写入、远程文件打开或无引用回答。

## 8. 配置 Action Pocket

```text
AP_CONNECTOR_URL=http://127.0.0.1:8788/action-pocket/v1
AP_CONNECTOR_TOKEN=<与 Connector 相同的凭据，通过环境注入>
```

另外将 B 添加为 Logseq 文件夹项目：

- B 文件源：关键词检索、文件定位、journals 记入；
- Connector：查询 C 的关键词、语义或混合索引。

## 9. 服务器部署

在 C 仓库：

```bash
cp deploy/docker.env.example deploy/docker.env
sudo cp deploy/server.env.example /etc/ai-collab-server.env
sudo cp deploy/connector.env.example /etc/ai-collab-connector.env
sudo chmod 0640 /etc/ai-collab-server.env /etc/ai-collab-connector.env
chmod 0600 deploy/docker.env
./deploy/serverctl.sh init
```

在 `server-data/secrets/` 创建权限为 `0600` 的：

```text
summary_api_key
embedding_api_key
query_api_token
ap_connector_token
```

按需创建 `qdrant_api_key`。

验证与启动：

```bash
SERVER_ENV_FILE=/etc/ai-collab-server.env ./deploy/serverctl.sh doctor
SERVER_ENV_FILE=/etc/ai-collab-server.env ./deploy/serverctl.sh update
./deploy/serverctl.sh health
./deploy/serverctl.sh connector-health
```

systemd 安装以下单元：

```text
ai-collab-stack.service
ai-collab-connector.service
ai-collab-cycle.service
ai-collab-cycle.timer
```

具体服务器账户、Deploy Key 和模板替换步骤见 C 的 `TODO.md`。

## 10. 验收流程

### 10.1 固化基线

验收前记录 A、B、C 的分支和 Commit SHA。三个工作区必须干净。不得用未提交源码进行生产验收。

### 10.2 自动化测试

A：

```bash
npm test
npm run build
npm run server:build
```

C：

```bash
python -m unittest discover -s tests -p 'test_*.py'
```

跨项目：

```bash
AP_PYTHON="$(command -v python3)" \
AP_CLIENT_MODULE=file:///path/to/action-pocket/.server-dist/server/sources/httpConnector.js \
node --test connector/server.test.mjs connector/pythonE2e.test.mjs
```

要求退出码全部为 0，跨项目测试不得有 skipped。

### 10.3 数据闭环

在测试源图谱新增包含唯一标识的笔记：

```text
ACCEPTANCE-KB-UNIQUE-001
```

依次验证：

1. process 后 keyword 可查；
2. embed 后 semantic 和 hybrid 可查；
3. 修改笔记后旧内容失效、新内容生效；
4. 删除笔记后 chunk 和向量被清理；
5. 连续执行两次 process/embed 不重复生成；
6. 输入图谱在全过程没有被流水线修改。

### 10.4 展示与客户端

- Logseq 能打开 B 的索引、总结、来源和知识页；
- Action Pocket 能关键词检索 B 并定位文件；
- Action Pocket 只能向 `journals/` 记入；
- Connector hybrid 查询可追溯到原始 `source_path` 和 `chunk_id`；
- 停止 8787 后 Connector 返回标准不可用错误，恢复后重新可用；
- 降级和裁剪 warning 在 UI 可见。

### 10.5 安全

- 输入图谱只读挂载；
- Token 不出现在 URL、命令历史、日志和 Git；
- 密钥文件权限为 `0600`；
- 服务以非 root 用户运行；
- 8787、8788 默认只监听回环；
- 外部服务使用 HTTPS，或仅在批准的私网使用 HTTP；
- 输出知识经过密钥扫描；
- Runtime、Qdrant 和模型原始响应不提交 Git。

## 11. 通过标准

完整验收必须全部满足：

- [ ] A、B、C 使用已记录 Commit，工作区干净
- [ ] validate、process、status 成功
- [ ] keyword 命中且可追溯
- [ ] summary 具有证据
- [ ] embed 成功
- [ ] semantic readiness 返回成功
- [ ] semantic 和 hybrid 通过
- [ ] hybrid 降级可见
- [ ] 新增、修改、删除、幂等通过
- [ ] Logseq 和 Action Pocket 通过
- [ ] 输入只读和凭据保护通过
- [ ] 服务重启恢复通过

只完成 process 和 keyword 时，只能标记“关键词阶段通过”。

## 12. 回滚

- Connector 故障：停止 Connector，Action Pocket 改用 B 文件源；
- 向量故障：将 `AP_QUERY_MODE` 改为 `keyword`，保留 chunks 和 manifest；
- 代码故障：停止服务，切换到已验收标签，使用正常 Git 回滚；
- 索引损坏：保留源图谱，从 chunks 或源数据重建；
- 禁止 `git reset --hard`、`git clean -fd` 和强制推送清理共享工作区。

## 13. 相关文档

- 当前审查结果：`docs/knowledge-base-deployment/VERIFICATION.md`
- 当前关系：`THREE-PROJECT-RELATIONSHIP-ANALYSIS.md`
- A 协议：`design/CONNECTOR-API.md`
- C 部署：`deploy/README.md`
- C 查询接口：`docs/QUERY_SERVICE.md`
- C Connector：`docs/ACTION_POCKET_CONNECTOR.md`
- C 服务器人工步骤：`TODO.md`
