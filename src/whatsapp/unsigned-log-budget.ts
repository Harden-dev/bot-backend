/** Lignes non signées écrites au plus dans `webhook_logs` par minute (H-01). */
export const UNSIGNED_LOG_LIMIT_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

/**
 * Plafond global, en mémoire, des écritures de POST non signés dans
 * `webhook_logs` (fenêtre fixe d'une minute). Au-delà, rien n'est écrit : un
 * seul message au premier refus de la minute, puis le total refusé au début
 * de la minute suivante.
 */
export class UnsignedLogBudget {
  private windowStart = Number.NEGATIVE_INFINITY;
  private used = 0;
  private dropped = 0;

  constructor(private readonly report: (message: string) => void) {}

  /** `true` si la ligne peut être écrite, `false` si le plafond est atteint. */
  tryConsume(now: number): boolean {
    if (now - this.windowStart >= WINDOW_MS) {
      this.reportDropped();
      this.windowStart = now;
      this.used = 0;
    }
    if (this.used < UNSIGNED_LOG_LIMIT_PER_MINUTE) {
      this.used += 1;
      return true;
    }
    this.dropped += 1;
    if (this.dropped === 1) {
      this.report(
        `Plafond de ${UNSIGNED_LOG_LIMIT_PER_MINUTE} requêtes webhook non signées par minute atteint : les suivantes ne sont plus journalisées en base`,
      );
    }
    return false;
  }

  private reportDropped(): void {
    if (this.dropped > 0) {
      this.report(
        `${this.dropped} requête(s) webhook non signée(s) non journalisée(s) en base sur la minute écoulée`,
      );
      this.dropped = 0;
    }
  }
}
