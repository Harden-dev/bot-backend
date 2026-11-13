import { Transform } from 'class-transformer';

/** Retire les espaces de début et de fin d'une chaîne (autres types inchangés). */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
