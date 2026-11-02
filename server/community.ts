import { randomInt, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  identity,
  contentHash,
  owned,
  CONSENT_VERSION,
  datasetRows,
  LEGACY_USER,
} from './studio-database';


export function registerCommunity(app: FastifyInstance, db: DatabaseSync, options: { legacyFeedback?: boolean } = {}) {
  async function verifyCaptcha(sessionHash: string, input: { id: string; answer: string }) {
    const row = db
      .prepare('SELECT * FROM captcha_challenges WHERE id=? AND session_hash=?')
      .get(input.id, sessionHash) as
      { expires_at: number; attempts: number; answer_hash: string } | undefined;
    if (!row || row.expires_at < Date.now() || row.attempts >= 3) return false;
    db.prepare('UPDATE captcha_challenges SET attempts=attempts+1 WHERE id=?').run(input.id);
    if (row.answer_hash === 'turnstile') {
      if (!process.env.TURNSTILE_SECRET_KEY) return false;
      try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: process.env.TURNSTILE_SECRET_KEY,
            response: input.answer,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const result = (await response.json()) as {
          success: boolean;
          action?: string;
          cdata?: string;
          hostname?: string;
        };
        if (
          !response.ok ||
          !result.success ||
          result.action !== 'studio' ||
          result.cdata !== input.id ||
          (process.env.APP_ORIGIN && result.hostname !== new URL(process.env.APP_ORIGIN).hostname)
        )
          return false;
      } catch {
        return false;
      }
    } else if (contentHash(input.id + ':' + input.answer) !== row.answer_hash) return false;
    db.prepare('DELETE FROM captcha_challenges WHERE id=?').run(input.id);
    return true;
  }
  app.get('/api/session', async (req) => {
    const user = identity(req);
    return {
      user: { id: user.id, name: user.name, kind: 'guest' },
      storage: 'local',
      authentication: 'browser-session',
    };
  });
  app.get('/api/captcha', async (req, reply) => {
    const user = identity(req),
      now = Date.now();
    db.prepare('DELETE FROM captcha_challenges WHERE expires_at<? OR attempts>=3').run(now);
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM captcha_challenges WHERE session_hash=?')
      .get(user.sessionHash) as { n: number };
    if (count.n >= 8)
      return reply.code(429).send({ error: 'Too many challenges. Wait a few minutes.' });
    const a = randomInt(2, 10),
      b = randomInt(1, 10),
      id = randomUUID();
    const turnstile = !!process.env.TURNSTILE_SITE_KEY && !!process.env.TURNSTILE_SECRET_KEY;
    if (process.env.CAPTCHA_PROVIDER === 'turnstile' && !turnstile)
      return reply.code(503).send({ error: 'Turnstile is not configured.' });
    db.prepare(
      'INSERT INTO captcha_challenges(id,session_hash,answer_hash,expires_at) VALUES(?,?,?,?)',
    ).run(
      id,
      user.sessionHash,
      turnstile ? 'turnstile' : contentHash(id + ':' + (a + b)),
      now + 5 * 60_000,
    );
    reply.header('Cache-Control', 'no-store');
    return turnstile
      ? { id, siteKey: process.env.TURNSTILE_SITE_KEY, expiresIn: 300, provider: 'turnstile' }
      : { id, question: `${a} + ${b}`, expiresIn: 300, provider: 'local-arithmetic' };
  });
  app.patch('/api/session', async (req, reply) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(60),
        captcha: z.object({ id: z.string().uuid(), answer: z.string().trim().max(2048) }),
      })
      .parse(req.body);
    if (!(await verifyCaptcha(identity(req).sessionHash, input.captcha)))
      return reply.code(400).send({ error: 'Complete the verification again.' });
    db.prepare('UPDATE users SET display_name=? WHERE id=?').run(input.name, identity(req).id);
    return { name: input.name };
  });
  app.get('/api/legacy-projects', async () => {
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id=?')
      .get(LEGACY_USER) as { count: number };
    return { count: row.count };
  });
  app.post('/api/legacy-projects/claim', async (req, reply) => {
    const input = z
      .object({ captcha: z.object({ id: z.string().uuid(), answer: z.string().trim().max(2048) }) })
      .parse(req.body);
    if (!(await verifyCaptcha(identity(req).sessionHash, input.captcha)))
      return reply.code(400).send({ error: 'Complete the verification again.' });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE projects SET user_id=? WHERE user_id=?').run(
        identity(req).id,
        LEGACY_USER,
      );
      db.prepare('UPDATE jobs SET user_id=? WHERE user_id=?').run(identity(req).id, LEGACY_USER);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { recovered: true };
  });
}
