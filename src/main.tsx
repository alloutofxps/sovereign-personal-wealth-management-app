/* Fonts are bundled, not fetched from a CDN — a local-first ledger must render
 * correctly offline and must not announce itself to a third party at load. */
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
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
