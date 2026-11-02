import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { migrateStudio, identities, sessionIdentity } from '../server/studio-database';
import { registerCommunity } from '../server/community';
it('local mode has session/project storage without collection tables or endpoints', async () => {
  const db = new DatabaseSync(':memory:');
  migrateStudio(db);
  const app = Fastify();
  app.addHook('onRequest', async (req, reply) => { identities.set(req, sessionIdentity(db, req, reply)); });
  registerCommunity(app, db);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    expect(tables).toContain('projects'); expect(tables).toContain('video_processing');
    for (const name of ['feedback', 'generation_reviews', 'generation_artifacts']) expect(tables).not.toContain(name);
    expect((await app.inject('/api/session')).statusCode).toBe(200);
    expect((await app.inject('/api/dataset')).statusCode).toBe(404);
    expect((await app.inject('/api/generations/00000000-0000-4000-8000-000000000002/feedback')).statusCode).toBe(404);
  } finally { await app.close(); db.close(); }
});
it('upgrading a historical database retains records while collection stays disabled', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateStudio(db, { legacyFeedback: true });
    db.prepare('INSERT INTO projects(id,name,updated,body) VALUES(?,?,?,?)').run('saved', 'Saved project', 'now', '{}');
    migrateStudio(db);
    expect(db.prepare('SELECT name FROM projects WHERE id=?').get('saved')?.name).toBe('Saved project');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='feedback'").get()).toBeTruthy();
  } finally { db.close(); }
});
