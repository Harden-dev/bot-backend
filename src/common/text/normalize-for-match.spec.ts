import { foldCase, normalizeForMatch } from './normalize-for-match.js';

describe('normalizeForMatch', () => {
  it.each([
    ['Modèle', 'modele'],
    ['MODELE', 'modele'],
    ['  Mes   Commandes \n', 'mes commandes'],
    ['ÉCHEC à Abidjan', 'echec a abidjan'],
    ['', ''],
  ])('normalise « %s » en « %s »', (input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
  });
});

describe('foldCase', () => {
  it('retire casse et accents sans toucher aux espaces', () => {
    expect(foldCase(' Téléphone  : ')).toBe(' telephone  : ');
  });
});
