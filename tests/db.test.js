import test from 'node:test';
import assert from 'node:assert/strict';

test('db uses Vercel KV REST when KV environment is configured', async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  const previousKey = process.env.TODO_KV_KEY;
  const calls = [];
  let saved = null;

  process.env.KV_REST_API_URL = 'https://kv.example.test';
  process.env.KV_REST_API_TOKEN = 'secret';
  process.env.TODO_KV_KEY = 'todo:test';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/get/')) return Response.json({ result: saved });
    if (url.includes('/set/')) {
      saved = decodeURIComponent(url.split('/set/')[1].split('/').slice(1).join('/'));
      return Response.json({ result: 'OK' });
    }
    return new Response('unexpected', { status: 500 });
  };

  try {
    const db = await import(`../src/db.js?kv=${Date.now()}`);
    await db.writeStore({ tasks: [{ id: '1', title: 'Cloud task' }], groceryItems: [] });
    const store = await db.readStore();

    assert.deepEqual(store.tasks, [{ id: '1', title: 'Cloud task' }]);
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer secret');
    const setCall = calls.findLast(call => call.url.startsWith('https://kv.example.test/set/todo%3Atest/'));
    assert.ok(setCall);
    assert.deepEqual(JSON.parse(decodeURIComponent(setCall.url.split('/set/todo%3Atest/')[1])), { tasks: [{ id: '1', title: 'Cloud task' }], groceryItems: [] });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = previousToken;
    if (previousKey === undefined) delete process.env.TODO_KV_KEY; else process.env.TODO_KV_KEY = previousKey;
  }
});

test('db falls back to writable tmp storage on Vercel without KV', async () => {
  const previousVercel = process.env.VERCEL;
  const previousTodoDb = process.env.TODO_DB;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;

  process.env.VERCEL = '1';
  delete process.env.TODO_DB;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const db = await import(`../src/db.js?vercel=${Date.now()}`);
    assert.equal(db.dbPath, '/tmp/todo.json');
    await db.writeStore({ tasks: [], groceryItems: [] });
    assert.deepEqual(await db.readStore(), { tasks: [], groceryItems: [] });
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
    if (previousTodoDb === undefined) delete process.env.TODO_DB; else process.env.TODO_DB = previousTodoDb;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = previousToken;
  }
});
