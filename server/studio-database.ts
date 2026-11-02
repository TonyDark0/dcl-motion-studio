import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export const CONSENT_VERSION = 'motion-dataset-v1';
const LEGACY_USER = '00000000-0000-4000-8000-000000000001';
const SESSION_AGE = 90 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Additive migrations retain existing projects and generations. */
export function migrateStudio(db: DatabaseSync, options: { legacyFeedback?: boolean } = {}) {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'guest', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT,updated TEXT,body TEXT);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,prompt TEXT,status TEXT,error TEXT,created TEXT);
  `);
  if (!db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      db.prepare('INSERT OR IGNORE INTO users VALUES(?,?,?,?)').run(
        LEGACY_USER,
        'Local creator',
        'guest',
        now,
      );
      for (const table of ['projects', 'jobs']) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
        if (!columns.some((c) => c.name === 'user_id'))
          db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT REFERENCES users(id)`);
        db.prepare(`UPDATE ${table} SET user_id=? WHERE user_id IS NULL`).run(LEGACY_USER);
        db.exec(`CREATE INDEX IF NOT EXISTS ${table}_owner ON ${table}(user_id)`);
      }
      db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(now);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS generations(
      id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      workflow TEXT NOT NULL CHECK(workflow IN ('text','video')),
      provider TEXT NOT NULL, request_json TEXT NOT NULL,
      model_json TEXT NOT NULL, created_at TEXT NOT NULL,
      artifact_hash TEXT, completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS generations_owner ON generations(user_id,created_at);
    CREATE TABLE IF NOT EXISTS captcha_challenges(
      id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      answer_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Historical exports only. Local Studio does not collect ratings or dataset snapshots.
  // Existing tables are deliberately retained, never dropped during an upgrade.
  if (options.legacyFeedback) db.exec(`
    CREATE TABLE IF NOT EXISTS feedback(
      generation_id TEXT PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
      issues_json TEXT NOT NULL, comment TEXT NOT NULL,
      dataset_consent INTEGER NOT NULL CHECK(dataset_consent IN (0,1)),
      consent_version TEXT NOT NULL, consent_at TEXT,
      snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS generations_owner ON generations(user_id,created_at);
    CREATE TABLE IF NOT EXISTS generation_artifacts(
      generation_id TEXT PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
      motion_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feedback_dataset ON feedback(dataset_consent,score);
    CREATE TABLE IF NOT EXISTS captcha_challenges(
      id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      answer_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(2,?)').run(new Date().toISOString());
  db.exec(`CREATE TABLE IF NOT EXISTS video_processing(
    generation_id TEXT PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
    capture_ms REAL NOT NULL DEFAULT 0,
    generation_ms REAL NOT NULL DEFAULT 0,
    total_ms REAL NOT NULL DEFAULT 0,
    reference_ready INTEGER NOT NULL DEFAULT 0 CHECK(reference_ready IN (0,1))
  )`);
  db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(3,?)').run(new Date().toISOString());
  if (options.legacyFeedback) db.exec(`CREATE TABLE IF NOT EXISTS generation_reviews(
    generation_id TEXT PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
    review_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  if (options.legacyFeedback)
    db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(4,?)').run(new Date().toISOString());
}

export type StudioIdentity = { id: string; name: string; sessionHash: string };
export function sessionIdentity(
  db: DatabaseSync,
  req: FastifyRequest,
  reply: FastifyReply,
): StudioIdentity {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('dcl_session='))
    ?.slice(12);
  if (cookie && /^[a-f0-9]{64}$/.test(cookie)) {
    const row = db
      .prepare(
        'SELECT u.id,u.display_name AS name,s.token_hash AS sessionHash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
      )
      .get(hash(cookie), Date.now()) as StudioIdentity | undefined;
    if (row) return row;
  }
  const token = randomBytes(32).toString('hex'),
    sessionHash = hash(token);
  const userId = randomUUID();
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(
    userId,
    'Creator',
    'guest',
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
    sessionHash,
    userId,
    Date.now() + SESSION_AGE,
  );
  reply.header(
    'Set-Cookie',
    `dcl_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE / 1000}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
  );
  return { id: userId, name: 'Creator', sessionHash };
}
export const identities = new WeakMap<FastifyRequest, StudioIdentity>();
export const identity = (req: FastifyRequest) => {
  const result = identities.get(req);
  if (!result) throw Error('Missing studio session');
  return result;
};

export function owned(
  db: DatabaseSync,
  table: 'projects' | 'jobs' | 'generations',
  id: string,
  userId: string,
) {
  return !!db.prepare(`SELECT id FROM ${table} WHERE id=? AND user_id=?`).get(id, userId);
}

/** Dataset records omit accounts, filenames, photographs, video and raw detector observations. */
export function datasetRows(db: DatabaseSync, userId?: string) {
  const rows = db
    .prepare(
      `SELECT g.id,g.workflow,g.provider,g.request_json,g.model_json,g.artifact_hash,f.score,f.issues_json,f.comment,f.consent_version,f.consent_at,f.snapshot_json,f.updated_at
    ,a.motion_json,r.review_json FROM generations g JOIN feedback f ON f.generation_id=g.id JOIN jobs j ON j.id=g.id JOIN generation_artifacts a ON a.generation_id=g.id LEFT JOIN generation_reviews r ON r.generation_id=g.id
    WHERE f.dataset_consent=1 AND j.status='completed' AND g.artifact_hash IS NOT NULL ${userId ? 'AND g.user_id=?' : ''} ORDER BY g.created_at`,
    )
    .all(...(userId ? [userId] : [])) as Record<string, any>[];
  return rows.map((r) => ({
    schemaVersion: 1,
    generationId: r.id,
    workflow: r.workflow,
    provider: r.provider,
    request: JSON.parse(r.request_json),
    model: JSON.parse(r.model_json),
    artifactHash: r.artifact_hash,
    rating: {
      score: r.score,
      issues: JSON.parse(r.issues_json),
      comment: r.comment,
      updatedAt: r.updated_at,
    },
    consent: { version: r.consent_version, acceptedAt: r.consent_at },
    generatedMotion: JSON.parse(r.motion_json),
    reviewedReference: r.review_json ? JSON.parse(r.review_json) : null,
    animation: JSON.parse(r.snapshot_json),
  }));
}

export { hash as contentHash };
export { LEGACY_USER };
