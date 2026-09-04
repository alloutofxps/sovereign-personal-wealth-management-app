/* The investments module's public surface. Import from '@/core/investments'.
 *
 * Pure arithmetic over holdings and prices. It never decides what a holding is
 * — the register does that — only what a set of them adds up to, how it is
 * spread, and what it costs to keep. */

export type {
  AssetClass,
  Holding,
  HoldingValue,
  PortfolioTotals,
  Reconciliation,
  Security,
} from './holdingsMath';
export {
  QUANTITY_EXPONENT,
  QUANTITY_SCALE,
  formatQuantity,
  formatReturn,
  marketValue,
  parseQuantity,
  reconcileTarget,
  totalsOf,
  valueOf,
} from './holdingsMath';

export type { Allocation, AllocationSlice } from './assetAllocation';
export {
  ASSET_CLASS_MEANINGS,
  ASSET_CLASS_NAMES,
  ASSET_CLASS_ORDER,
  allocationOf,
  describeAllocation,
  formatShare,
} from './assetAllocation';

export type { DisposalResult, LotRelief, TaxLot } from './disposals';
export {
  DisposalError,
  describeBudgetEffect,
  describeDisposal,
  openLotsInOrder,
  relieveLotsFIFO,
  totalRemaining,
} from './disposals';

export type {
  DepositAllocation,
  RebalanceLine,
  RebalancePlan,
  TargetAllocation,
} from './rebalance';
export {
  RebalanceError,
  assertTargetsComplete,
  describeDepositStep,
  describeRebalance,
  planRebalance,
} from './rebalance';

export type { FeeDrag, FeeProjection } from './feeDrag';
export {
  ASSUMED_GROSS_RETURN_BP,
  HORIZONS,
  LOW_COST_BASELINE_BP,
  PROJECTION_CAVEAT,
  compound,
  describeFeeDrag,
  feeDragOf,
  formatExpenseRatio,
  weightedExpenseRatio,
} from './feeDrag';
