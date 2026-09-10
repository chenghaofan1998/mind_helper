# UI 生图与视觉探索 Brief

## 目标

为 Action Pocket 生成可实现、同一产品体系内的一组桌面 UI 方案，而不是营销概念图。图像用于评审层级、布局、状态和视觉语言；最终实现以组件与设计令牌为准。

## 固定产品事实

- 产品形态：Windows/macOS 小窗 + 后台设置。
- 小窗基准：560×680，置顶、键盘优先。
- 后台基准：1280×820。
- 核心意图：记入、查询、一次性截图提问。
- 知识库负责正文和 RAG；多模态连接器负责截图观察；产品负责组合并清晰分层。
- 危险命令只复制不执行。
- 未来监控默认关闭，必须显式授权、持续可见、随时停止。

## 生成模型

正式视觉图必须使用 OpenAI `gpt-image-2`；SVG 仅作为布局结构稿。统一使用 1536×1024、高质量 PNG，原始结果不得覆盖，后续修改走独立版本文件。

## 统一视觉提示词

```text
Design a production-feasible desktop UI for “Action Pocket”, a quiet knowledge action launcher.
Premium restrained productivity software, compact always-on-top utility window, deep graphite green shell,
warm off-white content surfaces, jade green primary actions, subtle red safety states, excellent Chinese typography,
clear evidence-first hierarchy, accessible contrast, 8px spacing system, 14–20px radii, minimal shadows,
no chatbot persona, no decorative dashboard clutter, no glassmorphism, no neon cyberpunk.
Use realistic Chinese product copy. Show complete window boundaries and implementation-feasible controls.
```

## 负面提示词

```text
marketing landing page, mobile phone mockup, futuristic HUD, glassmorphism, neon gradient, oversized illustration,
chat bubbles everywhere, fake charts, unreadable text, random icons, excessive cards, autonomous AI agent,
automatic command execution, hidden monitoring, surveillance aesthetic
```

## 分镜输入

1. **快速记入**：原始想法、明确知识源与写入位置、成功前不清空。
2. **RAG 查询**：抽象自然语言问题、来源健康与真实检索模式。
3. **结果详情**：原文、上下文、定位、版本、派生提示分层。
4. **危险确认**：安全路径默认聚焦，强调只复制不执行。
5. **截图选区**：一次性区域选择、敏感遮挡、临时保留说明。
6. **截图分析**：模型观察、可编辑建议问题和知识库 RAG 数据去向。
7. **后台连接器**：RAG、文件 Graph 与多模态模型并存，显示 capabilities。
8. **小窗与热键**：普通入口、截图入口、托盘和单实例生命周期。
9. **观察授权**：指定范围、保留策略、处理位置和醒目运行状态。
10. **架构图**：输入信封、Connector Gateway、知识库/模型能力与证据输出。

## 生图输出要求

每个分镜至少输出：

- 1 张完整窗口图；
- 1 张关键状态局部图；
- 无设备外壳、无手持场景；
- 相同色板、字号层级、圆角和图标语言；
- 文案不得使用无意义占位符；
- 同时保留可落地的 SVG/Figma 结构稿作为验收基准。

## 评审维度

按以下顺序评审，不以“惊艳”优先：

1. 任务是否 3 秒内可理解；
2. 原文和派生内容是否不会混淆；
3. 风险、权限和观察状态是否可见；
4. 键盘路径是否明确；
5. 是否能映射为真实组件；
6. 最后才评审品牌感与美观度。
