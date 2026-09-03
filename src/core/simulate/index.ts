export type { DebtAccount, PayoffComparison, PayoffMonth, PayoffPlan, Strategy } from './debt';
export {
  comparePayoff,
  describeComparison,
  orderFor,
  simulatePayoff,
  strategyLabel,
  totalMinimum,
} from './debt';

export type { FireInput, FireResult, Milestone, MilestoneKind } from './fire';
export {
  MILESTONE_LABELS,
  describeMilestone,
  describeWhen,
  monthsToReach,
  projectFire,
  targetFor,
} from './fire';
