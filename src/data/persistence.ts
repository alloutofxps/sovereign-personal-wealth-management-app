/* ===========================================================================
 * KEEPING THE DATA, AND GETTING IT BACK OUT
 * ---------------------------------------------------------------------------
 * A local-first ledger has exactly one copy of somebody's financial history.
 * Three things follow from that, and all three live here:
 *
 *   · ask the browser to promise not to evict it, at the moment the person
 *     has demonstrably invested something in the app;
 *   · take a copy before any migration touches the shape of it;
 *   · let them take the whole thing away, encrypted, whenever they like.
 *
 * The export is a real SQLite file. Not a proprietary format, not a JSON
 * approximation — the actual database, which any SQLite tool on earth can
 * open. Sovereignty means being able to leave.
 * ======================================================================== */

import { exportDatabase, importDatabase, listBackups } from './client';

export interface PersistenceState {
  /** Whether the browser has agreed not to evict our storage. */
  persisted: boolean;
  /** How much room the origin is using and is allowed, where known. */
  usedBytes: number | null;
  quotaBytes: number | null;
  /** A complete sentence for the settings screen. */
  explanation: string;
}

/**
 * Ask the browser to keep this data.
 *
 * Called after a real write rather than at boot: Chrome weighs engagement,
 * and asking a stranger on first paint is the request most likely to be
 * refused. Safari grants it on installed apps. Either way this is safe to
 * call repeatedly — once granted it stays granted.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function persistenceState(): Promise<PersistenceState> {
  let persisted = false;
  let usedBytes: number | null = null;
  let quotaBytes: number | null = null;

  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
    const estimate = await navigator.storage?.estimate?.();
    usedBytes = estimate?.usage ?? null;
    quotaBytes = estimate?.quota ?? null;
  } catch {
    // Some browsers refuse to say. Not knowing is not a failure.
  }

  return {
    persisted,
    usedBytes,
    quotaBytes,
    explanation: persisted
      ? 'Your browser has agreed to keep your data even when space runs low.'
      : 'Your browser has not promised to keep this if it runs short of space. Adding ' +
        'Sovereign to your home screen makes that far more likely, and an export is ' +
        'always worth having either way.',
  };
}

/* --- taking a copy out --------------------------------------------------- */

const MAGIC = 'SVRGN1';

/**
 * Wrap the database bytes in an encrypted envelope.
 *
 * AES-GCM with a key stretched from the passphrase by PBKDF2. Six hundred
 * thousand iterations is OWASP's current floor for SHA-256, and it costs
 * roughly a second on a phone — which is the point.
 *
 * The salt and nonce travel with the file. They are not secrets; reusing
 * either would be the actual danger, so both are fresh every time.
 */
export async function encryptExport(bytes: Uint8Array, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource),
  );

  const header = new TextEncoder().encode(MAGIC);
  const envelope = new Uint8Array(header.length + salt.length + iv.length + ciphertext.length);
  envelope.set(header, 0);
  envelope.set(salt, header.length);
  envelope.set(iv, header.length + salt.length);
  envelope.set(ciphertext, header.length + salt.length + iv.length);

  return new Blob([envelope as BufferSource], { type: 'application/octet-stream' });
}

export async function decryptExport(file: ArrayBuffer, passphrase: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(file);
  const magic = new TextDecoder().decode(bytes.slice(0, MAGIC.length));

  if (magic !== MAGIC) {
    throw new Error(
      'That does not look like a Sovereign export. Nothing has been changed.',
    );
  }

  const salt = bytes.slice(MAGIC.length, MAGIC.length + 16);
  const iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28);
  const ciphertext = bytes.slice(MAGIC.length + 28);
  const key = await deriveKey(passphrase, salt);

  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error(
      'That passphrase does not open this file. Nothing has been changed, so you can try again.',
    );
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 600_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Save the whole database to a file the person keeps. */
export async function downloadExport(passphrase: string | null): Promise<{ name: string }> {
  const bytes = await exportDatabase();
  const stamp = new Date().toISOString().slice(0, 10);

  const blob = passphrase
    ? await encryptExport(bytes, passphrase)
    : new Blob([bytes as BufferSource], { type: 'application/vnd.sqlite3' });

  const name = passphrase ? `sovereign-${stamp}.svrgn` : `sovereign-${stamp}.sqlite3`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { name };
}

/** Replace everything with the contents of an export. */
export async function restoreFromFile(file: File, passphrase: string | null): Promise<void> {
  const buffer = await file.arrayBuffer();
  const bytes = passphrase
    ? await decryptExport(buffer, passphrase)
    : new Uint8Array(buffer);

  const header = new TextDecoder().decode(bytes.slice(0, 15));
  if (!header.startsWith('SQLite format 3')) {
    throw new Error(
      passphrase
        ? 'That file opened, but what is inside is not a Sovereign database.'
        : 'That is not a Sovereign database. If it was exported with a passphrase, enter it above.',
    );
  }

  await importDatabase(bytes);
}

export { listBackups };
