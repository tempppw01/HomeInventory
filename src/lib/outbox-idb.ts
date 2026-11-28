import type { OutboxOperation } from "@/lib/outbox-core";

// 待发队列的存储层(IndexedDB)。**刻意做得很薄**:所有判断都在 outbox-core 的纯函数里,
// 这里只负责读写 —— 于是「该不该重试、等多久、先发哪一条」都能单测,而这一层只在浏览器里验。
//
// 为什么用 IndexedDB 而不是 localStorage:队列要能在页面关掉之后还在(用户离线做完改动就退出应用,
// 是很正常的事);localStorage 是同步的、容量也小,而且没有事务。

const DB_NAME = "guiwu-outbox";
const STORE = "operations";
const VERSION = 1;

export function outboxSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "opId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("打不开离线队列"));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("离线队列读写失败"));
    tx.oncomplete = () => db.close();
  }));
}

/** 按创建时间排序 —— 重放要「先建后改」,顺序不能乱。 */
export async function listOperations(): Promise<OutboxOperation[]> {
  if (!outboxSupported()) return [];
  const rows = await run<OutboxOperation[]>("readonly", (store) => store.getAll() as IDBRequest<OutboxOperation[]>);
  return [...rows].sort((left, right) => left.createdAt - right.createdAt);
}

export async function putOperation(operation: OutboxOperation): Promise<void> {
  if (!outboxSupported()) return;
  await run("readwrite", (store) => store.put(operation) as IDBRequest<IDBValidKey>);
}

export async function deleteOperation(opId: string): Promise<void> {
  if (!outboxSupported()) return;
  await run("readwrite", (store) => store.delete(opId) as IDBRequest<undefined>);
}

export async function countOperations(): Promise<number> {
  if (!outboxSupported()) return 0;
  return run<number>("readonly", (store) => store.count());
}
