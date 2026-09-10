# 截图与多模态分析设计

## 1. 场景定义

用户遇到的问题往往就在当前界面里：报错、设置页面、游戏机制、软件状态或图表。Action Pocket 应允许用户显式截取当前问题，由多模态模型提取可见事实，再联合知识库 RAG 找回相关原文。

它不是实时监控。一次截图是一种**用户主动、范围明确、可预览和撤销的输入**。

## 2. MVP 用户流程

```text
Ctrl+Alt+Shift+P
  → 选择窗口或区域
  → 本地截图预览
  → 用户裁剪/遮挡敏感区域
  → 明确选择“仅分析”或“分析并查询知识库”
  → 多模态模型返回视觉观察与建议查询
  → 用户确认/修改查询
  → 知识库 RAG 返回原文证据
  → 小窗区分视觉推断、知识库原文和最终操作建议
```

默认热键：

- `Ctrl+Alt+P`：普通小窗；
- `Ctrl+Alt+Shift+P`：一次性截图；
- `Esc`：在任意截图阶段立即取消并销毁会话临时图像。

## 3. 输入边界

截图输入使用 `InputEnvelope`：

```ts
interface ScreenshotInput extends InputEnvelope {
  modality: "screen";
  intent: "query";
  attachments: [{
    mediaType: "image/png" | "image/jpeg" | "image/webp";
    uri: string;
    size: number;
    sha256: string;
    retention: "request" | "session";
  }];
  sourceContext: {
    captureType: "region" | "window";
    applicationName?: string;
    userRedacted: boolean;
  };
}
```

约束：

- 原始图片不写入日志、localStorage 或知识库；
- 图片默认只保留到本次请求或小窗会话结束；
- 不采集窗口标题、进程信息等额外元数据，除非用户明确允许；
- 发送云端模型前展示模型提供商、图片范围和数据去向；
- 支持本地多模态模型时，使用同一接口，不改变 UI 流程。

## 4. 多模态分析输出

视觉模型只返回派生观察，不充当知识库证据：

```ts
interface VisionAnalysis {
  analysisId: string;
  observations: Array<{
    text: string;
    region?: { x: number; y: number; width: number; height: number };
    confidence?: number;
  }>;
  problemStatement?: string;
  extractedText?: string;
  suggestedQueries: string[];
  sensitiveContentDetected: boolean;
  warnings: string[];
}
```

界面标签必须使用“截图观察”或“模型推断”，不得标成“原文”。

## 5. 与知识库联动

默认采用最小披露：

1. 截图只发送给用户选择的多模态分析连接器；
2. 返回的 `problemStatement` 和用户确认后的 query 发送给知识库 RAG；
3. 原始截图不发送给知识库；
4. 只有知识库同时声明 `multimodal-input` 且用户明确选择时，才发送附件引用；
5. 最终展示：截图观察、知识库原文、派生建议三层。

这使知识库可以自带多模态 RAG，也允许“视觉模型 + 文本 RAG”组合。

## 6. 标准接口

### 分析截图

`POST /action-pocket/v1/analyze`

请求包含 `InputEnvelope` 和任务：`describe-problem`、`extract-text` 或 `suggest-query`。

连接器须声明：

- `vision-analysis` capability；
- 支持的媒体类型与尺寸；
- 本地或云端处理；
- 数据保留策略；
- 是否支持区域引用。

### 联合查询

`POST /action-pocket/v1/search` 可选接受：

- `query`：用户确认后的文本；
- `analysisId`：同一连接器内短期引用；
- `attachments`：仅在 capability 与授权均满足时使用。

## 7. 未来观察能力复用

未来实时观察复用 `InputEnvelope` 与 `VisionAnalysis`，但必须另建显式 `ObservationSession`：

- 绑定一个应用或区域；
- 固定采样策略与本地预处理；
- 持续显示运行状态；
- 随时暂停和停止；
- 默认只输出结构化事件，不保留帧；
- 每次跨设备/写知识库仍需策略授权。

一次截图不会自动升级为观察会话。

## 8. 验收

- 取消截图后临时文件被删除；
- 发送前可预览和遮挡；
- 云端发送范围明确可见；
- 没有 `vision-analysis` capability 时入口明确禁用；
- 模型推断与知识库原文视觉分层；
- 抽象问题可以在用户确认后交给 RAG，而不是直接使用 OCR 字符串搜索；
- 截图失败或模型失败时仍保留用户可编辑的问题描述。
