import {
  UNSIGNED_LOG_LIMIT_PER_MINUTE,
  UnsignedLogBudget,
} from './unsigned-log-budget.js';

const T0 = 1_000_000;

describe('UnsignedLogBudget', () => {
  const report = vi.fn();
  let budget: UnsignedLogBudget;

  beforeEach(() => {
    report.mockReset();
    budget = new UnsignedLogBudget(report);
  });

  function consume(count: number, now: number): boolean[] {
    return Array.from({ length: count }, () => budget.tryConsume(now));
  }

  it('accepte 60 écritures par minute, refuse les suivantes', () => {
    const results = consume(UNSIGNED_LOG_LIMIT_PER_MINUTE + 3, T0);

    expect(results.filter(Boolean)).toHaveLength(UNSIGNED_LOG_LIMIT_PER_MINUTE);
    expect(results.slice(-3)).toEqual([false, false, false]);
  });

  it('signale une seule fois le plafond dans la minute, puis le total refusé', () => {
    consume(UNSIGNED_LOG_LIMIT_PER_MINUTE + 4, T0);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0]).toContain('Plafond de 60');

    expect(budget.tryConsume(T0 + 60_000)).toBe(true);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0]).toBe(
      '4 requête(s) webhook non signée(s) non journalisée(s) en base sur la minute écoulée',
    );
  });

  it('repart à zéro au bout d’une minute, pas avant', () => {
    consume(UNSIGNED_LOG_LIMIT_PER_MINUTE, T0);

    expect(budget.tryConsume(T0 + 59_999)).toBe(false);
    expect(budget.tryConsume(T0 + 60_000)).toBe(true);
  });

  it('ne signale rien sans refus', () => {
    consume(10, T0);
    consume(10, T0 + 60_000);

    expect(report).not.toHaveBeenCalled();
  });
});
