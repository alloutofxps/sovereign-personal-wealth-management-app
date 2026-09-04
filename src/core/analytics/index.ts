/* The analytics module's public surface. Import from '@/core/analytics'.
 *
 * Everything here is pure: no React, no DOM, no database. That is what lets
 * the conservation property be tested over hundreds of generated ledgers, and
 * what keeps the whole module out of the first-paint bundle. */

export type {
  Distribution,
  DistributionGroup,
  DistributionLeaf,
  SpendRow,
} from './categoryDistribution';
export { buildDistribution, describeShare, shareOf } from './categoryDistribution';

export type {
  FlowInput,
  FlowLink,
  FlowNode,
  IncomeSlice,
  NodeKind,
  SankeyGraph,
  SavingSlice,
  SpendSlice,
} from './sankeyFlow';
export {
  OTHER_ID,
  RESERVES_ID,
  RETAINED_ID,
  SMALL_SLICE_BP,
  STAGE_IDS,
  buildSankeyFlow,
  conservationErrors,
  foldSmallSlices,
} from './sankeyFlow';

export type {
  CategoryBaseline,
  CategoryHistory,
  CycleSpend,
  TrailingMedianResult,
} from './trailingMedian';
export {
  MIN_CLOSED_CYCLES,
  MIN_DAYS_OF_HISTORY,
  VARIANCE_NOTICE_BP,
  describePace,
  medianOf,
  trailingMedians,
} from './trailingMedian';
