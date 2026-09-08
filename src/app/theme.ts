/* ===========================================================================
 * LIGHT, DARK, OR WHATEVER THE PHONE SAYS
 * ---------------------------------------------------------------------------
 * Three states, not two. "System" is the default and is not a synonym for
 * either one: it means the choice has not been made here, so it belongs to the
 * operating system and has to keep following it when it changes at sunset.
 *
 * The whole mechanism is one attribute on <html>:
 *
 *   absent            follow prefers-color-scheme
 *   data-theme=light  light, whatever the system says
 *   data-theme=dark   dark, whatever the system says
 *
 * The palettes live in tokens.css and nothing here knows a single colour. The
 * one value this file does read — the colour the browser paints around the app
 * — is read back out of the stylesheet rather than restated, so there is still
 * exactly one place a palette is defined.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN THE CONFIG STORE
 *
 * Everything else in `sovereign.config` can be read after the first paint. A
 * theme cannot: an app that paints obsidian and then flips to white a beat
 * later has already shown the wrong thing. So the choice is kept under its own
 * key, holding a bare string rather than a serialised store, and a few lines in
 * the document head stamp the attribute before any of this code is fetched.
 * Anything more elaborate could not run early enough to matter.
 * ======================================================================== */

import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';

/** Also read by the inline script in index.html. Changing it changes both. */
export const THEME_STORAGE_KEY = 'sovereign.theme';

const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

function isChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value);
}

/** What is on disk, or 'system' if there is nothing legible there. */
export function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isChoice(stored) ? stored : 'system';
  } catch {
    // Private browsing, or storage disabled entirely. Follow the system.
    return 'system';
  }
}

/** Which of the two palettes a choice actually resolves to right now. */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  if (typeof matchMedia !== 'function') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Stamp the document, then tell the browser what to paint around it.
 *
 * The theme colour is read back out of the stylesheet rather than hard-coded
 * here. The alternative — two hex strings in TypeScript kept in step with the
 * CSS by hand — is the kind of duplication that goes quietly wrong the first
 * time somebody warms up the greys.
 *
 * Read synchronously, immediately after the attribute is set. `getComputedStyle`
 * flushes pending style itself, so the new value is already there; waiting a
 * frame for it would only make the whole thing depend on `requestAnimationFrame`
 * running, which it does not while the page is hidden — and a theme applied on
 * a hidden page would then keep the old bar colour for as long as it stayed
 * hidden.
 */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  const colour = getComputedStyle(root).getPropertyValue('--theme-color').trim();
  if (colour === '') return;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = colour;
  });
}

interface ThemeStore {
  choice: ThemeChoice;
  /** What `choice` resolves to at this moment. Kept for the Settings copy. */
  resolved: 'light' | 'dark';
  setChoice: (choice: ThemeChoice) => void;
}

export const useTheme = create<ThemeStore>()((set) => ({
  choice: readStoredChoice(),
  resolved: resolveTheme(readStoredChoice()),
  setChoice: (choice) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // The choice still applies for this session; it just will not survive it.
    }
    applyTheme(choice);
    set({ choice, resolved: resolveTheme(choice) });
  },
}));

/**
 * Follow the system while nobody has chosen otherwise.
 *
 * Called once at startup. Without this, somebody on "system" who is still in
 * the app when their phone flips at sunset keeps the daytime palette until
 * they relaunch — and the browser chrome around the app keeps the old colour
 * even after the CSS has changed underneath it, because the meta tag is not
 * something the media query can reach.
 */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: light)');

  const onChange = () => {
    const { choice } = useTheme.getState();
    if (choice !== 'system') return;
    applyTheme('system');
    useTheme.setState({ resolved: resolveTheme('system') });
  };

  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
