# ZY-Connect v1 — connect content producers to Zhiyan
Public integration reference for Zhiyan v0.5.9 RC. This repository publishes **documentation only**, not the proprietary app, credentials or user data.

**No-code route:** In Zhiyan > 自动发布 > 连接生产工具, select 本地文件夹, choose the producing app's output directory and the receiving account. Wait until the watch is ready, then generate a **new** video. Earlier files are ignored. Put a same-stem UTF-8 `.zhiyan.json` alongside the video to send exact title, description, hashtags and covers. Without it, edit metadata in Zhiyan before receiving.

Example: `video.mp4` and `video.zhiyan.json`:
```json
{"title":"Example video","description":"Actual contents","hashtags":["example"],"contentId":"work-001"}
```

**Developer route:** Use the existing `zhiyan.delivery` v1 Connector for a completed local video and accurate delivery receipts. Contract discovery: `GET http://127.0.0.1:17351/v1/delivery-contract` on the SAME computer (not a public internet endpoint). See [SPEC](./SPEC.md), [AI instructions](./AI-INTEGRATION.md) and [example](./examples/video.zhiyan.json).

The delivery interface does not grant social publishing rights; account enablement and the final public posting remain separate. Cloud HTTPS/Webhook integration is *not implemented*. Do not expose the local port to the internet.
