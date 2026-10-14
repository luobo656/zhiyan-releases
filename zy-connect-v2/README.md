# ZY-Connect v2 (纸燕 0.6.0) — 双路线、本机零拷贝

> ZY-Connect v2 技术预览版，适用于纸燕 0.6.0。**公开接入文档不代表正式机已升级**；旧 v1 版本的测试接口不能直接使用 v2 SDK。

## 产品原则

- **智能一键连接（默认）**：纸燕读取已支持生产工具的**已知本机设置文件**，发现视频输出位置，用户在纸燕点击「连接」即可。生产工具不需要改源码、开放网络端口、提供 API Key 或安装 SDK。无法识别的软件，可人工指定一次已有输出目录；不是所有第三方软件都能无条件自动发现。
- **专业 API（开发者）**：生产软件调用 ZY-Connect v2 SDK，提交本机授权申请；用户在纸燕界面确认一次后获得**仅交付内容**的专用凭据。生产者自行确定输出目录，界面不要求用户再选择它。
- **同一电脑零拷贝**：两种模式都不复制、上传或移动原视频。纸燕在 SQLite 中记录视频实际绝对路径、文件指纹和交付/发布记录。原视频所有权仍归生产工具；用户主动删除或移动后，原路径可能不可用，纸燕不会默默复制一份备份。
- **接收与发布分离**：接收不会自动开启任何平台账号开关，不会触发真实平台投稿。可以先接收无目标账号的作品，后续由纸燕选择平台并确认发布。
- **连接完整生命周期**：暂停（保留授权）／恢复／断开（撤销全部凭据与待配对码）／彻底移除（保留不可执行的历史引用，保留原视频、发布任务及记录）。源目录内生产者自己创建的文件归其所有。

## 智能一键连接

用户从「连接生产工具」进入「发现的本机生产工具」，看到已识别软件后点「连接」。支持的自动检测适配器列表位于 `src/services/v2-discovery-service.js`。

首个内置适配器：

- `每日识字视频工作台`：读取 `%APPDATA%\每日识字视频工作台\settings\settings.json` 中的 `outputDir`，仅获取输出目录位置，不返回配置中的其他值。
- 不扫描整块硬盘，不启动或修改第三方软件，不绕过操作系统权限。
- 启用智能连接时，第一次扫描建立基线：原目录里的旧作品不会突然加入发布队列。
- 新的 MP4/M4V/MOV/WebM 完成写入、稳定且有效后，优先读取同名 `视频名.zhiyan.json` 中的标题、描述、话题等。无文案时进入「待补全文案」，由用户在纸燕补充，不伪造标题。
- 文件变化与定期扫描目前使用后台轮询（默认约 5 秒），并校验大小/修改时间及 MP4 结构；不是任意第三方应用内事件的实时保证。

## 专业 API 连接

适用于能够让 AI/Codex 修改源码或安装本机集成 SDK 的内容生产工具。

### 给 Node.js 生产工具集成（Node >= 20）

```js
import { ZyConnectV2 } from './zy-connect-v2.mjs';

const sdk = new ZyConnectV2({
  name: '我的视频生产工具',
  outputDir: myAppVideoOutputDir, // 从生产软件自己的已有设置读取，不要求普通用户在纸燕重复填写
});

// 第一次由生产工具触发：
const connection = await sdk.requestConnection();
// 用户在纸燕「专业 API 连接请求」点击「允许连接」。
const result = await sdk.waitForApproval();
if (result.status !== 'connected') throw new Error('尚未取得用户授权');

sdk.startRetry(); // 启动基于 JSON 元数据的持久重试队列

// 只在成片彻底写完、真实文案可用后执行：
const receipt = await sdk.deliver({
  contentId: stableExportId, // 同一作品重试必须不变
  videoPath: renderedVideoAbsolutePath,
  title: realTitle,
  description: realDescription,
  hashtags: ['示例话题'],
});
console.log(receipt.state, receipt.deliveryId);
```

官方 Node SDK：[下载 zy-connect-v2.mjs](./sdk/zy-connect-v2.mjs)。零视频字节入队，仅保存 JSON 的路径、文案和回执。状态可通过 `sdk.status()` 读取；软件退出时调用 `sdk.stopRetry()`。

生产工具应在正常启动时处理未送达作品的 `sdk.flush()` 和在有新授权时重新检查 `sdk.checkApproval()`。一旦授权撤销，SDK 会在下次交付时发现 HTTP 401，作废旧本机令牌，不静默继续。

### HTTP（本机回环）

| 用途 | 请求 | 鉴权 |
| --- | --- | --- |
| 发现纸燕 v2 能力 | `GET /v2/delivery-contract` | 本机管理员访问规则 |
| 提出连接申请 | `POST /v2/connect-requests` | 仅本机，JSON，头 `x-zy-connect-intent: v2` |
| 查询/领取审批 | `GET /v2/connect-requests/{requestId}/claim` | 申请时的临时申请密钥 |
| 交付本机文件 | `POST /v2/connections/{connectionId}/deliveries` | 纸燕批准后返回的生产者 Bearer |
| 查询交付回执 | `GET /v2/connections/{connectionId}/deliveries/{deliveryId}` | 同一连接的生产者 Bearer |

管理界面使用管理员权限调用 `GET /v2/discovery`、`POST /v2/connections/smart`、`GET /v2/pending-connections`、`POST /v2/pending-connections/{id}/approve|reject`、`POST /v2/connections/{id}/pause|resume|disconnect`、`DELETE /v2/connections/{id}`。

无论 SDK 还是 HTTP，专业模式都**不允许**由生产工具提交发布账号、账号开关、`submitMode` 或自动投稿指令。当前仅支持**同一台计算机**：服务必须绑定回环接口，并拥有访问该来源文件的授权；跨电脑/云端上传不是此版本功能。MCP 可帮助开发 AI 配置适配器，但不是视频传输的必需依赖。

## 重要边界、维护与验收

- **引用不是备份**：原文件移动、损坏、删除、被覆盖后会影响纸燕后续使用。纸燕默认不备份，也不擅自删除或清理外部源文件。
- **仅匹配已实现的适配器**：生产者发现是“已知配置识别”，不是万能检测/自动补接口；看不到的软件需要手动选目录或在生产工具中集成 SDK。
- **元数据上限**：智能连接只能读取当前工具导出时存在的公开信息，缺少标题时进入待处理；专业连接可在生产工具生成完成事件提供完整元数据。
- **新旧断代**：不要继续采用旧 v1 的 pairing.json 和 `/v1/producer-...` 交付测试协议。原有已发布记录和账号设置仍保留在同一数据库，不作自动投稿。
- **测试**：`npm test` 仅执行 `test/*.test.js`（避免 runtime 历史脚本误加入）；`npm run check`；`node scripts/qa/zy-connect-v2-ui-smoke.mjs` 在临时独立目录和动态端口跑 Edge，不用正式登录账号、视频或生产数据库。

正式机升级前须完成可恢复备份、临时运行环境/端口隔离验收，确认新版本再有明确用户指示切换。