/* ===========================================================================
 * HOSTING AN EXPLANATION
 * ---------------------------------------------------------------------------
 * Every screen that carries information buttons needs the same three things: a
 * bit of state for which topic is open, the sheet itself, and a context of
 * live figures for the worked example. This is those three things, so a screen
 * adds explanations in two lines rather than fifteen.
 *
 * The figures are passed in by the screen because only the screen has them —
 * the dashboard knows what is safe to spend, the investments screen knows what
 * the funds charge, and neither knows the other's numbers. Anything absent is
 * simply absent: `worked()` returns null and the sheet shows the general
 * version, which is honest. It never fills a gap with a zero.
 * ======================================================================== */

import { useCallback, useMemo, useState } from 'react';
import type { ExplainFigures, ExplainTopic } from '@/content/explain';
import { useMoney } from '@/app/money/useMoney';
import { ExplainSheet } from './ExplainSheet';

export function useExplain(figures: Partial<ExplainFigures> = {}) {
  const money = useMoney();
  const [topic, setTopic] = useState<ExplainTopic | null>(null);

  const open = useCallback((next: ExplainTopic) => setTopic(next), []);
  const close = useCallback(() => setTopic(null), []);

  const format = useCallback((amount: Parameters<typeof money.format>[0]) => money.format(amount), [
    money,
  ]);

  const context = useMemo(() => ({ money: format, figures }), [format, figures]);

  const sheet = <ExplainSheet topic={topic} context={context} onClose={close} />;

  return { open, sheet };
}
