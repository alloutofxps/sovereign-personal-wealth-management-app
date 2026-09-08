/* Fonts are bundled, not fetched from a CDN. Two reasons, and the second is
 * not a preference: a local-first ledger must render correctly offline and
 * must not announce itself to a third party at load — and `require-corp` is
 * set on this origin, so a Google Fonts <link> would be blocked outright.
 *
 * Fraunces ships as the `opsz` subset rather than `full`. Production runs the
 * face at its default SOFT and WONK, so those axes do not need to be in the
 * file to reach the look, and leaving them out costs 54kB less on latin for a
 * pixel-identical result. See the note in tokens.css. */
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/space-grotesk';
import './design/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, useTheme, watchSystemTheme } from './app/theme';

/* The document head has already stamped the attribute, from two hex values it
 * had to carry itself because no stylesheet existed yet. Now that one does,
 * re-apply from it: the palette in tokens.css becomes the authority and those
 * two values go back to being a first approximation. Then follow the system,
 * for anyone who has left the choice to it. */
applyTheme(useTheme.getState().choice);
watchSystemTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
