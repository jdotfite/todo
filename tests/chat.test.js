import test from 'node:test';
import assert from 'node:assert/strict';
import { resetForTests } from '../src/db.js';
import { createApp } from '../src/server.js';
import {
  listThreads,
  createThread,
  updateThread,
  deleteThread,
  listMessages,
  postMessage,
  deleteMessage,
  getRecentMessages,
  markThreadRead,
} from '../src/modules/chat/data.js';

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

// --- Data layer: threads ---

test('chat threads can be created, listed, updated, and deleted', async () => {
  await resetForTests();

  const thread = await createThread({ title: 'General' });
  assert.ok(thread.id);
  assert.equal(thread.title, 'General');
  assert.equal(thread.pinned, false);
  assert.ok(thread.createdAt);

  let threads = await listThreads();
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, thread.id);
  assert.equal(threads[0].messageCount, 0);

  const updated = await updateThread(thread.id, { title: 'Family Chat', pinned: true });
  assert.equal(updated.title, 'Family Chat');
  assert.equal(updated.pinned, true);

  await deleteThread(thread.id);
  threads = await listThreads();
  assert.equal(threads.length, 0);
});

test('createThread rejects missing or blank title', async () => {
  await resetForTests();
  await assert.rejects(() => createThread({}), { message: /title/ });
  await assert.rejects(() => createThread({ title: '   ' }), { message: /title/ });
  await assert.rejects(() => createThread({ title: 'x'.repeat(121) }), { message: /120/ });
});

test('threads are sorted: pinned first, then by most recent activity', async () => {
  await resetForTests();

  const a = await createThread({ title: 'Alpha' });
  const b = await createThread({ title: 'Beta', pinned: true });
  const c = await createThread({ title: 'Gamma' });

  await postMessage(c.id, { profileId: 'family', body: 'Hello' });

  const threads = await listThreads();
  assert.equal(threads[0].id, b.id, 'pinned thread is first');
  assert.equal(threads[1].id, c.id, 'thread with latest message is next');
  assert.equal(threads[2].id, a.id, 'oldest inactive thread is last');
});

test('thread list includes latest message preview metadata', async () => {
  await resetForTests();
  const thread = await createThread({ title: 'Dinner' });

  await postMessage(thread.id, { profileId: 'justin', body: 'First idea' });
  await postMessage(thread.id, { profileId: 'kari', body: 'Latest dinner plan for tonight' });

  const [listed] = await listThreads();
  assert.equal(listed.id, thread.id);
  assert.equal(listed.messageCount, 2);
  assert.equal(listed.lastMessage.body, 'Latest dinner plan for tonight');
  assert.equal(listed.lastMessage.profileId, 'kari');
  assert.ok(listed.lastMessage.createdAt);
});

test('thread list exposes profile-aware unread counts and markThreadRead clears them', async () => {
  await resetForTests();
  const thread = await createThread({ title: 'Updates' });

  await postMessage(thread.id, { profileId: 'justin', body: 'My own note' });
  await postMessage(thread.id, { profileId: 'kari', body: 'Please read this' });

  let [listed] = await listThreads({ profileId: 'justin' });
  assert.equal(listed.unreadCount, 1);
  assert.equal(listed.hasUnread, true);

  await markThreadRead(thread.id, 'justin');
  [listed] = await listThreads({ profileId: 'justin' });
  assert.equal(listed.unreadCount, 0);
  assert.equal(listed.hasUnread, false);
  assert.ok(listed.lastReadAt);

  await postMessage(thread.id, { profileId: 'kari', body: 'One more thing' });
  [listed] = await listThreads({ profileId: 'justin' });
  assert.equal(listed.unreadCount, 1);

  const displayedBoundary = listed.lastReadAt;
  await postMessage(thread.id, { profileId: 'kari', body: 'Message after displayed snapshot' });
  await markThreadRead(thread.id, 'justin', { lastReadAt: displayedBoundary });
  [listed] = await listThreads({ profileId: 'justin' });
  assert.equal(listed.unreadCount, 2);

  await assert.rejects(
    () => markThreadRead(thread.id, 'justin', { lastReadAt: 'not-a-date' }),
    { status: 400 }
  );
  await assert.rejects(
    () => markThreadRead(thread.id, 'justin', { lastReadAt: '9999-01-01T00:00:00.000Z' }),
    { status: 400 }
  );
});

test('deleteThread also removes its messages', async () => {
  await resetForTests();

  const thread = await createThread({ title: 'Temp' });
  await postMessage(thread.id, { profileId: 'family', body: 'Will be deleted' });

  await deleteThread(thread.id);

  const threads = await listThreads();
  assert.equal(threads.length, 0);
});

test('updateThread and deleteThread throw 404 for unknown id', async () => {
  await resetForTests();
  await assert.rejects(() => updateThread('no-such', { title: 'X' }), { message: /not found/i });
  await assert.rejects(() => deleteThread('no-such'), { message: /not found/i });
});

// --- Data layer: messages ---

test('messages can be posted, listed, and deleted within a thread', async () => {
  await resetForTests();

  const thread = await createThread({ title: 'Chat' });
  const msg = await postMessage(thread.id, { profileId: 'justin', body: 'Hello household!' });

  assert.ok(msg.id);
  assert.equal(msg.threadId, thread.id);
  assert.equal(msg.profileId, 'justin');
  assert.equal(msg.body, 'Hello household!');

  const messages = await listMessages(thread.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, msg.id);

  const threads = await listThreads();
  assert.equal(threads[0].messageCount, 1);

  await deleteMessage(thread.id, msg.id);
  const after = await listMessages(thread.id);
  assert.equal(after.length, 0);
});

test('postMessage rejects blank body', async () => {
  await resetForTests();
  const thread = await createThread({ title: 'Chat' });
  await assert.rejects(() => postMessage(thread.id, { profileId: 'family', body: '' }), { message: /body/ });
  await assert.rejects(() => postMessage(thread.id, { profileId: 'family', body: 'x'.repeat(2001) }), { message: /2000/ });
});

test('postMessage falls back to family for unknown profileId', async () => {
  await resetForTests();
  const thread = await createThread({ title: 'Chat' });
  const msg = await postMessage(thread.id, { profileId: 'hacker', body: 'Hi' });
  assert.equal(msg.profileId, 'family');
});

test('postMessage to unknown thread throws 404', async () => {
  await resetForTests();
  await assert.rejects(() => postMessage('no-such', { profileId: 'family', body: 'Hi' }), { message: /not found/i });
});

test('messages within a thread are returned oldest-first', async () => {
  await resetForTests();
  const thread = await createThread({ title: 'Chat' });
  await postMessage(thread.id, { profileId: 'justin', body: 'First' });
  await postMessage(thread.id, { profileId: 'kari', body: 'Second' });
  await postMessage(thread.id, { profileId: 'family', body: 'Third' });

  const messages = await listMessages(thread.id);
  assert.deepEqual(messages.map(m => m.body), ['First', 'Second', 'Third']);
});

// --- API layer ---

test('GET /api/chat/threads returns empty list initially', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/chat/threads`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.threads, []);
  });
});

test('full thread + message API flow', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Reminders' }),
    });
    assert.equal(res.status, 201);
    const { thread } = await res.json();
    assert.equal(thread.title, 'Reminders');

    res = await fetch(`${base}/api/chat/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Doctor appt Friday 3pm' }),
    });
    assert.equal(res.status, 201);
    const { message } = await res.json();
    assert.equal(message.body, 'Doctor appt Friday 3pm');
    assert.equal(message.profileId, 'family');

    res = await fetch(`${base}/api/chat/threads/${thread.id}/messages`);
    assert.equal(res.status, 200);
    const msgs = (await res.json()).messages;
    assert.equal(msgs.length, 1);

    res = await fetch(`${base}/api/chat/threads/${thread.id}/messages/${message.id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { removed: 1 });
  });
});

test('PATCH /api/chat/threads/:id can pin a thread', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Notes' }),
    });
    const { thread } = await res.json();
    assert.equal(thread.pinned, false);

    res = await fetch(`${base}/api/chat/threads/${thread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.thread.pinned, true);
  });
});

test('POST /api/chat/threads returns 400 for missing title', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

test('POST message returns 400 for missing body', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Chat' }),
    });
    const { thread } = await res.json();

    res = await fetch(`${base}/api/chat/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/chat/threads/:id/read clears unread for active profile', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Read state' }),
    });
    const { thread } = await res.json();

    await fetch(`${base}/api/chat/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Family message' }),
    });

    res = await fetch(`${base}/api/profile/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: 'justin' }),
    });
    const cookie = res.headers.get('set-cookie');

    res = await fetch(`${base}/api/chat/threads`, { headers: { cookie } });
    let [{ unreadCount }] = (await res.json()).threads;
    assert.equal(unreadCount, 1);

    res = await fetch(`${base}/api/chat/threads/${thread.id}/read`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);

    res = await fetch(`${base}/api/chat/threads`, { headers: { cookie } });
    [{ unreadCount }] = (await res.json()).threads;
    assert.equal(unreadCount, 0);
  });
});

test('chat API requires household auth when enabled', async () => {
  const previousPassword = process.env.HOUSEHOLD_PASSWORD;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.HOUSEHOLD_PASSWORD = 'family-pass';
  process.env.AUTH_SECRET = 'test-auth-secret';

  await resetForTests();
  const app = createApp();
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    let res = await fetch(`${base}/api/chat/threads`);
    assert.equal(res.status, 401);

    res = await fetch(`${base}/api/chat/recent`);
    assert.equal(res.status, 401);

    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'family-pass' }),
    });
    const cookie = res.headers.get('set-cookie');

    res = await fetch(`${base}/api/chat/threads`, { headers: { cookie } });
    assert.equal(res.status, 200);
  } finally {
    if (previousPassword === undefined) delete process.env.HOUSEHOLD_PASSWORD; else process.env.HOUSEHOLD_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
    server.close();
  }
});

// --- getRecentMessages ---

test('getRecentMessages returns messages newest-first with threadTitle attached', async () => {
  await resetForTests();
  const thread = await createThread({ title: 'General' });
  await postMessage(thread.id, { profileId: 'justin', body: 'First' });
  await postMessage(thread.id, { profileId: 'kari', body: 'Second' });

  const recent = await getRecentMessages(5);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].body, 'Second');
  assert.equal(recent[0].threadTitle, 'General');
  assert.equal(recent[1].body, 'First');
});

test('getRecentMessages respects limit and caps at 20', async () => {
  await resetForTests();
  const thread = await createThread({ title: 'Busy' });
  for (let i = 0; i < 10; i++) {
    await postMessage(thread.id, { profileId: 'family', body: `msg ${i}` });
  }
  const three = await getRecentMessages(3);
  assert.equal(three.length, 3);
  const capped = await getRecentMessages(999);
  assert.equal(capped.length, 10);
});

test('getRecentMessages omits messages from deleted threads', async () => {
  await resetForTests();
  const t1 = await createThread({ title: 'Keep' });
  const t2 = await createThread({ title: 'Delete me' });
  await postMessage(t1.id, { profileId: 'family', body: 'Stays' });
  await postMessage(t2.id, { profileId: 'family', body: 'Goes away' });
  await deleteThread(t2.id);

  const recent = await getRecentMessages(10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].body, 'Stays');
});

test('GET /api/chat/recent returns messages with threadTitle', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/chat/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Household' }),
    });
    const { thread } = await res.json();
    await fetch(`${base}/api/chat/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hello from home panel' }),
    });

    res = await fetch(`${base}/api/chat/recent?limit=3`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.messages));
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].body, 'Hello from home panel');
    assert.equal(body.messages[0].threadTitle, 'Household');
  });
});
