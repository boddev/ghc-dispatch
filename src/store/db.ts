import Database from 'better-sqlite3';
import { paths, ensureDataDirs } from '../paths.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    ensureDataDirs();
    db = new Database(paths.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** For testing: create an in-memory database with the same schema */
export function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  runMigrations(testDb);
  return testDb;
}

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    sql: `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'normal',
      agent TEXT NOT NULL DEFAULT '@general-purpose',
      repo TEXT,
      working_directory TEXT,
      parent_task_id TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT 'cli',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      result TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority, created_at);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      task_id TEXT,
      payload TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      description TEXT NOT NULL,
      session_state TEXT NOT NULL DEFAULT '',
      artifacts TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      approvers TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      thread_id TEXT,
      speaker TEXT NOT NULL,
      speaker_type TEXT NOT NULL DEFAULT 'user',
      role TEXT NOT NULL DEFAULT 'user',
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversations(channel);
    CREATE INDEX IF NOT EXISTS idx_conv_thread ON conversations(thread_id);
    CREATE INDEX IF NOT EXISTS idx_conv_speaker ON conversations(speaker);
    CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_conv_channel_thread ON conversations(channel, thread_id);

    CREATE TABLE IF NOT EXISTS memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_slug TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'user',
      fact TEXT NOT NULL,
      source_channel TEXT,
      source_conversation_id INTEGER,
      confidence REAL NOT NULL DEFAULT 1.0,
      extracted_at TEXT NOT NULL,
      FOREIGN KEY (source_conversation_id) REFERENCES conversations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_facts_entity ON memory_facts(entity_slug);
    CREATE INDEX IF NOT EXISTS idx_facts_type ON memory_facts(entity_type);

    CREATE TABLE IF NOT EXISTS episodic_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      channel TEXT,
      thread_id TEXT,
      summary TEXT NOT NULL,
      topics TEXT NOT NULL DEFAULT '[]',
      entities TEXT NOT NULL DEFAULT '[]',
      decisions TEXT NOT NULL DEFAULT '[]',
      message_count INTEGER NOT NULL DEFAULT 0,
      first_message_id INTEGER,
      last_message_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_episodic_date ON episodic_summaries(date);
    CREATE INDEX IF NOT EXISTS idx_episodic_channel ON episodic_summaries(channel);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'user',
      source TEXT,
      source_url TEXT,
      dir_path TEXT NOT NULL,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_skills_origin ON skills(origin);
    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

    CREATE TABLE IF NOT EXISTS automation_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      schedule TEXT,
      webhook_path TEXT,
      event_type TEXT,
      action TEXT NOT NULL,
      action_config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_auto_type ON automation_jobs(type);
    CREATE INDEX IF NOT EXISTS idx_auto_enabled ON automation_jobs(enabled);
    CREATE INDEX IF NOT EXISTS idx_auto_next_run ON automation_jobs(next_run_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_webhook ON automation_jobs(webhook_path) WHERE webhook_path IS NOT NULL;
    `,
  },
  {
    version: 2,
    name: 'durable-scheduler-queue',
    sql: `
    CREATE TABLE IF NOT EXISTS scheduler_queue (
      task_id TEXT PRIMARY KEY,
      priority INTEGER NOT NULL,
      enqueued_at INTEGER NOT NULL,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      heartbeat_at INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_scheduler_queue_available
      ON scheduler_queue(lease_owner, lease_expires_at, priority, enqueued_at);
    CREATE INDEX IF NOT EXISTS idx_scheduler_queue_lease
      ON scheduler_queue(lease_owner, lease_expires_at);
    `,
  },
  {
    version: 3,
    name: 'agent-teams',
    sql: `
    CREATE TABLE IF NOT EXISTS agent_teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      lead_agent TEXT NOT NULL,
      member_agents TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_agent_teams_name ON agent_teams(name);
    CREATE INDEX IF NOT EXISTS idx_agent_teams_lead ON agent_teams(lead_agent);
    `,
  },
];

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const recordMigration = database.prepare(`
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (@version, @name, @appliedAt)
  `);

  for (const migration of MIGRATIONS) {
    if (hasMigration.get(migration.version)) continue;
    const tx = database.transaction(() => {
      database.exec(migration.sql);
      recordMigration.run({
        version: migration.version,
        name: migration.name,
        appliedAt: new Date().toISOString(),
      });
    });
    tx();
  }
}
