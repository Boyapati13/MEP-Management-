# Combined MEP + Octo application

This repository is the master codebase. The existing MEP dashboard and database remain at the root. `octo-agent/` contains the tracked source snapshot of Boyapati13/octo at commit `d25f49f345376fb46e114d3411718d109541a4a6` (4 June 2026), including its existing components and bundled resources. Original files and notices are retained. The standalone Octo repository is not modified by this integration.

## What is connected

The new passive WhatsApp collector sends explicitly selected group text messages to the MEP inbox. Administrators map group IDs to projects. Administrators and project managers with project access review messages and create either a task or a daily site log. The original text, sender, source ID, timestamps and review decision remain in the inbox. Categories use simple keywords, not AI extraction. Existing tasks, progress percentages and commercial records are never automatically overwritten.

The dashboard includes the inbox in both the served HTML interface and the React source interface. The root production build currently serves the HTML interface.

The rest of Octo's source is included but its desktop UI, general-purpose agent, voice, research and trading features are not automatically started by the combined deployment. There is no general-purpose agent access to the MEP database. Further assistant features need explicit API integration and testing.

## Start the combined deployment

Requirements: Docker with Compose. For a local collector without Docker, Node 22.13+ and npm.

1. Copy `.env.example` to `.env`. Set `OCTO_INGEST_TOKEN` to a new random secret of at least 32 characters (`openssl rand -hex 32`). Do not commit the secret.
2. Start the dashboard: `docker compose up -d --build mep-platform`.
3. Pair the collector using your phone's WhatsApp Business → Linked devices:

   ```sh
   docker compose --profile whatsapp run --rm octo-whatsapp node bridge.js --session /session --pair-only
   ```

4. List group IDs:

   ```sh
   docker compose --profile whatsapp run --rm octo-whatsapp node bridge.js --session /session --list-groups
   ```

5. In the dashboard, select a project, open **WhatsApp Inbox**, and map the relevant group name and ID as an administrator. A group cannot be reassigned to a different project; its history remains with its original project.
6. Set `WHATSAPP_GROUP_IDS` in `.env` to the same comma-separated IDs. Only these groups are captured. Then start everything:

   ```sh
   docker compose --profile whatsapp up -d --build
   ```

7. Send a new text message in a selected group, refresh the inbox and review it. Approve a reviewed task title or site-log note, or dismiss the message.

Pairing must be completed by the account owner. No live pairing or group reading was performed during implementation. Linking a device grants access at the WhatsApp session level; the application filters selected groups but that is not a WhatsApp permission boundary. Use only groups authorised for project processing. Baileys is an unofficial WhatsApp protocol library, so service changes, disconnections and account restrictions are possible.

## Local collector

From `octo-agent/scripts/whatsapp-bridge`, run `npm ci --ignore-scripts`. Set `MEP_INGEST_URL` to `https://your-dashboard/api/integrations/octo/messages` (loopback HTTP is allowed for local testing), plus the same secret and explicit group IDs. Run `node bridge.js --pair-only`, `node bridge.js --list-groups`, then `npm start`. Session state defaults to `~/.octo/whatsapp/session`; keep it private and persistent. Docker uses `/session` in a dedicated volume. Never run two collectors with the same session concurrently.

The collector can also be started by Octo's existing Python WhatsApp channel when `MEP_INGEST_URL` is configured. In this mode the channel never dispatches chat content to the general agent and cannot reply to groups. The direct collector is the recommended deployment because it does not need the desktop/AI dependencies.

## Delivery and limitations

New text and image/document captions are supported. Media downloads, voice transcription, historical chat backfill, AI task extraction and daily summaries are not implemented. Messages require no trigger word. Locally queued messages survive restarts and are acknowledged only after MEP accepts them. Source IDs prevent duplicate records. Disconnected periods before a message reaches the collector are subject to WhatsApp's own delivery behaviour.

Pausing a mapping stops new acceptance; queued messages retry if re-enabled. Remove a group from the collector allowlist to stop local collection too. Queued and delivered payloads are retained in the local SQLite queue; the MEP inbox retains message history. Define a retention/backup policy before broad deployment. Deleted projects are excluded from inbox access. The shared secret authorises ingestion only; it cannot review messages or log into the dashboard.

## Verification

- `npm run test:octo`: authentication, group mapping, role restrictions, project isolation, duplicate delivery, review-once behaviour, task/log creation, pause handling, durable queue recovery and group allowlisting.
- `npm run lint` and `npm run build`.
- The existing MEP integration suites continue to run through the existing GitHub CI workflow; Octo checks are added to that workflow.

The full imported Octo suite is not certified by these tests. Live WhatsApp pairing, Docker execution and the wider Octo desktop/AI stack require deployment-environment validation.

### Baseline test result

The existing end-to-end suite produced **110 passing / 1 failing** checks on both this change and the unchanged MEP main-branch server. The existing failure is “Extraction is review-only: it does not silently overwrite the project”, following the previous automatic document-update feature. It is not changed by the Octo integration. The new Octo checks, typecheck and build pass.
