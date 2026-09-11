# Action Pocket

**连接知识库与日常任务的统一轻量入口：随手记进去，需要时拿出来。**

当前 MVP 是一个 Web 浮窗原型：通过本机开发 API 将原始文字可靠追加到已有的文件型 Graph，并从 Markdown 标题与段落中找回少量原文。它不建立第二套正文库，也不会执行命令。产品范围以 [`docs/ACTION-POCKET-CHARTER.md`](docs/ACTION-POCKET-CHARTER.md) 为准。

下一阶段的“小窗 + 后台”、RAG 标准连接器、多模态输入与未来观察能力设计见 [`design/`](design/README.md)；其中包含 8 张可开发对照的 SVG UI 图和 OpenAPI 契约草案。

## 本地运行

需要 Node.js 20+。Graph 目录必须显式配置；服务不会猜测或扫描其他目录。

```bash
npm ci
AP_GRAPH_DIR=/absolute/path/to/your/graph npm run dev
# 浏览器打开 http://127.0.0.1:5173
```

Windows PowerShell：

```powershell
$env:AP_GRAPH_DIR = "C:\Users\you\notes"
npm run dev
```

生产构建可使用独立本机服务运行，不依赖 Vite 开发中间件：

```bash
AP_GRAPH_DIR=/absolute/path/to/your/graph npm start
# 浏览器打开 http://127.0.0.1:43127
```

Windows PowerShell：

```powershell
$env:AP_GRAPH_DIR = "C:\Users\you\notes"
npm start
```

可通过 `AP_PORT` 修改端口。服务仅监听 `127.0.0.1`，启动时为页面生成新的会话令牌，并对静态资源启用 CSP、禁止嵌入和禁止缓存。

首次写入会在 Graph 内创建目标子目录。默认位置是 `journals/YYYY_MM_DD.md`，提交前可见且可修改。建议先备份 Graph，并仅授予当前用户所需的读写权限；只读目录会返回明确错误，界面会保留未成功的草稿。

> `npm run dev` 仍由 Vite 提供开发 API；`npm start` 构建前后端并由 `server/app.ts` 提供生产静态页面与同源 API。`npm run preview` 仅用于静态预览，不具备知识源读写能力。Neutralino 壳已具备托盘、关闭后隐藏、Esc 隐藏和窗口置顶，并可成功生成资源包；但压缩包仍未内置 Node 运行时或自动拉起知识源服务，不能标记为独立可分发版本。Neutralino 当前没有官方跨平台全局热键 API，本项目不会用键盘钩子冒充该能力，`Ctrl+Alt+P` 留待受控原生辅助进程实现和真机验收。

## MVP 数据与能力边界

- 核心以 `KnowledgeSource`、`SourceDescriptor` 和 capabilities（`read/search/write/locate/status`）描述知识源，不绑定特定笔记软件。
- 首个适配器是文件型 Graph：只访问 `AP_GRAPH_DIR` 内的 `.md` / `.markdown`；拒绝绝对路径、`..` 和符号链接越界。
- `/api/sources` 发现来源及能力；`/api/search` 返回最多 5 条原文摘录、相邻块、相对路径、1-based 行号与版本；`/api/write` 追加原始内容并在 `fsync`、回读校验后返回回执。
- 当前检索诚实标记为**本地词法 fallback**，未接入或伪装 embedding/rerank。未来来源可实现同一 HTTP/能力契约。
- 浏览器仅持久化临时写入草稿和偏好。固定与“有用”反馈只保存来源位置和版本，不保存摘录正文；旧 `command-pocket-library-v2` 正文快照会被删除而不会迁移。
- “复制原文定位”提供 `sourceId / relative/path.md:line`。普通 Web 页面不能可靠打开任意本地编辑器，因此 MVP 不伪造文件跳转。
- 命令只能复制，永不执行；递归删除、强制 Git 改写、磁盘覆盖、写库等危险内容复制前需要二次确认。
- 正文不发送到云端，也不写入服务日志。

## API 摘要

```text
GET  /api/sources
POST /api/search  { query, sourceId?, limit? }
POST /api/write   { rawContent, target: { sourceId, relativePath } }
```

错误以稳定的 `code` 与非敏感 `message` 返回。API 使用每次开发服务启动时随机生成并注入页面的会话 token；浏览器请求还必须通过本机同源校验，无 `Origin` 的非浏览器请求也必须携带该 token。写入和查询只接受 `application/json`。单次写入上限 256 KiB，请求体上限 300 KiB，查询上限 500 字符；搜索总读取预算为 32 MiB，并限制目录、目录项、候选文件和候选块规模，跳过隐藏目录、`.git`、`logseq/bak`、符号链接和超大文件。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run server:build
```

手工闭环：

1. 用临时 Graph 启动：`AP_GRAPH_DIR=/tmp/ap-graph npm run dev`。
2. 在“记入”输入唯一文本，确认目标后保存；检查对应 Markdown 保留原文。
3. 在“查询”用自然语言找回，确认结果不超过 5 条，包含相对路径、行号和上下文。
4. 将 Graph 改为只读后再次写入，确认不显示成功且输入仍在。
5. 查询危险命令，确认首次复制被弹窗拦截，确认后仅进入剪贴板。
6. 固定结果后修改来源文件并再次查询；版本变化时固定引用显示过期提示。

## 历史资产

`actionpocket/`、`native/`、`docs/v5pilot/`、`docs/relook/` 和 `docs/actionpocket/` 是旧 Command Pocket / Runbook 探索，仅供实现经验参考，不是当前 MVP 的产品模型或验收入口。对应历史测试仍可单独运行 `npm run ap:test`。
