# 纸燕（Zhiyan）公开发布与接入标准

本仓库是纸燕的公开分发/开发者接入资料，不包含私有程序源码、账号资料或配对密钥。

## ZY-Connect v1：API 直接连接内容生产工具

**推荐：本机 HTTP API + Node/Python SDK，MCP 辅助 Codex 和其他编码 AI 进行发现、预检和安全配对。文件夹监视仅作为无法修改软件时的备用。**

- [API-first 快速开始、代码与 MCP](./zy-connect/README.md)
- [直接交给 Codex/Claude Code 的接入任务](./zy-connect/AI-INTEGRATION.md)
- [详细协议 zhiyan.delivery v1](./zy-connect/SPEC.md)
- [Node.js SDK](./zy-connect/node/zy-connect.mjs)
- [Python SDK](./zy-connect/python/zy_connect.py)
- [MCP stdio Server](./zy-connect/mcp/server.mjs)
- [AI 机器可读索引](./llms.txt)

**注意：** 接入纸燕不等于公开发布。新生产者 API 投递默认只能生成人工确认的发布任务；任何平台投稿都需符合平台授权和用户账号开关。当前 SDK/API 主要用于生产工具和纸燕运行在同一台 Windows 电脑的场景；跨主机远程上传尚未提供。未经授权不能把 localhost API 端口暴露到公网。
