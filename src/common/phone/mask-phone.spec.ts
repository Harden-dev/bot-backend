import { maskPhone } from './mask-phone.js';

describe('maskPhone', () => {
  it('masque un numéro local à 10 chiffres', () => {
    expect(maskPhone('0707070707')).toBe('07****0707');
  });

  it('masque un numéro vendeur à 13 chiffres de la même façon', () => {
    expect(maskPhone('2250707070707')).toBe('22*******0707');
  });

  it('masque entièrement un numéro trop court pour garder début et fin', () => {
    expect(maskPhone('123456')).toBe('******');
    expect(maskPhone('')).toBe('');
  });

  it('garde un seul caractère masqué au minimum au-delà de 6 caractères', () => {
    expect(maskPhone('1234567')).toBe('12*4567');
  });
});
