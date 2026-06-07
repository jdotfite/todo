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
  assert.match(js, /mobile-filters/);
  assert.match(js, /completed/);
  assert.match(js, /data-group-by="project"/);
});

test('task cards expose inline sub todo lists', () => {
  const js = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(js, /function subtasksHtml/);
  assert.match(js, /subtask-add/);
  assert.match(js, /\/api\/tasks\/\$\{task\.dataset\.id\}\/subtasks/);
  assert.match(js, /class="subtask-check"/);
  assert.match(js, /contenteditable="true" data-field="subtask-title"/);
  assert.match(js, /title: title/);
  assert.match(css, /\.subtask-list/);
  assert.match(css, /\.subtask-add/);
});

test('task composer clarifies projects and uses readable dark form controls', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(html, /placeholder="Project"/);
  assert.doesNotMatch(html, /id="new-project"[^>]*value="inbox"/);
  assert.match(css, /::-webkit-calendar-picker-indicator/);
  assert.match(css, /filter: invert\(1\)/);
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

test('mobile stylesheet follows the clean dark reference hierarchy', () => {
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(css, /Dark clean mobile direction/);
  assert.match(css, /--lemon: #ffd60a/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*body \{ background: #151515;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.composer:not\(\.is-open\) input:not\(#new-title\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.fab-add::before/);
  assert.match(css, /Exact-match mobile polish/);
  assert.match(css, /User screenshot correction pass/);
  assert.match(css, /\.mobile-appbar/);
  assert.match(css, /\.fab-add::after/);
  assert.match(css, /radial-gradient\(circle, #858585 2px/);
  assert.match(css, /\.task-menu/);
  assert.match(css, /\.mobile-add-panel/);
});

test('grocery page exposes recent re-add chips for family shopping', () => {
  const js = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(js, /\/api\/grocery\/recent/);
  assert.match(js, /class="recent-grocery /);
  assert.match(js, /class="recent-grocery-chip"/);
  assert.match(js, /class="recent-grocery-delete"/);
  assert.match(js, /Hold item to delete/);
  assert.match(js, /quick-readd-delete-mode/);
  assert.match(js, /Remove from quick re-add/);
  assert.match(js, /\/api\/grocery\/\$\{.*\}\/readd/);
  assert.match(js, /method: 'DELETE'/);
  assert.match(css, /\.recent-grocery/);
  assert.match(css, /\.recent-grocery-chip/);
  assert.match(css, /\.recent-grocery-delete/);
  assert.match(css, /wobble-delete/);
});


test('grocery mobile route behaves like a focused shopping PWA', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const js = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.doesNotMatch(html, /onclick="document\.querySelector\('\.quick-add'\)/);
  assert.match(js, /function setBodyView/);
  assert.match(js, /document\.body\.dataset\.view/);
  assert.match(js, /viewKey === 'grocery' \? 'Add grocery item' : viewKey === 'home' \? 'Capture item' : 'Add task'/);
  assert.match(js, /function openPrimaryAdd/);
  assert.match(js, /#grocery-title/);
  assert.match(css, /Grocery PWA focus/);
  assert.match(css, /body\[data-view="grocery"\] \.quick-add/);
  assert.match(css, /body\[data-view="grocery"\] \.fab-add::after[\s\S]*Add grocery item/);
});


test('walmart grocery links prefer in-store fulfillment search results', () => {
  const js = readFileSync('public/app.js', 'utf8');

  assert.match(js, /new URLSearchParams/);
  assert.match(js, /fulfillment_method_in_store:In-store/);
  assert.match(js, /https:\/\/www\.walmart\.com\/search\?\$\{query\.toString\(\)\}/);
});


test('household hub adds home and calendar app views', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const js = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(html, /data-nav="\/home"/);
  assert.match(html, /data-nav="\/calendar"/);
  assert.match(js, /function renderHome/);
  assert.match(js, /function renderCalendar/);
  assert.match(js, /\/api\/calendar/);
  assert.match(js, /Family Calendar/);
  assert.match(css, /\.hub-grid/);
  assert.match(css, /\.calendar-list/);
});
test('brand and navigation polish uses favicon, flat yellow, and cleaner sidebar icons', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');

  assert.match(html, /rel="icon" href="\/icon\.svg"/);
  assert.match(html, /rel="apple-touch-icon" href="\/icon\.svg"/);
  assert.match(html, /styles\.css\?v=hub-pwa-33/);
  assert.match(html, /app\.js\?v=hub-pwa-33/);
  assert.match(html, /<img src="\/house-logo\.svg" alt="" \/>/);
  assert.match(html, /<a href="\/home" data-nav="\/home"><span>🏠<\/span> Home<\/a>/);
  assert.match(html, /<a href="\/inbox" data-nav="\/inbox"><span>↧<\/span> Inbox<\/a>/);
  assert.match(html, /<a href="\/projects" data-nav="\/projects"><span>▦<\/span> Projects<\/a>/);
  assert.doesNotMatch(html, /data-nav="\/eink"/);
  assert.match(css, /Final brand\/accent cleanup/);
  assert.match(css, /Sidebar icon normalization/);
  assert.match(css, /\.brand-mark[\s\S]*border-radius: 9px/);
  assert.match(css, /\.brand-mark img[\s\S]*width: 34px/);
  assert.match(css, /\.walmart-link,[\s\S]*font-weight: 500/);
  assert.match(css, /recent-grocery-chip:hover[\s\S]*background: #303030/);
});

test('household hub includes documents, capture, sticky navigation, and PWA home launch', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const js = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  const sw = readFileSync('public/service-worker.js', 'utf8');
  const documents = readFileSync('src/documents.js', 'utf8');
  const icon = readFileSync('public/icon.svg', 'utf8');
  const houseLogo = readFileSync('public/house-logo.svg', 'utf8');

  assert.match(html, /<title>Household Hub<\/title>/);
  assert.match(html, /data-nav="\/documents"/);
  assert.match(html, /styles\.css\?v=hub-pwa-33/);
  assert.match(html, /app\.js\?v=hub-pwa-33/);
  assert.match(js, /function renderDocuments/);
  assert.match(js, /function quickCapture/);
  assert.match(js, /\/api\/documents/);
  assert.match(documents, /Insurance Cards/);
  assert.match(css, /\.sticky-hub-nav/);
  assert.match(css, /\.document-grid/);
  assert.match(css, /Mobile overflow guardrails for the household hub routes/);
  assert.match(css, /Mobile nav whitespace\/scroll polish/);
  assert.match(css, /\.mobile-category-nav[\s\S]*overflow-x: auto/);
  assert.match(css, /\.mobile-category-nav[\s\S]*-webkit-overflow-scrolling: touch/);
  assert.match(css, /\.mobile-appbar[\s\S]*height: 0/);
  assert.match(css, /body\[data-view="home"\] main,[\s\S]*body\[data-view="documents"\] main[\s\S]*padding-inline: 16px/);
  assert.match(css, /\.calendar-event,[\s\S]*\.document-card[\s\S]*border-radius/);
  assert.match(css, /\.document-card strong,[\s\S]*overflow-wrap: anywhere/);
  assert.match(css, /body\[data-view="home"\] \.fab-add::after[\s\S]*Add/);
  assert.equal(manifest.name, 'Household Hub');
  assert.equal(manifest.short_name, 'Hub');
  assert.equal(manifest.start_url, '/home');
  assert.match(sw, /todo-hub-v33/);
  assert.match(sw, /STATIC_ASSETS/);
  assert.doesNotMatch(sw, /'\/home'/);
  assert.doesNotMatch(sw, /'\/calendar'/);
  assert.doesNotMatch(sw, /'\/documents'/);
  assert.match(sw, /'\/house-logo\.svg'/);
  assert.match(icon, /viewBox="0 0 512 512"/);
  assert.match(houseLogo, /viewBox="0 0 1030\.96 375\.23"/);
});

test('profile switcher renders module-aware navigation and cache-bumped PWA assets', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const js = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  const sw = readFileSync('public/service-worker.js', 'utf8');

  assert.match(html, /id="profile-switcher"/);
  assert.match(html, /data-module-nav/);
  assert.match(html, /styles\.css\?v=hub-pwa-33/);
  assert.match(html, /app\.js\?v=hub-pwa-33/);
  assert.match(js, /\/api\/profiles/);
  assert.match(js, /\/api\/profile\/select/);
  assert.match(js, /\/api\/modules/);
  assert.match(js, /function renderModuleNav/);
  assert.match(js, /async function renderWork/);
  assert.match(js, /async function renderTips/);
  assert.match(js, /if \(isMobile\(\) && threads\.length\) \{\s*await openChatThread\(threads\[0\]\.id, threads\[0\]\.title\);\s*\}/);
  assert.match(js, /data-nav="\$\{escapeAttribute\(module\.href\)\}"/);
  assert.match(css, /\.profile-switcher/);
  assert.match(css, /\.profile-pill/);
  assert.match(sw, /todo-hub-v33/);
  assert.doesNotMatch(sw, /'\/tips'/);
  assert.match(js, /chat-thread-preview/);
  assert.match(js, /chat-unread-badge/);
  assert.match(js, /\/api\/chat\/threads\/\$\{encodeURIComponent\(threadId\)\}\/read/);
  assert.match(css, /\.chat-thread-item\.unread/);
});

test('settings page can hide calendar sources from the household calendar views', () => {
  const js = readFileSync('public/app.js', 'utf8');
  const css = readFileSync('public/styles.css', 'utf8');
  const sw = readFileSync('public/service-worker.js', 'utf8');

  assert.match(js, /function renderSettings/);
  assert.match(js, /calendar-source-toggle/);
  assert.match(js, /hiddenCalendarSourceIds/);
  assert.match(js, /filterVisibleCalendarEvents/);
  assert.match(js, /sourceLabel/);
  assert.match(css, /\.settings-card/);
  assert.match(css, /\.calendar-source-chip/);
  assert.doesNotMatch(sw, /'\/settings'/);
});

test('app navigation stays in the loaded shell and service worker falls back to cached assets', () => {
  const js = readFileSync('public/app.js', 'utf8');
  const sw = readFileSync('public/service-worker.js', 'utf8');

  assert.match(js, /const APP_ROUTES = new Set/);
  assert.match(js, /function bindAppNavigation/);
  assert.match(js, /event\.preventDefault\(\);\s*\n\s*navigateTo\(url\.pathname \+ url\.search \+ url\.hash\)/);
  assert.match(js, /window\.addEventListener\('popstate'/);
  assert.doesNotMatch(js, /if \(e\.key === '1'\) location\.href = '\/home'/);
  assert.match(sw, /request\.mode === 'navigate'\) return/);
  assert.match(sw, /cache\.match\(url\.pathname\)/);
  assert.match(sw, /await fetch\(request\)/);
  assert.match(sw, /if \(cached\) return cached/);
  assert.match(sw, /ignoreSearch: true/);
});
