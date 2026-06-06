import test from 'node:test';
import assert from 'node:assert/strict';
import { modules, findModuleById, appPageRoutes } from '../src/modules/registry.js';
import { calendarEvents } from '../src/modules/calendar/data.js';
import { registerCalendarRoutes } from '../src/modules/calendar/api.js';
import { listDocuments } from '../src/modules/documents/data.js';
import { registerDocumentRoutes } from '../src/modules/documents/api.js';
import { registerTaskRoutes } from '../src/modules/tasks/api.js';
import { registerGroceryRoutes } from '../src/modules/grocery/api.js';

test('static household modules registry describes existing first-party modules', () => {
  const ids = modules.map(module => module.id);
  assert.deepEqual(ids, ['home', 'tasks', 'calendar', 'grocery', 'documents', 'tips', 'chat', 'settings']);

  const calendar = findModuleById('calendar');
  assert.equal(calendar.label, 'Calendar');
  assert.equal(calendar.href, '/calendar');
  assert.equal(calendar.apiBase, '/api/calendar');
  assert.deepEqual(calendar.profiles, ['family', 'justin', 'kari']);

  const documents = findModuleById('documents');
  assert.equal(documents.navLabel, 'Docs');
  assert.deepEqual(documents.routes, ['/documents']);
  assert.ok(appPageRoutes.includes('/documents'));
  assert.ok(appPageRoutes.includes('/today'));

  const tasks = findModuleById('tasks');
  assert.equal(tasks.apiBase, '/api/tasks');
  assert.deepEqual(tasks.routes, ['/inbox', '/today', '/future', '/projects', '/done']);

  const grocery = findModuleById('grocery');
  assert.equal(grocery.apiBase, '/api/grocery');
  assert.deepEqual(grocery.routes, ['/grocery']);

  const tips = findModuleById('tips');
  assert.equal(tips.href, '/tips');
  assert.deepEqual(tips.profiles, ['kari']);
  assert.ok(appPageRoutes.includes('/tips'));

  const chat = findModuleById('chat');
  assert.equal(chat.href, '/chat');
  assert.deepEqual(chat.profiles, ['family', 'justin', 'kari', 'cohen', 'hudson']);
  assert.ok(appPageRoutes.includes('/chat'));
});

test('calendar module owns calendar data and route registration', async () => {
  const previousIcalUrl = process.env.GOOGLE_CALENDAR_ICAL_URL;
  const previousIcalUrls = process.env.GOOGLE_CALENDAR_ICAL_URLS;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const dayAfter = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const personalIcs = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:personal-calendar-1\nDTSTART;VALUE=DATE:${tomorrow}\nSUMMARY:Personal calendar event\nEND:VEVENT\nEND:VCALENDAR\n`;
  const familyIcs = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:family-calendar-1\nDTSTART;VALUE=DATE:${dayAfter}\nSUMMARY:Family calendar event\nEND:VEVENT\nEND:VCALENDAR\n`;

  delete process.env.GOOGLE_CALENDAR_ICAL_URL;
  process.env.GOOGLE_CALENDAR_ICAL_URLS = JSON.stringify([
    { id: 'personal', label: 'Personal', color: '#f6c944', url: `data:text/calendar,${encodeURIComponent(personalIcs)}` },
    { id: 'family', label: 'Family', color: '#7dd3fc', url: `data:text/calendar,${encodeURIComponent(familyIcs)}` },
  ]);

  try {
    const { events, calendars } = await calendarEvents({ respectEnabled: false, includeCalendars: true });
    assert.equal(events.length, 2);
    assert.deepEqual(calendars.map(calendar => calendar.id), ['personal', 'family']);
    assert.equal(events[0].sourceId, 'personal');
    assert.equal(events[0].sourceLabel, 'Personal');
    assert.equal(events[1].sourceId, 'family');
    assert.equal(typeof registerCalendarRoutes, 'function');
  } finally {
    if (previousIcalUrl === undefined) delete process.env.GOOGLE_CALENDAR_ICAL_URL; else process.env.GOOGLE_CALENDAR_ICAL_URL = previousIcalUrl;
    if (previousIcalUrls === undefined) delete process.env.GOOGLE_CALENDAR_ICAL_URLS; else process.env.GOOGLE_CALENDAR_ICAL_URLS = previousIcalUrls;
  }
});

test('documents module owns placeholder data and route registration', () => {
  const docs = listDocuments();
  assert.ok(docs.length >= 5);
  assert.ok(docs.every(doc => doc.source === 'placeholder'));
  assert.ok(docs.some(doc => doc.category === 'Insurance Cards'));
  assert.equal(typeof registerDocumentRoutes, 'function');
});

test('tasks and grocery modules expose API route registration wrappers', () => {
  assert.equal(typeof registerTaskRoutes, 'function');
  assert.equal(typeof registerGroceryRoutes, 'function');
});

