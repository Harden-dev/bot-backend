import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { maskPhone } from '../../common/index.js';
import type { Env } from '../../config/index.js';

const GRAPH_API_BASE_URL = 'https://graph.facebook.com';
export const RETRY_DELAY_MS = 2_000;
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE_LENGTH = 20;
export const MAX_INTERACTIVE_BODY_LENGTH = 1_024;
const HTTP_SERVER_ERROR = 500;
/** Longueur maximale du corps de réponse Meta journalisé. */
export const MAX_LOGGED_RESPONSE_LENGTH = 1_000;
export const MAX_TEXT_BODY_LENGTH = 4_096;
export const MAX_BUTTON_ID_LENGTH = 256;

/** Bouton de réponse : `id` renvoyé par Meta au clic, `title` affiché. */
export interface ReplyButton {
  id: string;
  title: string;
}

/** Envoi refusé par Meta ou impossible (réseau), déjà journalisé. */
export class WhatsappSendError extends Error {
  constructor(readonly status?: number) {
    super(
      status === undefined
        ? 'Envoi WhatsApp impossible'
        : `Envoi WhatsApp refusé (HTTP ${status})`,
    );
    this.name = 'WhatsappSendError';
  }
}

function isRetryable(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return false;
  }
  return (
    error.response === undefined || error.response.status >= HTTP_SERVER_ERROR
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envoi de messages vers WhatsApp Cloud API. Erreur réseau ou 5xx : une
 * seule nouvelle tentative après 2 s ; 4xx : journalisée avec le corps de la
 * réponse de Meta, sans nouvelle tentative. Les journaux ne contiennent ni
 * le token, ni le contenu du message, et le destinataire est masqué.
 */
@Injectable()
export class WhatsappClient {
  private readonly logger = new Logger(WhatsappClient.name);
  private readonly url: string;
  private readonly token: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService<Env, true>,
  ) {
    const version = config.get('GRAPH_API_VERSION', { infer: true });
    const phoneNumberId = config.get('PHONE_NUMBER_ID', { infer: true });
    this.url = `${GRAPH_API_BASE_URL}/${version}/${phoneNumberId}/messages`;
    this.token = config.get('WHATSAPP_TOKEN', { infer: true });
  }

  /** `to` : numéro international sans `+`, tel que reçu dans `from`. */
  async sendText(to: string, body: string): Promise<void> {
    if (body.length > MAX_TEXT_BODY_LENGTH) {
      throw new RangeError(
        `Message texte limité à ${MAX_TEXT_BODY_LENGTH} caractères`,
      );
    }
    await this.send(to, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  }

  /** Message à boutons : 1 à 3 boutons, titre ≤ 20 caractères, corps ≤ 1 024. */
  async sendButtons(
    to: string,
    body: string,
    buttons: ReplyButton[],
  ): Promise<void> {
    assertButtonsLimits(body, buttons);
    await this.send(to, {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.map((reply) => ({ type: 'reply', reply })),
        },
      },
    });
  }

  private async send(to: string, payload: object): Promise<void> {
    try {
      await this.post(payload);
    } catch (error) {
      if (!isRetryable(error)) {
        throw this.toSendError(error, to);
      }
      this.logger.warn(
        `Envoi WhatsApp vers ${maskPhone(to)} en échec (${describeSendError(error)}), nouvelle tentative dans ${RETRY_DELAY_MS} ms`,
      );
      await delay(RETRY_DELAY_MS);
      try {
        await this.post(payload);
      } catch (retryError) {
        throw this.toSendError(retryError, to);
      }
    }
  }

  private async post(payload: object): Promise<void> {
    await firstValueFrom(
      this.http.post(this.url, payload, {
        headers: { Authorization: `Bearer ${this.token}` },
      }),
    );
  }

  private toSendError(error: unknown, to: string): WhatsappSendError {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    const responseBody = isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? null).slice(
          0,
          MAX_LOGGED_RESPONSE_LENGTH,
        )
      : 'null';
    this.logger.error(
      `Envoi WhatsApp vers ${maskPhone(to)} en échec (${describeSendError(error)}) ; réponse Meta : ${responseBody}`,
    );
    return new WhatsappSendError(status);
  }
}

/**
 * Description sûre d'une erreur d'envoi : statut HTTP ou code réseau, jamais
 * l'objet axios (sa configuration contient l'en-tête `Authorization`).
 */
function describeSendError(error: unknown): string {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error.name : 'erreur inconnue';
  }
  if (error.response !== undefined) {
    return `HTTP ${error.response.status}`;
  }
  return error.code ?? 'erreur réseau';
}

function isValidButton(button: ReplyButton): boolean {
  return (
    button.id.length > 0 &&
    button.id.length <= MAX_BUTTON_ID_LENGTH &&
    button.title.length > 0 &&
    button.title.length <= MAX_BUTTON_TITLE_LENGTH
  );
}

function assertButtonsLimits(body: string, buttons: ReplyButton[]): void {
  if (buttons.length === 0 || buttons.length > MAX_BUTTONS) {
    throw new RangeError(`Entre 1 et ${MAX_BUTTONS} boutons attendus`);
  }
  if (!buttons.every(isValidButton)) {
    throw new RangeError(
      `Bouton invalide : identifiant de 1 à ${MAX_BUTTON_ID_LENGTH} caractères, titre de 1 à ${MAX_BUTTON_TITLE_LENGTH} caractères`,
    );
  }
  if (new Set(buttons.map((button) => button.title)).size !== buttons.length) {
    throw new RangeError('Les titres des boutons doivent être uniques');
  }
  if (body.length > MAX_INTERACTIVE_BODY_LENGTH) {
    throw new RangeError(
      `Corps du message limité à ${MAX_INTERACTIVE_BODY_LENGTH} caractères`,
    );
  }
}
