import type { WorkspaceData } from "../types";

const CACHE_VERSION = 1;
const cacheKey = (ownerId: string) => `noted-workspace-cache-v${CACHE_VERSION}-${ownerId}`;

interface CachedWorkspace {
  version: number;
  ownerId: string;
  activeId: string | null;
  data: WorkspaceData;
}

export function readWorkspaceCache(ownerId: string): CachedWorkspace | null {
  try {
    const raw = localStorage.getItem(cacheKey(ownerId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedWorkspace;
    if (cached.version !== CACHE_VERSION || cached.ownerId !== ownerId ||
        !Array.isArray(cached.data?.documents) || !Array.isArray(cached.data?.projects) ||
        !Array.isArray(cached.data?.comments) || !Array.isArray(cached.data?.replies) ||
        !Array.isArray(cached.data?.notifications) || typeof cached.data?.displayName !== "string") return null;
    if ([cached.data.documents, cached.data.projects, cached.data.comments,
      cached.data.replies, cached.data.notifications].some((items) =>
      items.some((item) => item.owner_id !== ownerId))) return null;
    return cached;
  } catch {
    return null;
  }
}

export function writeWorkspaceCache(ownerId: string, data: WorkspaceData, activeId: string | null): void {
  try {
    localStorage.setItem(cacheKey(ownerId), JSON.stringify({
      version: CACHE_VERSION, ownerId, activeId, data,
    } satisfies CachedWorkspace));
  } catch {
    // Storage can be disabled or full. The server remains the source of truth.
  }
}

export function clearWorkspaceCache(ownerId: string): void {
  try {
    localStorage.removeItem(cacheKey(ownerId));
  } catch {
    // Storage can be disabled.
  }
}
