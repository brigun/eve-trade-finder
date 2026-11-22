import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIntInput,
  formatIskInput,
  formatLiveNumericInput,
  formatShorthandInput,
  parseIskShorthand,
} from '../../../../client/src/lib/format.ts';

describe('American comma input formatters', () => {
  it('formats ISK and integer input values in American style', () => {
    assert.equal(formatIskInput(123456789), '123,456,789');
    assert.equal(formatIskInput(123456789.25), '123,456,789.25');
    assert.equal(formatIskInput(null), '');
    assert.equal(formatIntInput(1234567), '1,234,567');
    assert.equal(formatIntInput(null), '');
  });

  it('formats live typing with commas while preserving trailing decimals and shorthand', () => {
    assert.equal(formatLiveNumericInput('123456789'), '123,456,789');
    assert.equal(formatLiveNumericInput('123456789.25'), '123,456,789.25');
    assert.equal(formatLiveNumericInput('123456.'), '123,456.');
    assert.equal(formatLiveNumericInput('10m'), '10m');
    assert.equal(formatLiveNumericInput('500k'), '500k');
    assert.equal(formatLiveNumericInput('12345.67', false), '1,234,567');
  });

  it('uses comma formatting for non-shorthand values and parses comma strings cleanly', () => {
    assert.equal(formatShorthandInput(123456789), '123,456,789');
    assert.equal(formatShorthandInput(10_000_000), '10m');
    assert.equal(parseIskShorthand('123,456,789'), 123_456_789);
    assert.equal(parseIskShorthand('123,456,789.25'), 123_456_789.25);
    assert.equal(parseIskShorthand('10m'), 10_000_000);
  });
});
