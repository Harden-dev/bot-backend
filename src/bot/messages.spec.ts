import {
  MAX_BUTTON_TITLE_LENGTH,
  MAX_TEXT_BODY_LENGTH,
} from '../whatsapp/client/index.js';
import {
  helpMessage,
  myOrdersMessage,
  NO_ORDERS_MESSAGE,
  ORDER_TEMPLATE,
  orderAlreadyRecordedMessage,
  orderConfirmedMessage,
  parseErrorsMessage,
  quote,
  RECAP_BUTTON_TITLES,
} from './messages.js';

describe('messages du bot', () => {
  it('reprend le modèle du DAT', () => {
    expect(ORDER_TEMPLATE).toBe(
      'Nom: Awa Koné\nTéléphone: 0707070707\nLieu: Cocody Angré 8e tranche\nArticles: 2 robes bleues x 15000, 1 sac noir x 8000',
    );
  });

  it('a des titres de boutons de 20 caractères au plus', () => {
    for (const title of Object.values(RECAP_BUTTON_TITLES)) {
      expect(title.length).toBeLessThanOrEqual(MAX_BUTTON_TITLE_LENGTH);
    }
  });

  it('formate la confirmation et la commande déjà enregistrée (DAT, PO-11)', () => {
    expect(orderConfirmedMessage('CMD-20261110-003')).toBe(
      'Commande CMD-20261110-003 enregistrée.',
    );
    expect(orderAlreadyRecordedMessage('CMD-20261110-003')).toBe(
      "La commande CMD-20261110-003 est déjà enregistrée. Pour la modifier ou l'annuler, contactez l'administration.",
    );
  });

  it('mentionne la durée de validité et la distinction Valider / Validée dans l’aide (PO-27)', () => {
    const help = helpMessage(30);
    expect(help).toContain('30 minutes');
    expect(help).toContain('« Non traitée »');
    expect(help).toContain('« Validée »');
    expect(help).toContain('vos 5 dernières commandes');
  });

  it('liste les commandes avec référence, statut et total', () => {
    expect(
      myOrdersMessage([
        {
          reference: 'CMD-20261110-003',
          status: 'non_traitee',
          totalAmount: 38_000,
        },
        { reference: 'CMD-20261109-001', status: 'echec', totalAmount: 8_000 },
      ]),
    ).toBe(
      [
        'Vos dernières commandes :',
        '• CMD-20261110-003 — Non traitée — 38 000 F',
        '• CMD-20261109-001 — Échec — 8 000 F',
      ].join('\n'),
    );
    expect(myOrdersMessage([])).toBe(NO_ORDERS_MESSAGE);
  });

  it('tronque une citation à 60 caractères', () => {
    expect(quote('court')).toBe('court');
    expect(quote('a'.repeat(61))).toBe(`${'a'.repeat(59)}…`);
  });

  it('ne coupe jamais un emoji à la limite de la citation', () => {
    const emoji = '👍🏽';
    expect(quote(`${'a'.repeat(59)}${emoji}`)).toBe(
      `${'a'.repeat(59)}${emoji}`,
    );
    expect(quote(`${'a'.repeat(58)}${emoji}bb`)).toBe(
      `${'a'.repeat(58)}${emoji}…`,
    );
    expect(quote(`${'a'.repeat(59)}${emoji}b`)).toBe(`${'a'.repeat(59)}…`);
  });

  describe('parseErrorsMessage', () => {
    it('liste les erreurs puis le modèle', () => {
      expect(parseErrorsMessage(['Erreur 1', 'Erreur 2'])).toBe(
        `Votre commande n'a pas pu être lue :\n- Erreur 1\n- Erreur 2\n\nCorrigez-la et renvoyez-la en suivant ce modèle :\n\n${ORDER_TEMPLATE}`,
      );
    });

    it('tronque la liste pour rester sous la limite d’un texte WhatsApp', () => {
      const errors = Array.from(
        { length: 200 },
        (_, i) => `Erreur ${i} ${'e'.repeat(50)}`,
      );
      const text = parseErrorsMessage(errors);
      expect(text.length).toBeLessThanOrEqual(MAX_TEXT_BODY_LENGTH);
      expect(text).toMatch(/- … et \d+ autre\(s\) erreur\(s\)\n/);
      expect(text.endsWith(ORDER_TEMPLATE)).toBe(true);
    });
  });
});
