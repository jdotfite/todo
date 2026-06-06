import test from 'node:test';
import assert from 'node:assert/strict';
import { resetForTests } from '../src/db.js';
import { createApp } from '../src/server.js';
import {
  createTipEntry,
  listTipEntries,
  updateTipEntry,
  deleteTipEntry,
  getTipSummary,
} from '../src/modules/tips/data.js';

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

// --- Data layer ---

test('tip entries can be created, listed, updated, and deleted', async () => {
  await resetForTests();

  const entry = await createTipEntry({ date: '2025-03-15', amount: 42, notes: 'great client' });
  assert.ok(entry.id);
  assert.equal(entry.profileId, 'wife');
  assert.equal(entry.date, '2025-03-15');
  assert.equal(entry.amount, 42);
  assert.equal(entry.notes, 'great client');
  assert.ok(entry.createdAt);
  assert.ok(entry.updatedAt);

  let entries = await listTipEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, entry.id);

  const updated = await updateTipEntry(entry.id, { amount: 50, notes: 'updated' });
  assert.equal(updated.amount, 50);
  assert.equal(updated.notes, 'updated');

  const removed = await deleteTipEntry(entry.id);
  assert.deepEqual(removed, { removed: 1 });

  entries = await listTipEntries();
  assert.equal(entries.length, 0);
});

test('tip entries are sorted newest-first by date', async () => {
  await resetForTests();

  await createTipEntry({ date: '2025-03-01', amount: 10 });
  await createTipEntry({ date: '2025-03-15', amount: 20 });
  await createTipEntry({ date: '2025-03-08', amount: 15 });

  const entries = await listTipEntries();
  assert.deepEqual(entries.map(e => e.date), ['2025-03-15', '2025-03-08', '2025-03-01']);
});

test('tip entries can be filtered by month', async () => {
  await resetForTests();

  await createTipEntry({ date: '2025-02-28', amount: 5 });
  await createTipEntry({ date: '2025-03-01', amount: 10 });
  await createTipEntry({ date: '2025-03-15', amount: 20 });

  const march = await listTipEntries({ month: '2025-03' });
  assert.equal(march.length, 2);
  assert.ok(march.every(e => e.date.startsWith('2025-03')));
});

test('tip summary computes totals correctly', async () => {
  await resetForTests();

  const today = new Date().toISOString().slice(0, 10);
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  const thisWeekDate = d.toISOString().slice(0, 10);

  await createTipEntry({ date: '2023-01-01', amount: 15 });
  await createTipEntry({ date: today, amount: 50 });
  await createTipEntry({ date: thisWeekDate, amount: 25 });

  const summary = await getTipSummary();
  assert.equal(summary.entryCount, 3);
  assert.equal(summary.total, 90);
  assert.ok(summary.thisWeek >= 25);
  assert.ok(summary.thisMonth >= 0);
  assert.ok(summary.avgPerTip > 0);
});

test('createTipEntry rejects missing or impossible dates', async () => {
  await resetForTests();
  await assert.rejects(
    () => createTipEntry({ amount: 10 }),
    { message: /date/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-99-99', amount: 10 }),
    { message: /date/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-02-29', amount: 10 }),
    { message: /date/ }
  );
});

test('createTipEntry rejects negative or non-finite amounts', async () => {
  await resetForTests();
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', amount: -5 }),
    { message: /amount/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', amount: Infinity }),
    { message: /amount/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', amount: 1e309 }),
    { message: /amount/ }
  );
});

test('deleteTipEntry throws 404 for unknown id', async () => {
  await resetForTests();
  await assert.rejects(
    () => deleteTipEntry('no-such-id'),
    { message: /not found/i }
  );
});

test('updateTipEntry throws 404 for unknown id', async () => {
  await resetForTests();
  await assert.rejects(
    () => updateTipEntry('no-such-id', { amount: 10 }),
    { message: /not found/i }
  );
});

// --- API layer ---

test('GET /api/tips returns empty list initially', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/tips`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.entries, []);
  });
});

test('POST /api/tips creates an entry and GET /api/tips lists it', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', amount: 40 }),
    });
    assert.equal(res.status, 201);
    const { entry } = await res.json();
    assert.ok(entry.id);
    assert.equal(entry.amount, 40);

    res = await fetch(`${base}/api/tips`);
    const body = await res.json();
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].id, entry.id);
  });
});

test('POST /api/tips returns 400 for missing date', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10 }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/tips returns 400 for negative amounts', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', amount: -1 }),
    });
    assert.equal(res.status, 400);
  });
});

test('PATCH /api/tips/:id updates a tip entry', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', amount: 20 }),
    });
    const { entry } = await res.json();

    res = await fetch(`${base}/api/tips/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 35 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entry.amount, 35);
  });
});

test('DELETE /api/tips/:id removes the entry', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', amount: 20 }),
    });
    const { entry } = await res.json();

    res = await fetch(`${base}/api/tips/${entry.id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { removed: 1 });

    res = await fetch(`${base}/api/tips`);
    const body = await res.json();
    assert.deepEqual(body.entries, []);
  });
});

test('GET /api/tips/summary returns totals', async () => {
  await withServer(async base => {
    const today = new Date().toISOString().slice(0, 10);
    await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today, amount: 50 }),
    });

    const res = await fetch(`${base}/api/tips/summary`);
    assert.equal(res.status, 200);
    const summary = await res.json();
    assert.equal(summary.entryCount, 1);
    assert.equal(summary.total, 50);
    assert.ok(summary.thisWeek >= 50);
    assert.ok(summary.thisMonth >= 50);
    assert.equal(summary.avgPerTip, 50);
  });
});

test('tips API requires household auth when enabled', async () => {
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
    let res = await fetch(`${base}/api/tips`);
    assert.equal(res.status, 401);

    res = await fetch(`${base}/api/tips/summary`);
    assert.equal(res.status, 401);

    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'family-pass' }),
    });
    const cookie = res.headers.get('set-cookie');

    res = await fetch(`${base}/api/tips`, { headers: { cookie } });
    assert.equal(res.status, 200);
  } finally {
    if (previousPassword === undefined) delete process.env.HOUSEHOLD_PASSWORD; else process.env.HOUSEHOLD_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;
    server.close();
  }
});


// --- CSV export ---

test('exportTipsCsv produces correct CSV with headers and one row per entry', async () => {
  await resetForTests();
  const { exportTipsCsv } = await import('../src/modules/tips/data.js');

  await createTipEntry({ date: '2025-03-15', amount: 42, notes: 'generous' });
  await createTipEntry({ date: '2025-03-10', amount: 30 });

  const csv = await exportTipsCsv();
  const lines = csv.split('\n');
  assert.equal(lines[0], '"date","amount","notes"');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /2025-03-15/);
  assert.match(lines[1], /"42"/);
  assert.match(lines[2], /2025-03-10/);
});

test('exportTipsCsv escapes quotes in fields', async () => {
  await resetForTests();
  const { exportTipsCsv } = await import('../src/modules/tips/data.js');
  await createTipEntry({ date: '2025-03-15', amount: 10, notes: 'said "thank you"' });
  const csv = await exportTipsCsv();
  assert.match(csv, /"said ""thank you""/);
});

test('exportTipsCsv neutralizes spreadsheet formula injection in text fields', async () => {
  await resetForTests();
  const { exportTipsCsv } = await import('../src/modules/tips/data.js');
  await createTipEntry({
    date: '2025-03-15',
    amount: 10,
    notes: ' @SUM(1,2)',
  });

  const csv = await exportTipsCsv();
  assert.match(csv, /"' @SUM\(1,2\)"/);
});

test('GET /api/tips/export.csv returns CSV content type and data', async () => {
  await withServer(async base => {
    await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', amount: 40 }),
    });

    const res = await fetch(`${base}/api/tips/export.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /filename="tips-export\.csv"/);
    const text = await res.text();
    assert.match(text, /"date","amount","notes"/);
    assert.match(text, /2025-03-15/);
  });
});

// --- Breakdown ---

test('getTipBreakdown returns a 7-day week array and month weeks array', async () => {
  await resetForTests();
  const { getTipBreakdown } = await import('../src/modules/tips/data.js');

  const today = new Date().toISOString().slice(0, 10);
  await createTipEntry({ date: today, amount: 50 });

  const breakdown = await getTipBreakdown();

  assert.equal(breakdown.week.length, 7);
  assert.ok(breakdown.week.every(d => d.date && d.label));

  const todaySlot = breakdown.week.find(d => d.date === today);
  assert.ok(todaySlot, 'today should appear in the week breakdown');
  assert.equal(todaySlot.total, 50);
  assert.equal(todaySlot.count, 1);

  assert.ok(Array.isArray(breakdown.month));
  const hasThisMonthWeek = breakdown.month.some(w => w.count > 0);
  assert.ok(hasThisMonthWeek, 'this month breakdown should include the week with today');
});

test('getTipBreakdown week totals sum correctly with multiple tips on same day', async () => {
  await resetForTests();
  const { getTipBreakdown } = await import('../src/modules/tips/data.js');

  const today = new Date().toISOString().slice(0, 10);
  await createTipEntry({ date: today, amount: 20 });
  await createTipEntry({ date: today, amount: 15 });
  await createTipEntry({ date: today, amount: 10 });

  const breakdown = await getTipBreakdown();
  const todaySlot = breakdown.week.find(d => d.date === today);
  assert.equal(todaySlot.total, 45);
  assert.equal(todaySlot.count, 3);
});

test('GET /api/tips/breakdown returns week and month arrays', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/tips/breakdown`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.week));
    assert.ok(Array.isArray(body.month));
    assert.equal(body.week.length, 7);
  });
});
