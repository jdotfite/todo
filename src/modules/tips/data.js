import { nanoid } from 'nanoid';
import { nowIso, readStore, writeStore } from '../../db.js';

function normalizeTipEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profileId || 'wife',
    date: row.date,
    amount: Number(row.amount) || 0,
    notes: row.notes || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validDateString(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function validateEntry(input) {
  if (!validDateString(input.date)) {
    return 'date must be a valid YYYY-MM-DD string';
  }
  if (input.amount !== undefined) {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0) return 'amount must be a non-negative number';
  }
  return null;
}

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function createTipEntry(input = {}) {
  const errMsg = validateEntry(input);
  if (errMsg) throw apiError(errMsg, 400);

  const timestamp = nowIso();
  const entry = normalizeTipEntry({
    id: nanoid(12),
    profileId: 'wife',
    date: input.date,
    amount: Number(input.amount) || 0,
    notes: input.notes || '',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const store = await readStore();
  store.tipEntries.push(entry);
  await writeStore(store);
  return entry;
}

export async function listTipEntries(query = {}) {
  const store = await readStore();
  let entries = (store.tipEntries || [])
    .map(normalizeTipEntry)
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (query.month) entries = entries.filter(e => e.date.startsWith(query.month));
  return entries;
}

export async function updateTipEntry(id, input = {}) {
  const store = await readStore();
  const index = store.tipEntries.findIndex(e => e.id === id);
  if (index === -1) throw apiError('Tip entry not found', 404);

  const current = store.tipEntries[index];
  const merged = { ...current, ...input };
  const errMsg = validateEntry(merged);
  if (errMsg) throw apiError(errMsg, 400);

  const updated = normalizeTipEntry({ ...merged, id: current.id, profileId: 'wife', updatedAt: nowIso() });
  store.tipEntries[index] = updated;
  await writeStore(store);
  return updated;
}

export async function deleteTipEntry(id) {
  const store = await readStore();
  const before = store.tipEntries.length;
  store.tipEntries = store.tipEntries.filter(e => e.id !== id);
  if (store.tipEntries.length === before) throw apiError('Tip entry not found', 404);
  await writeStore(store);
  return { removed: 1 };
}

export async function getTipSummary() {
  const entries = await listTipEntries();
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  const weekStart = d.toISOString().slice(0, 10);
  const monthPrefix = today.slice(0, 7);

  const sum = arr => arr.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const round2 = n => Math.round(n * 100) / 100;

  const allTotal = sum(entries);
  return {
    total: round2(allTotal),
    thisWeek: round2(sum(entries.filter(e => e.date >= weekStart))),
    thisMonth: round2(sum(entries.filter(e => e.date.startsWith(monthPrefix)))),
    avgPerTip: round2(entries.length ? allTotal / entries.length : 0),
    entryCount: entries.length,
  };
}

export async function exportTipsCsv() {
  const entries = await listTipEntries();
  const headers = ['date', 'amount', 'notes'];
  const neutralizeCsvFormula = v => {
    const text = String(v ?? '');
    return /^[\s\t\r]*[=+\-@]/.test(text) ? `'${text}` : text;
  };
  const csvCell = v => `"${neutralizeCsvFormula(v).replace(/"/g, '""')}"`;
  const rows = [headers.map(csvCell).join(',')];
  for (const e of entries) {
    rows.push([e.date, e.amount, e.notes].map(csvCell).join(','));
  }
  return rows.join('\n');
}

export async function getTipBreakdown() {
  const entries = await listTipEntries();

  // --- This week: one slot per calendar day Sun..Sat ---
  const now = new Date();
  const weekStartDate = new Date(now);
  weekStartDate.setDate(now.getDate() - now.getDay());
  weekStartDate.setHours(0, 0, 0, 0);

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartDate);
    d.setDate(weekStartDate.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayEntries = entries.filter(e => e.date === dateStr);
    const total = dayEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    weekDays.push({
      date: dateStr,
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      total: Math.round(total * 100) / 100,
      count: dayEntries.length,
    });
  }

  // --- This month: group by week ---
  const monthPrefix = now.toISOString().slice(0, 7);
  const monthEntries = entries.filter(e => e.date.startsWith(monthPrefix));

  const weekMap = new Map();
  for (const e of monthEntries) {
    const d = new Date(e.date + 'T12:00:00Z');
    const wStart = new Date(d);
    wStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const key = wStart.toISOString().slice(0, 10);
    if (!weekMap.has(key)) {
      weekMap.set(key, { start: key, total: 0, count: 0 });
    }
    const w = weekMap.get(key);
    w.total += Number(e.amount) || 0;
    w.count++;
  }

  const monthWeeks = [...weekMap.values()]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(w => ({ ...w, total: Math.round(w.total * 100) / 100 }));

  return { week: weekDays, month: monthWeeks };
}
