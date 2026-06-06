import test from 'node:test';
import assert from 'node:assert/strict';
import { readStore, resetForTests, writeStore } from '../src/db.js';
import { createApp } from '../src/server.js';
import { modulesForProfile } from '../src/profiles.js';
import { hashPin, DEFAULT_PROFILES } from '../src/profileDefaults.js';

async function withServer(fn) {
  await resetForTests();
  const app = createApp();
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('default profiles include family, justin, kari, cohen, hudson — not wife', async () => {
  const ids = DEFAULT_PROFILES.map(p => p.id);
  assert.deepEqual(ids, ['family', 'justin', 'kari', 'cohen', 'hudson']);
  assert.ok(!ids.includes('wife'), 'wife should not exist — it was renamed to kari');
});

test('kari and kids have pinHashes pre-seeded', () => {
  const kari = DEFAULT_PROFILES.find(p => p.id === 'kari');
  const cohen = DEFAULT_PROFILES.find(p => p.id === 'cohen');
  const hudson = DEFAULT_PROFILES.find(p => p.id === 'hudson');
  assert.equal(kari.pinHash, hashPin('1323'));
  assert.equal(cohen.pinHash, hashPin('1234'));
  assert.equal(hudson.pinHash, hashPin('1234'));
  assert.equal(DEFAULT_PROFILES.find(p => p.id === 'family').pinHash, null);
});

test('old stores normalize with default household profiles and future module data arrays', async () => {
  await writeStore({ tasks: [], groceryItems: [] });
  const store = await readStore();

  assert.ok(Array.isArray(store.profiles));
  assert.ok(store.profiles.some(p => p.id === 'family'));
  assert.ok(store.profiles.some(p => p.id === 'justin'));
  assert.ok(store.profiles.some(p => p.id === 'kari'), 'kari should exist');
  assert.ok(store.profiles.some(p => p.id === 'cohen'));
  assert.ok(store.profiles.some(p => p.id === 'hudson'));
  assert.ok(!store.profiles.some(p => p.id === 'wife'), 'wife should be migrated to kari');
  assert.ok(Array.isArray(store.modules));
  assert.ok(Array.isArray(store.tipEntries));
  assert.ok(Array.isArray(store.chatThreads));
  assert.ok(Array.isArray(store.chatMessages));
});

test('normalizeProfiles migrates wife profile id to kari', async () => {
  await writeStore({ profiles: [{ id: 'wife', name: 'Wife', color: '#f0abfc' }] });
  const store = await readStore();
  assert.ok(store.profiles.some(p => p.id === 'kari'));
  assert.ok(!store.profiles.some(p => p.id === 'wife'));
});

test('db migration converts wife profileId to kari in tipEntries and chatMessages', async () => {
  await writeStore({
    tipEntries: [{ id: 't1', profileId: 'wife', date: '2025-01-01', amount: 10 }],
    chatMessages: [{ id: 'm1', threadId: 'th1', profileId: 'wife', body: 'hi' }],
  });
  const store = await readStore();
  assert.equal(store.tipEntries[0].profileId, 'kari');
  assert.equal(store.chatMessages[0].profileId, 'kari');
});

test('profile-aware modules hide tips for Justin and show tips for Kari', async () => {
  await resetForTests();
  const justinModules = await modulesForProfile('justin');
  const kariModules = await modulesForProfile('kari');

  assert.equal(justinModules.some(m => m.id === 'tips'), false);
  assert.equal(kariModules.some(m => m.id === 'tips'), true);
  assert.ok(kariModules.some(m => m.href === '/tips'));
});

test('profile API defaults to family and can switch the active profile with a signed cookie', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/profile`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.profile.id, 'family');

    res = await fetch(`${base}/api/modules`);
    body = await res.json();
    assert.equal(body.profile.id, 'family');
    assert.equal(body.modules.some(m => m.id === 'tips'), false);

    res = await fetch(`${base}/api/profile/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'kari' }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /todo_profile=/);

    res = await fetch(`${base}/api/profile`, { headers: { cookie } });
    body = await res.json();
    assert.equal(body.profile.id, 'kari');

    res = await fetch(`${base}/api/modules`, { headers: { cookie } });
    body = await res.json();
    assert.equal(body.profile.id, 'kari');
    assert.ok(body.modules.some(m => m.id === 'tips'));
  });
});

test('profile/select with wife id is aliased to kari', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/profile/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'wife' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.profile.id, 'kari');
  });
});

test('invalid profile selections are rejected', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/profile/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: '../admin' }),
    });
    assert.equal(res.status, 400);
  });
});

test('malformed profile cookies safely fall back to family profile', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/profile`, { headers: { cookie: 'todo_profile=%E0%A4%A' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.profile.id, 'family');
  });
});

test('GET /api/profiles does not expose pinHash', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/profiles`);
    assert.equal(res.status, 200);
    const { profiles } = await res.json();
    assert.ok(profiles.length >= 5);
    profiles.forEach(p => assert.equal(p.pinHash, undefined, `${p.id} should not expose pinHash`));
  });
});

test('POST /api/auth/profile-login with correct PIN sets session and profile cookies', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/auth/profile-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'kari', pin: '1323' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.profile.id, 'kari');
    const cookies = res.headers.get('set-cookie');
    assert.ok(cookies?.includes('todo_session='), 'should set session cookie');
    assert.ok(cookies?.includes('todo_profile='), 'should set profile cookie');
  });
});

test('POST /api/auth/profile-login with wrong PIN returns 401', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/auth/profile-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'kari', pin: '9999' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /incorrect pin/i);
  });
});

test('POST /api/auth/profile-login for profile without PIN succeeds without pin', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/auth/profile-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'family' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.profile.id, 'family');
  });
});

test('POST /api/auth/profile-login for unknown profile returns 400', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/auth/profile-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'nobody' }),
    });
    assert.equal(res.status, 400);
  });
});

test('PATCH /api/profiles/:id/avatar stores and clears avatar', async () => {
  await withServer(async base => {
    const fakeAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    let res = await fetch(`${base}/api/profiles/justin/avatar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: fakeAvatar }),
    });
    assert.equal(res.status, 200);

    res = await fetch(`${base}/api/profiles`);
    const { profiles } = await res.json();
    const justin = profiles.find(p => p.id === 'justin');
    assert.equal(justin.avatar, fakeAvatar);

    res = await fetch(`${base}/api/profiles/justin/avatar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: null }),
    });
    assert.equal(res.status, 200);

    res = await fetch(`${base}/api/profiles`);
    const { profiles: p2 } = await res.json();
    assert.equal(p2.find(p => p.id === 'justin').avatar, null);
  });
});

test('PATCH /api/profiles/:id/avatar rejects non-image data URLs', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/profiles/justin/avatar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: 'data:text/html;base64,abc' }),
    });
    assert.equal(res.status, 400);
  });
});
