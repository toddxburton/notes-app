import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL(".vite/manifest.json", dist), "utf8"));
const files = new Set(["/", "/index.html", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png", "/icons/favicon.png"]);
for (const entry of Object.values(manifest)) {
  if (entry.file) files.add(`/${entry.file}`);
  for (const css of entry.css ?? []) files.add(`/${css}`);
  for (const asset of entry.assets ?? []) files.add(`/${asset}`);
}
const list = [...files].sort();
const source = await readFile(new URL("sw-template.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(source);
for (const path of list) {
  hash.update(path);
  hash.update(await readFile(new URL(path === "/" ? "index.html" : path.slice(1), dist)));
}
const version = hash.digest("hex").slice(0, 12);
await writeFile(join(fileURLToPath(dist), "sw.js"), source
  .replace("__CACHE_VERSION__", version)
  .replace("__PRECACHE_FILES__", JSON.stringify(list)));
