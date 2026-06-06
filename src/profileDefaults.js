import { createHash } from 'node:crypto';

export function hashPin(pin) {
  return createHash('sha256').update(String(pin)).digest('hex');
}

export const DEFAULT_PROFILES = [
  {
    id: 'family',
    name: 'Family',
    color: '#ffd60a',
    role: 'household',
    enabledModules: ['home', 'calendar', 'grocery', 'documents', 'chat'],
    pinHash: null,
    avatar: null,
  },
  {
    id: 'justin',
    name: 'Justin',
    color: '#7dd3fc',
    role: 'adult',
    enabledModules: ['home', 'tasks', 'calendar', 'grocery', 'documents', 'chat'],
    pinHash: null,
    avatar: null,
  },
  {
    id: 'kari',
    name: 'Kari',
    color: '#f0abfc',
    role: 'adult',
    enabledModules: ['home', 'calendar', 'grocery', 'documents', 'tips', 'chat'],
    pinHash: hashPin('1323'),
    avatar: null,
  },
  {
    id: 'cohen',
    name: 'Cohen',
    color: '#86efac',
    role: 'child',
    enabledModules: ['home', 'grocery', 'chat'],
    pinHash: hashPin('1234'),
    avatar: null,
  },
  {
    id: 'hudson',
    name: 'Hudson',
    color: '#fb7185',
    role: 'child',
    enabledModules: ['home', 'grocery', 'chat'],
    pinHash: hashPin('1234'),
    avatar: null,
  },
];

const PROFILE_ALIAS = { wife: 'kari' };

function normalizeProfile(profile, fallback = {}) {
  const id = String(profile?.id || fallback.id || '').trim().toLowerCase();
  const now = new Date().toISOString();
  return {
    ...fallback,
    ...(profile && typeof profile === 'object' ? profile : {}),
    id,
    name: String(profile?.name || fallback.name || id || 'Profile'),
    color: String(profile?.color || fallback.color || '#ffd60a'),
    role: String(profile?.role || fallback.role || 'adult'),
    enabledModules: Array.isArray(profile?.enabledModules) ? profile.enabledModules
      : Array.isArray(fallback.enabledModules) ? fallback.enabledModules : ['home'],
    pinHash: profile?.pinHash !== undefined ? profile.pinHash : (fallback.pinHash ?? null),
    avatar: profile?.avatar !== undefined ? profile.avatar : (fallback.avatar ?? null),
    createdAt: profile?.createdAt || fallback.createdAt || now,
    updatedAt: profile?.updatedAt || fallback.updatedAt || now,
  };
}

export function normalizeProfiles(profiles) {
  const byId = new Map(DEFAULT_PROFILES.map(p => [p.id, normalizeProfile(p)]));
  if (Array.isArray(profiles)) {
    profiles.forEach(profile => {
      const raw = String(profile?.id || '').trim().toLowerCase();
      const id = PROFILE_ALIAS[raw] || raw;
      const fallback = byId.get(id) || {};
      const normalized = normalizeProfile({ ...profile, id }, fallback);
      if (normalized.id) byId.set(normalized.id, normalized);
    });
  }
  return [...byId.values()];
}
