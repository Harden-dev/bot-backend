import {
  extractMessages,
  MAX_WAMID_LENGTH,
  normalizeMessage,
} from './normalize-messages.js';

const FROM = '2250707070707';

function payload(...values: unknown[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: values.map((value) => ({ value })) }],
  };
}

describe('normalizeMessage', () => {
  it('transmet le corps d’un message texte', () => {
    expect(
      normalizeMessage({
        id: 'wamid.1',
        from: FROM,
        type: 'text',
        text: { body: 'Bonjour' },
      }),
    ).toEqual({ wamid: 'wamid.1', from: FROM, type: 'text', text: 'Bonjour' });
  });

  it('transmet l’identifiant d’un bouton (button_reply)', () => {
    expect(
      normalizeMessage({
        id: 'wamid.2',
        from: FROM,
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'valider:abc' },
        },
      }),
    ).toEqual({
      wamid: 'wamid.2',
      from: FROM,
      type: 'button',
      buttonId: 'valider:abc',
    });
  });

  it.each([
    ['image', { type: 'image' }],
    ['audio', { type: 'audio' }],
    ['document', { type: 'document' }],
    ['sticker', { type: 'sticker' }],
    [
      'interactive list_reply',
      { type: 'interactive', interactive: { type: 'list_reply' } },
    ],
    [
      'interactive sans id',
      {
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: {} },
      },
    ],
    ['texte sans corps', { type: 'text', text: {} }],
    ['texte au corps non textuel', { type: 'text', text: { body: 42 } }],
  ])('normalise %s en unsupported (PO-13)', (_label, fields) => {
    expect(normalizeMessage({ id: 'wamid.3', from: FROM, ...fields })).toEqual({
      wamid: 'wamid.3',
      from: FROM,
      type: 'unsupported',
    });
  });
});

describe('extractMessages', () => {
  it('parcourt entry[].changes[].value.messages[] dans l’ordre', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'w1', from: FROM, type: 'text', text: { body: 'a' } },
                  { id: 'w2', from: FROM, type: 'image' },
                ],
              },
            },
          ],
        },
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'w3', from: FROM, type: 'text', text: { body: 'b' } },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(extractMessages(body)?.messages.map((m) => m.wamid)).toEqual([
      'w1',
      'w2',
      'w3',
    ]);
  });

  it('ignore les statuses[] (aucun message)', () => {
    expect(
      extractMessages(payload({ statuses: [{ id: 'w1', status: 'read' }] })),
    ).toEqual({ messages: [], invalidCount: 0 });
  });

  it('renvoie une liste vide pour un payload sans entrée', () => {
    expect(extractMessages({ entry: [] })).toEqual({
      messages: [],
      invalidCount: 0,
    });
  });

  it.each([
    ['null', null],
    ['un tableau', []],
    ['une chaîne', 'texte'],
    ['un objet sans entry', { object: 'whatsapp_business_account' }],
    ['entry non tableau', { entry: {} }],
    ['changes absent', { entry: [{}] }],
    ['value absent', { entry: [{ changes: [{}] }] }],
    ['messages non tableau', payload({ messages: {} })],
  ])(
    'renvoie null pour une structure globale inattendue : %s (PO-29)',
    (_l, body) => {
      expect(extractMessages(body)).toBeNull();
    },
  );

  it.each([
    ['sans id', { from: FROM, type: 'text' }],
    ['à id vide', { id: '', from: FROM, type: 'text' }],
    [
      'à id trop long',
      { id: 'w'.repeat(MAX_WAMID_LENGTH + 1), from: FROM, type: 'text' },
    ],
    ['sans from', { id: 'w9', type: 'text' }],
    ['à from vide', { id: 'w9', from: '', type: 'text' }],
    ['sans type', { id: 'w9', from: FROM }],
    ['non objet', 'texte'],
  ])('écarte un message %s et garde les autres (PO-29)', (_l, invalid) => {
    const valid = { id: 'w1', from: FROM, type: 'text', text: { body: 'a' } };

    expect(extractMessages(payload({ messages: [invalid, valid] }))).toEqual({
      messages: [{ wamid: 'w1', from: FROM, type: 'text', text: 'a' }],
      invalidCount: 1,
    });
  });

  it('accepte un wamid de 120 caractères', () => {
    const wamid = 'w'.repeat(MAX_WAMID_LENGTH);

    expect(
      extractMessages(
        payload({ messages: [{ id: wamid, from: FROM, type: 'image' }] }),
      ),
    ).toEqual({
      messages: [{ wamid, from: FROM, type: 'unsupported' }],
      invalidCount: 0,
    });
  });
});
