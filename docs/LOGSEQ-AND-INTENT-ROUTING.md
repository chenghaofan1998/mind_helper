# Logseq 接入与问题辨识迭代方案

> 范围以 `ACTION-POCKET-CHARTER.md` 为准。本文描述已经落地的最小切片和下一步接口，不承诺尚未实现的云模型或 Logseq DB 支持。

## 1. 本轮边界

本轮只完成两条可验证路径：

1. 文件型 Logseq graph 通过通用 `KnowledgeSource` 读、搜、写、定位；
2. 输入辨识提供本地规则、显式模式覆盖和可关闭的模型适配接口，但不连接真实模型。

Logseq DB graph 不可当成文件 graph 猜测。它应由独立 sidecar 实现 `design/action-pocket-connector.openapi.yaml`，再经现有 `HttpConnectorSource` 接入。核心代码不出现 Logseq page UUID、Datascript 或插件 API 类型。

## 2. 文件型 Logseq：已落地

### 配置

```text
AP_GRAPH_DIR=C:\absolute\path\to\graph
AP_GRAPH_KIND=logseq-files
```

- `AP_GRAPH_DIR` 必须是已经存在、可访问的绝对路径；程序不会替用户创建或猜测 graph。
- `AP_GRAPH_KIND` 可省略，默认 `markdown-files`；仅接受 `markdown-files` 或 `logseq-files`。
- 指定 `logseq-files` 后，UI 项目来源名显示为“Logseq 文件 Graph”。这只影响明确的连接身份，不改变通用领域接口。
- 桌面多项目配置通过 `AP_PROJECTS_FILE` 装配；每个 Logseq 目录、普通 Markdown 目录或单 Markdown 文件是独立 `ProjectDescriptor` 作用域。请求必须携带当前 `projectId`，服务端验证 source 成员关系后才检索、写入或定位。
- 密钥不适用于文件 graph，也不会写入前端存储。

### 数据流

```text
UI → 本机 /api → SourceRegistry → FileGraphSource → pages/**/*.md / journals/**/*.md
```

`FileGraphSource` 仍是厂商无关实现：

- 目录作用域递归检索 Markdown；单文件作用域只允许被选择的 `.md/.markdown`，不会读取同目录兄弟文件；两者都保留语义块、邻接上下文、行号、文件 URI 和内容版本；
- 忽略隐藏目录、符号链接与 `logseq/bak`，并限制文件数、目录数、块数和总读取量；
- 逐字追加到用户明确选择的相对 Markdown 路径；`fsync` 并回读校验后才返回成功；
- 写入失败返回稳定错误，UI 保留原始输入。

默认 journal 目标仍为 `journals/YYYY_MM_DD.md`。用户可以显式更改目标；程序不会自动整理、覆盖或删除正文。

### Logseq DB / 已有 embedding 与 rerank

使用 Connector：

```text
AP_CONNECTOR_URL=https://127.0.0.1-or-host/action-pocket/v1
AP_CONNECTOR_TOKEN=<environment-only-secret>
```

sidecar 至少实现 `/capabilities` 和 `/search`；需要写入时再声明并实现 `/write`。Bearer token 只从服务端环境变量读取，不进入 URL、前端 bundle、localStorage 或响应。非回环明文 HTTP 会被拒绝。

Connector 必须返回逐字 `evidence.excerpt`、稳定 `location` 和 `version`。RAG、embedding 与 rerank 归知识源所有，Action Pocket 不重复建设索引。`find|command|understanding|task|decision` 已在内部类型、本机 API 与 Connector 请求中对齐；P0 UI 不暴露筛选 chips 或多来源参数。

## 3. 快速问题辨识：已落地的接口

`src/knowledge/intentRouter.ts` 定义：

```ts
type EntryMode = "capture" | "query" | "clarify";
type SearchIntent = "find" | "command" | "understanding" | "task" | "decision";

interface RouteDecision {
  mode: EntryMode;
  intent?: SearchIntent;
  confidence: number;
  reasonCode: string;
  needsConfirmation: boolean;
}

interface IntentRouter {
  classify(text: string, signal?: AbortSignal): Promise<RouteDecision>;
}
```

当前行为：

1. `localRoute` 先做同步、可测试的保守规则；混合粘贴、短词和不明确输入返回 `clarify`。
2. 用户已经点击“记入”或“查询”时，`applyExplicitMode` 永远覆盖辨识结果。分类不能自行触发写入。
3. 查询页只把本次问题交给本地规则以推断底层 search intent；UI 仍只有一个问题框。来源原生检索可把 intent 当路由提示，本地词法 fallback 固定使用 `find`，避免未验证的分类静默降低召回。
4. `ModelFallbackIntentRouter` 默认关闭。只有调用方同时提供 adapter 且设 `enabled: true` 才可能调用模型。
5. 本地高置信度输入不发模型；疑似密钥、token、密码或私钥的输入只在本地处理。
6. 模型只收到当前输入文本。接口没有知识库结果、正文、路径、历史或附件参数，因此默认不能把这些内容发给模型。
7. 模型超时限制为 50–1500 ms，默认 1000 ms；失败、取消、低置信度或非法 JSON 均回退本地决策。
8. 外部结果只接受固定 schema；诊断 `reasonCode` 由本地生成，不复用可能含敏感内容的模型字段。

## 4. 后续模型 adapter（未实现）

需要真实使用验证后，才在服务端增加一个薄 adapter；不在浏览器直连模型。建议环境变量：

```text
AP_INTENT_MODEL_ENABLED=false
AP_INTENT_MODEL_URL=https://model-gateway.example/v1/classify
AP_INTENT_MODEL_TOKEN=<environment-only-secret>
AP_INTENT_MODEL_NAME=<deployment-name>
AP_INTENT_MODEL_TIMEOUT_MS=1000
```

约束：

- 未配置或关闭是正常状态，继续使用本地规则；
- URL 强制 HTTPS，仅回环开发地址允许 HTTP；拒绝 URL 内凭据；
- 请求只包含当前输入和固定分类 schema，不请求答案；
- 不发送知识库正文、检索结果、graph 路径、历史、附件或剪贴板；
- 不记录原文、Authorization、模型原始响应或 token；只记录 request id、adapter 类型、耗时和本地 reason code；
- 模型不能选择知识源、扩大权限、执行命令或写入正文；
- 超时或错误不把 query 改成 capture，也不阻断用户显式保存/查询。

在确实需要服务端共享前不新增 `/api/classify`。若后续增加，它必须复用本机 session token、同源检查、body limit、`no-store` 和取消链。

## 5. 明确不做

- 不新增 provider SDK、Agent、对话记忆、多模型竞速或 prompt 管理平台；
- 不把文件型支持宣称为 Logseq DB 支持；
- 不增加检索类型筛选器或示例问题卡；当前项目切换器必须始终紧凑可见，知识源 provider 仍由项目注册表驱动而不写死在 UI；
- 不自动执行命令，不因分类结果自动写入；
- 不用模型生成内容冒充知识库原文。

## 6. 验收

- 临时 Logseq fixture 可检索 `pages/`、逐字追加 `journals/`，并忽略 `logseq/bak`；
- `decision` intent 可通过本机 API、文件源和 HTTP Connector；
- 模型 adapter 默认零调用，启用后非法响应/异常/50 ms 测试超时均回退；
- 敏感文本不调用 fake model；显式“查询/记入”覆盖分类；
- UI 查询仍为单框，结果支持 `↑/↓` 选择和 Enter 主操作；危险命令 Enter 仍进入复制确认。
