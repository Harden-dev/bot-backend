import type { Level } from 'pino';
import type { Options } from 'pino-http';
import type { NodeEnv } from '../../config/index.js';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["x-hub-signature-256"]',
];

const LOG_LEVELS: Record<NodeEnv, Level | 'silent'> = {
  production: 'info',
  development: 'debug',
  test: 'silent',
};

interface SerializedRequest {
  url?: string;
  query?: unknown;
}

/**
 * Retire la chaîne de requête des logs : elle peut contenir le jeton de
 * vérification du webhook ou un téléphone client (recherche).
 */
export function stripQueryString<T extends SerializedRequest>(req: T): T {
  return { ...req, url: req.url?.split('?')[0], query: undefined };
}

export function buildPinoHttpOptions(nodeEnv: NodeEnv): Options {
  return {
    level: LOG_LEVELS[nodeEnv],
    redact: REDACTED_PATHS,
    serializers: { req: stripQueryString },
  };
}
