# ZY-Connect | 纸燕 API-first 开放接入

技术协议 zhiyan.delivery v1，纸燕最低版本 v0.5.11 RC。**推荐 HTTP API + SDK，MCP 帮助开发 AI 配置，文件夹监视仅作为兜底。**

本项目是公开的独立接入组件，不包含纸燕私有源码，不需要把平台账号信息交给第三方 AI。

## 普通用户首次连接

1. 在纸燕「自动发布」页面，点击「连接生产工具」，选择「API 直连」，设置视频生产工具输出目录和接收作品的账号。
2. 选择连接，点击「复制 AI 接入指令」，把指令粘贴给 Codex 或 Claude Code。开发 AI 从本仓库读取 SDK，修改生产软件的视频导出完成事件。
3. 纸燕已将一次性本机配对凭证写入输出目录的 .zhiyan/pairing.json。SDK 首次调用自动读取并配对，之后自动发送、重试并读取 ACK。凭证短期有效；过期时在纸燕点击「重新连接生产工具」。

原来已使用文件夹监控的连接可以继续运行。**先让 AI 在隔离环境准备好 SDK，再点击「将选中连接切换为 API」**，避免在正式改造过程中意外断开原有接收能力。

## Node.js（Node >=20，无第三方依赖）

把 node/zy-connect.mjs 复制到视频生产工具源码中：

    import { ZyConnect } from './zy-connect.mjs';
    const zhiyan = new ZyConnect({ outputDir: 'E:/文档/每日识字/成片' });
    zhiyan.startRetry();
    // 请把调用挂到真正的“视频生成完成且文件已关闭”的事件
    const receipt = await zhiyan.deliver({
      contentId: 'your-stable-unique-work-id',
      videoPath: 'E:/文档/每日识字/成片/撞.mp4',
      title: '每日识字｜撞',
      description: '今天一起认识汉字「撞」。',
      hashtags: ['每日识字', '汉字启蒙'],
    });
    // acknowledged + deliveryId：纸燕已接收；pending：待自动重试；blocked：需要人工处理
    console.log(receipt.state, receipt.deliveryId);

## Python（Python >=3.9，标准库）

把 python/zy_connect.py 复制到生产工具项目：

    from zy_connect import ZyConnect
    zhiyan = ZyConnect("E:/文档/每日识字/成片")
    zhiyan.start_retry()
    receipt = zhiyan.deliver({
        "contentId": "your-stable-unique-work-id",
        "videoPath": "E:/文档/每日识字/成片/撞.mp4",
        "title": "每日识字｜撞",
        "hashtags": ["每日识字", "汉字启蒙"]
    })
    print(receipt["state"], receipt["deliveryId"])

SDK 会在用户自己的本机 AppData 中保存配对凭据和持久化投递记录，不把令牌存入成片目录。对失败或断网作品，会将媒体副本暂存于授权目录下的 .zy-connect-outbox 子目录，后台重试成功后清理。生产工具应在启动时开启 startRetry()/start_retry()，不要把“被接收”误认为“已公开发布”。

## MCP：协助 Codex 和其他 AI 完成接入

mcp/server.mjs 是可独立运行的本机 MCP stdio server，需要 Node。提供：
- zy_guide — 官方公开接入说明
- zy_contract — 查看真实本机 Delivery Contract
- zy_status — 安全查看配对与待发送数量
- zy_preview — 不发送作品的预检
- zy_pair — 用户明确确认 confirm=true 时消费一次性本机配对

MCP 不接收视频流、不控制登录浏览器、不具备平台投稿接口。内容交付仍由 SDK 使用 HTTP API。

Codex config.toml 示例（AI 应替换为实际克隆目录，不能直接照抄占位路径）：

    [mcp_servers.zy_connect]
    command = "node"
    args = ["C:/YOUR/DOWNLOADED/zy-connect/mcp/server.mjs"]
    [mcp_servers.zy_connect.env]
    ZY_CONNECT_OUTPUT_DIR = "E:/文档/每日识字/成片"
    ZY_CONNECT_GATEWAY_URL = "http://127.0.0.1:17351"

其他支持 MCP 的应用请使用它对应的 stdio server 配置界面；是否能自动注册取决于该应用的权限和配置支持。

## 技术文档

- [给编码 AI 的任务](./AI-INTEGRATION.md)
- [接口规范与限制](./SPEC.md)
- [Node SDK](./node/zy-connect.mjs)
- [Python SDK](./python/zy_connect.py)
- [MCP Server](./mcp/server.mjs)

**安全边界：** 所有新 API 交付只创建 manual_confirm 待人工确认任务，即使抖音/视频号账号发布开关已开启，也不会直接点击发布按钮。没有完成真实无人值守自动投稿验收。远程网站/跨电脑的 HTTPS 上传目前没有实现；不能把纸燕 127.0.0.1 端口暴露到互联网，也不能让远端生产工具引用另一台电脑的本机视频路径。