import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listGroceryItems } from './grocery.js';

const execFileAsync = promisify(execFile);
const GOOGLE_API = process.env.GOOGLE_API_SCRIPT || `${process.env.HERMES_HOME || `${process.env.HOME}/.hermes`}/skills/productivity/google-workspace/scripts/google_api.py`;
const FAMILY_CALENDAR_ID = process.env.FAMILY_CALENDAR_ID || 'family12925651382350424080@group.calendar.google.com';
const FACT_CACHE_MS = Number(process.env.EINK_FACT_CACHE_MS || 60 * 60 * 1000);
const CALENDAR_DAYS = Number(process.env.EINK_CALENDAR_DAYS || 3);
const CALENDAR_MAX = Number(process.env.EINK_CALENDAR_MAX || 8);

let factCache = null;

function todayLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function localIso(date) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const tz = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00${tz}`;
}

function eventDateKey(event) {
  const raw = event.start?.dateTime || event.start?.date || event.start || '';
  return String(raw).slice(0, 10);
}

function eventTimeLabel(event) {
  const start = event.start?.dateTime || event.start || '';
  if (!start || event.start?.date || /^\d{4}-\d{2}-\d{2}$/.test(String(start))) return 'All day';
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
}

function parseIcsDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{8}$/.test(raw)) {
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    return { date: `${year}-${month}-${day}`, allDay: true, startMs: Date.parse(`${year}-${month}-${day}T00:00:00`) };
  }
  const normalized = raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/, '$1-$2-$3T$4:$5:$6$7');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return { date: d.toISOString().slice(0, 10), allDay: false, startMs: d.getTime(), iso: d.toISOString() };
}

function parseIcsCalendar(text, now = new Date(), days = CALENDAR_DAYS, max = CALENDAR_MAX) {
  const lines = unfoldIcs(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const [left, ...right] = line.split(':');
      const key = left.split(';')[0];
      const value = right.join(':');
      if (key === 'UID') current.id = value;
      if (key === 'SUMMARY') current.summary = value.replace(/\\,/g, ',').replace(/\\n/g, ' ');
      if (key === 'DTSTART') current.start = parseIcsDate(value);
    }
  }
  const startMs = now.getTime();
  const endMs = addDays(now, days).getTime();
  return events
    .filter(event => event.summary && event.start && event.start.startMs >= startMs && event.start.startMs <= endMs)
    .sort((a, b) => a.start.startMs - b.start.startMs)
    .slice(0, max)
    .map(event => ({
      id: event.id || `${event.start.date}:${event.summary}`,
      summary: event.summary,
      date: event.start.date,
      time: event.start.allDay ? 'All day' : eventTimeLabel({ start: { dateTime: event.start.iso } }),
    }));
}

async function calendarEventsFromIcs() {
  const url = process.env.GOOGLE_CALENDAR_ICAL_URL;
  if (!url) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'family-eink-dashboard/1.0' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return parseIcsCalendar(await res.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function calendarEventsFromGoogleApi() {
  const now = new Date();
  const end = addDays(now, CALENDAR_DAYS);
  const { stdout } = await execFileAsync('python3', [
    GOOGLE_API,
    'calendar',
    'list',
    '--calendar', FAMILY_CALENDAR_ID,
    '--start', localIso(now),
    '--end', localIso(end),
    '--max', String(CALENDAR_MAX),
  ], { timeout: 15000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return parsed.map(event => ({
    id: event.id,
    summary: event.summary || '(untitled)',
    date: eventDateKey(event),
    time: eventTimeLabel(event),
  })).filter(event => event.summary);
}

async function calendarEvents() {
  try {
    if (process.env.EINK_CALENDAR_ENABLED === 'false') return [];
    const icsEvents = await calendarEventsFromIcs();
    if (icsEvents) return icsEvents;
    return await calendarEventsFromGoogleApi();
  } catch (err) {
    return [];
  }
}

function cleanFactText(text, max = 170) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').replace(/\[[^\]]+\]/g, '').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'family-eink-dashboard/1.0' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function onThisDay() {
  try {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const data = await fetchJson(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`);
    const events = Array.isArray(data.events) ? data.events : [];
    const event = events.find(e => String(e.text || '').length >= 40 && String(e.text || '').length <= 180) || events[0];
    if (!event) return null;
    return { title: 'On this day', text: `${event.year} — ${cleanFactText(event.text, 160)}` };
  } catch {
    return null;
  }
}

async function randomFact() {
  try {
    const data = await fetchJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
    if (data?.text) return { title: 'Random fact', text: cleanFactText(data.text, 155) };
  } catch {}
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('http://numbersapi.com/random/trivia', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) return { title: 'Random fact', text: cleanFactText(await res.text(), 155) };
  } catch {}
  return null;
}

async function facts() {
  if (process.env.EINK_FACTS_ENABLED === 'false') return { onThisDay: null, randomFact: null };
  const now = Date.now();
  if (factCache && now - factCache.createdAt < FACT_CACHE_MS) return factCache.value;
  const value = { onThisDay: await onThisDay(), randomFact: await randomFact() };
  factCache = { createdAt: now, value };
  return value;
}

export async function einkDashboard() {
  const [groceryItems, events, factData] = await Promise.all([
    listGroceryItems({ checked: 'false' }),
    calendarEvents(),
    facts(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    date: todayLocalDate(),
    calendar: events,
    grocery: groceryItems.slice(0, 12).map(item => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      category: item.category,
      store: item.store,
    })),
    ...factData,
  };
}
