/* ===========================================================================
 * DAYLIGHT, MIDNIGHT, OR WHATEVER THE PHONE SAYS
 * ---------------------------------------------------------------------------
 * Three states, not two. "System" is the default and is not a synonym for
 * either one: it means the choice has not been made here, so it belongs to the
 * operating system and has to keep following it when it changes at sunset.
 *
 * The whole mechanism is one attribute on <html>:
 *
 *   absent                  follow prefers-color-scheme
 *   data-theme=daylight     Daylight, whatever the system says
 *   data-theme=midnight     Midnight, whatever the system says
 *
 * The palettes live in tokens.css and nothing here knows a single colour. The
 * two values this file does read — the colour the browser paints around the
 * app, and which of iOS's status-bar treatments suits it — are read back out
 * of the stylesheet rather than restated, so there is still exactly one place
 * a palette is defined.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN THE CONFIG STORE
 *
 * Everything else in `sovereign.config` can be read after the first paint. A
 * theme cannot: an app that paints one ground and then flips to the other a
 * beat later has already shown the wrong thing. So the choice is kept under
 * its own key, holding a bare string rather than a serialised store, and a few
 * lines in the document head stamp the attribute before any of this code is
 * fetched. Anything more elaborate could not run early enough to matter.
 * ======================================================================== */

import { create } from 'zustand';

export type ThemeChoice = 'system' | 'daylight' | 'midnight';
export type ResolvedTheme = 'daylight' | 'midnight';

/** Also read by the inline script in index.html. Changing it changes both. */
export const THEME_STORAGE_KEY = 'sovereign.theme';

const CHOICES: readonly ThemeChoice[] = ['system', 'daylight', 'midnight'];

/**
 * What the two themes were called before they had names.
 *
 * The app shipped with a plain light/dark pair under this same key. Reading
 * those as unrecognised and falling back to "system" would silently undo a
 * choice somebody had already made, so they are translated instead.
 */
const LEGACY: Record<string, ThemeChoice> = {
  light: 'daylight',
  dark: 'midnight',
};

function normalise(value: unknown): ThemeChoice | null {
  if (typeof value !== 'string') return null;
  if ((CHOICES as readonly string[]).includes(value)) return value as ThemeChoice;
  return LEGACY[value] ?? null;
}

/** What is on disk, or 'system' if there is nothing legible there. */
export function readStoredChoice(): ThemeChoice {
  try {
    const stored = normalise(localStorage.getItem(THEME_STORAGE_KEY));
    if (stored === null) return 'system';
    // Rewrite a legacy value in place, so the head script — which does no
    // translation of its own — stamps the right attribute on the next launch.
    if (localStorage.getItem(THEME_STORAGE_KEY) !== stored) {
      localStorage.setItem(THEME_STORAGE_KEY, stored);
    }
    return stored;
  } catch {
    // Private browsing, or storage disabled entirely. Follow the system.
    return 'system';
  }
}

/** Which of the two palettes a choice actually resolves to right now. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice;
  if (typeof matchMedia !== 'function') return 'daylight';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'daylight';
}

/**
 * Stamp the document, then tell the phone what to paint around it.
 *
 * Two meta tags move together and for the same reason. `theme-color` is the
 * ground the browser continues past the edges of the page. The iOS status-bar
 * style decides whether the clock and the battery are drawn in black or white,
 * and it was pinned to `black-translucent` — which paints white glyphs, and
 * therefore painted white-on-celadon the moment a light theme existed.
 *
 * The colour is read synchronously, immediately after the attribute is set.
 * `getComputedStyle` flushes pending style itself, so the new value is already
 * there; waiting a frame would make this depend on `requestAnimationFrame`
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
  if (colour !== '') {
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = colour;
    });
  }

  const bar = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
  );
  if (bar) {
    bar.content = resolveTheme(choice) === 'midnight' ? 'black-translucent' : 'default';
  }
}

interface ThemeStore {
  choice: ThemeChoice;
  /** What `choice` resolves to at this moment. Used for the Settings copy. */
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
}

export const useTheme = create<ThemeStore>()((set) => {
  const initial = readStoredChoice();
  return {
    choice: initial,
    resolved: resolveTheme(initial),
    setChoice: (choice) => {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, choice);
      } catch {
        // The choice still applies for this session; it just will not survive it.
      }
      applyTheme(choice);
      set({ choice, resolved: resolveTheme(choice) });
    },
  };
});

/**
 * Follow the system while nobody has chosen otherwise.
 *
 * Called once at startup. Without this, somebody on "system" who is still in
 * the app when their phone flips at sunset keeps the daytime palette until
 * they relaunch — and the browser chrome around the app keeps the old colour
 * even after the CSS has changed underneath it, because neither meta tag is
 * something a media query can reach.
 */
export function watchSystemTheme(): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');

  const onChange = () => {
    const { choice } = useTheme.getState();
    if (choice !== 'system') return;
    applyTheme('system');
    useTheme.setState({ resolved: resolveTheme('system') });
  };

  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
