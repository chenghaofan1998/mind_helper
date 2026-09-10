# Action Pocket Knowledge Source Connector API

## 1. 目标

该协议让知识库、多模态模型或适配器向 Action Pocket 提供能力。Action Pocket 不规定 RAG、向量库、rerank、视觉模型或存储实现，只规定可信输入输出。

```text
Action Pocket 小窗 → 本地 Connector Gateway ┬→ Knowledge Source → 知识库/RAG
                                               └→ Vision Analyzer → 多模态模型
```

连接器声明 `connectorType`：`knowledge-source`、`multimodal-analyzer` 或 `combined`。平台只按 capabilities 调用，不根据厂商名称猜测能力。

若知识库不能直接实现协议，可部署一个 sidecar adapter 做字段映射；凭据只保存在本机环境变量或系统凭据库。

## 2. 版本与传输

- 基础路径：`/action-pocket/v1`
- HTTPS；仅回环开发模式可使用 HTTP。
- JSON 使用 UTF-8。
- 认证由连接器声明，首版支持 Bearer token；不得把 token 写入 URL、日志或前端持久化。
- 写入请求使用 `Idempotency-Key` 防止超时重试造成重复正文。
- 每个响应返回 `requestId` 供脱敏诊断。

## 3. 能力发现

`GET /action-pocket/v1/capabilities`

核心能力：

- `search`：查询原始知识；
- `rag`：支持语义/混合检索；
- `write`：保存原始输入；
- `locate`：返回可定位或打开的来源；
- `status`：健康和索引新鲜度；
- `vision-analysis`：分析用户显式提供的一次性截图或图片；
- `multimodal-input`：知识库检索可直接接收图片等输入；
- `observe`：未来显式观察会话。

未声明的能力不得调用。`vision-analysis` 不代表持续读取屏幕；`observe` 不因接口存在而默认启用。

## 4. 查询

`POST /action-pocket/v1/search`

请求：

```json
{
  "query": "我以前为什么觉得 Adam 的动量容易理解？",
  "limit": 5,
  "intent": "understanding",
  "filters": { "kinds": ["note", "conversation"] }
}
```

响应中的每个结果必须包含：

- `evidence.excerpt`：逐字原文；
- `contextBefore/contextAfter`：必要上下文；
- `location`：稳定文档/块标识、版本、可选 URI；
- `retrieval.mode`：`rag`、`hybrid`、`keyword` 等真实模式；
- `retrieval.score`：可选，不能跨实现直接比较；
- `derived`：可选转换结果，必须带 evidence 引用；
- `warnings`：冲突、过期、权限裁剪或依据不足。

连接器不得返回无引用的流畅回答冒充知识库原文。

## 5. 截图与多模态分析

`POST /action-pocket/v1/analyze`

请求必须包含带显式 consent 的 `InputEnvelope`、会话期附件引用和分析任务。响应返回 `observations`、`extractedText`、`problemStatement`、`suggestedQueries`、敏感内容提示和区域引用。

默认联动方式是：截图只发给多模态连接器，用户确认后的问题文本再发给知识库 RAG。只有知识库声明 `multimodal-input` 且用户再次授权时，`/search` 才可携带附件。

视觉模型结果属于派生 Observation，不能作为知识库 Evidence 展示。完整约束见 `SCREENSHOT-AND-VISION.md`。

## 6. 写入

`POST /action-pocket/v1/write`

- 原始内容不得被连接器静默摘要后替代；
- `target` 必须明确；
- 成功响应必须含实际来源位置和版本；
- 失败时返回稳定错误码，Action Pocket 保留用户输入；
- 是否整理、追加标签或生成标题必须在 `transforms` 中显式声明。

## 7. 原文定位

`POST /action-pocket/v1/locate`

输入稳定 `SourceLocation`，返回最新 URI/位置和版本状态。固定结果展示前应调用或通过查询结果核对版本，不能继续把旧缓存当最新正文。

## 8. 状态

`GET /action-pocket/v1/status`

至少返回：

- `healthy`；
- 当前检索模式；
- 索引更新时间；
- 权限裁剪说明；
- 可重试错误与建议等待时间。

## 9. 多模态输入

`InputEnvelope.attachments` 使用会话期外部引用，不在 JSON 中传 Base64：

```json
{
  "id": "att_123",
  "mediaType": "image/png",
  "size": 240381,
  "sha256": "...",
  "uri": "ap-local://session/...",
  "retention": "session"
}
```

连接器必须声明支持的媒体类型、最大尺寸、是否离开设备及保留策略。一次性截图进入下一版 MVP；音频和持续屏幕事件继续保留契约但不实现。

## 10. 观察扩展

未来接口：

- `POST /observation-sessions`：显式开始；
- `GET /observation-sessions/{id}/events`：SSE 结构化事件；
- `DELETE /observation-sessions/{id}`：立即停止；
- `GET /observation-sessions/{id}/audit`：查看采集摘要。

MVP 只保留命名与能力位，不实现采集。观察事件默认不得包含原始屏幕帧；需要原始媒体时必须单独声明并确认。

## 11. 错误码

至少支持：

`INVALID_INPUT`、`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`CAPABILITY_UNAVAILABLE`、`PAYLOAD_TOO_LARGE`、`RATE_LIMITED`、`SOURCE_STALE`、`TIMEOUT`、`UPSTREAM_UNAVAILABLE`、`IO_ERROR`。
