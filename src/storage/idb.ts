// Minimal promise wrapper over IndexedDB — house style is dependency-light, so no idb library.
// One database, two stores: keepsakes (keyed by id) and a small key-value meta store (walk draft).

const DB_NAME = 'leaf-garden';
const DB_VERSION = 2;

export const KEEPSAKES = 'keepsakes';
export const META = 'meta';
export const PRESETS = 'presets';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEEPSAKES)) db.createObjectStore(KEEPSAKES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(PRESETS)) db.createObjectStore(PRESETS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

export const idb = {
  get: <T>(store: string, key: IDBValidKey) => run<T | undefined>(store, 'readonly', (s) => s.get(key)),
  put: (store: string, value: unknown, key?: IDBValidKey) => run<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: string, key: IDBValidKey) => run<undefined>(store, 'readwrite', (s) => s.delete(key)),
  getAll: <T>(store: string) => run<T[]>(store, 'readonly', (s) => s.getAll()),
  count: (store: string) => run<number>(store, 'readonly', (s) => s.count()),
};
