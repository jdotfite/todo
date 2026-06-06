import { nanoid } from 'nanoid';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nowIso, readStore, writeStore } from '../../db.js';

const execFileAsync = promisify(execFile);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const IMPORT_SCRIPT = resolve(MODULE_DIR, '../../../scripts/import-commission-xlsx.py');

const DEFAULT_SETTINGS = {
  defaultCommissionRate: 0.1,
  serviceRateRules: [],
  tipTypes: ['Cash', 'Tippy', 'Venmo', 'Other'],
};

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toMoney(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? round2(number) : NaN;
}

function toRate(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function validDateString(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings && typeof settings === 'object' ? settings : {}) };
  const defaultCommissionRate = toRate(merged.defaultCommissionRate, DEFAULT_SETTINGS.defaultCommissionRate);
  return {
    defaultCommissionRate: Number.isFinite(defaultCommissionRate) && defaultCommissionRate >= 0 && defaultCommissionRate <= 1 ? defaultCommissionRate : DEFAULT_SETTINGS.defaultCommissionRate,
    serviceRateRules: Array.isArray(merged.serviceRateRules)
      ? merged.serviceRateRules
          .map(rule => ({ match: String(rule?.match || '').trim(), rate: toRate(rule?.rate, NaN) }))
          .filter(rule => rule.match && Number.isFinite(rule.rate) && rule.rate >= 0 && rule.rate <= 1)
      : [],
    tipTypes: Array.isArray(merged.tipTypes) && merged.tipTypes.length
      ? [...new Set(merged.tipTypes.map(type => String(type || '').trim()).filter(Boolean))]
      : DEFAULT_SETTINGS.tipTypes,
  };
}

function chooseCommissionRate(input, settings) {
  if (input.commissionRate !== undefined && input.commissionRate !== '') return toRate(input.commissionRate, NaN);
  const serviceName = String(input.serviceName || '').toLowerCase();
  const matched = settings.serviceRateRules.find(rule => serviceName.includes(rule.match.toLowerCase()));
  return matched ? matched.rate : settings.defaultCommissionRate;
}

function validateEntry(input, { allowImportedReview = false } = {}) {
  if (!validDateString(input.date)) return 'date must be a valid YYYY-MM-DD string';
  const numericFields = ['revenue', 'commissionAmount', 'deductions', 'payout', 'tipAmount'];
  for (const field of numericFields) {
    const value = input[field];
    if (value === undefined || value === '' || value === null) continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return `${field} must be a non-negative number`;
  }
  if (input.commissionRate !== undefined && input.commissionRate !== '' && input.commissionRate !== null) {
    const rate = Number(input.commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) return 'commission rate must be between 0 and 1';
  }
  if (!allowImportedReview && input.needsReview && !input.reviewReason) return 'reviewReason is required when needsReview is true';
  return null;
}

function normalizeWorkEntry(row, settings = DEFAULT_SETTINGS) {
  if (!row) return null;
  const commissionRate = chooseCommissionRate(row, settings);
  const revenue = toMoney(row.revenue, 0);
  const deductions = toMoney(row.deductions, 0);
  const tipAmount = toMoney(row.tipAmount, 0);
  const calculatedCommission = round2(revenue * commissionRate);
  const commissionAmount = row.commissionAmount === undefined || row.commissionAmount === '' || row.commissionAmount === null
    ? calculatedCommission
    : toMoney(row.commissionAmount, calculatedCommission);
  const payout = row.payout === undefined || row.payout === '' || row.payout === null
    ? round2(commissionAmount - deductions)
    : toMoney(row.payout, round2(commissionAmount - deductions));
  return {
    id: row.id,
    profileId: row.profileId || 'kari',
    date: row.date,
    clientName: String(row.clientName || '').trim(),
    serviceName: String(row.serviceName || '').trim(),
    revenue,
    commissionRate,
    commissionAmount,
    deductions,
    payout,
    tipAmount,
    tipType: String(row.tipType || '').trim(),
    totalEarnings: round2(payout + tipAmount),
    notes: row.notes || '',
    source: row.source || 'manual',
    sourceWorkbook: row.sourceWorkbook || '',
    sourceSheet: row.sourceSheet || '',
    sourceRow: row.sourceRow || null,
    importMetadata: row.importMetadata || null,
    needsReview: Boolean(row.needsReview),
    reviewReason: row.reviewReason || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function legacyTipAsWorkEntry(tip) {
  if (!tip) return null;
  const amount = toMoney(tip.amount, 0);
  return normalizeWorkEntry({
    id: tip.id,
    profileId: tip.profileId || 'kari',
    date: tip.date,
    clientName: '',
    serviceName: 'Tip',
    revenue: 0,
    commissionRate: 0,
    commissionAmount: 0,
    deductions: 0,
    payout: 0,
    tipAmount: amount,
    tipType: 'Other',
    notes: tip.notes || '',
    source: 'legacy-tip',
    createdAt: tip.createdAt,
    updatedAt: tip.updatedAt,
  }, DEFAULT_SETTINGS);
}

function sortEntries(entries) {
  return entries.sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function getWorkSettings() {
  const store = await readStore();
  return normalizeSettings(store.workSettings);
}

export async function updateWorkSettings(input = {}) {
  const settings = normalizeSettings(input);
  const rate = Number(input.defaultCommissionRate);
  if (input.defaultCommissionRate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 1)) throw apiError('default commission rate must be between 0 and 1', 400);
  const store = await readStore();
  store.workSettings = settings;
  await writeStore(store);
  return settings;
}

export async function createWorkEntry(input = {}) {
  const settings = await getWorkSettings();
  const prepared = normalizeWorkEntry({
    ...input,
    id: nanoid(12),
    profileId: 'kari',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }, settings);
  const errMsg = validateEntry(prepared, { allowImportedReview: true });
  if (errMsg) throw apiError(errMsg, 400);
  const store = await readStore();
  store.workEntries = Array.isArray(store.workEntries) ? store.workEntries : [];
  store.workEntries.push(prepared);
  await writeStore(store);
  return prepared;
}

export async function listWorkEntries(query = {}) {
  const store = await readStore();
  const settings = normalizeSettings(store.workSettings);
  let entries = (Array.isArray(store.workEntries) ? store.workEntries : []).map(row => normalizeWorkEntry(row, settings)).filter(Boolean);
  if (entries.length === 0 && Array.isArray(store.tipEntries) && store.tipEntries.length) {
    entries = store.tipEntries.map(legacyTipAsWorkEntry).filter(Boolean);
  }
  if (query.month) entries = entries.filter(e => e.date.startsWith(query.month));
  if (query.needsReview === 'true' || query.review === 'true') entries = entries.filter(e => e.needsReview);
  return sortEntries(entries);
}

export async function updateWorkEntry(id, input = {}) {
  const store = await readStore();
  const index = (store.workEntries || []).findIndex(e => e.id === id);
  if (index === -1) throw apiError('Work entry not found', 404);
  const settings = normalizeSettings(store.workSettings);
  const merged = { ...store.workEntries[index], ...input, id, profileId: 'kari', updatedAt: nowIso() };
  if (input.revenue !== undefined || input.commissionRate !== undefined) delete merged.commissionAmount;
  if (input.revenue !== undefined || input.commissionRate !== undefined || input.deductions !== undefined || input.commissionAmount !== undefined) delete merged.payout;
  const updated = normalizeWorkEntry(merged, settings);
  const errMsg = validateEntry(updated, { allowImportedReview: true });
  if (errMsg) throw apiError(errMsg, 400);
  store.workEntries[index] = updated;
  await writeStore(store);
  return updated;
}

export async function deleteWorkEntry(id) {
  const store = await readStore();
  const before = (store.workEntries || []).length;
  store.workEntries = (store.workEntries || []).filter(e => e.id !== id);
  if (store.workEntries.length === before) throw apiError('Work entry not found', 404);
  await writeStore(store);
  return { removed: 1 };
}

function summarize(entries) {
  const initial = { revenue: 0, commission: 0, deductions: 0, payout: 0, tips: 0, totalEarnings: 0 };
  const totals = entries.reduce((acc, e) => {
    acc.revenue += Number(e.revenue) || 0;
    acc.commission += Number(e.commissionAmount) || 0;
    acc.deductions += Number(e.deductions) || 0;
    acc.payout += Number(e.payout) || 0;
    acc.tips += Number(e.tipAmount) || 0;
    acc.totalEarnings += Number(e.totalEarnings) || 0;
    return acc;
  }, initial);
  for (const key of Object.keys(totals)) totals[key] = round2(totals[key]);
  return totals;
}

export async function getWorkSummary(query = {}) {
  const entries = await listWorkEntries(query);
  const totals = summarize(entries);
  const tipsByType = {};
  const services = new Map();
  for (const e of entries) {
    if (e.tipAmount > 0) tipsByType[e.tipType || 'Other'] = round2((tipsByType[e.tipType || 'Other'] || 0) + e.tipAmount);
    const key = e.serviceName || 'Unspecified';
    if (!services.has(key)) services.set(key, { serviceName: key, revenue: 0, commission: 0, tips: 0, count: 0 });
    const item = services.get(key);
    item.revenue += e.revenue;
    item.commission += e.commissionAmount;
    item.tips += e.tipAmount;
    item.count += 1;
  }
  const topServices = [...services.values()]
    .map(s => ({ ...s, revenue: round2(s.revenue), commission: round2(s.commission), tips: round2(s.tips) }))
    .sort((a, b) => b.revenue - a.revenue || b.commission - a.commission)
    .slice(0, 8);
  return {
    entryCount: entries.length,
    ...totals,
    avgPerEntry: round2(entries.length ? totals.totalEarnings / entries.length : 0),
    tipsByType,
    topServices,
    reviewCount: entries.filter(e => e.needsReview).length,
  };
}

export async function getWorkBreakdown() {
  const entries = await listWorkEntries();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    const dayEntries = entries.filter(e => e.date === date);
    week.push({ date, label: d.toLocaleDateString('en-US', { weekday: 'short' }), count: dayEntries.length, ...summarize(dayEntries) });
  }
  const monthPrefix = now.toISOString().slice(0, 7);
  const weeks = new Map();
  for (const e of entries.filter(e => e.date.startsWith(monthPrefix))) {
    const d = new Date(e.date + 'T12:00:00Z');
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const key = start.toISOString().slice(0, 10);
    if (!weeks.has(key)) weeks.set(key, []);
    weeks.get(key).push(e);
  }
  const month = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, rows]) => ({ start, count: rows.length, ...summarize(rows) }));
  return { week, month };
}

function importSourceKey(row) {
  return [row.sourceWorkbook, row.sourceSheet, row.sourceRow].map(value => String(value ?? '')).join('|');
}

function normalizeImportRow(row, existingKeys = new Set()) {
  const problems = Array.isArray(row.problems) ? row.problems : [];
  const duplicateExisting = existingKeys.has(importSourceKey(row));
  const status = duplicateExisting ? 'duplicate' : problems.length ? 'needs_review' : 'ready';
  return {
    id: nanoid(12),
    status,
    problems,
    duplicateExisting,
    suggestedDate: row.suggestedDate || '',
    autoFixed: Array.isArray(row.autoFixed) ? row.autoFixed : [],
    reviewedAt: null,
    entry: {
      date: row.date,
      clientName: row.clientName || '',
      serviceName: row.serviceName || '',
      revenue: row.revenue || 0,
      commissionRate: row.commissionRate || 0,
      commissionAmount: row.commissionAmount || 0,
      deductions: row.deductions || 0,
      payout: row.payout || 0,
      tipAmount: row.tipAmount || 0,
      tipType: row.tipType || '',
      source: 'import',
      sourceWorkbook: row.sourceWorkbook || '',
      sourceSheet: row.sourceSheet || '',
      sourceRow: row.sourceRow || null,
      originalDate: row.originalDate || '',
      autoFixed: Array.isArray(row.autoFixed) ? row.autoFixed : [],
      dateEvidence: row.dateEvidence || null,
      importMetadata: { problems, suggestedDate: row.suggestedDate || '', originalDate: row.originalDate || '', autoFixed: row.autoFixed || [], dateEvidence: row.dateEvidence || null },
      needsReview: problems.length > 0,
      reviewReason: problems.join(','),
    },
  };
}

function batchSummary(rows) {
  return {
    totalRows: rows.length,
    readyRows: rows.filter(row => row.status === 'ready').length,
    reviewRows: rows.filter(row => row.status === 'needs_review').length,
    approvedRows: rows.filter(row => row.status === 'approved').length,
    duplicateRows: rows.filter(row => row.status === 'duplicate').length,
    skippedRows: rows.filter(row => row.status === 'skipped').length,
    committedRows: rows.filter(row => row.status === 'committed').length,
  };
}

function publicBatch(batch, { includeRows = true } = {}) {
  return {
    ...batch,
    summary: batchSummary(batch.rows || []),
    rows: includeRows ? (batch.rows || []) : undefined,
  };
}

export async function listWorkImportBatches() {
  const store = await readStore();
  return (store.workImportBatches || []).map(batch => publicBatch(batch, { includeRows: false })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getWorkImportBatch(id) {
  const store = await readStore();
  const batch = (store.workImportBatches || []).find(item => item.id === id);
  if (!batch) throw apiError('Import batch not found', 404);
  return publicBatch(batch);
}

export async function stageWorkImportFromReport(report, sourcePaths = []) {
  const store = await readStore();
  const existingKeys = new Set((store.workEntries || []).filter(entry => entry.sourceWorkbook && entry.sourceSheet && entry.sourceRow).map(importSourceKey));
  const rows = (report.workbooks || []).flatMap(workbook => (workbook.rows || []).map(row => normalizeImportRow(row, existingKeys)));
  const batch = {
    id: nanoid(12),
    createdAt: nowIso(),
    committedAt: null,
    committedCount: 0,
    sourcePaths,
    aggregate: report.aggregate || {},
    workbooks: (report.workbooks || []).map(({ rows: _rows, ...workbook }) => workbook),
    rows,
  };
  store.workImportBatches = Array.isArray(store.workImportBatches) ? store.workImportBatches : [];
  store.workImportBatches.unshift(batch);
  await writeStore(store);
  return publicBatch(batch);
}

export async function dryRunWorkImport(paths = []) {
  if (!Array.isArray(paths) || paths.length === 0) throw apiError('paths must include at least one .xlsx workbook', 400);
  const resolved = paths.map(path => resolve(String(path || '')));
  for (const path of resolved) {
    if (!path.endsWith('.xlsx')) throw apiError('only .xlsx workbooks are supported', 400);
    if (!existsSync(path)) throw apiError(`Workbook not found: ${path}`, 400);
  }
  const { stdout } = await execFileAsync('python3', [IMPORT_SCRIPT, '--include-rows', ...resolved], { maxBuffer: 50 * 1024 * 1024 });
  return stageWorkImportFromReport(JSON.parse(stdout), resolved);
}

export async function updateWorkImportRow(batchId, rowId, input = {}) {
  const store = await readStore();
  const batch = (store.workImportBatches || []).find(item => item.id === batchId);
  if (!batch) throw apiError('Import batch not found', 404);
  const row = (batch.rows || []).find(item => item.id === rowId);
  if (!row) throw apiError('Import row not found', 404);
  if (input.status !== undefined) {
    const status = String(input.status);
    if (!['ready', 'approved', 'needs_review', 'skipped', 'duplicate'].includes(status)) throw apiError('invalid row status', 400);
    row.status = status;
  }
  if (input.entry && typeof input.entry === 'object') row.entry = { ...row.entry, ...input.entry };
  if (input.useSuggestedDate && row.suggestedDate) row.entry.date = row.suggestedDate;
  if (row.status === 'approved' || row.status === 'ready') {
    row.entry.needsReview = false;
    row.entry.reviewReason = '';
  }
  row.reviewedAt = nowIso();
  await writeStore(store);
  return publicBatch(batch);
}

export async function commitWorkImportBatch(batchId, { allowPartial = false } = {}) {
  const store = await readStore();
  const batch = (store.workImportBatches || []).find(item => item.id === batchId);
  if (!batch) throw apiError('Import batch not found', 404);
  const unresolved = (batch.rows || []).filter(row => row.status === 'needs_review');
  if (unresolved.length && !allowPartial) throw apiError(`${unresolved.length} import rows still need review`, 400);
  const existingKeys = new Set((store.workEntries || []).filter(entry => entry.sourceWorkbook && entry.sourceSheet && entry.sourceRow).map(importSourceKey));
  const settings = normalizeSettings(store.workSettings);
  const now = nowIso();
  const commitRows = (batch.rows || []).filter(row => ['ready', 'approved'].includes(row.status) && !existingKeys.has(importSourceKey(row.entry)));
  const entries = commitRows.map(row => normalizeWorkEntry({
    ...row.entry,
    id: nanoid(12),
    profileId: 'kari',
    source: 'import',
    needsReview: false,
    reviewReason: '',
    createdAt: now,
    updatedAt: now,
  }, settings));
  for (const entry of entries) {
    const errMsg = validateEntry(entry, { allowImportedReview: true });
    if (errMsg) throw apiError(errMsg, 400);
  }
  store.workEntries = [...(store.workEntries || []), ...entries];
  const committedKeys = new Set(commitRows.map(row => importSourceKey(row.entry)));
  for (const row of batch.rows || []) {
    if (committedKeys.has(importSourceKey(row.entry))) row.status = 'committed';
  }
  batch.committedAt = now;
  batch.committedCount = (batch.committedCount || 0) + entries.length;
  await writeStore(store);
  return { batch: publicBatch(batch), committed: entries.length };
}

export async function exportWorkCsv() {
  const entries = await listWorkEntries();
  const headers = ['date', 'clientName', 'serviceName', 'revenue', 'commissionRate', 'commissionAmount', 'deductions', 'payout', 'tipAmount', 'tipType', 'totalEarnings', 'notes', 'source'];
  const neutralizeCsvFormula = v => {
    const text = String(v ?? '');
    return /^[\s\t\r]*[=+\-@]/.test(text) ? `'${text}` : text;
  };
  const csvCell = v => `"${neutralizeCsvFormula(v).replace(/"/g, '""')}"`;
  return [headers.join(','), ...entries.map(e => headers.map(h => csvCell(e[h])).join(','))].join('\n');
}
