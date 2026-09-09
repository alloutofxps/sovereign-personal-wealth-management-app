/* ===========================================================================
 * THE EXPLANATION LOOKUP
 * ---------------------------------------------------------------------------
 * The types are here, the registry is not.
 *
 * `<Explain topic="…" />` appears on screens that are in the first paint, and
 * the registry is nineteen explanations of prose. Re-exporting it from this
 * barrel would pull all of it into the opening bundle to render a 22px circle
 * — the barrel-leak pattern this project has paid for twice. So the button
 * imports the type from here and the sheet fetches the registry when somebody
 * actually opens one.
 * ======================================================================== */

export type {
  ChapterSlug,
  ExplainContext,
  ExplainFigures,
  ExplainTopic,
  Explanation,
} from './types';

/**
 * Load the registry.
 *
 * Dynamic on purpose. Nothing renders an explanation until a person asks for
 * one, and by the time they do the chunk is already on disk — the service
 * worker precaches every chunk on install, so this is a disk read rather than
 * a network one on every launch after the first.
 */
export async function loadExplanations() {
  const module = await import('./registry');
  return module.EXPLANATIONS;
}
