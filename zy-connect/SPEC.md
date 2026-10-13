# ZY-Connect API-first 规格 | zhiyan.delivery v1

## 版本与部署范围

最低适用版本：纸燕 v0.5.11 RC（API fail-closed）；协议仍为 zhiyan.delivery v1。不声称这是业界统一协议。生产工具与纸燕必须运行在同一台电脑，纸燕通过 127.0.0.1:17351 服务本机 API。跨主机 HTTP 上传、HTTPS 中继、远端 OAuth 尚未实现。

## 配对和最小授权

管理员在纸燕控制台创建 API Connector：指定允许读取的 allowedRoots 视频输出目录及固定目标账号。纸燕调用 POST /v1/producer-connections/{id}/pairing-bootstrap，写入 .zhiyan/pairing.json（默认十分钟有效，单次使用）。

Node/Python SDK 从这个文件读取一次性凭据并调用 POST /v1/producer-pairings/exchange，换取与独立 Connection 绑定的 zy_pc_ 开头 token。后续交付必须携带 Authorization: Bearer token。令牌不得写到成片文件夹、Git 仓库、聊天日志或 MCP 返回结果中。所有普通 AI 只能读取被用户授权的生产工具源码与输出目录。

## 投递接口

POST /v1/producer-connections/{connectionId}/deliveries
Content-Type: application/json
Authorization: Bearer <producer credential>

最小 JSON：
    {
      "contentId": "stable-id-123",
      "videoPath": "E:/my-output/video.mp4",
      "title": "视频真实标题",
      "description": "作品真实描述",
      "hashtags": ["主题"]
    }

Contract v1 必填 contentId 与 videoPath，SDK 额外要求真实标题，避免无声生成空文案作品。可选字段：description、hashtags、coverPath、portraitCoverPath、landscapeCoverPath、collectionName、publishAt、metadata。不允许 producer 擅自传平台 platform、accountKey、submitMode、Cookie 等。

成功：HTTP 202，响应 accepted:true 与 delivery.id。生产端记录 ACK 为 acknowledged；网络中断/429/5xx 等保留 pending 并自动重试；永久性 4xx 标记 blocked 等待人工处理。相同 Connection + contentId 幂等，不产生重复 Delivery。Node/Python SDK 的待发素材暂存于授权视频目录内的 .zy-connect-outbox 子目录，长期密钥/队列数据保存在 Windows 当前用户独立本地目录 %LOCALAPPDATA%/Zhiyan/ZyConnect，不应纳入生产视频公开导出内容。

交付记录查询：GET /v1/producer-connections/{connectionId}/deliveries/{deliveryId}，需绑定的 Producer token。接口 Schema 发现：GET /v1/delivery-contract。

## 安全与权限

API Connector 只授予**接收作品**的能力。任何 API 送入的作品只生成 manual_confirm 待人工确认任务，无论抖音、视频号的发布开关是否开启。后续真实平台发布必须由操作员明确审核确认；不能靠 API bypass。保持小红书暂停策略及其他平台官方授权约束。

## MCP

本仓库 mcp/server.mjs 使用标准 stdio JSON-RPC，提供五个工具：
zy_guide（指令）、zy_contract（Schema）、zy_status（隐藏密钥）、zy_preview（不提交的路径/字段预检）、zy_pair（明确确认才进行一次性本机配对）。

MCP 无投递真实视频/浏览器投稿/打开账号开关/修改历史任务的功能。MCP 可帮助编码 AI 正确选择 SDK，但不能取代 SDK 的持久重试能力。

## 备用

只在软件无源码或无法集成 API 时，使用原 Folder Watch 智能文件夹监视。它不能代表可靠 ACK 交付。已选择 API 的同一 Connection 不再启动 Folder Watch，避免两个接收通道并存。