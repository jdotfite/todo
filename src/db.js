import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const fallbackDbPath = process.env.VERCEL ? '/tmp/todo.json' : './data/todo.json';
export const dbPath = resolve(process.env.TODO_DB || fallbackDbPath);
const kvKey = process.env.TODO_KV_KEY || 'todo:store';
const postgresKey = process.env.TODO_POSTGRES_KEY || 'todo:store';
let postgresSql;

function postgresConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

function postgresEnabled() {
  return Boolean(postgresConnectionString());
}

async function getPostgresSql() {
  if (!postgresSql) {
    const { neon } = await import('@neondatabase/serverless');
    postgresSql = neon(postgresConnectionString());
  }
  return postgresSql;
}

import { normalizeProfiles } from './profileDefaults.js';

function emptyStore() {
  return {
    profiles: normalizeProfiles(),
    modules: [],
    tasks: [],
    groceryItems: [],
    tipEntries: [],
    workEntries: [],
    workSettings: {
      defaultCommissionRate: 0.1,
      serviceRateRules: [],
      tipTypes: ['Cash', 'Tippy', 'Venmo', 'Other'],
    },
    workImportBatches: [],
    chatThreads: [],
    chatMessages: [],
    chatReads: [],
  };
}

const PROFILE_LEGACY = { wife: 'kari' };
function migrateProfileId(id) { return PROFILE_LEGACY[id] || id; }

function normalizeStore(store) {
  const tipEntries = (Array.isArray(store?.tipEntries) ? store.tipEntries : [])
    .map(e => e.profileId && PROFILE_LEGACY[e.profileId] ? { ...e, profileId: migrateProfileId(e.profileId) } : e);
  const workEntries = (Array.isArray(store?.workEntries) ? store.workEntries : [])
    .map(e => e.profileId && PROFILE_LEGACY[e.profileId] ? { ...e, profileId: migrateProfileId(e.profileId) } : e);
  const chatMessages = (Array.isArray(store?.chatMessages) ? store.chatMessages : [])
    .map(m => m.profileId && PROFILE_LEGACY[m.profileId] ? { ...m, profileId: migrateProfileId(m.profileId) } : m);
  const chatReads = (Array.isArray(store?.chatReads) ? store.chatReads : [])
    .map(r => r.profileId && PROFILE_LEGACY[r.profileId] ? { ...r, profileId: migrateProfileId(r.profileId) } : r);
  return {
    ...emptyStore(),
    ...(store && typeof store === 'object' ? store : {}),
    profiles: normalizeProfiles(store?.profiles),
    modules: Array.isArray(store?.modules) ? store.modules : [],
    tasks: Array.isArray(store?.tasks) ? store.tasks : [],
    groceryItems: Array.isArray(store?.groceryItems) ? store.groceryItems : [],
    tipEntries,
    workEntries,
    workSettings: store?.workSettings && typeof store.workSettings === 'object' ? store.workSettings : emptyStore().workSettings,
    workImportBatches: Array.isArray(store?.workImportBatches) ? store.workImportBatches : [],
    chatThreads: Array.isArray(store?.chatThreads) ? store.chatThreads : [],
    chatMessages,
    chatReads,
  };
}

function kvEnabled() {
  return !postgresEnabled() && Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvRequest(command, ...args) {
  const base = process.env.KV_REST_API_URL.replace(/\/$/, '');
  const path = [command, ...args.map(arg => encodeURIComponent(arg))].join('/');
  const res = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV ${command} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function migrate() {
  if (postgresEnabled()) {
    const sql = await getPostgresSql();
    await sql`
      CREATE TABLE IF NOT EXISTS app_store (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      INSERT INTO app_store (key, value)
      VALUES (${postgresKey}, ${JSON.stringify(emptyStore())}::jsonb)
      ON CONFLICT (key) DO NOTHING
    `;
    return;
  }
  if (kvEnabled()) {
    const { result } = await kvRequest('get', kvKey);
    if (!result) await writeStore(emptyStore());
    return;
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  if (!existsSync(dbPath)) await writeStore(emptyStore());
}

export async function readStore() {
  try {
    if (postgresEnabled()) {
      const sql = await getPostgresSql();
      const rows = await sql`SELECT value FROM app_store WHERE key = ${postgresKey} LIMIT 1`;
      if (!rows.length) return emptyStore();
      return normalizeStore(rows[0].value);
    }
    if (kvEnabled()) {
      const { result } = await kvRequest('get', kvKey);
      if (!result) return emptyStore();
      return normalizeStore(typeof result === 'string' ? JSON.parse(result) : result);
    }
    await migrate();
    return normalizeStore(JSON.parse(await readFile(dbPath, 'utf8')));
  } catch {
    return emptyStore();
  }
}

export async function writeStore(store) {
  const normalized = normalizeStore(store);
  if (postgresEnabled()) {
    const sql = await getPostgresSql();
    await sql`
      INSERT INTO app_store (key, value, updated_at)
      VALUES (${postgresKey}, ${JSON.stringify(normalized)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `;
    return;
  }
  if (kvEnabled()) {
    await kvRequest('set', kvKey, JSON.stringify(normalized));
    return;
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.tmp`;
  const json = JSON.stringify(normalized, null, 2);
  await writeFile(tmp, json);
  await writeFile(dbPath, json);
}

export async function resetForTests() {
  await writeStore(emptyStore());
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

await migrate();
