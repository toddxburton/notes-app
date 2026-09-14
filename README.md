# Notes

Notes is a private React writing workspace for `notes.toddxburton.com`. It synchronizes through Supabase and exposes ten WebMCP tools so Codex can read documents, edit them, and work with comment threads from the open site.

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

## Cloudflare

The Worker serves Vite's static output as a single-page app and claims `notes.toddxburton.com` as a custom domain.

```sh
npm test
npm run build
npm run deploy:dry
npm run deploy
```

Cloudflare must manage the `toddxburton.com` zone in the deploying account. The custom-domain route creates the required DNS record when deployed.

## Codex collaboration

Open the deployed app in Codex's in-app browser and sign in. The page registers these WebMCP tools:

- `list_documents`, `get_document`, `open_document`
- `create_document`, `update_document`
- `list_comments`, `add_comment`, `reply_to_comment`
- `resolve_comment`, `reopen_comment`

The browser grants tools access only while the signed-in page is open, so database credentials never need to be shared with Codex.
