const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/** Entier avec espace comme séparateur de milliers : `38000` -> `38 000`. */
export function formatThousands(value: number): string {
  return String(value).replace(THOUSANDS, ' ');
}

/** Montant XOF entier : `38000` -> `38 000 F`. */
export function formatXof(amount: number): string {
  return `${formatThousands(amount)} F`;
}
