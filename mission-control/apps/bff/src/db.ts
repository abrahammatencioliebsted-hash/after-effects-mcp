import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Abre (y migra) el SQLite propio de MC. `:memory:` para pruebas.
 * Tablas: machines, machine_secrets, missions_meta, plans, notes, settings, idempotency, archived_agents, agent_meta.
 */
export function openDb(dataDir: string | ':memory:'): DatabaseSync {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true });
    file = join(dataDir, 'mc.sqlite');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      os TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      node_agent_version TEXT,
      last_seen_at INTEGER,
      health_json TEXT,
      hermes_json TEXT,
      allowed_commands_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS machine_secrets (
      machine_id TEXT PRIMARY KEY,
      secret_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS missions_meta (
      issue_id TEXT PRIMARY KEY,
      identifier TEXT,
      objective TEXT NOT NULL DEFAULT '',
      team_json TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      finish TEXT NOT NULL,
      scope TEXT NOT NULL,
      idea_id TEXT,
      target_date TEXT,
      title TEXT,
      required_caps_json TEXT NOT NULL DEFAULT '[]',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      status TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS plans_issue ON plans(issue_id);
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL,
      mission_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS archived_agents (
      agent_id TEXT PRIMARY KEY,
      archived_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_meta (
      agent_id TEXT PRIMARY KEY,
      machine_id TEXT,
      platform TEXT,
      short_name TEXT,
      model_label TEXT,
      effort TEXT
    );
  `);
  return db;
}

export type Db = DatabaseSync;
