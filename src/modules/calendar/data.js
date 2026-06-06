import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GOOGLE_API = process.env.GOOGLE_API_SCRIPT || `${process.env.HERMES_HOME || `${process.env.HOME}/.hermes`}/skills/productivity/google-workspace/scripts/google_api.py`;
const FAMILY_CALENDAR_ID = process.env.FAMILY_CALENDAR_ID || 'family12925651382350424080@group.calendar.google.com';
const CALENDAR_DAYS = Number(process.env.EINK_CALENDAR_DAYS || 14);
const CALENDAR_MAX = Number(process.env.EINK_CALENDAR_MAX || 8);

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

function slugCalendarId(label, index) {
  return String(label || `calendar-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `calendar-${index + 1}`;
}

function normalizeCalendarSource(source, index = 0) {
  if (!source?.url) return null;
  const label = String(source.label || source.name || (index === 0 ? 'Calendar' : `Calendar ${index + 1}`));
  return {
    id: String(source.id || slugCalendarId(label, index)),
    label,
    color: source.color || ['#f6c944', '#7dd3fc', '#f0abfc', '#86efac', '#fb7185'][index % 5],
    url: String(source.url),
  };
}

function defaultCalendarSource() {
  return normalizeCalendarSource({
    id: process.env.GOOGLE_CALENDAR_ICAL_ID || 'primary',
    label: process.env.GOOGLE_CALENDAR_ICAL_LABEL || 'Primary',
    color: process.env.GOOGLE_CALENDAR_ICAL_COLOR || '#f6c944',
    url: process.env.GOOGLE_CALENDAR_ICAL_URL,
  }, 0);
}

function calendarSourcesFromEnv() {
  const multi = process.env.GOOGLE_CALENDAR_ICAL_URLS;
  if (multi) {
    try {
      const parsed = JSON.parse(multi);
      if (Array.isArray(parsed)) return parsed.map(normalizeCalendarSource).filter(Boolean);
    } catch {
      return multi.split(/\n+/).map((line, index) => {
        const [label, url, color] = line.split('|').map(part => part?.trim());
        return normalizeCalendarSource({ label, url, color }, index);
      }).filter(Boolean);
    }
  }
  const single = defaultCalendarSource();
  return single ? [single] : [];
}

function publicCalendarSource(source) {
  return source ? { id: source.id, label: source.label, color: source.color } : null;
}

function calendarEventsResult(events, calendars, includeCalendars) {
  return includeCalendars ? { events, calendars: calendars.map(publicCalendarSource).filter(Boolean) } : events;
}

function parseIcsCalendar(text, now = new Date(), days = CALENDAR_DAYS, max = CALENDAR_MAX, source = defaultCalendarSource()) {
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
      sourceId: source?.id || 'primary',
      sourceLabel: source?.label || 'Primary',
      sourceColor: source?.color || '#f6c944',
    }));
}

async function calendarEventsFromIcsSource(source) {
  if (!source?.url) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(source.url, { signal: controller.signal, headers: { 'User-Agent': 'family-eink-dashboard/1.0' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return parseIcsCalendar(await res.text(), new Date(), CALENDAR_DAYS, CALENDAR_MAX, source);
  } finally {
    clearTimeout(timeout);
  }
}

async function calendarEventsFromIcsSources() {
  const sources = calendarSourcesFromEnv();
  if (!sources.length) return null;
  const settled = await Promise.allSettled(sources.map(source => calendarEventsFromIcsSource(source)));
  const events = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  return {
    events: events.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, CALENDAR_MAX),
    calendars: sources,
  };
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
  const source = { id: 'google-api', label: 'Family', color: '#7dd3fc' };
  return parsed.map(event => ({
    id: event.id,
    summary: event.summary || '(untitled)',
    date: eventDateKey(event),
    time: eventTimeLabel(event),
    sourceId: source.id,
    sourceLabel: source.label,
    sourceColor: source.color,
  })).filter(event => event.summary);
}

export async function calendarEvents({ respectEnabled = true, includeCalendars = false } = {}) {
  try {
    if (respectEnabled && process.env.EINK_CALENDAR_ENABLED === 'false') return calendarEventsResult([], [], includeCalendars);
    const icsResult = await calendarEventsFromIcsSources();
    if (icsResult) return calendarEventsResult(icsResult.events, icsResult.calendars, includeCalendars);
    const apiEvents = await calendarEventsFromGoogleApi();
    return calendarEventsResult(apiEvents, [{ id: 'google-api', label: 'Family', color: '#7dd3fc' }], includeCalendars);
  } catch (err) {
    return calendarEventsResult([], [], includeCalendars);
  }
}
