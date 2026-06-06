import test from 'node:test';
import assert from 'node:assert/strict';
import { resetForTests, readStore, writeStore } from '../src/db.js';
import { createApp } from '../src/server.js';
import {
  createWorkEntry,
  listWorkEntries,
  updateWorkEntry,
  deleteWorkEntry,
  getWorkSummary,
  exportWorkCsv,
  getWorkSettings,
  updateWorkSettings,
  stageWorkImportFromReport,
  updateWorkImportRow,
  commitWorkImportBatch,
} from '../src/modules/work/data.js';

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

test('work entries calculate commission and payout while preserving tips separately', async () => {
  await resetForTests();

  const entry = await createWorkEntry({
    date: '2025-03-15',
    clientName: 'Sarah Miller',
    serviceName: 'IPL special',
    revenue: 300,
    commissionRate: 0.1,
    deductions: 5,
    tipAmount: 20,
    tipType: 'Cash',
    notes: 'first work entry',
  });

  assert.ok(entry.id);
  assert.equal(entry.profileId, 'kari');
  assert.equal(entry.commissionAmount, 30);
  assert.equal(entry.payout, 25);
  assert.equal(entry.totalEarnings, 45);
  assert.equal(entry.tipAmount, 20);
  assert.equal(entry.tipType, 'Cash');

  const entries = await listWorkEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, entry.id);
});

test('work entries validate dates and money/rate fields', async () => {
  await resetForTests();
  await assert.rejects(
    () => createWorkEntry({ date: '2025-02-29', revenue: 10, commissionRate: 0.1 }),
    { message: /date/ }
  );
  await assert.rejects(
    () => createWorkEntry({ date: '2025-03-15', revenue: -1, commissionRate: 0.1 }),
    { message: /revenue/ }
  );
  await assert.rejects(
    () => createWorkEntry({ date: '2025-03-15', revenue: 10, commissionRate: 1.5 }),
    { message: /commission rate/ }
  );
});

test('work summary includes revenue, commission, payout, tips, and top services', async () => {
  await resetForTests();
  await createWorkEntry({ date: '2025-03-15', clientName: 'A', serviceName: 'IPL', revenue: 300, commissionRate: 0.1, tipAmount: 20, tipType: 'Cash' });
  await createWorkEntry({ date: '2025-03-16', clientName: 'B', serviceName: 'Peel', revenue: 200, commissionRate: 0.2, deductions: 10, tipAmount: 5, tipType: 'Venmo' });

  const summary = await getWorkSummary({ month: '2025-03' });
  assert.equal(summary.entryCount, 2);
  assert.equal(summary.revenue, 500);
  assert.equal(summary.commission, 70);
  assert.equal(summary.deductions, 10);
  assert.equal(summary.payout, 60);
  assert.equal(summary.tips, 25);
  assert.equal(summary.totalEarnings, 85);
  assert.deepEqual(summary.tipsByType, { Cash: 20, Venmo: 5 });
  assert.equal(summary.topServices[0].serviceName, 'IPL');
  assert.equal(summary.topServices[0].revenue, 300);
});

test('work entries can be updated and deleted', async () => {
  await resetForTests();
  const entry = await createWorkEntry({ date: '2025-03-15', revenue: 100, commissionRate: 0.1 });
  const updated = await updateWorkEntry(entry.id, { revenue: 150, commissionRate: 0.2, deductions: 5 });
  assert.equal(updated.commissionAmount, 30);
  assert.equal(updated.payout, 25);

  assert.deepEqual(await deleteWorkEntry(entry.id), { removed: 1 });
  assert.deepEqual(await listWorkEntries(), []);
});

test('work settings provide default commission rate and editable service rules', async () => {
  await resetForTests();
  let settings = await getWorkSettings();
  assert.equal(settings.defaultCommissionRate, 0.1);
  assert.ok(settings.tipTypes.includes('Cash'));

  settings = await updateWorkSettings({ defaultCommissionRate: 0.12, serviceRateRules: [{ match: 'Product', rate: 0.2 }] });
  assert.equal(settings.defaultCommissionRate, 0.12);
  assert.deepEqual(settings.serviceRateRules, [{ match: 'Product', rate: 0.2 }]);

  const entry = await createWorkEntry({ date: '2025-03-15', revenue: 100 });
  assert.equal(entry.commissionRate, 0.12);
  assert.equal(entry.commissionAmount, 12);
});

test('legacy tip entries are readable as work entries during migration', async () => {
  await resetForTests();
  const store = await readStore();
  store.tipEntries.push({ id: 'tip-1', profileId: 'kari', date: '2025-03-15', amount: 42, notes: 'legacy cash tip', createdAt: '2025-03-15T00:00:00.000Z', updatedAt: '2025-03-15T00:00:00.000Z' });
  await writeStore(store);

  const entries = await listWorkEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'tip-1');
  assert.equal(entries[0].source, 'legacy-tip');
  assert.equal(entries[0].tipAmount, 42);
  assert.equal(entries[0].revenue, 0);
});

test('work CSV export includes detailed commission fields and neutralizes formulas', async () => {
  await resetForTests();
  await createWorkEntry({ date: '2025-03-15', clientName: '=bad', serviceName: '+IPL', revenue: 300, commissionRate: 0.1, tipAmount: 20, tipType: 'Cash' });
  const csv = await exportWorkCsv();
  assert.match(csv, /date,clientName,serviceName,revenue,commissionRate,commissionAmount,deductions,payout,tipAmount,tipType,totalEarnings,notes,source/);
  assert.match(csv, /"'=bad"/);
  assert.match(csv, /"'\+IPL"/);
});

test('work API creates, lists, summarizes, exports, and exposes settings', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-03-15', clientName: 'A', serviceName: 'IPL', revenue: 300, commissionRate: 0.1, tipAmount: 20, tipType: 'Cash' }),
    });
    assert.equal(res.status, 201);
    const { entry } = await res.json();
    assert.equal(entry.commissionAmount, 30);

    res = await fetch(`${base}/api/work`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).entries.length, 1);

    res = await fetch(`${base}/api/work/summary?month=2025-03`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).totalEarnings, 50);

    res = await fetch(`${base}/api/work/settings`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).settings.defaultCommissionRate, 0.1);

    res = await fetch(`${base}/api/work/export.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
  });
});

function sampleImportReport() {
  return {
    aggregate: { workbookCount: 1, rowCount: 2, problemCount: 1, totals: { revenue: 400, payout: 40, tipAmount: 20 } },
    workbooks: [{
      workbook: 'sample-2025.xlsx',
      rowCount: 2,
      problemCount: 1,
      rows: [
        { date: '2025-03-15', clientName: 'A', serviceName: 'IPL', revenue: 300, commissionRate: 0.1, commissionAmount: 30, deductions: 0, payout: 30, tipAmount: 20, tipType: 'Cash', sourceWorkbook: 'sample-2025.xlsx', sourceSheet: '3-10-25', sourceRow: 3, problems: [] },
        { date: '2005-03-16', suggestedDate: '2025-03-16', clientName: 'B', serviceName: 'Peel', revenue: 100, commissionRate: 0.1, commissionAmount: 10, deductions: 0, payout: 10, tipAmount: 0, tipType: '', sourceWorkbook: 'sample-2025.xlsx', sourceSheet: '3-10-25', sourceRow: 4, problems: ['date_outside_workbook_year'] },
      ],
    }],
  };
}

test('work import batches stage rows, require review, approve suggested dates, and commit entries', async () => {
  await resetForTests();
  const batch = await stageWorkImportFromReport(sampleImportReport(), ['/tmp/sample-2025.xlsx']);
  assert.equal(batch.summary.totalRows, 2);
  assert.equal(batch.summary.readyRows, 1);
  assert.equal(batch.summary.reviewRows, 1);

  await assert.rejects(() => commitWorkImportBatch(batch.id), { message: /need review/ });
  const reviewRow = batch.rows.find(row => row.status === 'needs_review');
  const reviewed = await updateWorkImportRow(batch.id, reviewRow.id, { status: 'approved', useSuggestedDate: true });
  assert.equal(reviewed.rows.find(row => row.id === reviewRow.id).entry.date, '2025-03-16');

  const result = await commitWorkImportBatch(batch.id);
  assert.equal(result.committed, 2);
  assert.equal(result.batch.summary.committedRows, 2);

  const entries = await listWorkEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries.find(entry => entry.clientName === 'B').date, '2025-03-16');
  assert.equal((await getWorkSummary()).totalEarnings, 60);
});

test('work import staging detects already imported source rows as duplicates', async () => {
  await resetForTests();
  await createWorkEntry({ date: '2025-03-15', revenue: 300, commissionRate: 0.1, sourceWorkbook: 'sample-2025.xlsx', sourceSheet: '3-10-25', sourceRow: 3, source: 'import' });
  const batch = await stageWorkImportFromReport(sampleImportReport(), []);
  assert.equal(batch.rows.find(row => row.entry.sourceRow === 3).status, 'duplicate');
  assert.equal(batch.summary.duplicateRows, 1);
});

test('work import API exposes batch review and commit flow', async () => {
  await withServer(async base => {
    let res = await fetch(`${base}/api/work/import/dry-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: ['/does/not/exist.xlsx'] }),
    });
    assert.equal(res.status, 400);

    const batch = await stageWorkImportFromReport(sampleImportReport(), []);
    res = await fetch(`${base}/api/work/import/batches`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).batches.length, 1);

    const reviewRow = batch.rows.find(row => row.status === 'needs_review');
    res = await fetch(`${base}/api/work/import/batches/${batch.id}/rows/${reviewRow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', useSuggestedDate: true }),
    });
    assert.equal(res.status, 200);

    res = await fetch(`${base}/api/work/import/batches/${batch.id}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).committed, 2);
  });
});
