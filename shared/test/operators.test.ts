import { describe, expect, it } from 'vitest';
import { OPERATOR_PALETTE, groupByOperator, operatorColor } from '../src/operators.js';

describe('operator colours and grouping', () => {
  it('uses the saved colour, otherwise a stable palette colour by code', () => {
    expect(operatorColor({ code: 'H', color: '#123456' })).toBe('#123456');
    const auto = operatorColor({ code: 'GL' });
    expect(OPERATOR_PALETTE).toContain(auto);
    expect(operatorColor({ code: 'GL', color: null })).toBe(auto);
  });

  it('groups buses by company in code order, with bus numbers in natural order', () => {
    const groups = groupByOperator([
      { code: 'M-11', operatorCode: 'M' }, { code: 'H-12', operatorCode: 'H' }, { code: 'H-9', operatorCode: 'H' }, { code: 'G-01', operatorCode: 'G' },
    ]);
    expect(groups.map((g) => g.operatorCode)).toEqual(['G', 'H', 'M']);
    expect(groups[1]!.buses.map((b) => b.code)).toEqual(['H-9', 'H-12']);
  });
});
