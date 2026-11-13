import { Prisma } from '../../generated/prisma/client.js';
import { isTransactionConflict } from './prisma-error.js';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erreur', {
    code,
    clientVersion: 'test',
  });
}

describe('isTransactionConflict', () => {
  it('reconnaît un conflit de transaction (P2034)', () => {
    expect(isTransactionConflict(prismaError('P2034'))).toBe(true);
  });

  it.each([
    ['une autre erreur Prisma', prismaError('P2002')],
    ['une erreur ordinaire', new Error('P2034')],
    ['une valeur quelconque', 'P2034'],
  ])('ignore %s', (_label, error) => {
    expect(isTransactionConflict(error)).toBe(false);
  });
});
