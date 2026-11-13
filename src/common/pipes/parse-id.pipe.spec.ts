import { BadRequestException } from '@nestjs/common';
import { INVALID_ID_MESSAGE, ParseIdPipe } from './parse-id.pipe.js';

describe('ParseIdPipe', () => {
  const pipe = new ParseIdPipe();

  it.each([
    ['1', 1n],
    ['42', 42n],
    [String(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER)],
  ])('convertit « %s » en bigint', (input, expected) => {
    expect(pipe.transform(input)).toBe(expected);
  });

  it.each([
    ['0'],
    ['-1'],
    ['01'],
    ['1.5'],
    ['1e3'],
    ['abc'],
    [''],
    ['9007199254740992'],
  ])('refuse « %s » en 400', (input) => {
    expect(() => pipe.transform(input)).toThrow(
      new BadRequestException(INVALID_ID_MESSAGE),
    );
  });
});
