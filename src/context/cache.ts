import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let _db: Database.Database | null = null;

function getDB(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH ?? "./data/context.db";
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS repo_context (
      repo        TEXT PRIMARY KEY,
      summary     TEXT NOT NULL,
      tree        TEXT NOT NULL,
      indexed_sha TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_context (
      group_name  TEXT PRIMARY KEY,
      summary     TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  return _db;
}

export interface RepoContext {
  repo: string;
  summary: string;
  tree: string;
  indexedSha: string;
  updatedAt: number;
}

export interface GroupContext {
  groupName: string;
  summary: string;
  updatedAt: number;
}

export function getRepoContext(repo: string): RepoContext | null {
  const db = getDB();
  const row = db
    .prepare("SELECT * FROM repo_context WHERE repo = ?")
    .get(repo) as any;
  if (!row) return null;
  return {
    repo: row.repo,
    summary: row.summary,
    tree: row.tree,
    indexedSha: row.indexed_sha,
    updatedAt: row.updated_at,
  };
}

export function setRepoContext(ctx: RepoContext): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO repo_context (repo, summary, tree, indexed_sha, updated_at)
    VALUES (@repo, @summary, @tree, @indexedSha, @updatedAt)
    ON CONFLICT(repo) DO UPDATE SET
      summary = excluded.summary,
      tree = excluded.tree,
      indexed_sha = excluded.indexed_sha,
      updated_at = excluded.updated_at
  `).run(ctx);
}

export function getGroupContext(groupName: string): GroupContext | null {
  const db = getDB();
  const row = db
    .prepare("SELECT * FROM group_context WHERE group_name = ?")
    .get(groupName) as any;
  if (!row) return null;
  return {
    groupName: row.group_name,
    summary: row.summary,
    updatedAt: row.updated_at,
  };
}

export function setGroupContext(ctx: GroupContext): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO group_context (group_name, summary, updated_at)
    VALUES (@groupName, @summary, @updatedAt)
    ON CONFLICT(group_name) DO UPDATE SET
      summary = excluded.summary,
      updated_at = excluded.updated_at
  `).run(ctx);
}
