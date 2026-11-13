import { describe, expect, it } from 'vitest';
import { resolveFee, type FeeRuleLike } from '../src/fees.js';

const rule = (id: string, category: string | null, routeId: string | null, amountBdt: number, isActive = true): FeeRuleLike => ({ id, category, routeId, amountBdt, isActive });
const rules = [
  rule('everyone', null, null, 4000),
  rule('cat', 'student_tri_semester', null, 4500),
  rule('route', null, 'savar', 3000),
  rule('route-cat', 'faculty', 'savar', 2000),
  rule('off', 'hall_resident', null, 100, false),
];

describe('resolveFee: the most specific rule wins', () => {
  it('rider fee beats every rule', () => {
    expect(resolveFee({ category: 'faculty', routeId: 'savar' }, rules, { amountBdt: 999 })).toEqual({ amountBdt: 999, source: 'rider', ruleId: null });
  });
  it('route + category beats route, route beats category, category beats everyone', () => {
    expect(resolveFee({ category: 'faculty', routeId: 'savar' }, rules)).toMatchObject({ amountBdt: 2000, source: 'route_category' });
    expect(resolveFee({ category: 'student_tri_semester', routeId: 'savar' }, rules)).toMatchObject({ amountBdt: 3000, source: 'route' });
    expect(resolveFee({ category: 'student_tri_semester', routeId: 'mirpur' }, rules)).toMatchObject({ amountBdt: 4500, source: 'category' });
    expect(resolveFee({ category: 'admin_staff', routeId: 'mirpur' }, rules)).toMatchObject({ amountBdt: 4000, source: 'everyone' });
  });
  it('ignores switched-off rules, and returns null when nothing applies', () => {
    expect(resolveFee({ category: 'hall_resident', routeId: 'mirpur' }, rules)).toMatchObject({ source: 'everyone' });
    expect(resolveFee({ category: 'hall_resident', routeId: 'mirpur' }, rules.filter((r) => r.id !== 'everyone'))).toBeNull();
  });
});
