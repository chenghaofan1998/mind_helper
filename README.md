# Action Pocket

**连接知识库与日常任务的统一轻量入口：随手记进去，需要时拿出来。**

当前 MVP 是一个 Web 浮窗原型：可连接本地文件型 Graph 或标准 HTTP Connector，可靠记入原始文字并找回少量原文。它不建立第二套正文库，也不会执行命令。产品范围以 [`docs/ACTION-POCKET-CHARTER.md`](docs/ACTION-POCKET-CHARTER.md) 为准。

下一阶段的“小窗 + 后台”、RAG 标准连接器、多模态输入与未来观察能力设计见 [`design/`](design/README.md)；Logseq 接入和问题辨识的已实现边界见 [`docs/LOGSEQ-AND-INTENT-ROUTING.md`](docs/LOGSEQ-AND-INTENT-ROUTING.md)。

## 本地运行

需要 Node.js 20+。应用允许在未配置知识源时启动；本地 Graph 目录必须显式配置，服务不会猜测或扫描其他目录。

```bash
npm ci
AP_GRAPH_DIR=/absolute/path/to/your/graph npm run dev
# 浏览器打开 http://127.0.0.1:5173
```

Windows PowerShell：

```powershell
$env:AP_GRAPH_DIR = "C:\Users\you\notes"
$env:AP_GRAPH_KIND = "logseq-files" # 文件型 Logseq；普通 Markdown 可省略
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

也可接入遵循 [`design/CONNECTOR-API.md`](design/CONNECTOR-API.md) 的标准 Connector。`AP_CONNECTOR_URL` 应指向 `/action-pocket/v1` 基础地址，Bearer token 只通过环境变量提供：

```bash
AP_CONNECTOR_URL=https://knowledge.example.com/action-pocket/v1 \
AP_CONNECTOR_TOKEN=*** npm start
```

明文 HTTP 仅允许 `127.0.0.1`、`localhost` 或 `::1`。可通过 `AP_PORT` 修改本机服务端口。服务仅监听 `127.0.0.1`，启动时为页面生成新的会话令牌，并对静态资源启用 CSP、禁止嵌入和禁止缓存。

首次写入会在 Graph 内创建目标子目录。默认位置是 `journals/YYYY_MM_DD.md`，提交前可见且可修改。建议先备份 Graph，并仅授予当前用户所需的读写权限；只读目录会返回明确错误，界面会保留未成功的草稿。

> `npm run dev` 仍由 Vite 提供开发 API；`npm start` 构建前后端并由 `server/app.ts` 提供生产静态页面与同源 API。`npm run preview` 仅用于静态预览，不具备知识源读写能力。Neutralino 壳已具备托盘、关闭后隐藏、Esc 隐藏和窗口置顶。Windows 测试包使用最小原生启动器先启动同源本机服务，再打开 Neutralino 壳；启动器注册 `Ctrl+Alt+P`，不使用键盘钩子，并在退出时清理服务进程。该链路仍需 Windows 真机验收，验收前不能标记为正式可分发版本。

## Windows P0 测试包

需要 Windows x64、PowerShell 和构建机上的 Node.js 20+：

```powershell
npm ci
npm run desktop:web-package
```

产物为 `dist/ActionPocket-windows-x64.zip`。包内已复制 Node 运行时、服务产物和 Web 资源；目标测试机不应再依赖预装 Node.js。`ActionPocket.exe` 不会在首次启动时强迫配置知识源；需要连接或更换本地文件型知识库时，运行 `ActionPocket.exe --choose-graph` 并选择已备份的目录。标准 HTTP Connector 已实现环境变量接入，桌面配置界面仍待后续迭代。

构建与自动测试不能替代 Windows 热键、托盘、进程清理和启动耗时验收，执行步骤见 [`docs/P0-RELEASE-CHECKLIST.md`](docs/P0-RELEASE-CHECKLIST.md)。

## MVP 数据与能力边界

- 核心以 `KnowledgeSource`、`SourceDescriptor` 和 capabilities（`read/search/write/locate/status`）描述知识源，不绑定特定笔记软件。
- 文件型 Graph 会递归读取 `AP_GRAPH_DIR` 多级子目录内的 `.md` / `.markdown`；拒绝绝对路径、`..` 和符号链接越界，并跳过隐藏目录、缓存及备份目录。
- `/api/sources` 发现来源及能力；`/api/search` 返回最多 5 条原文摘录、相邻块、相对路径、1-based 行号与版本；`/api/write` 追加原始内容并在 `fsync`、回读校验后返回回执。
- 本地 Graph 检索诚实标记为**本地词法 fallback**，未接入或伪装 embedding/rerank；标准 Connector 原样声明来源侧检索能力。查询界面保持单问题框，底层以本地规则辨识 `find/command/understanding/task/decision`。
- 浏览器仅持久化临时写入草稿和偏好。固定与“有用”反馈只保存来源位置和版本，不保存摘录正文；旧 `command-pocket-library-v2` 正文快照会被删除而不会迁移。
- “复制原文定位”提供 `sourceId / relative/path.md:line`。普通 Web 页面不能可靠打开任意本地编辑器，因此 MVP 不伪造文件跳转。
- 命令只能复制，永不执行；递归删除、强制 Git 改写、磁盘覆盖、写库等危险内容复制前需要二次确认。
- 本地 Graph 正文不会发送到云端，也不写入服务日志；只有用户显式配置标准 Connector 后，查询或写入内容才会发送给该 Connector。

## API 摘要

```text
GET  /api/sources
POST /api/search  { query, sourceId?, limit?, intent? }
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
