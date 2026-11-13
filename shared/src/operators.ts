/**
 * Bus companies are data: the transport office adds, renames and retires them.
 * Screens colour a company's buses with its saved colour, or one picked from
 * this palette by the company code (stable on every device).
 */
export const OPERATOR_PALETTE = [
  '#4f46e5', '#0b8f83', '#d9620c', '#be185d', '#0369a1',
  '#65a30d', '#7c3aed', '#b45309', '#0f766e', '#dc2626',
] as const;

export interface OperatorLike {
  code: string;
  color?: string | null;
}

export function operatorColor(op: OperatorLike): string {
  if (op.color) return op.color;
  let h = 0;
  for (const c of op.code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return OPERATOR_PALETTE[h % OPERATOR_PALETTE.length]!;
}

/** Groups buses by company, companies in code order, buses in code order. */
export function groupByOperator<B extends { code: string; operatorCode: string }>(buses: readonly B[]): { operatorCode: string; buses: B[] }[] {
  const groups = new Map<string, B[]>();
  for (const b of buses) groups.set(b.operatorCode, [...(groups.get(b.operatorCode) ?? []), b]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([operatorCode, list]) => ({ operatorCode, buses: [...list].sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true })) }));
}
