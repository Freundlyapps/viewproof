import { expect, test } from 'vitest';
import { median, noData, value } from '../src/measured';

test('median of odd count', () => expect(median([3, 1, 2])).toBe(2));
test('median of even count', () => expect(median([1, 2, 3, 4])).toBe(2.5));
test('median of empty is null', () => expect(median([])).toBeNull());
test('noData carries the reason', () => expect(noData('x')).toEqual({ kind: 'no_data', reason: 'x' }));
test('value carries formula and inputs', () =>
  expect(value(3, 'a ÷ b', { a: 6, b: 2 })).toEqual({ kind: 'value', value: 3, formula: 'a ÷ b', inputs: { a: 6, b: 2 } }));
