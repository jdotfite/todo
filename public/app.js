const $ = sel => document.querySelector(sel);
const content = $('#content');
let activeFilter = 'all';
let draggedId = null;
let quickReaddDeleteMode = false;
let activeProfile = null;
let activeModules = [];

function todayString() { return new Date().toISOString().slice(0, 10); }
function routeView() {
  const path = location.pathname;
  if (path === '/' || path === '/home') return { key: 'home', title: 'Home', subtitle: 'Today at a glance for the whole household.', home: true };
  if (path === '/today') return { key: 'today', title: 'Today', subtitle: 'Due today, overdue, or intentionally undated.', query: 'view=today', filters: true };
  if (path === '/future') return { key: 'future', title: 'Future', subtitle: 'Scheduled tasks that are not ready for today yet.', future: true, filters: true };
  if (path === '/grocery') return { key: 'grocery', title: 'Grocery', grocery: true };
  if (path === '/calendar') return { key: 'calendar', title: 'Family Calendar', calendar: true };
  if (path === '/documents') return { key: 'documents', title: 'Documents', documents: true };
  if (path === '/tips') return { key: 'tips', title: 'Tips', tips: true };
  if (path === '/done') return { key: 'done', title: 'Done', subtitle: 'Completed tasks.', query: 'view=done' };
  if (path === '/projects') return { key: 'projects', title: 'Projects', projects: true };
  return { key: 'inbox', title: 'Inbox', subtitle: 'Unsorted tasks waiting to be clarified or scheduled.', query: 'view=inbox', filters: true };
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error('Authentication required');
  }
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

async function render() {
  await loadProfileChrome();
  setActiveNav();
  await refreshProjectOptions();
  const view = routeView();
  setBodyView(view.key);
  if (view.home) return renderHome();
  if (view.calendar) return renderCalendar();
  if (view.documents) return renderDocuments();
  if (view.tips) return renderTips();
  if (view.projects) return renderProjects();
  if (view.grocery) return renderGrocery();

  const { tasks: allOpenTasks } = await api('/api/tasks?status=open');
  let tasks;
  if (activeFilter === 'completed' && !view.grocery && !view.projects) {
    ({ tasks } = await api('/api/tasks?status=done'));
  } else if (view.future) {
    tasks = allOpenTasks.filter(t => t.dueDate && t.dueDate > todayString());
  } else {
    ({ tasks } = await api(`/api/tasks?${view.query}`));
  }
  tasks = applyFilter(tasks);
  content.innerHTML = summaryCards(allOpenTasks) + viewHeader(view.title, view.subtitle, view.filters, tasks.length) + (tasks.length ? workSectionsHtml(tasks) : emptyState(view.title));
  bindTaskControls();
}

function applyFilter(tasks) {
  const today = todayString();
  if (activeFilter === 'overdue') return tasks.filter(t => t.status === 'open' && t.dueDate && t.dueDate < today);
  if (activeFilter === 'no-date') return tasks.filter(t => t.status === 'open' && !t.dueDate);
  if (activeFilter === 'waiting') return tasks.filter(t => t.waiting);
  if (activeFilter === 'eink') return tasks.filter(t => t.showOnEink);
  if (activeFilter === 'completed') return tasks.filter(t => t.status === 'done');
  if (activeFilter === 'uncompleted') return tasks.filter(t => t.status !== 'done');
  return tasks;
}

function summaryCards(tasks) {
  const today = todayString();
  const counts = {
    today: tasks.filter(t => !t.dueDate || t.dueDate <= today).length,
    scheduled: tasks.filter(t => t.dueDate && t.dueDate > today).length,
    all: tasks.length,
    overdue: tasks.filter(t => t.dueDate && t.dueDate < today).length,
  };
  return `<section class="summary-grid" aria-label="Task summary">
    <a class="summary-card lavender" href="/today"><span class="summary-icon">◷</span><span>Today</span><strong>${counts.today}</strong></a>
    <a class="summary-card lemon" href="/future"><span class="summary-icon">▣</span><span>Scheduled</span><strong>${counts.scheduled}</strong></a>
    <a class="summary-card mint" href="/inbox"><span class="summary-icon">□</span><span>All Open</span><strong>${counts.all}</strong></a>
    <button class="summary-card pink" data-filter="overdue"><span class="summary-icon">!</span><span>Overdue</span><strong>${counts.overdue}</strong></button>
  </section>`;
}

function viewHeader(title, subtitle = '', showFilters = false, count = null) {
  const mobileTitle = title === 'Today' ? 'Today’s Task' : title;
  const countLabel = Number.isInteger(count) ? ` (${count})` : '';
  const eyebrow = title === 'Home' ? 'Household Hub' : title === 'Family Calendar' ? 'Family Calendar' : title === 'Documents' ? 'Household Documents' : 'Personal tasks';
  return `<div class="mobile-appbar" aria-label="Mobile navigation"><button type="button" onclick="history.length > 1 ? history.back() : location.href='/home'" aria-label="Back">‹</button></div>
    ${mobileCategoryNav()}
    <div class="view-header"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2><h2 class="mobile-page-title">${escapeHtml(mobileTitle)}<span>${countLabel}</span></h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p><p class="mobile-modified">Last modified: Today</p>` : ''}</div>${showFilters ? filterBar() : ''}</div>`;
}

function mobileCategoryNav() {
  const path = location.pathname === '/' ? '/home' : location.pathname;
  const modules = activeModules.length ? activeModules : [
    { href: '/home', navLabel: 'Home' },
    { href: '/today', navLabel: 'Today' },
    { href: '/calendar', navLabel: 'Calendar' },
    { href: '/grocery', navLabel: 'Grocery' },
    { href: '/documents', navLabel: 'Docs' },
    { href: '/inbox', navLabel: 'Inbox' },
    { href: '/future', navLabel: 'Future' },
    { href: '/done', navLabel: 'Done' },
  ];
  const links = modules.flatMap(module => module.id === 'tasks'
    ? [
      { href: '/today', navLabel: 'Today' },
      { href: '/inbox', navLabel: 'Inbox' },
      { href: '/future', navLabel: 'Future' },
      { href: '/done', navLabel: 'Done' },
    ]
    : [module]);
  return `<nav class="mobile-category-nav" aria-label="Categories">${links.map(module => `<a href="${escapeAttribute(module.href)}" class="${path === module.href ? 'active' : ''}">${escapeHtml(module.navLabel || module.label)}</a>`).join('')}</nav>`;
}

function filterBar() {
  const filters = [['all', 'All'], ['overdue', 'Overdue'], ['no-date', 'No date'], ['waiting', 'Waiting'], ['eink', 'E-ink']];
  const mobileFilters = [['all', 'All'], ['completed', 'Completed'], ['uncompleted', 'Uncompleted']];
  return `<div class="filters desktop-filters">${filters.map(([id, label]) => `<button class="filter ${activeFilter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div>
    <div class="filters mobile-filters">${mobileFilters.map(([id, label]) => `<button class="filter ${activeFilter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div>`;
}

function emptyState(title) {
  const messages = {
    Today: 'Nothing pressing today. Add a task above or schedule an inbox item.',
    Future: 'No future-dated tasks yet. Add a task with a due date after today.',
    Inbox: 'Inbox is clear. Nice.',
    Done: 'No completed tasks yet.',
  };
  return `<div class="empty-state">${messages[title] || 'Nothing here yet.'}</div>`;
}

function workSectionsHtml(tasks) {
  const groups = tasks.reduce((acc, task) => {
    const key = task.project || 'inbox';
    (acc[key] ||= []).push(task);
    return acc;
  }, {});
  return `<div class="work-list" data-group-by="project">${Object.entries(groups).map(([project, group], index) => `
    <section class="work-section tone-${index % 4}">
      <header class="work-section-header">
        <span class="status-dot"></span>
        <strong>${escapeHtml(labelizeProject(project))}</strong>
        <span class="section-count">${group.length}</span>
        <button type="button" class="section-add" onclick="document.querySelector('.quick-add').classList.add('is-open');document.querySelector('#new-project').value='${escapeAttribute(project)}';document.querySelector('#new-title').focus()">+</button>
      </header>
      <div class="task-table-head" aria-hidden="true"><span>Name</span><span>Project</span><span>Due date</span><span>Flags</span><span></span></div>
      <div class="task-list">${group.map(taskHtml).join('')}</div>
    </section>`).join('')}</div>`;
}

function labelizeProject(project) {
  if (!project) return 'Inbox';
  return project.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function taskHtml(t) {
  const dueCell = t.dueDate ? `<span class="due-text">${escapeHtml(t.dueDate)}</span>` : '';
  const recur = t.recurrence && t.recurrence !== 'none' ? `<span class="meta-token">↻ ${escapeHtml(t.recurrence)}</span>` : '';
  const status = t.status === 'done' ? ' done' : '';
  const project = t.project || 'inbox';
  const flags = [
    t.showOnEink ? '<span class="meta-token">e-ink</span>' : '',
    t.waiting ? '<span class="meta-token waiting">waiting</span>' : '',
    t.status === 'done' ? '<span class="meta-token done">done</span>' : '',
  ].join('');
  return `<article class="task${status}" draggable="true" data-id="${t.id}">
    <button class="complete" title="Complete" aria-label="Complete task">Complete</button>
    <div class="task-main">
      <strong class="task-title" contenteditable="true" data-field="title">${escapeHtml(t.title)}</strong>
      <div class="meta"><span class="meta-token project">${escapeHtml(labelizeProject(project))}</span>${recur}${flags}</div>
      ${subtasksHtml(t)}
      <details class="task-editors">
        <summary>Edit</summary>
        <div class="editor-grid">
          <label>Due <input class="due-input" type="date" value="${escapeHtml(t.dueDate || '')}"></label>
          <label>Project <input class="project-input" value="${escapeHtml(project)}" list="project-options"></label>
          <label>Repeat <select class="recurrence-input">${['none','daily','weekly','monthly'].map(r => `<option value="${r}" ${t.recurrence === r ? 'selected' : ''}>${r === 'none' ? 'none' : r}</option>`).join('')}</select></label>
        </div>
      </details>
    </div>
    <div class="task-due-cell">${dueCell}</div>
    <div class="task-actions">
      <button class="waiting-toggle ${t.waiting ? 'active' : ''}" title="Toggle waiting">${t.waiting ? 'Waiting' : 'Wait'}</button>
      <button class="eink-toggle" title="Toggle e-ink">${t.showOnEink ? 'Hide e-ink' : 'E-ink'}</button>
      <span class="task-menu drag-handle" title="Drag to reorder" aria-hidden="true"></span>
    </div>
  </article>`;
}

function subtasksHtml(t) {
  const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
  return `<div class="subtask-list" aria-label="Sub todo list">
    ${subtasks.map(item => `<label class="subtask ${item.checked ? 'checked' : ''}" data-id="${escapeAttribute(item.id)}"><input class="subtask-check" type="checkbox" ${item.checked ? 'checked' : ''}> <span contenteditable="true" data-field="subtask-title">${escapeHtml(item.title)}</span><button type="button" class="subtask-delete" aria-label="Delete sub todo">×</button></label>`).join('')}
    <div class="subtask-add"><input placeholder="Add sub todo…"><button type="button">+</button></div>
  </div>`;
}

function bindTaskControls() {
  document.querySelectorAll('.filter, .summary-card[data-filter]').forEach(btn => btn.onclick = () => { activeFilter = btn.dataset.filter; render(); });
  document.querySelectorAll('.complete').forEach(btn => btn.onclick = async e => {
    const id = e.target.closest('.task').dataset.id;
    await api(`/api/tasks/${id}/complete`, { method: 'POST' });
    render();
  });
  document.querySelectorAll('.eink-toggle').forEach(btn => btn.onclick = async e => {
    const task = e.target.closest('.task');
    await patchTask(task, { showOnEink: btn.textContent !== 'Hide e-ink' });
  });
  document.querySelectorAll('.waiting-toggle').forEach(btn => btn.onclick = async e => {
    const task = e.target.closest('.task');
    await patchTask(task, { waiting: !btn.classList.contains('active') });
  });
  document.querySelectorAll('.due-input').forEach(el => el.onchange = async e => patchTask(e.target.closest('.task'), { dueDate: e.target.value || null }));
  document.querySelectorAll('.project-input').forEach(el => el.onchange = async e => patchTask(e.target.closest('.task'), { project: e.target.value || 'inbox' }));
  document.querySelectorAll('.recurrence-input').forEach(el => el.onchange = async e => patchTask(e.target.closest('.task'), { recurrence: e.target.value }));
  document.querySelectorAll('.subtask-check').forEach(el => el.onchange = async e => {
    const task = e.target.closest('.task');
    const subtask = e.target.closest('.subtask');
    await api(`/api/tasks/${task.dataset.id}/subtasks/${subtask.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ checked: e.target.checked }) });
    render();
  });
  document.querySelectorAll('.subtask-delete').forEach(btn => btn.onclick = async e => {
    e.preventDefault();
    const task = e.target.closest('.task');
    const subtask = e.target.closest('.subtask');
    await api(`/api/tasks/${task.dataset.id}/subtasks/${subtask.dataset.id}`, { method: 'DELETE' });
    render();
  });
  document.querySelectorAll('[data-field="subtask-title"]').forEach(el => {
    el.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.currentTarget.blur();
      }
    };
    el.onblur = async e => {
      const task = e.target.closest('.task');
      const subtask = e.target.closest('.subtask');
      const title = e.target.textContent.trim();
      if (title) {
        await api(`/api/tasks/${task.dataset.id}/subtasks/${subtask.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ title: title }) });
        render();
      } else {
        render();
      }
    };
  });
  document.querySelectorAll('.subtask-add').forEach(row => {
    const input = row.querySelector('input');
    const add = async () => {
      const title = input.value.trim();
      if (!title) return;
      const task = row.closest('.task');
      await api(`/api/tasks/${task.dataset.id}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) });
      render();
    };
    row.querySelector('button').onclick = add;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  });
  document.querySelectorAll('[contenteditable][data-field="title"]').forEach(el => el.onblur = async e => {
    const task = e.target.closest('.task');
    const title = e.target.textContent.trim();
    if (title) await patchTask(task, { title }); else render();
  });
  bindDragDrop();
}

async function patchTask(task, patch) {
  await api(`/api/tasks/${task.dataset.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  render();
}

function bindDragDrop() {
  document.querySelectorAll('.task').forEach(task => {
    task.addEventListener('dragstart', e => { draggedId = task.dataset.id; task.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    task.addEventListener('dragend', () => { task.classList.remove('dragging'); draggedId = null; });
    task.addEventListener('dragover', e => { e.preventDefault(); task.classList.add('drop-target'); });
    task.addEventListener('dragleave', () => task.classList.remove('drop-target'));
    task.addEventListener('drop', async e => {
      e.preventDefault();
      task.classList.remove('drop-target');
      if (!draggedId || draggedId === task.dataset.id) return;
      await reorderTaskIds(draggedId, task.dataset.id);
    });
  });
  bindTouchReorder();
}

async function reorderTaskIds(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const list = [...document.querySelectorAll('.task')].map(el => el.dataset.id);
  const from = list.indexOf(fromId);
  const to = list.indexOf(toId);
  if (from < 0 || to < 0) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  await api('/api/tasks/reorder', { method: 'POST', body: JSON.stringify({ ids: list }) });
  render();
}

function bindTouchReorder() {
  const handles = document.querySelectorAll('.drag-handle');
  handles.forEach(handle => {
    let holdTimer = null;
    let active = false;
    let sourceTask = null;
    let targetTask = null;

    const clearDragState = () => {
      clearTimeout(holdTimer);
      document.body.classList.remove('touch-reordering');
      sourceTask?.classList.remove('dragging', 'touch-dragging');
      targetTask?.classList.remove('drop-target');
      handle.releasePointerCapture?.(handle._pointerId);
      active = false;
      sourceTask = null;
      targetTask = null;
    };

    handle.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      sourceTask = handle.closest('.task');
      targetTask = sourceTask;
      handle._pointerId = e.pointerId;
      handle.setPointerCapture?.(e.pointerId);
      holdTimer = setTimeout(() => {
        active = true;
        sourceTask.classList.add('dragging', 'touch-dragging');
        document.body.classList.add('touch-reordering');
        if (navigator.vibrate) navigator.vibrate(12);
      }, 140);
    });

    handle.addEventListener('pointermove', e => {
      if (!active) return;
      e.preventDefault();
      const previousTarget = targetTask;
      handle.style.pointerEvents = 'none';
      const underFinger = document.elementFromPoint(e.clientX, e.clientY)?.closest('.task');
      handle.style.pointerEvents = '';
      if (!underFinger || underFinger === sourceTask) return;
      targetTask = underFinger;
      if (previousTarget !== targetTask) previousTarget?.classList.remove('drop-target');
      targetTask.classList.add('drop-target');
    });

    handle.addEventListener('pointerup', async e => {
      if (!active) {
        clearDragState();
        return;
      }
      e.preventDefault();
      const fromId = sourceTask?.dataset.id;
      const toId = targetTask?.dataset.id;
      clearDragState();
      await reorderTaskIds(fromId, toId);
    });

    handle.addEventListener('pointercancel', clearDragState);
  });
}

async function renderHome() {
  setActiveNav();
  setBodyView('home');
  const [{ tasks: allOpenTasks }, { events }, { items: groceryItems }, { documents }] = await Promise.all([
    api('/api/tasks?status=open'),
    api('/api/calendar'),
    api('/api/grocery'),
    api('/api/documents'),
  ]);
  const today = todayString();
  const todayTasks = allOpenTasks.filter(t => !t.dueDate || t.dueDate <= today).slice(0, 5);
  const upcoming = events.slice(0, 5);
  const activeGrocery = groceryItems.filter(i => !i.checked);
  const featuredDocs = documents.slice(0, 4);
  content.innerHTML = viewHeader('Home', 'Family calendar, tasks, grocery, and docs in one sticky PWA.', false, todayTasks.length) + `
    <section class="hub-hero">
      <div><p class="eyebrow">Household Hub</p><h3>${friendlyDate(new Date())}</h3><p>One clean place for the family source of truth. E-paper is now an output; this is the control center.</p></div>
      <div class="quick-capture-card"><label for="hub-capture">Quick capture</label><div><input id="hub-capture" placeholder="task, grocery milk, note, reminder…"><button id="hub-capture-add">Capture</button></div><small>Routes grocery/walmart text automatically; everything else becomes a task for now.</small></div>
    </section>
    <section class="hub-grid">
      ${hubPanel('Today', '/today', todayTasks.length ? todayTasks.map(t => `<li><span>☐</span><strong>${escapeHtml(t.title)}</strong></li>`).join('') : '<li class="muted-row">No pressing tasks.</li>')}
      ${hubPanel('Family Calendar', '/calendar', upcoming.length ? upcoming.map(calendarEventRow).join('') : '<li class="muted-row">No upcoming events.</li>')}
      ${hubPanel('Grocery', '/grocery', `<li><span>🛒</span><strong>${activeGrocery.length} open item${activeGrocery.length === 1 ? '' : 's'}</strong></li>${activeGrocery.slice(0, 4).map(i => `<li><span>•</span>${escapeHtml(i.quantity ? i.quantity + ' ' : '')}${escapeHtml(i.title)}</li>`).join('')}`)}
      ${hubPanel('Documents', '/documents', featuredDocs.map(doc => `<li><span>${escapeHtml(doc.icon)}</span><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.category)}</small></li>`).join(''))}
    </section>`;
  $('#hub-capture-add').onclick = quickCapture;
  $('#hub-capture').addEventListener('keydown', e => { if (e.key === 'Enter') quickCapture(); });
}

function hubPanel(title, href, body) {
  return `<article class="hub-panel"><header><h3>${escapeHtml(title)}</h3><a href="${href}">Open →</a></header><ul>${body}</ul></article>`;
}

async function quickCapture() {
  const input = $('#hub-capture') || $('#new-title');
  const text = input?.value.trim();
  if (!text) return;
  await api('/api/quick-add', { method: 'POST', body: JSON.stringify({ text, source: 'hub' }) });
  input.value = '';
  renderHome();
}

async function renderCalendar() {
  setActiveNav();
  setBodyView('calendar');
  const { events } = await api('/api/calendar');
  const grouped = events.reduce((acc, event) => {
    (acc[event.date] ||= []).push(event);
    return acc;
  }, {});
  content.innerHTML = viewHeader('Family Calendar', '14-day read-only view from the Family Google Calendar feed.', false, events.length) + `
    <section class="calendar-shell">
      <div class="calendar-summary"><strong>${events.length}</strong><span>upcoming family event${events.length === 1 ? '' : 's'}</span><small>Private iCal URL stays server-side.</small></div>
      <div class="calendar-list">${Object.entries(grouped).length ? Object.entries(grouped).map(([date, dayEvents]) => `<section class="calendar-day"><time datetime="${escapeAttribute(date)}">${escapeHtml(formatDateLabel(date))}</time><div>${dayEvents.map(calendarEventCard).join('')}</div></section>`).join('') : '<div class="empty-state">No Family Calendar events in the current window.</div>'}</div>
    </section>`;
}

function calendarEventRow(event) {
  return `<li><span>📅</span><strong>${escapeHtml(event.summary)}</strong><small>${escapeHtml(formatDateLabel(event.date))} · ${escapeHtml(event.time)}</small></li>`;
}

function calendarEventCard(event) {
  return `<article class="calendar-event"><span>${escapeHtml(event.time)}</span><strong>${escapeHtml(event.summary)}</strong></article>`;
}

async function renderDocuments() {
  setActiveNav();
  setBodyView('documents');
  const { documents } = await api('/api/documents');
  const grouped = documents.reduce((acc, doc) => {
    (acc[doc.category] ||= []).push(doc);
    return acc;
  }, {});
  content.innerHTML = viewHeader('Documents', 'Google Drive-backed household documents are mocked here until Google auth/Drive browsing is wired.', false, documents.length) + `
    <section class="document-intro"><strong>Drive phase placeholder</strong><span>These cards define the UX and categories now; later they will store Drive file IDs instead of blobs.</span></section>
    <section class="document-grid">${Object.entries(grouped).map(([category, docs]) => `<div class="document-category"><h3>${escapeHtml(category)}</h3>${docs.map(documentCard).join('')}</div>`).join('')}</section>`;
}

function documentCard(doc) {
  return `<article class="document-card"><span class="doc-icon">${escapeHtml(doc.icon)}</span><div><strong>${escapeHtml(doc.title)}</strong><p>${escapeHtml(doc.description)}</p><small>${escapeHtml(doc.visibility)} · ${escapeHtml(doc.updated)} · ${escapeHtml(doc.source)}</small></div></article>`;
}

function formatDateLabel(date) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function friendlyDate(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

async function renderTips() {
  setActiveNav();
  setBodyView('tips');
  const today = new Date().toISOString().slice(0, 10);
  const [summary, { entries }, breakdown] = await Promise.all([api('/api/tips/summary'), api('/api/tips'), api('/api/tips/breakdown')]);
  const fmt = n => '$' + Number(n).toFixed(2).replace(/\.00$/, '');
  content.innerHTML = viewHeader('Tips', `${entries.length} shift${entries.length === 1 ? '' : 's'} logged.`) + `
    <section class="tips-summary-grid">
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(fmt(summary.thisWeek))}</span><small>This week</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(fmt(summary.thisMonth))}</span><small>This month</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(fmt(summary.avgPerShift))}</span><small>Avg / shift</small></div>
    </section>
    ${entries.length ? `<div class="tips-export-row"><a class="tips-export-btn" href="/api/tips/export.csv" download="tips-export.csv">↓ Export CSV</a></div>` : ''}
    ${tipsBreakdownHtml(breakdown)}
    <section class="hub-panel tips-log-panel">
      <header><h3>Log Shift</h3></header>
      <form id="tips-form" class="tips-form">
        <div class="tips-form-row">
          <label>Date<input type="date" name="date" value="${escapeAttribute(today)}" required></label>
          <label>Shift<select name="shiftType"><option value="day">Day</option><option value="night">Night</option><option value="double">Double</option><option value="weekend">Weekend</option><option value="other">Other</option></select></label>
          <label>Location<input type="text" name="location" placeholder="e.g. Main St"></label>
        </div>
        <div class="tips-form-row">
          <label>Cash&nbsp;$<input type="number" name="cashTips" placeholder="0" step="0.01" min="0" value="0"></label>
          <label>Card&nbsp;$<input type="number" name="cardTips" placeholder="0" step="0.01" min="0" value="0"></label>
          <label>Hours<input type="number" name="hours" placeholder="—" step="0.5" min="0.5"></label>
        </div>
        <div class="tips-form-row tips-notes-row">
          <label class="tips-notes-label">Notes<input type="text" name="notes" placeholder="Optional…"></label>
          <button type="submit" class="tips-submit-btn">Log shift</button>
        </div>
      </form>
    </section>
    <div id="tips-shifts-list" class="tips-shifts">
      ${entries.length ? entries.map(tipShiftHtml).join('') : '<div class="empty-state">No shifts logged yet. Use the form above to add your first shift.</div>'}
    </div>`;

  $('#tips-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      date: fd.get('date'),
      shiftType: fd.get('shiftType'),
      location: fd.get('location') || '',
      cashTips: parseFloat(fd.get('cashTips')) || 0,
      cardTips: parseFloat(fd.get('cardTips')) || 0,
      notes: fd.get('notes') || '',
    };
    const hoursVal = fd.get('hours');
    if (hoursVal) data.hours = parseFloat(hoursVal);
    await api('/api/tips', { method: 'POST', body: JSON.stringify(data) });
    renderTips();
  };

  bindTipsShiftControls(entries);
}

function bindTipsShiftControls(entries) {
  content.querySelectorAll('.tips-delete-btn').forEach(btn => {
    btn.onclick = async e => {
      const card = e.currentTarget.closest('.tips-shift');
      const id = card.dataset.id;
      if (!confirm('Delete this shift?')) return;
      await api(`/api/tips/${id}`, { method: 'DELETE' });
      renderTips();
    };
  });
  content.querySelectorAll('.tips-edit-btn').forEach(btn => {
    btn.onclick = e => {
      const card = e.currentTarget.closest('.tips-shift');
      const id = card.dataset.id;
      const entry = entries.find(en => en.id === id);
      if (!entry) return;
      card.innerHTML = tipEditFormHtml(entry);
      card.querySelector('.tips-edit-form').onsubmit = async ev => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        const data = {
          date: fd.get('date'),
          shiftType: fd.get('shiftType'),
          location: fd.get('location') || '',
          cashTips: parseFloat(fd.get('cashTips')) || 0,
          cardTips: parseFloat(fd.get('cardTips')) || 0,
          notes: fd.get('notes') || '',
        };
        const hoursVal = fd.get('hours');
        if (hoursVal) data.hours = parseFloat(hoursVal);
        await api(`/api/tips/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
        renderTips();
      };
      card.querySelector('.tips-edit-cancel').onclick = () => renderTips();
    };
  });
}

function tipShiftHtml(entry) {
  const total = (Number(entry.cashTips) || 0) + (Number(entry.cardTips) || 0);
  const fmt = n => '$' + Number(n).toFixed(2).replace(/\.00$/, '');
  const meta = [entry.shiftType, entry.location, entry.hours ? entry.hours + 'h' : ''].filter(Boolean).join(' · ');
  return `<article class="tips-shift" data-id="${escapeAttribute(entry.id)}">
    <div class="tips-shift-header">
      <div><span class="tips-shift-date">${escapeHtml(formatDateLabel(entry.date))}</span><span class="tips-shift-meta">${escapeHtml(meta)}</span></div>
      <span class="tips-shift-total">${escapeHtml(fmt(total))}</span>
    </div>
    <div class="tips-shift-breakdown">
      <span>Cash ${escapeHtml(fmt(entry.cashTips))}</span>
      <span>Card ${escapeHtml(fmt(entry.cardTips))}</span>
      ${entry.notes ? `<span class="tips-shift-notes">${escapeHtml(entry.notes)}</span>` : ''}
    </div>
    <div class="tips-shift-actions">
      <button type="button" class="tips-edit-btn">Edit</button>
      <button type="button" class="tips-delete-btn">Delete</button>
    </div>
  </article>`;
}


function tipsBreakdownHtml(breakdown) {
  if (!breakdown) return '';
  const fmt = n => n > 0 ? '$' + Number(n).toFixed(2).replace(/\.00$/, '') : '';
  const hasWeekActivity = breakdown.week.some(d => d.count > 0);
  const hasMonthActivity = breakdown.month.some(w => w.count > 0);
  if (!hasWeekActivity && !hasMonthActivity) return '';

  const weekRows = breakdown.week
    .filter(d => d.count > 0)
    .map(d => `<tr><td>${escapeHtml(d.label)}</td><td class="tip-num">${escapeHtml(fmt(d.total))}</td><td class="tip-num tip-muted">Cash ${escapeHtml(fmt(d.cash))}</td><td class="tip-num tip-muted">Card ${escapeHtml(fmt(d.card))}</td><td class="tip-num tip-muted">${d.hours ? d.hours + 'h' : ''}</td></tr>`)
    .join('');

  const monthRows = breakdown.month
    .map(w => {
      const startDate = new Date(w.start + 'T12:00:00Z');
      const label = 'Week of ' + startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      return `<tr><td>${escapeHtml(label)}</td><td class="tip-num">${escapeHtml(fmt(w.total))}</td><td class="tip-num tip-muted">Cash ${escapeHtml(fmt(w.cash))}</td><td class="tip-num tip-muted">Card ${escapeHtml(fmt(w.card))}</td><td class="tip-num tip-muted">${w.hours ? w.hours + 'h' : ''}</td></tr>`;
    })
    .join('');

  const weekSection = hasWeekActivity ? `<section class="tips-breakdown-section">
    <h4>This Week</h4>
    <table class="tips-breakdown-table"><tbody>${weekRows}</tbody></table>
  </section>` : '';

  const monthSection = hasMonthActivity ? `<section class="tips-breakdown-section">
    <h4>${new Date().toLocaleDateString('en-US', { month: 'long' })}</h4>
    <table class="tips-breakdown-table"><tbody>${monthRows}</tbody></table>
  </section>` : '';

  return `<div class="tips-breakdown">${weekSection}${monthSection}</div>`;
}

function tipEditFormHtml(entry) {
  const shiftTypes = ['day', 'night', 'double', 'weekend', 'other'];
  const opts = shiftTypes.map(st => `<option value="${st}"${entry.shiftType === st ? ' selected' : ''}>${st[0].toUpperCase() + st.slice(1)}</option>`).join('');
  return `<form class="tips-form tips-edit-form" data-id="${escapeAttribute(entry.id)}">
    <div class="tips-form-row">
      <label>Date<input type="date" name="date" value="${escapeAttribute(entry.date)}" required></label>
      <label>Shift<select name="shiftType">${opts}</select></label>
      <label>Location<input type="text" name="location" value="${escapeAttribute(entry.location)}"></label>
    </div>
    <div class="tips-form-row">
      <label>Cash&nbsp;$<input type="number" name="cashTips" value="${escapeAttribute(entry.cashTips)}" step="0.01" min="0"></label>
      <label>Card&nbsp;$<input type="number" name="cardTips" value="${escapeAttribute(entry.cardTips)}" step="0.01" min="0"></label>
      <label>Hours<input type="number" name="hours" value="${escapeAttribute(entry.hours != null ? entry.hours : '')}" step="0.5" min="0.5" placeholder="—"></label>
    </div>
    <div class="tips-form-row tips-notes-row">
      <label class="tips-notes-label">Notes<input type="text" name="notes" value="${escapeAttribute(entry.notes)}"></label>
      <div class="tips-edit-btns">
        <button type="submit">Save</button>
        <button type="button" class="tips-edit-cancel">Cancel</button>
      </div>
    </div>
  </form>`;
}

async function renderProjects() {
  setActiveNav();
  const { projects } = await api('/api/projects');
  const palette = ['pink', 'lavender', 'lemon', 'green', 'mint'];
  content.innerHTML = viewHeader('Projects', 'Clean project cards on mobile; grouped workbench on desktop.') + (projects.length ? `<div class="project-stack">${projects.map((p, i) => `<a class="project-card ${palette[i % palette.length]}" href="#" data-project="${escapeHtml(p.project)}"><span><strong>${escapeHtml(labelizeProject(p.project))}</strong><small>${p.count} open notes</small></span><span class="badge done">Open →</span></a>`).join('')}</div>` : emptyState('Projects'));
  content.querySelectorAll('[data-project]').forEach(a => a.onclick = async e => {
    e.preventDefault();
    const { tasks } = await api(`/api/tasks?status=open&project=${encodeURIComponent(a.dataset.project)}`);
    content.innerHTML = viewHeader(labelizeProject(a.dataset.project), 'Open tasks in this project.', true) + (tasks.length ? workSectionsHtml(applyFilter(tasks)) : emptyState('Project'));
    bindTaskControls();
  });
}

async function renderGrocery() {
  setActiveNav();
  setBodyView('grocery');
  const [{ items }, { items: recentItems }] = await Promise.all([
    api('/api/grocery'),
    api('/api/grocery/recent?limit=8'),
  ]);
  const grouped = items.reduce((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});
  const activeItems = items.filter(i => !i.checked);
  const listText = activeItems.map(i => `${i.quantity ? i.quantity + ' ' : ''}${i.title}`).join('\n');
  content.innerHTML = viewHeader('Grocery', 'Fast shared capture for Walmart and household shopping.', false, activeItems.length) + `
    <section class="grocery-panel">
      <div class="grocery-add">
        <input id="grocery-title" placeholder="Add grocery item… e.g. walmart 2 paper towels" autofocus>
        <button id="grocery-add">Add item</button>
      </div>
      ${recentItems.length ? recentGroceryHtml(recentItems) : ''}
      <div class="grocery-actions">
        <button id="copy-grocery">Copy Walmart list</button>
            <button id="clear-grocery">Clear checked</button>
      </div>
      <textarea id="grocery-copy" readonly>${escapeHtml(listText)}</textarea>
    </section>
    ${items.length ? Object.entries(grouped).map(([category, group]) => groceryGroupHtml(category, group)).join('') : '<div class="empty-state">Grocery list is empty. Add milk, bananas, or walmart 2 paper towels.</div>'}`;
  $('#grocery-add').onclick = addGroceryFromInput;
  $('#grocery-title').addEventListener('keydown', e => { if (e.key === 'Enter') addGroceryFromInput(); });
  $('#clear-grocery').onclick = async () => { await api('/api/grocery/clear-checked', { method: 'POST' }); renderGrocery(); };
  $('#copy-grocery').onclick = async () => {
    const text = $('#grocery-copy').value;
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    $('#copy-grocery').textContent = 'Copied';
    setTimeout(() => $('#copy-grocery').textContent = 'Copy Walmart list', 1200);
  };
  document.querySelectorAll('.recent-grocery-chip').forEach(btn => btn.onclick = async e => {
    if (quickReaddDeleteMode) return;
    await api(`/api/grocery/${e.currentTarget.dataset.id}/readd`, { method: 'POST' });
    renderGrocery();
  });
  document.querySelectorAll('.recent-grocery-delete').forEach(btn => btn.onclick = async e => {
    e.stopPropagation();
    await api(`/api/grocery/${e.currentTarget.dataset.id}`, { method: 'DELETE' });
    renderGrocery();
  });
  bindRecentGrocerySwipeDelete();
  document.querySelectorAll('.grocery-check').forEach(cb => cb.onchange = async e => {
    await api(`/api/grocery/${e.target.closest('.grocery-item').dataset.id}`, { method: 'PATCH', body: JSON.stringify({ checked: e.target.checked }) });
    renderGrocery();
  });
  document.querySelectorAll('.walmart-link').forEach(a => {
    const query = new URLSearchParams({
      q: a.dataset.query,
      facet: 'fulfillment_method_in_store:In-store',
    });
    a.href = `https://www.walmart.com/search?${query.toString()}`;
  });
}

function recentGroceryHtml(items) {
  return `<div class="recent-grocery ${quickReaddDeleteMode ? 'quick-readd-delete-mode' : ''}" aria-label="Recently bought items"><span>Quick re-add <small>Hold item to delete</small></span><div>${items.map(item => `<span class="recent-grocery-pill" data-id="${escapeAttribute(item.id)}"><button type="button" class="recent-grocery-chip" data-id="${escapeAttribute(item.id)}">+ ${escapeHtml(item.quantity ? item.quantity + ' ' : '')}${escapeHtml(item.title)}</button><button type="button" class="recent-grocery-delete" data-id="${escapeAttribute(item.id)}" aria-label="Remove from quick re-add">×</button></span>`).join('')}</div></div>`;
}

function bindRecentGrocerySwipeDelete() {
  document.querySelectorAll('.recent-grocery-pill').forEach(pill => {
    let startX = 0;
    let currentX = 0;
    let dragging = false;
    let holdTimer = null;
    const reset = () => {
      clearTimeout(holdTimer);
      dragging = false;
      pill.classList.remove('swiping');
      pill.style.transform = '';
    };
    pill.addEventListener('pointerdown', e => {
      startX = e.clientX;
      currentX = 0;
      dragging = true;
      pill.classList.add('swiping');
      pill.setPointerCapture?.(e.pointerId);
      holdTimer = setTimeout(() => {
        quickReaddDeleteMode = true;
        document.querySelector('.recent-grocery')?.classList.add('quick-readd-delete-mode');
        if (navigator.vibrate) navigator.vibrate(12);
      }, 450);
    });
    pill.addEventListener('pointermove', e => {
      if (!dragging) return;
      currentX = Math.min(0, e.clientX - startX);
      if (Math.abs(currentX) > 10) clearTimeout(holdTimer);
      if (Math.abs(currentX) < 6) return;
      pill.style.transform = `translateX(${Math.max(currentX, -90)}px)`;
    });
    pill.addEventListener('pointerup', async e => {
      if (!dragging) return;
      clearTimeout(holdTimer);
      pill.releasePointerCapture?.(e.pointerId);
      if (currentX < -72) {
        await api(`/api/grocery/${pill.dataset.id}`, { method: 'DELETE' });
        renderGrocery();
        return;
      }
      reset();
    });
    pill.addEventListener('pointercancel', reset);
  });
}

function groceryGroupHtml(category, items) {
  return `<section class="grocery-group"><h3>${escapeHtml(category)}</h3>${items.map(item => `<article class="grocery-item ${item.checked ? 'checked' : ''}" data-id="${item.id}">
    <label><input class="grocery-check" type="checkbox" ${item.checked ? 'checked' : ''}> <span>${escapeHtml(item.quantity ? item.quantity + ' ' : '')}${escapeHtml(item.title)}</span></label>
    <span class="badge project">${escapeHtml(item.store)}</span>
    <a class="walmart-link" data-query="${escapeHtml(item.title)}" target="_blank" rel="noopener" title="Search Walmart for ${escapeAttribute(item.title)}" aria-label="Search Walmart for ${escapeAttribute(item.title)}">Search</a>
  </article>`).join('')}</section>`;
}

async function addGroceryFromInput() {
  const input = $('#grocery-title');
  const text = input.value.trim();
  if (!text) return;
  await api('/api/quick-add', { method: 'POST', body: JSON.stringify({ text: text.match(/^(walmart|grocery)\s+/i) ? text : `grocery ${text}`, source: 'app' }) });
  input.value = '';
  renderGrocery();
}

function profileOptionHtml(profile) {
  return `<option value="${escapeAttribute(profile.id)}" ${activeProfile?.id === profile.id ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`;
}

async function loadProfileChrome() {
  const [{ profiles }, moduleState] = await Promise.all([
    api('/api/profiles'),
    api('/api/modules'),
  ]);
  activeProfile = moduleState.profile;
  activeModules = moduleState.modules;
  renderModuleNav(activeModules);
  document.querySelectorAll('#profile-select, #top-profile-select').forEach(select => {
    select.innerHTML = profiles.map(profileOptionHtml).join('');
    select.value = activeProfile.id;
    select.onchange = async event => {
      await api('/api/profile/select', { method: 'POST', body: JSON.stringify({ profileId: event.target.value }) });
      render();
    };
  });
  const pill = document.querySelector('.profile-pill');
  if (pill) pill.textContent = activeProfile.name;
}

function moduleLinks(module) {
  if (module.id === 'tasks') {
    return [
      { href: '/today', label: 'Today', icon: module.icon },
      { href: '/inbox', label: 'Inbox', icon: '↧' },
      { href: '/future', label: 'Future', icon: '▣' },
      { href: '/projects', label: 'Projects', icon: '▦' },
      { href: '/done', label: 'Done', icon: '✓' },
    ];
  }
  return [{ href: module.href, label: module.navLabel || module.label, icon: module.icon }];
}

function renderModuleNav(modules) {
  const nav = document.querySelector('[data-module-nav]');
  if (!nav || !modules?.length) return;
  nav.innerHTML = modules.flatMap(moduleLinks).map(module => `<a href="${escapeAttribute(module.href)}" data-nav="${escapeAttribute(module.href)}"><span>${escapeHtml(module.icon || '•')}</span> ${escapeHtml(module.label)}</a>`).join('');
  setActiveNav();
}

async function refreshProjectOptions() {
  const datalist = $('#project-options');
  if (!datalist) return;
  const { projects } = await api('/api/projects');
  datalist.innerHTML = projects.map(p => `<option value="${escapeHtml(p.project)}"></option>`).join('');
}

function setActiveNav() {
  const path = location.pathname === '/' ? '/home' : location.pathname;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === path));
}

function setBodyView(viewKey) {
  document.body.dataset.view = viewKey || 'inbox';
  const fab = document.querySelector('.fab-add');
  if (fab) fab.setAttribute('aria-label', viewKey === 'grocery' ? 'Add grocery item' : viewKey === 'home' ? 'Capture item' : 'Add task');
}

function openPrimaryAdd() {
  if (document.body.dataset.view === 'home') {
    const input = $('#hub-capture');
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus();
    return;
  }
  if (document.body.dataset.view === 'grocery') {
    const input = $('#grocery-title');
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus();
    return;
  }
  const panel = document.querySelector('.quick-add');
  panel?.classList.toggle('is-open');
  $('#new-title')?.focus();
}

async function addTask() {
  const title = $('#new-title').value.trim();
  if (!title) return;
  await api('/api/tasks', { method: 'POST', body: JSON.stringify({
    title,
    project: $('#new-project').value.trim() || 'inbox',
    dueDate: $('#new-due').value || null,
    recurrence: $('#new-recurrence').value,
  }) });
  $('#new-title').value = '';
  $('#new-due').value = '';
  $('#new-recurrence').value = 'none';
  render();
}

$('#add').onclick = addTask;
document.querySelector('.fab-add')?.addEventListener('click', openPrimaryAdd);
['#new-title', '#new-project', '#new-due', '#new-recurrence'].forEach(sel => $(sel).addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); }));
document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, [contenteditable="true"]')) return;
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); $('#new-title').focus(); }
  if (e.key === '1') location.href = '/home';
  if (e.key === '2') location.href = '/today';
  if (e.key === '3') location.href = '/calendar';
  if (e.key === '4') location.href = '/grocery';
});

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttribute(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }
render().catch(err => content.innerHTML = `<pre>${escapeHtml(err.stack || err.message)}</pre>`);
