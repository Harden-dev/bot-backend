import Joi from 'joi';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export const RECEIPT_FORMATS = ['A5', 'TICKET80'] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];
export type ReceiptFormat = (typeof RECEIPT_FORMATS)[number];

export interface Env {
  NODE_ENV: NodeEnv;
  PORT: number;
  TZ: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  CORS_ORIGIN: string;
  META_APP_SECRET: string;
  WEBHOOK_VERIFY_TOKEN: string;
  WHATSAPP_TOKEN: string;
  PHONE_NUMBER_ID: string;
  WABA_ID: string;
  GRAPH_API_VERSION: string;
  DRAFT_TTL_MINUTES: number;
  ADMIN_EMAIL: string;
  ADMIN_NAME: string;
  ADMIN_PASSWORD: string;
  RECEIPT_COMPANY_NAME: string;
  RECEIPT_FORMAT: ReceiptFormat;
}

const JWT_SECRET_MIN_LENGTH = 32;
const ADMIN_PASSWORD_MIN_LENGTH = 12;
// Origine CORS : schéma et hôte (port facultatif), sans chemin ni « / » final.
const ORIGIN_PATTERN = /^https?:\/\/[^/]+$/;
// Durée JWT au format `ms` avec unité obligatoire : un nombre seul serait lu
// en millisecondes (`28800` = jeton de 29 s).
const JWT_EXPIRES_IN_PATTERN = /^\d+(ms|s|m|h|d)$/;

export const envValidationSchema = Joi.object<Env, true>({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENVS)
    .required(),
  PORT: Joi.number().port().default(3000),
  TZ: Joi.string().required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['mysql'] })
    .required(),
  JWT_SECRET: Joi.string().min(JWT_SECRET_MIN_LENGTH).required(),
  JWT_EXPIRES_IN: Joi.string().pattern(JWT_EXPIRES_IN_PATTERN).default('8h'),
  CORS_ORIGIN: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .pattern(ORIGIN_PATTERN)
    .required(),
  META_APP_SECRET: Joi.string().required(),
  WEBHOOK_VERIFY_TOKEN: Joi.string().required(),
  WHATSAPP_TOKEN: Joi.string().required(),
  PHONE_NUMBER_ID: Joi.string().required(),
  WABA_ID: Joi.string().required(),
  GRAPH_API_VERSION: Joi.string()
    .pattern(/^v\d+\.\d+$/)
    .required(),
  DRAFT_TTL_MINUTES: Joi.number().integer().min(1).default(30),
  ADMIN_EMAIL: Joi.string().email().required(),
  ADMIN_NAME: Joi.string().required(),
  ADMIN_PASSWORD: Joi.string().min(ADMIN_PASSWORD_MIN_LENGTH).required(),
  RECEIPT_COMPANY_NAME: Joi.string().required(),
  RECEIPT_FORMAT: Joi.string()
    .valid(...RECEIPT_FORMATS)
    .default('A5'),
});
