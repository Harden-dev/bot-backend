import { normalizeCiPhone, normalizeVendorNumber } from './normalize-phone.js';

describe('normalizeCiPhone', () => {
  it.each([
    ['0707070707', '0707070707'],
    ['07 07 07 07 07', '0707070707'],
    ['07.07.07.07.07', '0707070707'],
    ['07-07-07-07-07', '0707070707'],
    ['\t07 07 07 07 07 ', '0707070707'],
    ['+2250707070707', '0707070707'],
    ['+225 07 07 07 07 07', '0707070707'],
    ['002250707070707', '0707070707'],
    ['00 225 07-07-07-07-07', '0707070707'],
    ['2250707070707', '0707070707'],
    ['225.07.07.07.07.07', '0707070707'],
  ])('normalise « %s » en %s', (input, expected) => {
    expect(normalizeCiPhone(input)).toBe(expected);
  });

  it('garde une saisie locale de 10 chiffres commençant par 225', () => {
    expect(normalizeCiPhone('2250707070')).toBe('2250707070');
  });

  it.each([
    [''],
    ['   '],
    ['070707070'],
    ['07070707070'],
    ['+0707070707'],
    ['+33612345678'],
    ['+3361234567'],
    ['0033612345678'],
    ['22507070707'],
    ['+22507070707070'],
    ['07070707O7'],
    ['(07)07070707'],
  ])('refuse « %s »', (input) => {
    expect(normalizeCiPhone(input)).toBeNull();
  });
});

describe('normalizeVendorNumber', () => {
  it.each([
    ['0707070707', '2250707070707'],
    ['07 07 07 07 07', '2250707070707'],
    ['+225 07 07 07 07 07', '2250707070707'],
    ['+225-07.07.07.07.07', '2250707070707'],
    ['002250707070707', '2250707070707'],
    ['2250707070707', '2250707070707'],
  ])('normalise « %s » en %s (E.164 sans +)', (input, expected) => {
    expect(normalizeVendorNumber(input)).toBe(expected);
  });

  it.each([
    [''],
    ['070707070'],
    ['+33612345678'],
    ['14155552671'],
    ['+2250707070707070'],
    ['abc'],
  ])('refuse « %s »', (input) => {
    expect(normalizeVendorNumber(input)).toBeNull();
  });
});
