# ZY-Connect v1 specification

## Capability matrix
- **Implemented** v0.5.9 RC: local folder polling (direct child files only, no recursive directory scan); first-scan existing files ignored; video stabilization and container-header check; UTF-8 same-stem `.zhiyan.json` sidecar; manual metadata correction in UI; local copy and idempotent delivery; existing `zhiyan.delivery` v1 connector.
- **Not implemented**: remote/cloud webhook, managed HTTPS upload, true zero-confirmation public publishing across social sites, certification or registration of this as an industry standard.

## Folder watch
Supported candidates: `.mp4`, `.m4v`, `.mov`, `.webm`. Wait for `正在监视` before producing new files. The app waits for repeated stable observations, validates basic media container signatures and copies the source to its own local asset area without modifying the original. This is *not* a full decoding/format compatibility guarantee.

Same-stem metadata e.g. `撞.mp4` plus `撞.zhiyan.json`. JSON object max 64 KiB. Allowed keys: `contentId`, `title`, `description`, `hashtags`, `coverPath`, `portraitCoverPath`, `landscapeCoverPath`, `collectionName`, `publishAt`, `metadata`. Never include `platform`, `accountKey`, `submitMode`, cookies, browser profiles or credentials. Cover assets must remain within the explicitly allowed folder. A non-empty title is required to receive automatically; without it, the user fills metadata manually in Zhiyan. If `contentId` is omitted, a deterministic content hash is used. The final task is `manual_confirm` even if an account switch later becomes enabled. Duplicate deliveries do not generate duplicate tasks.

## Native Connector: zhiyan.delivery v1
Required: `contentId` (non-empty string, <=256 chars); `videoPath` (non-empty local file path readable by the gateway). Optional: `title`, `description`, `hashtags` (array), the cover paths, `collectionName`, ISO-8601 `publishAt`, and object `metadata`. Extra top-level fields are rejected. Existing runtime `src/connector/zhiyan-connector.js` exposes the canonical connector functions. Maintain stable `contentId` across retries and only deliver once media and metadata are completely written.

Local endpoints:
- `GET /v1/delivery-contract`
- `POST /v1/producer-connections/{id}/pairing-bootstrap`
- `POST /v1/producer-pairings/exchange`
- `POST /v1/producer-connections/{id}/deliveries`
- `GET /v1/producer-connections/{id}/deliveries/{deliveryId}`
The gateway controls routes, account switches and platform authorization. Never send account secrets through this contract.

Admin-only folder endpoints: `POST /v1/producer-connections` (metadata.intakeMode = folder_watch), `GET /v1/folder-watch`, `POST /v1/folder-watch/select-folder`, `POST /v1/folder-watch/items/{id}/receive`. Do not mistake Admin controls for an unauthenticated third-party API.

## Security, compatibility and limits
- Local loopback `127.0.0.1` is only meaningful on the gateway host. No public tunnel or unauthenticated internet access is part of this standard.
- File reads are constrained to configured directories and no arbitrary symlink/path escape is supported.
- Old connector clients remain supported. A watched folder does not need pairing; a Connector producer does.
- Incoming items are not approvals to publish. Respect each social platform's actual authorized capabilities, the platform suspension policy and account-level switches.
- Code examples are implementation aids, not a promise that every production tool or social network is compatible.
