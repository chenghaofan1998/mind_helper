# Action Pocket 设计基线

> 状态：MVP 产品形态与连接器设计基线。实现仍以 `docs/ACTION-POCKET-CHARTER.md` 为最高约束。

## 结论

Action Pocket 是一个**小窗 + 后台**的知识行动入口：小窗负责低打扰地记入、查询和使用；后台负责知识源、权限、热键与未来观察能力。知识库负责正文与 RAG，Action Pocket 不重复建设向量库或生成式问答。

## 设计文件

| 文件 | 用途 |
|---|---|
| `ui/*.svg` | 8 张可编辑结构稿，用于约束布局和开发实现，不作为 GPT 生图成品 |
| `generated/gpt-image-2/*.png` | GPT Image 2 正式视觉探索图（生成后写入） |
| `gpt-image-2-prompts.json` | 10 个统一风格的 GPT Image 2 分镜提示词 |
| `generate-gpt-image-2.mjs` | 固定使用 `gpt-image-2` 的正式生图脚本 |
| `UI-GENERATION-BRIEF.md` | 生图输入、输出和评审标准 |
| `PRODUCT-FLOWS.md` | 功能范围、状态与验收 |
| `SCREENSHOT-AND-VISION.md` | 一次性截图、多模态分析与 RAG 联动 |
| `CONNECTOR-API.md` | 标准知识源接口与扩展规则 |
| `action-pocket-connector.openapi.yaml` | 可实现的 HTTP 契约草案 |
| `generate-ui-mocks.mjs` | SVG 结构稿可重复生成脚本 |

## GPT Image 2 生图

不要把 API Key 写入文件或提交记录。在当前终端配置环境变量后运行：

```bash
OPENAI_API_KEY=*** npm run design:generate
# 单张重试
OPENAI_API_KEY=*** npm run design:generate -- --only=05-screenshot-capture.png
```

脚本固定调用官方 `gpt-image-2` 和 `v1/images/generations`，以高质量 1536×1024 PNG 输出到 `generated/gpt-image-2/`。当前执行环境没有配置 API Key，因此仓库内暂时只有提示词与 SVG 结构稿。

## 视觉方向

- **气质**：安静、可信、克制，不做聊天机器人，也不做复杂知识库后台。
- **主色**：墨绿 `#276B5D`；强调色 `#43B69B`；危险色 `#C54B43`。
- **表面**：深墨背景 + 浅色内容卡，突出原文而非装饰。
- **尺寸**：小窗设计基准 560×680；后台设计基准 1280×820。
- **信息层级**：当前意图 > 原文结果 > 来源定位 > 派生说明 > 次要操作。

## 实施顺序

1. 标准 Connector API、远程 RAG 与多模态分析适配器。
2. Neutralino 小窗（置顶、托盘、窗口显隐）。
3. `Ctrl+Alt+P` 普通入口与 `Ctrl+Alt+Shift+P` 一次性截图。
4. 截图预览、遮挡、明确发送范围和证据分层。
5. 后台知识源、模型、热键、权限与连接测试。
6. 真实截图试用后，再判断持续观察是否值得进入开发。

## 明确边界

- 一次性截图进入下一版 MVP；图片文件和实时观察仍按真实需求逐项验证。
- 截图必须由独立热键或显式按钮触发，并在发送前预览、遮挡和确认。
- 不默认读取剪贴板、屏幕、键盘、摄像头或麦克风；一次截图绝不自动升级为持续观察。
- 原始证据与 AI/RAG 派生结果必须分开展示。
- 固定、反馈和临时状态不得形成第二套正文库。
- 监控能力未来必须单独授权、可见、可暂停、可审计、默认关闭。
