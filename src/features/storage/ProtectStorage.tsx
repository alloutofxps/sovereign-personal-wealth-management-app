/* ===========================================================================
 * ASKING THE BROWSER TO LEAVE OUR DATA ALONE
 * ---------------------------------------------------------------------------
 * Browsers evict site storage when a device runs short of space. For most
 * sites that means a lost session; here it means somebody's entire financial
 * history, because there is no server holding a second copy.
 *
 * `navigator.storage.persist()` is the fix, and it is one call. The reason
 * this is a component rather than a line of code is timing and consent:
 *
 *   · Chrome grants it silently on engagement, so the app already asks once
 *     quietly at startup. This prompt only appears when that quiet ask did
 *     not land — otherwise nobody is bothered about a problem they do not
 *     have.
 *   · Firefox shows a real permission dialog. Springing that on somebody
 *     unannounced earns a refusal, and a refusal is remembered. Explaining
 *     first, and letting them tap, is what makes the answer a yes.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { persistenceState, requestPersistence } from '@/data/persistence';
import { toast } from '@/app/toast';
import { Button, Card, Explain } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

/** Where the prompt is being shown, which decides how it explains itself. */
export type ProtectStorageContext = 'settings' | 'after-import';

const DISMISSED_KEY = 'sovereign.protect-storage.dismissed';

function supported(): boolean {
  return typeof navigator.storage?.persist === 'function';
}

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'yes';
  } catch {
    return false;
  }
}

/**
 * A quiet card offering permanent storage, which renders nothing at all in the
 * common case: the browser has already agreed, does not support the request,
 * or the person has said no thank you once already.
 */
export function ProtectStorage({ context }: { context: ProtectStorageContext }) {
  const [needed, setNeeded] = useState(false);
  /** What the records actually take, so the explanation can say so. */
  const [usedBytes, setUsedBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(context === 'after-import' && dismissedBefore());
  const explain = useExplain(usedBytes === null ? {} : { storageUsedBytes: usedBytes });

  useEffect(() => {
    let cancelled = false;
    if (!supported()) return;
    void persistenceState().then((state) => {
      if (cancelled) return;
      setNeeded(!state.persisted);
      setUsedBytes(state.usedBytes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const protect = useCallback(async () => {
    setBusy(true);
    const granted = await requestPersistence();
    setBusy(false);
    if (granted) {
      setNeeded(false);
      toast('Your browser has agreed to keep these records, even when space runs low.');
      return;
    }
    toast(
      'Your browser said no for now. Adding Sovereign to your home screen usually changes ' +
        'its mind, and an export is worth keeping either way.',
      { tone: 'attention' },
    );
  }, []);

  if (!needed || hidden) return null;

  return (
    <Card
      label="Keeping your records"
      accent="caution"
      action={<Explain topic="storage" label="keeping your records" onOpen={explain.open} />}
    >
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-2">
          {context === 'after-import'
            ? 'That statement is now on this device and nowhere else. To make sure your device ' +
              'never clears these records during a storage cleanup, tap Protect storage and ' +
              'your browser will leave them alone.'
            : 'When a device runs low on space, browsers clear out stored data to make room. ' +
              'Sovereign has no server, so what is here is the only copy. Tap Protect storage ' +
              'to grant permanent storage and your browser will leave it alone.'}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void protect()}>
            {busy ? 'Asking your browser…' : 'Protect storage'}
          </Button>
          {context === 'after-import' && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setHidden(true);
                try {
                  localStorage.setItem(DISMISSED_KEY, 'yes');
                } catch {
                  // A browser that refuses localStorage will simply be asked
                  // again next time, which is a smaller problem than crashing.
                }
              }}
            >
              Not now
            </Button>
          )}
        </div>

        <p className="text-caption text-ink-3">
          This only asks your browser not to delete anything. It does not send your data
          anywhere. There is nowhere for it to go.
        </p>
      </div>
    {explain.sheet}
    </Card>
  );
}
