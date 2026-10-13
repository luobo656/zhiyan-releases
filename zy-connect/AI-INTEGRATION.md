# Instructions for Codex / Claude Code / other coding AIs

You are integrating an *existing content-production application* with **Zhiyan ZY-Connect v1**. Read [SPEC.md](./SPEC.md) and [README.md](./README.md) first. Discover the application's actual video export completion event, output directory, and metadata/cover sources. **Do not assume Zhiyan is a globally-known industry protocol**: use these exact public references as the specification.

Select the least-invasive approach:
1. **No-code**: If videos already land in a user-selected output folder, recommend that the user connect it from Zhiyan's GUI. Do not modify source code unless structured metadata is required.
2. **Sidecar metadata**: After a successful and fully closed video export, atomically write a same-stem `.zhiyan.json` in the same folder, providing real title/description/hashtags/cover paths. Do not guess descriptions or misstate content. Keep a stable `contentId` for retries. Do not alter the user's output media or move files.
3. **Native Connector**: Only if app needs precise delivery acknowledgements or advanced workflow, use the existing `zhiyan.delivery` v1 implementation or contract discovery; use local pairing and existing retry/outbox. Never build separate social-login or posting automation.

**Important guardrails:** Preserve existing behavior and data; do not collect tokens, cookies or social passwords in output; do not modify or enable any publishing switch; do not open browsers or submit real posts to test; do not circumvent suspended platform automation. Cloud producers cannot access another PC's loopback endpoint or disk. Do not expose `127.0.0.1:17351` to the internet. Ask for permission before changes that post publicly or broaden access.

Validation: use temp directories, a dummy video, representative metadata, slow/incomplete exports, duplicate `contentId`, restart conditions and invalid paths. Report what was tested and what remains unverified. Completion means **received in Zhiyan**, not **published on Douyin**.

Deliver the smallest clear change and a simple instruction to the user: generate one NEW video after Zhiyan displays its folder as monitored and check the intake list.
