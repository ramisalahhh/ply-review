// Tiny key-value store on IndexedDB (falls back to memory where IndexedDB is
// missing or blocked, e.g. tests or some private windows).

export type StoreName = "http" | "reviews";

export interface KvStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  set(store: StoreName, key: string, value: unknown): Promise<void>;
  keys(store: StoreName): Promise<string[]>;
}

const DB_NAME = "ply-review";
const STORES: StoreName[] = ["http", "reviews"];

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function memoryStore(): KvStore {
  const data = new Map<string, unknown>();
  return {
    get: async (s, k) => data.get(`${s}:${k}`) as never,
    set: async (s, k, v) => {
      data.set(`${s}:${k}`, v);
    },
    keys: async (s) => [...data.keys()].filter((k) => k.startsWith(`${s}:`))
      .map((k) => k.slice(s.length + 1)),
  };
}

function indexedDbStore(): KvStore {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      for (const s of STORES) {
        if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const tx = async (s: StoreName, mode: IDBTransactionMode) =>
    (await db).transaction(s, mode).objectStore(s);
  return {
    get: async (s, k) => request((await tx(s, "readonly")).get(k)),
    set: async (s, k, v) => {
      await request((await tx(s, "readwrite")).put(v, k));
    },
    keys: async (s) => (await request((await tx(s, "readonly")).getAllKeys())).map(String),
  };
}

let shared: KvStore | null = null;

/** The app-wide store: IndexedDB when it works, memory otherwise. */
export function kv(): KvStore {
  if (shared) return shared;
  if (typeof indexedDB === "undefined") return (shared = memoryStore());
  const idb = indexedDbStore();
  const mem = memoryStore();
  let broken = false;
  const guard = <A extends unknown[], R>(f: (...a: A) => Promise<R>, g: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      if (broken) return g(...a);
      try {
        return await f(...a);
      } catch {
        broken = true; // e.g. blocked storage: keep working for this visit
        return g(...a);
      }
    };
  shared = {
    get: guard(idb.get, mem.get) as KvStore["get"],
    set: guard(idb.set, mem.set),
    keys: guard(idb.keys, mem.keys),
  };
  return shared;
}

export function setKv(store: KvStore | null): void {
  shared = store;
}
