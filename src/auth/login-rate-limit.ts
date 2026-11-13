/** 5 tentatives de connexion par minute et par IP (DAT section 7). */
export const LOGIN_RATE_LIMIT = { limit: 5, ttl: 60_000 };

export const LOGIN_RATE_LIMIT_MESSAGE =
  'Trop de tentatives de connexion : réessayez dans une minute';
