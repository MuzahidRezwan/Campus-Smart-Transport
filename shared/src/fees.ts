/**
 * Which fee a rider pays. The transport office sets rules; the most specific wins:
 *   1. this rider's own fee (a discount or special arrangement)
 *   2. route + category
 *   3. route (every category on it)
 *   4. category (every route)
 *   5. everyone (no route, no category)
 * Inactive rules are ignored. Null means no fee is set for this rider yet.
 */
export type FeeSource = 'rider' | 'route_category' | 'route' | 'category' | 'everyone';

export interface FeeRuleLike {
  id: string;
  category: string | null;
  routeId: string | null;
  amountBdt: number;
  isActive: boolean;
}

export interface ResolvedFee {
  amountBdt: number;
  source: FeeSource;
  /** The rule used, or null for a rider fee. */
  ruleId: string | null;
}

export const FEE_SOURCE_LABELS: Record<FeeSource, string> = {
  rider: "This rider's own fee",
  route_category: 'Route and category rule',
  route: 'Route rule',
  category: 'Category rule',
  everyone: 'Rule for everyone',
};

export function resolveFee(
  rider: { category: string | null; routeId: string | null },
  rules: readonly FeeRuleLike[],
  riderFee?: { amountBdt: number } | null,
): ResolvedFee | null {
  if (riderFee) return { amountBdt: riderFee.amountBdt, source: 'rider', ruleId: null };
  const active = rules.filter((r) => r.isActive);
  const find = (category: string | null, routeId: string | null) => active.find((r) => r.category === category && r.routeId === routeId);
  const steps: [FeeSource, FeeRuleLike | undefined][] = [
    ['route_category', rider.routeId && rider.category ? find(rider.category, rider.routeId) : undefined],
    ['route', rider.routeId ? find(null, rider.routeId) : undefined],
    ['category', rider.category ? find(rider.category, null) : undefined],
    ['everyone', find(null, null)],
  ];
  for (const [source, rule] of steps) if (rule) return { amountBdt: rule.amountBdt, source, ruleId: rule.id };
  return null;
}
