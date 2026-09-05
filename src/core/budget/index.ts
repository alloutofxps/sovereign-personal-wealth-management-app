/* The budget module's public surface. Import from '@/core/budget'.
 *
 * Pure arithmetic over dated allocations. It never decides what an allocation
 * is — the journal does that — only what a set of them adds up to. */

export type {
  BudgetInput,
  BudgetPlan,
  CoverSource,
  EnvelopeMovement,
  EnvelopePeriod,
  EnvelopeState,
  OverspendPolicy,
  PeriodInput,
  PeriodState,
  QuickAssignTarget,
} from './multiMonth';
export {
  applyPosting,
  describeReadyToAssign,
  noMovement,
  planBudget,
  quickAssignToTargets,
  rankCoverSources,
} from './multiMonth';

export type { EnvelopePace, EnvelopePaceInput, PaceStatus } from './envelopePacing';
export {
  AHEAD_NOTICE_BP,
  UNDER_NOTICE_BP,
  describePace as describeEnvelopePace,
  envelopePace,
  paceTone,
} from './envelopePacing';
