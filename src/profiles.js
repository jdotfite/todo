import { createHmac, timingSafeEqual } from 'node:crypto';
import { modules } from './modules/registry.js';
import { readStore, writeStore, nowIso } from './db.js';
import { DEFAULT_PROFILES, normalizeProfiles } from './profileDefaults.js';

export { DEFAULT_PROFILES, normalizeProfiles } from './profileDefaults.js';

export const PROFILE_COOKIE = 'todo_profile';
export const PROFILE_MAX_AGE = 60 * 60 * 24 * 365;

const PROFILE_ALIAS = { wife: 'kari' };

function secret() {
  return process.env.AUTH_SECRET || process.env.HOUSEHOLD_PIN || process.env.HOUSEHOLD_PASSWORD || 'local-dev-secret';
}

function sign(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function decodeCookieValue(value) {
  try { return decodeURIComponent(value); } catch { return ''; }
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeCookieValue(part.slice(index + 1))];
  }));
}

export async function listProfiles() {
  const store = await readStore();
  return normalizeProfiles(store.profiles);
}

export async function findProfile(profileId) {
  const raw = String(profileId || '').trim().toLowerCase();
  const id = PROFILE_ALIAS[raw] || raw;
  const profiles = await listProfiles();
  return profiles.find(p => p.id === id) || null;
}

export function profileCookieValue(profileId) {
  const payload = String(profileId).trim().toLowerCase();
  return `${payload}.${sign(payload)}`;
}

export function selectedProfileId(req) {
  const value = parseCookies(req)[PROFILE_COOKIE];
  if (!value) return 'family';
  const parts = String(value).split('.');
  if (parts.length !== 2) return 'family';
  const [profileId, signature] = parts;
  if (!profileId || !safeEqual(signature, sign(profileId))) return 'family';
  const id = PROFILE_ALIAS[profileId] || profileId;
  return id;
}

export async function activeProfile(req) {
  return (await findProfile(selectedProfileId(req))) || (await findProfile('family'));
}

export async function modulesForProfile(profileId) {
  const profile = (await findProfile(profileId)) || (await findProfile('family'));
  const enabled = new Set(profile.enabledModules || []);
  return modules.filter(m => enabled.has(m.id) && (!m.profiles || m.profiles.includes(profile.id)));
}

export async function activeModules(req) {
  const profile = await activeProfile(req);
  return { profile, modules: await modulesForProfile(profile.id) };
}

export function registerProfileRoutes(app) {
  app.get('/api/profiles', async (_req, res, next) => {
    try {
      const profiles = await listProfiles();
      res.json({ profiles: profiles.map(p => ({ ...p, pinHash: undefined })) });
    } catch (err) { next(err); }
  });

  app.get('/api/profile', async (req, res, next) => {
    try {
      const profile = await activeProfile(req);
      res.json({ profile: { ...profile, pinHash: undefined } });
    } catch (err) { next(err); }
  });

  app.post('/api/profile/select', async (req, res, next) => {
    try {
      const profile = await findProfile(req.body?.profileId);
      if (!profile) return res.status(400).json({ error: 'Unknown profile' });
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${PROFILE_COOKIE}=${encodeURIComponent(profileCookieValue(profile.id))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PROFILE_MAX_AGE}${secure}`);
      res.json({ ok: true, profile: { ...profile, pinHash: undefined } });
    } catch (err) { next(err); }
  });

  app.patch('/api/profiles/:id/avatar', async (req, res, next) => {
    try {
      const profile = await findProfile(req.params.id);
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      const { avatar } = req.body;
      if (avatar !== null && avatar !== undefined) {
        if (typeof avatar !== 'string') return res.status(400).json({ error: 'avatar must be a string or null' });
        if (avatar && !avatar.startsWith('data:image/')) return res.status(400).json({ error: 'avatar must be an image data URL' });
        if (avatar && Buffer.byteLength(avatar, 'utf8') > 500_000) return res.status(400).json({ error: 'Avatar too large (max 500KB)' });
      }
      const store = await readStore();
      const idx = store.profiles.findIndex(p => p.id === profile.id);
      if (idx !== -1) {
        store.profiles[idx] = { ...store.profiles[idx], avatar: avatar || null, updatedAt: nowIso() };
      }
      await writeStore(store);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  app.get('/api/modules', async (req, res, next) => {
    try { res.json(await activeModules(req)); } catch (err) { next(err); }
  });
}
