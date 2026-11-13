import { createHmac } from 'node:crypto';
import { safeEqualStrings, verifyMetaSignature } from './meta-signature.js';

const SECRET = 'app-secret';
const BODY = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

function sign(body: Buffer, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyMetaSignature', () => {
  it('accepte une signature valide calculée sur les octets bruts', () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('refuse une signature absente', () => {
    expect(verifyMetaSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('refuse un corps brut absent', () => {
    expect(verifyMetaSignature(undefined, sign(BODY), SECRET)).toBe(false);
  });

  it('refuse une signature falsifiée de même longueur', () => {
    const forged = sign(BODY).replace(/.$/, (c) => (c === '0' ? '1' : '0'));

    expect(verifyMetaSignature(BODY, forged, SECRET)).toBe(false);
  });

  it('refuse une signature calculée avec un autre secret', () => {
    expect(verifyMetaSignature(BODY, sign(BODY, 'autre'), SECRET)).toBe(false);
  });

  it('refuse un corps modifié d’un seul octet après signature', () => {
    const signature = sign(BODY);
    const tampered = Buffer.from(BODY);
    tampered[tampered.length - 2] ^= 1;

    expect(verifyMetaSignature(tampered, signature, SECRET)).toBe(false);
  });

  it.each([
    ['vide', ''],
    ['sans préfixe', sign(BODY).slice('sha256='.length)],
    ['tronquée', sign(BODY).slice(0, -1)],
    ['trop longue', `${sign(BODY)}0`],
    ['multi-octets', `${sign(BODY).slice(0, -1)}é`],
  ])(
    'refuse une signature de longueur différente (%s) sans exception',
    (_label, header) => {
      expect(verifyMetaSignature(BODY, header, SECRET)).toBe(false);
    },
  );
});

describe('safeEqualStrings', () => {
  it('reconnaît deux chaînes identiques', () => {
    expect(safeEqualStrings('jeton', 'jeton')).toBe(true);
  });

  it.each([
    ['jeton', 'jetom'],
    ['jeton', 'jeton-plus-long'],
    ['jeton', ''],
  ])('distingue %s de %s', (a, b) => {
    expect(safeEqualStrings(a, b)).toBe(false);
  });
});
