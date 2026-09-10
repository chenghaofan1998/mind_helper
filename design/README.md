# Action Pocket 设计基线

> 状态：MVP 产品形态与连接器设计基线。实现仍以 `docs/ACTION-POCKET-CHARTER.md` 为最高约束。

## 结论

Action Pocket 是一个**小窗 + 后台**的知识行动入口：小窗负责低打扰地记入、查询和使用；后台负责知识源、权限、热键与未来观察能力。知识库负责正文与 RAG，Action Pocket 不重复建设向量库或生成式问答。

## 设计文件

| 文件 | 用途 |
|---|---|
| `ui/01-quick-capture.svg` | 热键唤起后的快速记录态 |
| `ui/02-rag-search.svg` | 抽象自然语言问题输入态 |
| `ui/03-rag-results.svg` | RAG 结果、原文、上下文与来源呈现 |
| `ui/04-command-risk.svg` | 危险命令复制确认 |
| `ui/05-backstage-connectors.svg` | 后台知识源与能力管理 |
| `ui/06-hotkey-lifecycle.svg` | 全局热键与窗口生命周期 |
| `ui/07-monitoring-consent.svg` | 未来实时观察的显式授权形态 |
| `ui/08-input-output-architecture.svg` | 输入、连接器、知识库和输出架构 |
| `PRODUCT-FLOWS.md` | 功能范围、状态与验收 |
| `CONNECTOR-API.md` | 标准知识源接口与扩展规则 |
| `action-pocket-connector.openapi.yaml` | 可实现的 HTTP 契约草案 |
| `generate-ui-mocks.mjs` | UI SVG 可重复生成脚本 |

## 视觉方向

- **气质**：安静、可信、克制，不做聊天机器人，也不做复杂知识库后台。
- **主色**：墨绿 `#276B5D`；强调色 `#43B69B`；危险色 `#C54B43`。
- **表面**：深墨背景 + 浅色内容卡，突出原文而非装饰。
- **尺寸**：小窗设计基准 560×680；后台设计基准 1280×820。
- **信息层级**：当前意图 > 原文结果 > 来源定位 > 派生说明 > 次要操作。

## 实施顺序

1. 标准 Connector API 与远程 RAG 适配器。
2. Neutralino 小窗（置顶、托盘、窗口显隐）。
3. `Ctrl+Alt+P` 全局热键与键盘操作。
4. 后台知识源源管理与连接测试。
5. 真实知识库试用后再决定图像输入与观察能力是否进入开发。

## 明确边界

- 当前只实现显式文字/粘贴输入；图像、屏幕与实时观察仅预留契约。
- 不默认读取剪贴板、屏幕、键盘、摄像头或麦克风。
- 原始证据与 AI/RAG 派生结果必须分开展示。
- 固定、反馈和临时状态不得形成第二套正文库。
- 监控能力未来必须单独授权、可见、可暂停、可审计、默认关闭。
