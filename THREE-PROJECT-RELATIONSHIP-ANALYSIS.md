# 三项目关系与运行边界

## 结论

三个项目属于同一条知识链，不应打包为一个目录：

| 代号 | 项目 | 职责 |
| --- | --- | --- |
| A | Action Pocket | 桌面查询、记入和定位入口 |
| B | AI Collab Output Logseq | 承载总结、审核候选和正式知识 |
| C | AI Collab Agent Workspace | 加工、切片、总结、Embedding、检索服务和 Connector |

完整运行还需要独立的输入 Logseq 图谱和 Pipeline Runtime。

```text
输入 Logseq（只读）
        │
        ▼
C：process → summarize → review → embed
        ├────────► B：输出 Logseq
        └────────► Runtime：chunks / vectors / state / logs
                         │
A ◄── Connector :8788 ◄── Query Service :8787
│
└──── 直接读取 B（关键词检索、定位、journals 记入）
```

## 关系

### A 与 B：文件级集成

- A 将 B 添加为 `logseq-files` 项目；
- 支持关键词检索、文件定位和 Markdown 展示；
- A 只允许向 B 的 `journals/` 记入普通内容；
- A 禁止写入流水线生成目录和索引页。

### B 与 C：输出目录契约

C 只向以下位置写生成内容：

```text
pages/knowledge-pipeline/30-summaries/
pages/knowledge-pipeline/40-review/
pages/knowledge-pipeline/50-knowledge/
pages/knowledge-pipeline/AI Knowledge Index.md
```

B 不包含业务代码，不自行生成内容。

### A 与 C：只读 Connector

```text
Action Pocket
  → http://127.0.0.1:8788/action-pocket/v1
  → http://127.0.0.1:8787/v1/query
```

- Connector 实现位于 C 的 `connector/server.mjs`；
- 支持 `keyword`、`semantic`、`hybrid`；
- 生产推荐 `hybrid`，语义依赖故障时明确降级为 `keyword`；
- 不接入 `/v1/answer`，不返回无引用的生成式回答；
- 不提供远程写入或文件打开能力。

## 数据边界

系统使用三个互不重叠的数据根目录：

| 环境变量 | 权限 | 内容 |
| --- | --- | --- |
| `LOGSEQ_REPO_PATH` | 只读 | 原始 pages、journals、assets |
| `OUTPUT_LOGSEQ_REPO_PATH` | 流水线受限写入 | B 的总结、审核和知识页面 |
| `PIPELINE_RUNTIME_PATH` | 可写，不提交 Git | normalized、chunks、vectors、state、logs |

禁止事项：

- 将输入、输出或 Runtime 指向同一目录或父子目录；
- 将 Runtime 放入 Logseq；
- 将密钥写入 Git、YAML、输出知识或日志；
- 把派生总结伪装成原文证据。

## 检索模式

| 入口 | 模式 |
| --- | --- |
| A 直接读取 B | 关键词 |
| C `query --search-mode keyword` | 关键词 |
| C `query --search-mode semantic` | Embedding 语义检索 |
| C `query --search-mode hybrid` | 向量召回 + 关键词重排 |
| A 通过 Connector | 由 `AP_QUERY_MODE` 决定，生产推荐 `hybrid` |

语义或混合检索上线前必须满足：

```text
GET /health/ready?require=semantic → HTTP 200
```

## 关键文件

| 用途 | 文件 |
| --- | --- |
| A Connector 客户端 | `server/sources/httpConnector.ts` |
| A Connector 协议 | `design/CONNECTOR-API.md` |
| C Connector | `connector/server.mjs` |
| C 查询服务 | `pipeline/server.py` |
| C Connector 文档 | `docs/ACTION_POCKET_CONNECTOR.md` |
| C 部署入口 | `deploy/serverctl.sh` |
| C 容器编排 | `compose.yaml` |
| 统一配置与验收 | `docs/knowledge-base-deployment/README.md` |
