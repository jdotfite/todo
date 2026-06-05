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

  const entry = await createTipEntry({ date: '2025-03-15', shiftType: 'night', location: 'downtown', cashTips: 42, cardTips: 18.5, hours: 6 });
  assert.ok(entry.id);
  assert.equal(entry.profileId, 'wife');
  assert.equal(entry.date, '2025-03-15');
  assert.equal(entry.shiftType, 'night');
  assert.equal(entry.location, 'downtown');
  assert.equal(entry.cashTips, 42);
  assert.equal(entry.cardTips, 18.5);
  assert.equal(entry.hours, 6);
  assert.ok(entry.createdAt);
  assert.ok(entry.updatedAt);

  let entries = await listTipEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, entry.id);

  const updated = await updateTipEntry(entry.id, { cashTips: 50, notes: 'busy night' });
  assert.equal(updated.cashTips, 50);
  assert.equal(updated.notes, 'busy night');
  assert.equal(updated.cardTips, 18.5);

  const removed = await deleteTipEntry(entry.id);
  assert.deepEqual(removed, { removed: 1 });

  entries = await listTipEntries();
  assert.equal(entries.length, 0);
});

test('tip entries are sorted newest-first by date', async () => {
  await resetForTests();

  await createTipEntry({ date: '2025-03-01', cashTips: 10, cardTips: 0 });
  await createTipEntry({ date: '2025-03-15', cashTips: 20, cardTips: 0 });
  await createTipEntry({ date: '2025-03-08', cashTips: 15, cardTips: 0 });

  const entries = await listTipEntries();
  assert.deepEqual(entries.map(e => e.date), ['2025-03-15', '2025-03-08', '2025-03-01']);
});

test('tip entries can be filtered by month', async () => {
  await resetForTests();

  await createTipEntry({ date: '2025-02-28', cashTips: 5, cardTips: 0 });
  await createTipEntry({ date: '2025-03-01', cashTips: 10, cardTips: 0 });
  await createTipEntry({ date: '2025-03-15', cashTips: 20, cardTips: 0 });

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

  await createTipEntry({ date: '2023-01-01', cashTips: 10, cardTips: 5 });
  await createTipEntry({ date: today, cashTips: 30, cardTips: 20 });
  await createTipEntry({ date: thisWeekDate, cashTips: 15, cardTips: 10 });

  const summary = await getTipSummary();
  assert.equal(summary.entryCount, 3);
  assert.equal(summary.total, 90);
  assert.ok(summary.thisWeek >= 25);
  assert.ok(summary.thisMonth >= 0);
  assert.ok(summary.avgPerShift > 0);
});

test('createTipEntry rejects missing or impossible dates', async () => {
  await resetForTests();
  await assert.rejects(
    () => createTipEntry({ cashTips: 10, cardTips: 5 }),
    { message: /date/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-99-99', cashTips: 10, cardTips: 5 }),
    { message: /date/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-02-29', cashTips: 10, cardTips: 5 }),
    { message: /date/ }
  );
});

test('createTipEntry rejects negative or non-finite tip amounts', async () => {
  await resetForTests();
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', cashTips: -5, cardTips: 0 }),
    { message: /cashTips/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', cashTips: Infinity, cardTips: 0 }),
    { message: /cashTips/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', cashTips: 0, cardTips: -1 }),
    { message: /cardTips/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', cashTips: 0, cardTips: 1e309 }),
    { message: /cardTips/ }
  );
});

test('createTipEntry rejects non-positive or non-finite hours', async () => {
  await resetForTests();
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', cashTips: 0, cardTips: 0, hours: 0 }),
    { message: /hours/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', cashTips: 0, cardTips: 0, hours: -2 }),
    { message: /hours/ }
  );
  await assert.rejects(
    () => createTipEntry({ date: '2025-03-15', cashTips: 0, cardTips: 0, hours: Infinity }),
    { message: /hours/ }
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
    () => updateTipEntry('no-such-id', { cashTips: 10 }),
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
      body: JSON.stringify({ date: '2025-03-15', shiftType: 'day', location: 'main', cashTips: 40, cardTips: 22.5 }),
    });
    assert.equal(res.status, 201);
    const { entry } = await res.json();
    assert.ok(entry.id);
    assert.equal(entry.cashTips, 40);
    assert.equal(entry.cardTips, 22.5);

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
      body: JSON.stringify({ cashTips: 10, cardTips: 5 }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/tips returns 400 for negative amounts', async () => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', cashTips: -1, cardTips: 0 }),
    });
    assert.equal(res.status, 400);
  });
});

test('PATCH /api/tips/:id updates a tip entry', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', cashTips: 20, cardTips: 10 }),
    });
    const { entry } = await res.json();

    res = await fetch(`${base}/api/tips/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cashTips: 35 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entry.cashTips, 35);
    assert.equal(body.entry.cardTips, 10);
  });
});

test('DELETE /api/tips/:id removes the entry', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', cashTips: 20, cardTips: 10 }),
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
      body: JSON.stringify({ date: today, cashTips: 30, cardTips: 20 }),
    });

    const res = await fetch(`${base}/api/tips/summary`);
    assert.equal(res.status, 200);
    const summary = await res.json();
    assert.equal(summary.entryCount, 1);
    assert.equal(summary.total, 50);
    assert.ok(summary.thisWeek >= 50);
    assert.ok(summary.thisMonth >= 50);
    assert.equal(summary.avgPerShift, 50);
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

  await createTipEntry({ date: '2025-03-15', shiftType: 'night', location: 'downtown', cashTips: 42, cardTips: 18.5, hours: 6, notes: 'busy' });
  await createTipEntry({ date: '2025-03-10', shiftType: 'day', location: '', cashTips: 30, cardTips: 0 });

  const csv = await exportTipsCsv();
  const lines = csv.split('\n');
  assert.equal(lines[0], '"date","shift_type","location","cash_tips","card_tips","total","hours","notes"');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /2025-03-15/);
  assert.match(lines[1], /42/);
  assert.match(lines[1], /"60\.50"/);
  assert.match(lines[2], /2025-03-10/);
});

test('exportTipsCsv escapes quotes in fields', async () => {
  await resetForTests();
  const { exportTipsCsv } = await import('../src/modules/tips/data.js');
  await createTipEntry({ date: '2025-03-15', cashTips: 10, cardTips: 5, notes: 'said "great night"' });
  const csv = await exportTipsCsv();
  assert.match(csv, /"said ""great night""/);
});

test('GET /api/tips/export.csv returns CSV content type and data', async () => {
  await withServer(async base => {
    await fetch(`${base}/api/tips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', cashTips: 40, cardTips: 20 }),
    });

    const res = await fetch(`${base}/api/tips/export.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /filename="tips-export\.csv"/);
    const text = await res.text();
    assert.match(text, /"date","shift_type","location"/);
    assert.match(text, /2025-03-15/);
  });
});

// --- Breakdown ---

test('getTipBreakdown returns a 7-day week array and month weeks array', async () => {
  await resetForTests();
  const { getTipBreakdown } = await import('../src/modules/tips/data.js');

  const today = new Date().toISOString().slice(0, 10);
  await createTipEntry({ date: today, cashTips: 30, cardTips: 20 });

  const breakdown = await getTipBreakdown();

  assert.equal(breakdown.week.length, 7);
  assert.ok(breakdown.week.every(d => d.date && d.label));

  const todaySlot = breakdown.week.find(d => d.date === today);
  assert.ok(todaySlot, 'today should appear in the week breakdown');
  assert.equal(todaySlot.total, 50);
  assert.equal(todaySlot.cash, 30);
  assert.equal(todaySlot.card, 20);
  assert.equal(todaySlot.count, 1);

  assert.ok(Array.isArray(breakdown.month));
  const hasThisMonthWeek = breakdown.month.some(w => w.count > 0);
  assert.ok(hasThisMonthWeek, 'this month breakdown should include the week with today');
});

test('getTipBreakdown week totals sum correctly with multiple shifts on same day', async () => {
  await resetForTests();
  const { getTipBreakdown } = await import('../src/modules/tips/data.js');

  const today = new Date().toISOString().slice(0, 10);
  await createTipEntry({ date: today, cashTips: 20, cardTips: 10 });
  await createTipEntry({ date: today, cashTips: 15, cardTips: 5 });

  const breakdown = await getTipBreakdown();
  const todaySlot = breakdown.week.find(d => d.date === today);
  assert.equal(todaySlot.total, 50);
  assert.equal(todaySlot.count, 2);
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
