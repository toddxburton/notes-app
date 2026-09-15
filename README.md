# Notes

Notes is a private React writing workspace for `notes.toddxburton.com`. It synchronizes through Supabase and exposes browser WebMCP tools plus an authenticated remote MCP endpoint so Codex can read documents, edit them, and work with comment threads and @mention notifications.

## Local development

```sh
cp .env.example .env.local
npm install
npm run dev
```

Without Supabase environment variables, the app runs in local preview mode and stores data in the browser. A deployed build should always provide both variables.

## Supabase

Create or link a Supabase project, then apply the checked-in migration:

```sh
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Set the project URL and publishable key in `.env.production`, then add `https://notes.toddxburton.com` and `https://notes.toddxburton.com/**` to the Supabase Auth URL configuration. The migration enables row-level security for every exposed table. Each signed-in user can access only rows owned by their Supabase user ID.

Editing uses a local-first save path. Each title or body change is cached in browser storage immediately. Supabase receives the combined update after five seconds without typing, or when the editor loses focus. A newer browser draft is preserved across reloads and takes precedence over an older realtime snapshot until cloud sync succeeds.

## Backups and recovery

Every document insert and edit creates an immutable row in `document_versions`, including soft deletion. When a signed-in workspace is used, the app also stores a full `workspace_backups` snapshot at least once every 24 hours. Settings → Export downloads the same complete JSON format; Settings → Import restores notes, comments, replies, and the display name.

For infrastructure-level recovery, enable Supabase database backups or point-in-time recovery for the project plan. The in-app snapshots provide convenient content recovery; the Supabase platform backup protects the database itself.

## Cloudflare and remote MCP

The Worker serves Vite's static output as a single-page app, claims `notes.toddxburton.com` as a custom domain, and serves a stateless Streamable HTTP MCP endpoint at `/mcp`. The endpoint uses a dedicated bearer token and a server-only Supabase secret key. Every backend query is additionally restricted to `NOTES_OWNER_ID`.

Set the Worker secrets before the first deployment:

```sh
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put NOTES_MCP_TOKEN
npx wrangler secret put NOTES_OWNER_ID
```

For local Worker development, copy `.dev.vars.example` to `.dev.vars` and replace the placeholders. Never prefix the server secrets with `VITE_`.

```sh
npm test
npm run build
npm run deploy:dry
npm run deploy
```

Cloudflare must manage the `toddxburton.com` zone in the deploying account. The custom-domain route creates the required DNS record when deployed.

## Codex collaboration

The signed-in page registers these WebMCP tools:

- `list_documents`, `get_document`, `open_document`
- `create_document`, `update_document`
- `list_comments`, `add_comment`, `reply_to_comment`
- `resolve_comment`, `reopen_comment`
- `list_notifications`, `acknowledge_notification`, `complete_notification`

The browser grants WebMCP access only while the signed-in page is open. Scheduled tasks should instead connect to `https://notes.toddxburton.com/mcp` as a Streamable HTTP MCP server and read the bearer token from an environment variable.

Every exact `@handle` in a new comment or reply creates one durable notification. The in-app Mentions menu shows unread and historical `@todd` notifications in realtime. GPT uses the same records through MCP: it acknowledges a notification after adding it to a plan, and completes it only after the work and the `@todd Done — …` reply are finished.
