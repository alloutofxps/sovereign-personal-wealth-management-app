/* ===========================================================================
 * THE DATABASE CLIENT
 * ---------------------------------------------------------------------------
 * One worker, one Drizzle instance, one invalidation bus. Everything the app
 * reads or writes goes through here.
 * ======================================================================== */

import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type {
  SqlMethod,
  Statement,
  StorageStatus,
  WithoutId,
  WorkerRequest,
  WorkerResponse,
} from './worker/protocol';
import { invalidate } from './live/bus';

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (value: WorkerResponse) => void; reject: (reason: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./worker/db.worker.ts', import.meta.url), {
    type: 'module',
    name: 'sovereign-db',
  });

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;

    if ('event' in message && message.event === 'invalidate') {
      invalidate(message.tables);
      return;
    }

    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);

    if ('ok' in message && message.ok) waiting.resolve(message);
    else waiting.reject(new Error('error' in message ? message.error : 'Unknown database error'));
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || 'The database worker stopped unexpectedly.');
    for (const [, waiting] of pending) waiting.reject(error);
    pending.clear();
  };

  return worker;
}

function send(request: WithoutId<WorkerRequest>): Promise<WorkerResponse> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...request, id } as WorkerRequest);
  });
}

/* --- Drizzle over the worker --------------------------------------------- */

/**
 * Drizzle's proxy driver: it builds the SQL, we carry it across the thread
 * boundary. Reads and single writes come through here; anything that must be
 * atomic across several statements goes through `runBatch`.
 */
export const db = drizzle(async (sql, params, method) => {
  const response = await send({ op: 'exec', sql, params, method: method as SqlMethod });
  return { rows: 'rows' in response ? response.rows : [] };
});

/** Commit several statements as one transaction. All of them, or none. */
export async function runBatch(statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await send({ op: 'batch', statements });
}

/* --- lifecycle ----------------------------------------------------------- */

let storageStatus: StorageStatus | null = null;

/**
 * Open the database and find out whether this browser will actually keep it.
 *
 * `navigator.storage.persist()` has to be called from the main thread, and is
 * far more likely to be granted once the app is installed or has been used a
 * little — so it is requested here at open, not buried somewhere later.
 */
export async function openDatabase(): Promise<StorageStatus> {
  const response = await send({ op: 'open' });
  const base = 'status' in response ? response.status : null;
  if (!base) throw new Error('The database did not report its status.');

  let persisted = false;
  try {
    if (navigator.storage?.persist) {
      persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    }
  } catch {
    persisted = false;
  }

  storageStatus = { ...base, persisted };
  return storageStatus;
}

export function getStorageStatus(): StorageStatus | null {
  return storageStatus;
}

/** Wipe everything and start over. Used by "Start again" in settings. */
export async function resetDatabase(): Promise<void> {
  await send({ op: 'reset' });
}
