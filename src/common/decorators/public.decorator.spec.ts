import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from './public.decorator.js';

class SampleController {
  @Public()
  open(): void {}

  closed(): void {}
}

describe('@Public()', () => {
  const reflector = new Reflector();

  it('marque la route comme publique', () => {
    expect(reflector.get(IS_PUBLIC_KEY, SampleController.prototype.open)).toBe(
      true,
    );
  });

  it('ne marque pas une route sans décorateur', () => {
    expect(
      reflector.get(IS_PUBLIC_KEY, SampleController.prototype.closed),
    ).toBeUndefined();
  });
});
