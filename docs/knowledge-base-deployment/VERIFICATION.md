# 项目完整性与可运行性审查结果

## 结论

**代码与离线端到端链路通过，可以进入受控验收；当前环境仍不满足生产启动条件。**

生产验证前必须由部署者完成真实数据挂载、凭据轮换、版本固化和服务器运行环境准备。没有完成这些事项时，不应把“自动化测试通过”表述为“生产上线通过”。

## 已修复

1. 增加 Connector 的 systemd 常驻服务，随知识库 stack 启停；
2. Connector 支持 `AP_CONNECTOR_TOKEN_FILE` 和 `QUERY_API_TOKEN_FILE`，生产无需明文 Token 环境值；
3. `serverctl doctor` 增加 Node.js 22、Connector 环境文件和 Connector Token 文件检查；
4. 增加 Connector 独立健康检查命令；
5. 修复生成物密钥扫描器把正常子目录误判为失败的问题，并补充回归测试；
6. 清除本地 `.env` 中的明文提供商密钥；
7. 将 B 的 UTF-16 占位 README 改为简洁 UTF-8 边界说明；
8. 删除一次性维护报告、重复测试手册、错放的 PR 说明和可再生缓存；
9. 将三项目关系文档和统一部署 README 压缩为当前有效内容。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Action Pocket 自动化测试 | 117/117 通过 |
| Action Pocket 类型检查与 Web 构建 | 通过 |
| Action Pocket 服务端构建 | 通过 |
| Action Pocket 本机服务启动烟测 | HTTP 200 |
| 知识流水线全量测试 | 375/375 通过 |
| Connector 跨项目真实 E2E | 17/17 通过，无跳过 |
| Connector Token 文件测试 | 通过 |
| 部署 Shell 与 Node 语法 | 通过 |
| 三仓库 `git diff --check` | 通过 |
| npm 生产依赖审计 | 0 个漏洞 |
| B 真实生成物密钥扫描 | 通过 |
| A 文档本地链接检查 | 0 个断链 |

## 当前生产阻断项

### P0：必须处理

1. **缺少真实输入图谱挂载**
   - 当前环境没有可用的 `LOGSEQ_REPO_PATH`；
   - 本地 `.env` 中的历史 Windows 路径不适用于当前 Linux 环境；
   - 当前执行 `validate` 会因输入根目录不存在而失败。

2. **版本尚未固化**
   - A、C 含有尚未提交的功能改动；
   - B 的 `pages/`、`journals/`、`logseq/` 尚未纳入当前 Git 基线；
   - 服务器 `doctor` 和同步周期要求仓库干净，因此当前状态不能直接执行生产自动化。

3. **生产运行环境未安装**
   - 当前环境没有 Docker / Docker Compose；
   - 8787 查询服务和 8788 Connector 未常驻运行；
   - 无法在此环境验证 Compose 解析、容器挂载和 systemd 实际启动。

4. **真实凭据必须重新提供**
   - 本地明文密钥已清除；
   - 曾出现在共享终端、聊天或日志中的密钥必须在提供商侧轮换；
   - 新密钥必须通过 `server-data/secrets/*` 或批准的密钥管理系统提供。

5. **真实语义依赖未验收**
   - 尚未在生产 Embedding 和 Qdrant 上通过 `/health/ready?require=semantic`；
   - 当前只能证明代码路径正确，不能证明生产向量质量、网络和配额可用。

### P1：目标环境确认

- B 的历史生成物包含 Windows `file:///F:/...` 来源链接；Windows 部署可继续使用，Linux 部署应在真实 Linux 源图谱上重新生成，不能手工批量改写证据链接；
- Windows 桌面的托盘、快捷键、文件管理器定位和 WebView 焦点仍需真机验收；
- 当前挂载文件系统不保留 POSIX 权限位；生产密钥必须放在支持 `0600` 的 Linux 文件系统中。

## Go / No-Go

| 范围 | 决策 |
| --- | --- |
| 代码合并前审查 | Go，测试通过，但需审阅并提交现有差异 |
| 临时图谱离线验收 | Go |
| 关键词阶段真实数据验收 | 完成真实图谱挂载后 Go |
| 语义/混合检索验收 | Embedding、Qdrant 和新凭据配置后 Go |
| 当前环境直接生产上线 | **No-Go** |

## 下一步

严格按 `README.md` 执行：

1. 在功能分支审阅并提交 A、C 改动；
2. 为 B 建立干净且可恢复的基线；
3. 挂载真实输入、输出和 Runtime；
4. 安装 Docker、Compose、systemd 与 Node.js 22+；
5. 安装轮换后的密钥文件；
6. 执行 `serverctl.sh doctor`；
7. 按关键词 → Embedding → semantic readiness → hybrid → Action Pocket 的顺序验收。
