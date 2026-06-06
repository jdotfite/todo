import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const fallbackDbPath = process.env.VERCEL ? '/tmp/todo.json' : './data/todo.json';
export const dbPath = resolve(process.env.TODO_DB || fallbackDbPath);
const kvKey = process.env.TODO_KV_KEY || 'todo:store';

import { normalizeProfiles } from './profileDefaults.js';

function emptyStore() {
  return {
    profiles: normalizeProfiles(),
    modules: [],
    tasks: [],
    groceryItems: [],
    tipEntries: [],
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
    chatThreads: Array.isArray(store?.chatThreads) ? store.chatThreads : [],
    chatMessages,
    chatReads,
  };
}

function kvEnabled() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
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
