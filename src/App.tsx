import { Gallery } from '@/features/gallery/Gallery';

/**
 * Phase 2 ships the design system, so the gallery *is* the app for now.
 * Phase 4 replaces this with the shell and its vertical slices; the gallery
 * stays reachable as a route so the primitives remain reviewable in isolation.
 */
export function App() {
  return <Gallery />;
}
