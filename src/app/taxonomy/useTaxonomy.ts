/* ===========================================================================
 * THE CHART OF ACCOUNTS, LIVE
 * ---------------------------------------------------------------------------
 * Every category picker in the app reads from here. Before this slice they all
 * read from a literal in `seed.ts`, which is why nobody could add a category:
 * the chart was code, and code needs a deploy.
 * ======================================================================== */

import { useCallback, useMemo } from 'react';
import type { AccountId } from '@/core/ledger';
import type { PredictionResult } from '@/core/taxonomy/merchantMemory';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import {
  TAXONOMY_TABLES,
  listTaxonomy,
  type CategoryNode,
  type Taxonomy,
} from '@/data/repositories/categoriesRepo';
import {
  MERCHANT_TABLES,
  RULES_TABLES,
  listRulesWithStats,
  predictCategoryForMerchant,
  type RuleWithStats,
} from '@/data/repositories/rulesRepo';
import { useDebounced } from '@/app/ledger/useSearch';

/**
 * The shape a grouped picker wants.
 *
 * Declared here rather than imported from the design system, because the
 * layering runs one way and `app` sits below `design`. It is structurally
 * identical to `SelectOptionGroup`, so it drops straight into a `Select`
 * without either side knowing about the other.
 */
export interface PickerGroup {
  label: string;
  options: { value: string; label: string }[];
}

const EMPTY: Taxonomy = { groups: [], ungrouped: [], all: [] };

/** The whole tree, re-read whenever the chart changes. */
export function useTaxonomy(includeArchived = false): LiveQueryResult<Taxonomy> {
  const run = useCallback(() => listTaxonomy({ includeArchived }), [includeArchived]);
  return useLiveQuery(run, TAXONOMY_TABLES);
}

export interface CategoryPicker {
  /** Flat list, for anything that needs to look one up. */
  all: CategoryNode[];
  /** Grouped, for a `Select` with `<optgroup>` headings. */
  groups: PickerGroup[];
  /** categoryId to its node, including the paired envelope. */
  byId: Map<string, CategoryNode>;
  /** True once the chart has actually loaded. */
  ready: boolean;
}

/**
 * Everything a category picker needs.
 *
 * Groups become `<optgroup>` labels. Anything not yet in a group is gathered
 * under a heading of its own rather than being dropped, because a category
 * that exists but cannot be chosen is the worst of both worlds.
 */
export function useCategoryPicker(): CategoryPicker {
  const taxonomy = useTaxonomy();
  const data = taxonomy.data ?? EMPTY;

  return useMemo(() => {
    const groups: PickerGroup[] = data.groups
      .filter((group) => group.categories.length > 0)
      .map((group) => ({
        label: group.name,
        options: group.categories.map((c) => ({ value: c.categoryId, label: c.name })),
      }));

    if (data.ungrouped.length > 0) {
      groups.push({
        label: data.groups.length > 0 ? 'Everything else' : 'Your categories',
        options: data.ungrouped.map((c) => ({ value: c.categoryId, label: c.name })),
      });
    }

    return {
      all: data.all,
      groups,
      byId: new Map(data.all.map((c) => [c.categoryId as string, c])),
      ready: taxonomy.data !== undefined,
    };
  }, [data, taxonomy.data]);
}

/** Look one category up by id, whichever half you have. */
export function useCategory(categoryId: AccountId | null | undefined): CategoryNode | null {
  const picker = useCategoryPicker();
  return categoryId ? (picker.byId.get(categoryId) ?? null) : null;
}

/** The rules, with their counters, for the manager screen. */
export function useRules(): LiveQueryResult<RuleWithStats[]> {
  const run = useCallback(() => listRulesWithStats(), []);
  return useLiveQuery(run, RULES_TABLES);
}

/**
 * What this merchant is usually filed as.
 *
 * Debounced, because it is driven by a text field and nobody needs a database
 * query per keystroke. Returns null while the name is too short to mean
 * anything, so an empty field never produces a suggestion.
 */
export function useMerchantPrediction(
  merchantName: string,
): LiveQueryResult<PredictionResult | null> {
  const settled = useDebounced(merchantName, 200);
  const usable = settled.trim().length >= 3 ? settled.trim() : '';

  const run = useCallback(
    () => (usable ? predictCategoryForMerchant(usable) : Promise.resolve(null)),
    [usable],
  );

  return useLiveQuery(run, MERCHANT_TABLES);
}
