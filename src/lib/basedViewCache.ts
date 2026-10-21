import type { BasedCatalog, BasedLink, BasedRecord } from "./basedTypes";

export type CachedBasedTable = { records: BasedRecord[]; count: number };
export type CachedBasedView = {
  ownerId: string;
  version: 1;
  catalog: BasedCatalog | null;
  tables: Record<string, CachedBasedTable>;
  links: BasedLink[];
  savedAt: string;
};

const DB_NAME = "noted-offline-v1";
const STORE = "based-views";
let writes: Promise<unknown> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      for (const name of ["workspaces", STORE]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "ownerId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function valid(view: CachedBasedView | null, ownerId: string): view is CachedBasedView {
  if (!view || view.version !== 1 || view.ownerId !== ownerId || !view.tables || !Array.isArray(view.links)) return false;
  if (view.catalog !== null) {
    const catalogItems = [view.catalog.folders, view.catalog.databases, view.catalog.tables,
      view.catalog.fields, view.catalog.relations];
    if (!catalogItems.every((items) => Array.isArray(items) && items.every((item) => item.owner_id === ownerId))) return false;
  }
  return Object.values(view.tables).every((table) => Array.isArray(table.records) &&
    table.records.every((record) => record.owner_id === ownerId)) && view.links.every((link) => link.owner_id === ownerId);
}

export async function readBasedView(ownerId: string): Promise<CachedBasedView | null> {
  if (typeof indexedDB === "undefined") return null;
  await writes;
  const db = await openDatabase();
  try {
    const value = await new Promise<CachedBasedView | null>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(ownerId);
      request.onsuccess = () => resolve((request.result as CachedBasedView | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    return valid(value, ownerId) ? value : null;
  } finally { db.close(); }
}

function update(ownerId: string, change: (current: CachedBasedView) => CachedBasedView): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  const task = async () => {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const request = store.get(ownerId);
        request.onsuccess = () => {
          const value = request.result as CachedBasedView | undefined;
          const current = valid(value ?? null, ownerId) ? value! : {
            ownerId, version: 1 as const, catalog: null, tables: {}, links: [], savedAt: "",
          };
          store.put({ ...change(current), savedAt: new Date().toISOString() });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  };
  const next = writes.then(task, task);
  writes = next.catch(() => undefined);
  return next;
}

export function cacheBasedCatalog(ownerId: string, catalog: BasedCatalog): Promise<void> {
  return update(ownerId, (current) => ({ ...current, catalog }));
}

export function cacheBasedPage(ownerId: string, tableId: string, offset: number, page: CachedBasedTable): Promise<void> {
  return update(ownerId, (current) => {
    const previous = offset === 0 ? [] : current.tables[tableId]?.records ?? [];
    const records = [...previous];
    for (const record of page.records) {
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
    }
    return { ...current, tables: { ...current.tables, [tableId]: { records, count: page.count } } };
  });
}

export function cacheBasedRecord(ownerId: string, record: BasedRecord): Promise<void> {
  return update(ownerId, (current) => {
    const table = current.tables[record.table_id];
    if (!table) return current;
    return { ...current, tables: { ...current.tables, [record.table_id]: {
      ...table, records: table.records.map((item) => item.id === record.id ? record : item),
    } } };
  });
}

export function cacheBasedLinks(ownerId: string, links: BasedLink[]): Promise<void> {
  return update(ownerId, (current) => ({ ...current, links }));
}

export function clearBasedView(ownerId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  const task = async () => {
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(ownerId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  };
  const next = writes.then(task, task);
  writes = next.catch(() => undefined);
  return next;
}
