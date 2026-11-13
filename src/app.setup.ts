import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Env } from './config/index.js';

export const API_PREFIX = 'api/v1';
/** Hors préfixe `api/v1` : jamais transmis par Nginx (proxy limité à `/api/v1/`). */
export const SWAGGER_PATH = 'api/docs';
const JSON_BODY_LIMIT = '256kb';

/** En-têtes de sécurité de toutes les réponses (B-03), sans dépendance. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
/** API JSON/PDF uniquement : aucune ressource à charger, aucun cadre. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'";

/**
 * Pose les en-têtes de sécurité. La CSP n'est pas posée sur l'interface
 * Swagger (`/api/docs*`, montée hors production seulement), qui charge ses
 * scripts et styles.
 */
function securityHeaders(swaggerEnabled: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.set(SECURITY_HEADERS);
    if (!(swaggerEnabled && req.path.startsWith(`/${SWAGGER_PATH}`))) {
      res.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    }
    next();
  };
}

/** Configuration HTTP commune à `main.ts` et aux tests e2e. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const swaggerEnabled =
    config.get('NODE_ENV', { infer: true }) !== 'production';

  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.use(securityHeaders(swaggerEnabled));
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }) });
  if (swaggerEnabled) {
    setupSwagger(app);
  }
}

/**
 * Swagger sur `/api/docs` (JSON : `/api/docs-json`). Le document est construit
 * à la première consultation, à partir des seuls décorateurs : aucune valeur
 * de configuration n'y figure.
 */
function setupSwagger(app: NestExpressApplication): void {
  const options = new DocumentBuilder()
    .setTitle('API commandes WhatsApp')
    .setDescription(
      'Backoffice : JWT Bearer obtenu par POST /api/v1/auth/login. Routes publiques : login, webhook WhatsApp (signature Meta), health.',
    )
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(SWAGGER_PATH, app, () =>
    SwaggerModule.createDocument(app, options),
  );
}
