# Action Pocket 设计基线

> 状态：MVP 产品形态与连接器设计基线。实现仍以 `docs/ACTION-POCKET-CHARTER.md` 为最高约束。
>
> ⚠️ **`generated/` 里的 PNG 是蓝灰 token 更新前的历史探索素材，不是当前视觉或验收清单。** 当前视觉以本页“视觉方向”、[`UI-GENERATION-BRIEF.md`](UI-GENERATION-BRIEF.md) 与实现测试为准；`gpt-image-2-prompts.json` 和 `ui/*.svg` 是本轮真实反馈前的生成/结构素材，不再约束系统标题框、固定/反馈或实色外壳。首版实际做什么，以 [`IMPLEMENTATION-NOTES.md`](IMPLEMENTATION-NOTES.md) 为准。

## 结论

Action Pocket 是一个**小窗 + 后台**的知识行动入口：小窗负责低打扰地记入、查询和使用；后台负责知识源、权限、热键与未来观察能力。知识库负责正文与 RAG，Action Pocket 不重复建设向量库或生成式问答。

## 设计文件

| 文件 | 用途 |
|---|---|
| `IMPLEMENTATION-NOTES.md` | **范围权威**：逐图「保留 / 简化 / 不做」注记与阶段验收 |
| `generated/gpt-image-2/*.png` | P0 四个任务的 10 张旧色状态图，仅作历史探索，不属于当前视觉链 |
| `ui/*.svg` | 8 张可编辑结构稿，用于约束布局，非最终视觉 |
| `gpt-image-2-prompts.json` | P0 四个任务的 10 条历史生成提示词；真实反馈后的视觉与操作以本页和 UI Brief 为准 |
| `generate-gpt-image-2.mjs` | 固定使用 `gpt-image-2` 的正式生图脚本 |
| `UI-GENERATION-BRIEF.md` | 现有 10 图逐张纠偏、规划冲突口径、生图输入与验收标准 |
| `PRODUCT-FLOWS.md` | 功能范围、状态与验收 |
| `SCREENSHOT-AND-VISION.md` | 一次性截图、多模态分析与 RAG 联动 |
| `CONNECTOR-API.md` | 标准知识源接口与扩展规则 |
| `action-pocket-connector.openapi.yaml` | 可实现的 HTTP 契约草案 |
| `generate-ui-mocks.mjs` | SVG 结构稿可重复生成脚本 |

## GPT Image 2 生图

不要把 API Key 写入文件或提交记录。在当前终端配置环境变量后运行：

```bash
OPENAI_API_KEY=*** npm run design:generate
# 单张生成（先确认目标文件不存在）
OPENAI_API_KEY=*** npm run design:generate -- --only=01-quick-capture-v2-default.png
```

脚本固定调用官方 `gpt-image-2` 和 `v1/images/generations`，以高质量 1536×1024 PNG 输出到 `generated/gpt-image-2/`。当前目录只保留 P0 的 10 张 v2 主态/异常态；旧版 01–10 PNG 已移除，历史问题与范围取舍保留在 Brief 和实现注记中。脚本只读取 JSON 提示词，不自动读取 Brief，也不会防止同名覆盖；重试前须将目标改为未使用的版本文件名。详见 [`UI-GENERATION-BRIEF.md`](UI-GENERATION-BRIEF.md)。

## 视觉方向

- **气质**：安静、可信、克制，不做聊天机器人，也不做复杂知识库后台。
- **权威设计 token**：可访问蓝主色 `#2563EB`；浅蓝强调 `#60A5FA`；正文 `#172033`；次正文 `#526071`；危险色 `#C54B43`。外壳与内容面使用这些颜色的半透明版本，不以不透明整块壳覆盖系统材质。
- **表面**：Today AI 作为安静轻量的白玻璃参考（已核对官网真实 HTML/CSS：`bg-white/70`、`backdrop-blur-[10px]`、圆角 34px，浅蓝 `#b7ddfb/#dfeafd` 到暖桃 `#ffe2c3` 底色，文字 black/65，深色只用于小面积主按钮），不声称像素复刻。实现取主壳 white ~70%、`blur(10–16px)`、圆角 24–28px、白色内高光与柔和大阴影，header 不使用深色条，背景只留极轻的蓝/桃漫反射；输入、项目切换、结果卡同属玻璃层级，危险态仍红，主按钮深色/近黑。Windows 11 由 launcher 优先应用 Mica，失败或 Windows 10 使用 Acrylic；透明无边框 Neutralino 内叠半透明浅色内容层、细边框、柔阴影，无系统最小化/最大化/关闭框。无 blur 与高对比模式有可读 fallback（失败回退不透明白色）。
- **尺寸**：小窗设计基准 560×680；后台设计基准 1280×820。
- **信息层级**：当前意图 > 原文结果 > 来源定位 > 派生说明 > 次要操作。

## 实施顺序

**P0（首版闭环，只做 4 个画面）**：快速记入 → 查询 → 结果 → 危险确认，接一个真实知识源。

**P1（第二闭环）**：一次性截图 → 选区 → 预览 → 分析 → 联合查询。

**P2（需真实数据支撑）**：遮挡编辑、Derived 渲染、负反馈。项目切换已因真实反馈纳入 P0：主窗只切换已配置项目，单项目显示紧凑标签、多项目显示 `select`，无项目时只提示“请从系统托盘打开设置”，不加入 provider 专属装饰；项目增删改全部在托盘“设置…”的独立原生窗口完成。

**本轮不做**：观察会话、架构图页面、能力矩阵、凭据管理 UI、多模型路由。

详细拆分与验收标准见 [`IMPLEMENTATION-NOTES.md`](IMPLEMENTATION-NOTES.md)。

## 明确边界

- 一次性截图进入下一版 MVP；图片文件和实时观察仍按真实需求逐项验证。
- 截图必须由独立热键或显式按钮触发，并在发送前预览、允许重选并确认。
- 不默认读取剪贴板、屏幕、键盘、摄像头或麦克风；一次截图绝不自动升级为持续观察。
- 原始证据与 AI/RAG 派生结果必须分开展示。
- 固定、反馈和临时状态不得形成第二套正文库。
- 监控能力未来必须单独授权、可见、可暂停、可审计、默认关闭。
