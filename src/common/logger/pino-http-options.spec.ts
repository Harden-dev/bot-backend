import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { buildPinoHttpOptions, stripQueryString } from './pino-http-options.js';

const BEARER_TOKEN = 'jeton-jwt-secret';
const META_SIGNATURE = 'sha256=signature-meta-secrete';
const VERIFY_TOKEN = 'jeton-verification-secret';

/** Journalise une vraie requête HTTP avec la configuration de production. */
async function captureProductionRequestLog(): Promise<string> {
  let output = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logRequest = pinoHttp(buildPinoHttpOptions('production'), stream);
  const server = createServer((req, res) => {
    logRequest(req, res);
    res.end('ok');
  });

  await request(server)
    .get(
      `/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`,
    )
    .set('Authorization', `Bearer ${BEARER_TOKEN}`)
    .set('X-Hub-Signature-256', META_SIGNATURE)
    .set('Content-Type', 'application/json')
    .expect(200);
  await new Promise((resolve) => setImmediate(resolve));
  return output;
}

describe('buildPinoHttpOptions', () => {
  it.each([
    ['production', 'info'],
    ['development', 'debug'],
    ['test', 'silent'],
  ] as const)('utilise le niveau adapté à %s', (nodeEnv, level) => {
    expect(buildPinoHttpOptions(nodeEnv).level).toBe(level);
  });

  it('masque le jeton JWT, la signature Meta et hub.verify_token en production', async () => {
    const output = await captureProductionRequestLog();

    expect(output).toContain('/api/v1/whatsapp/webhook');
    expect(output).toContain('application/json');
    expect(output).not.toContain(BEARER_TOKEN);
    expect(output).not.toContain(META_SIGNATURE);
    expect(output).not.toContain(VERIFY_TOKEN);
    expect(output).not.toContain('hub.verify_token');
  });
});

describe('stripQueryString', () => {
  it('retire la chaîne de requête de l’URL et la requête analysée', () => {
    const req = {
      method: 'GET',
      url: '/api/v1/whatsapp/webhook?hub.verify_token=secret&hub.challenge=1',
      query: { 'hub.verify_token': 'secret' },
    };

    expect(stripQueryString(req)).toEqual({
      method: 'GET',
      url: '/api/v1/whatsapp/webhook',
      query: undefined,
    });
  });

  it('laisse une URL sans chaîne de requête inchangée', () => {
    expect(stripQueryString({ url: '/api/v1/orders' }).url).toBe(
      '/api/v1/orders',
    );
  });
});
