/* ===========================================================================
 * LOCKING THE APP
 * ---------------------------------------------------------------------------
 * Be precise about what this is, because vagueness here would be dishonest.
 *
 * What it does: keeps somebody who picks up your unlocked phone out of your
 * finances, hides the numbers from the app switcher, and locks again after a
 * period of inactivity. The passcode is verified cryptographically — a stored
 * token that only the right passcode can open — not by comparing strings.
 *
 * What it does not do: encrypt the database on disk. OPFS is already private
 * to this origin and unreadable by other sites, but anything running *on* this
 * origin could read it while the app is open. Calling that "zero-knowledge"
 * would be marketing. The honest claim is: nothing leaves the device, no
 * server holds a key, and exports are properly encrypted.
 *
 * Settings says all of this in as many words.
 * ======================================================================== */

const STORAGE_KEY = 'sovereign.lock';
const PROBE_TEXT = 'sovereign-unlocked';
const ITERATIONS = 600_000;

export type LockMethod = 'none' | 'passcode' | 'biometric';

interface StoredLock {
  method: Exclude<LockMethod, 'none'>;
  /** Base64. Fresh per set-up; not a secret. */
  salt: string;
  iv: string;
  /** The probe text encrypted under the derived key. */
  token: string;
  /** The passkey this device registered, if biometrics were set up. */
  credentialId?: string;
  /** Minutes of inactivity before locking again. */
  lockAfterMinutes: number;
}

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

function read(): StoredLock | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredLock) : null;
  } catch {
    return null;
  }
}

function write(lock: StoredLock | null): void {
  try {
    if (lock) localStorage.setItem(STORAGE_KEY, JSON.stringify(lock));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A browser that refuses local storage cannot hold a lock. The app still
    // works; it simply will not lock, which is better than failing to open.
  }
}

export function lockMethod(): LockMethod {
  return read()?.method ?? 'none';
}

export function lockAfterMinutes(): number {
  return read()?.lockAfterMinutes ?? 5;
}

async function deriveKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Set up a passcode. Verification is by decryption, never by comparison. */
export async function setPasscode(passcode: string, lockAfter = 5): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passcode, salt);

  const token = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(PROBE_TEXT),
    ),
  );

  write({
    method: 'passcode',
    salt: toBase64(salt),
    iv: toBase64(iv),
    token: toBase64(token),
    lockAfterMinutes: lockAfter,
  });
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  const lock = read();
  if (!lock) return true;

  try {
    const key = await deriveKey(passcode, fromBase64(lock.salt));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(lock.iv) as BufferSource },
      key,
      fromBase64(lock.token) as BufferSource,
    );
    return new TextDecoder().decode(plain) === PROBE_TEXT;
  } catch {
    return false;
  }
}

export function removeLock(): void {
  write(null);
}

export function setLockAfter(minutes: number): void {
  const lock = read();
  if (lock) write({ ...lock, lockAfterMinutes: Math.max(0, minutes) });
}

/* --- passkeys ------------------------------------------------------------ */

export async function biometricsAvailable(): Promise<boolean> {
  try {
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Register a passkey on this device.
 *
 * The passcode is set up alongside it and kept, deliberately: a passkey lives
 * on one device, and somebody who only ever set up Face ID would be locked out
 * of their own records the day they change phone.
 */
export async function setUpBiometrics(passcode: string, lockAfter = 5): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { name: 'Sovereign' },
      user: { id: userId as BufferSource, name: 'you', displayName: 'You' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('That was cancelled, so nothing has changed.');

  await setPasscode(passcode, lockAfter);
  const lock = read();
  if (lock) {
    write({ ...lock, method: 'biometric', credentialId: toBase64(new Uint8Array(credential.rawId)) });
  }
}

/** Ask the device to confirm it is you. */
export async function verifyBiometrics(): Promise<boolean> {
  const lock = read();
  if (!lock?.credentialId) return false;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge as BufferSource,
        allowCredentials: [
          { type: 'public-key', id: fromBase64(lock.credentialId) as BufferSource },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return assertion !== null;
  } catch {
    return false;
  }
}

/**
 * What the lock honestly protects, for the settings screen.
 * Overstating this would be worse than not having it.
 */
export const LOCK_EXPLANATION =
  'A lock keeps anyone who picks up your unlocked phone out of your finances, and hides ' +
  'your figures when you switch apps. It does not scramble the data on your device. ' +
  'nothing here ever leaves it, and your exports are properly encrypted, but the lock ' +
  'itself is a door rather than a safe.';
