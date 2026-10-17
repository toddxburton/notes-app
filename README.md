# Noted

Noted is a private React writing workspace for `noted.toddxburton.com`. It synchronizes through Supabase and exposes browser WebMCP tools plus an authenticated remote MCP endpoint so Codex can read documents, edit them, and work with comment threads and @mention notifications. The previous `notes.toddxburton.com` hostname remains available as a compatibility alias.

## Based

Click the Noted logo to switch to Based, the companion database workspace. Click the Based logo to return to notes. Based databases live in their own sidebar with folders; each database has table tabs and a full-width editable grid. The two tools share sign-in and visual styling but store their data separately. Existing inline database blocks in Noted remain available.

Based supports text, number, date, select, multiselect, URL, checkbox, and two-way linked-record columns. The reciprocal linked column starts visible and can be hidden independently. Tables support search, filter, sort, group, column sizing, text wrap, and loading more rows as the grid scrolls. Records, columns, tables, folders, and databases can be archived and restored without deleting their data.

Based has a separate JSON export/import flow and daily cloud snapshots. Import replaces only Based data. The `based_workspace` migration must be applied before using Based with Supabase; local preview mode stores Based data under a separate browser storage key. Browser and remote MCP endpoints expose Based discovery, schema creation, record queries and edits, and links.

## Local development

```sh
cp .env.example .env.local
npm install
npm run dev
```

Without Supabase environment variables, the app runs in local preview mode and stores data in the browser. A deployed build should always provide both variables.

To test locally without signing in, run `npm run dev:local`. This command overrides the local Supabase settings for that dev server only. Preview notes stay in that browser's local storage and do not sync to Supabase.

## Supabase

Create or link a Supabase project, then apply the checked-in migration:

```sh
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Set the project URL and publishable key in `.env.production`, then use `https://noted.toddxburton.com` as the Supabase Auth site URL. Add both `https://noted.toddxburton.com/**` and `https://notes.toddxburton.com/**` to the redirect allow list during the hostname transition. The migration enables row-level security for every exposed table. Each signed-in user can access only rows owned by their Supabase user ID.

This is an existing-account-only workspace. Provision the owner account before disabling signups. Keep new user signups disabled in the hosted Supabase Auth settings as well as in `supabase/config.toml`; the browser's magic-link request also sets `shouldCreateUser: false`. Hosted Auth settings are separate from the app build and database migrations.

Editing uses a local-first save path. Each title or body change is cached in browser storage immediately. Supabase receives the combined update after five seconds without typing, or when the editor loses focus. A newer browser draft is preserved across reloads and takes precedence over an older realtime snapshot until cloud sync succeeds.

## Backups and recovery

Every document insert and edit creates an immutable row in `document_versions`, including soft deletion. When a signed-in workspace is used, the app also stores a full `workspace_backups` snapshot at least once every 24 hours. Settings → Export downloads the same complete JSON format; Settings → Import restores notes, comments, replies, and the display name.

For infrastructure-level recovery, enable Supabase database backups or point-in-time recovery for the project plan. The in-app snapshots provide convenient content recovery; the Supabase platform backup protects the database itself.

## Cloudflare and remote MCP

The Worker serves Vite's static output as a single-page app, claims `noted.toddxburton.com` as its primary custom domain plus `notes.toddxburton.com` as a compatibility alias, and serves a stateless Streamable HTTP MCP endpoint at `/mcp`. The endpoint uses a dedicated bearer token and a server-only Supabase secret key. Every backend query is additionally restricted to `NOTES_OWNER_ID`.

The remote MCP endpoint offers `create_comment` for new threads anchored to an exact quote in a note, alongside `reply_to_comment` for existing threads. Repeated quotes require an occurrence number or surrounding text to identify the intended passage.

Set the Worker secrets before the first deployment:

```sh
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put NOTES_MCP_TOKEN
npx wrangler secret put CLAUDE_MCP_TOKEN
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

- `list_projects`, `create_project`
- `list_documents`, `get_document`, `open_document`
- `create_document`, `update_document`
- `list_comments`, `add_comment`, `reply_to_comment`
- `resolve_comment`, `reopen_comment`
- `list_notifications`, `acknowledge_notification`, `complete_notification`

The browser grants WebMCP access only while the signed-in page is open. Scheduled tasks and Codex tasks in other projects should instead connect to `https://noted.toddxburton.com/mcp` as a Streamable HTTP MCP server. Register that MCP server in the user-level `~/.codex/config.toml` when it should be available across every local Codex project; a repository `.codex/config.toml` applies only within that trusted project.

Local Codex uses `scripts/noted-mcp-headers.sh` as an HTTP-header helper. The helper reads `NOTES_MCP_TOKEN` from the ignored `.dev.vars` file only when Codex connects to Noted, so the desktop app does not need the token in its launch environment and the token is not stored in `config.toml`. Keep `.dev.vars` readable only by the local user.

Claude uses a separate `CLAUDE_MCP_TOKEN` bearer token at the same endpoint. It can be rotated or revoked independently of the Codex token. Both tokens currently grant access to the same MCP tools and owner data.

Every exact `@handle` in a new comment or reply creates one durable notification. The in-app Mentions menu shows unread and historical `@todd` notifications in realtime. GPT uses the same records through MCP: it acknowledges a notification after adding it to a plan, and completes it only after the work and the `@todd Done — …` reply are finished.
