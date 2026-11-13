import {
  addGroup,
  type CountAndAmount,
  microsecondsToHours,
  percentage,
} from './stats-math.js';

describe('percentage (PO-20 e)', () => {
  it.each([
    [8, 10, 80],
    [2, 10, 20],
    [1, 3, 33.3],
    [2, 3, 66.7],
    [0, 4, 0],
    [1, 16, 6.3],
  ])('%i ÷ %i = %d %%', (part, total, expected) => {
    expect(percentage(part, total)).toBe(expected);
  });

  it('renvoie null si le dénominateur est nul', () => {
    expect(percentage(0, 0)).toBeNull();
  });
});

describe('microsecondsToHours (PO-20 f)', () => {
  it('convertit en heures à une décimale', () => {
    expect(microsecondsToHours(7_200_000_000)).toBe(2);
    expect(microsecondsToHours(5_400_000_000)).toBe(1.5);
    expect(microsecondsToHours(1_000_000_000)).toBe(0.3);
  });

  it('renvoie null sans commande validée', () => {
    expect(microsecondsToHours(null)).toBeNull();
  });
});

describe('addGroup (PO-20 d)', () => {
  it('compte toutes les commandes et exclut annulee du montant, echec inclus', () => {
    const totals: CountAndAmount = { count: 0, amount: 0 };

    addGroup(totals, 'livree', 2, 30_000);
    addGroup(totals, 'echec', 1, 10_000);
    addGroup(totals, 'annulee', 3, 50_000);

    expect(totals).toEqual({ count: 6, amount: 40_000 });
  });
});
