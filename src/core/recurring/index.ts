/* The recurrence engine's public surface. Import from '@/core/recurring'. */

export type { Cadence, Occurrence, RecurringItem } from './occurrences';
export {
  CADENCE_LABELS,
  daysInMonth,
  describeSchedule,
  monthsAfter,
  occurrencesWithin,
  semiMonthlyDays,
} from './occurrences';

export type {
  ActivityWindow,
  DormantCandidate,
  HistoricalPayment,
  PriceChange,
  RecurringCandidate,
  WatchedItem,
} from './surveillance';
export {
  AMOUNT_TOLERANCE_BP,
  CREEP_NOTICE_BP,
  DORMANT_AFTER_WEEKS,
  INTERVAL_TOLERANCE_DAYS,
  MIN_OCCURRENCES,
  detectDormantSubscriptions,
  detectPriceCreep,
  inferRecurringCandidates,
  worthMentioning,
} from './surveillance';
