/* ===========================================================================
 * NEW VERSIONS
 * ---------------------------------------------------------------------------
 * A waiting service worker that nothing ever activates is how people end up
 * running a build from months ago — which for a ledger means running known
 * arithmetic bugs. But reloading underneath somebody halfway through entering
 * a payment is its own kind of rude.
 *
 * So: install quietly, then offer. One line, one tap, dismissible.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface AppUpdate {
  /** A new version is downloaded and waiting for a tap. */
  ready: boolean;
  /** Everything needed to work without a network is now cached. */
  offlineReady: boolean;
  apply: () => void;
  dismiss: () => void;
}

export function useAppUpdate(): AppUpdate {
  const [ready, setReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [update, setUpdate] = useState<{ run: () => Promise<void> } | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdate({ run: () => updateSW(true) });
        setReady(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
    });
  }, []);

  return {
    ready,
    offlineReady,
    apply: () => void update?.run(),
    dismiss: () => setReady(false),
  };
}
