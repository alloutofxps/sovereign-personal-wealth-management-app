/* Fonts are bundled, not fetched from a CDN — a local-first ledger must render
 * correctly offline and must not announce itself to a third party at load. */
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import './design/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
