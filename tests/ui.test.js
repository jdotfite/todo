import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('app shell includes desktop project-management chrome and mobile-friendly quick add', () => {
  const html = readFileSync('public/index.html', 'utf8');

  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /class="mobile-greeting"/);
  assert.match(html, /class="composer quick-add"/);
});

test('frontend renders inspiration-driven summary cards and grouped work sections', () => {
  const js = readFileSync('public/app.js', 'utf8');

  assert.match(js, /function summaryCards/);
  assert.match(js, /function workSectionsHtml/);
  assert.match(js, /class="summary-grid"/);
  assert.match(js, /class="work-section/);
  assert.match(js, /data-group-by="project"/);
});

test('stylesheet includes responsive mobile card UI and desktop task table affordances', () => {
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(css, /--lavender/);
  assert.match(css, /\.summary-card/);
  assert.match(css, /\.work-section-header/);
  assert.match(css, /\.task-table-head/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\.fab-add/);
});
