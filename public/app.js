const $ = sel => document.querySelector(sel);
const content = $('#content');
let activeFilter = 'all';
let draggedId = null;
let quickReaddDeleteMode = false;
let activeProfile = null;
let activeModules = [];
const APP_ROUTES = new Set(['/home', '/today', '/future', '/grocery', '/calendar', '/documents', '/work', '/tips', '/chat', '/settings', '/done', '/projects', '/inbox']);

function todayString() { return new Date().toISOString().slice(0, 10); }
function appRoutePath(pathname) { return pathname === '/' ? '/home' : pathname; }
function isAppRoute(pathname) { return APP_ROUTES.has(appRoutePath(pathname)); }
function routeView() {
  const path = location.pathname;
  if (path === '/' || path === '/home') return { key: 'home', title: 'Home', subtitle: '', home: true };
  if (path === '/today') return { key: 'today', title: 'Today', subtitle: 'Due today, overdue, or intentionally undated.', query: 'view=today', filters: true };
  if (path === '/future') return { key: 'future', title: 'Future', subtitle: 'Scheduled tasks that are not ready for today yet.', future: true, filters: true };
  if (path === '/grocery') return { key: 'grocery', title: 'Grocery', grocery: true };
  if (path === '/calendar') return { key: 'calendar', title: 'Family Calendar', calendar: true };
  if (path === '/documents') return { key: 'documents', title: 'Documents', documents: true };
  if (path === '/work') return { key: 'work', title: 'Work', work: true };
  if (path === '/tips') return { key: 'tips', title: 'Tips', tips: true };
  if (path === '/chat') return { key: 'chat', title: 'Chat', chat: true };
  if (path === '/settings') return { key: 'settings', title: 'Settings', settings: true };
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
  $('#add').onclick = addTask;
  $('#new-title').placeholder = 'Capture task, grocery, note…';
  const view = routeView();
  setBodyView(view.key);
  if (view.home) return renderHome();
  if (view.calendar) return renderCalendar();
  if (view.documents) return renderDocuments();
  if (view.work) return renderWork();
  if (view.tips) return renderTips();
  if (view.chat) return renderChat();
  if (view.settings) return renderSettings();
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
  const eyebrow = title === 'Home' ? 'Fite Family Hub' : title === 'Family Calendar' ? 'Family Calendar' : title === 'Documents' ? 'Household Documents' : title === 'Today' ? 'Daily tasks' : 'Personal tasks';
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
    { href: '/chat', navLabel: 'Chat' },
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

const CALENDAR_VISIBILITY_KEY = 'householdHub.hiddenCalendarSourceIds';

function hiddenCalendarSourceIds() {
  try { return new Set(JSON.parse(localStorage.getItem(CALENDAR_VISIBILITY_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveHiddenCalendarSourceIds(ids) {
  localStorage.setItem(CALENDAR_VISIBILITY_KEY, JSON.stringify([...ids]));
}

function filterVisibleCalendarEvents(events) {
  const hidden = hiddenCalendarSourceIds();
  return events.filter(event => !hidden.has(event.sourceId));
}

function calendarSourceChip(source) {
  const hidden = hiddenCalendarSourceIds();
  const checked = !hidden.has(source.id);
  return `<label class="calendar-source-chip"><input type="checkbox" class="calendar-source-toggle" data-source-id="${escapeAttribute(source.id)}" ${checked ? 'checked' : ''}><span style="--source-color:${escapeAttribute(source.color || '#f6c944')}"></span><strong>${escapeHtml(source.label)}</strong></label>`;
}

async function renderHome() {
  setActiveNav();
  setBodyView('home');
  const [{ tasks: allOpenTasks }, calendarData, { items: groceryItems }, { documents }, recentChatData] = await Promise.all([
    api('/api/tasks?status=open'),
    api('/api/calendar'),
    api('/api/grocery'),
    api('/api/documents'),
    api('/api/chat/recent?limit=4').catch(() => ({ messages: [] })),
  ]);
  const events = filterVisibleCalendarEvents(calendarData.events || []);
  const recentChat = recentChatData.messages || [];
  const today = todayString();
  const todayTasks = allOpenTasks.filter(t => !t.dueDate || t.dueDate <= today).slice(0, 5);
  const upcoming = events.slice(0, 5);
  const activeGrocery = groceryItems.filter(i => !i.checked);
  const featuredDocs = documents.slice(0, 4);
  content.innerHTML = viewHeader('Home', '', false) + `
    <section class="hub-hero">
      <div class="hub-hero-date">
        <p class="eyebrow">Household Hub</p>
        <h3>${friendlyDate(new Date())}</h3>
        <p class="hub-hero-summary">${heroSummaryText(todayTasks, activeGrocery, upcoming)}</p>
      </div>
      <div class="hub-next-panel">${heroNextHtml(upcoming)}</div>
    </section>
    <section class="hub-grid">
      ${hubPanel('Today', '/today', 'View tasks', todayTasks.length ? todayTasks.map(t => `<li><span>☐</span><strong>${escapeHtml(t.title)}</strong></li>`).join('') : '<li class="hub-empty-row">Nothing due today.</li>')}
      ${hubPanel('Family Calendar', '/calendar', 'View calendar', upcoming.length ? upcoming.map(calendarEventRow).join('') : '<li class="hub-empty-row">No upcoming events.</li>')}
      ${hubPanel('Grocery', '/grocery', 'Open list', activeGrocery.length
        ? activeGrocery.slice(0, 5).map(i => `<li><span>•</span>${escapeHtml(i.quantity ? i.quantity + ' ' : '')}${escapeHtml(i.title)}</li>`).join('')
        : `<li class="hub-empty-row">Grocery list is clear.</li><li style="background:transparent;min-height:auto;padding:4px 0;display:block"><div class="hub-grocery-add"><input id="hub-grocery-quick" placeholder="Add item…"><button id="hub-grocery-quick-add">Add</button></div></li>`)}
      ${hubPanel('Documents', '/documents', 'View docs', featuredDocs.map(doc => `<li><span>${escapeHtml(doc.icon)}</span><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.category)}</small></li>`).join(''))}
      ${hubPanel('Family Chat', '/chat', 'Open chat', recentChat.length ? recentChat.map(m => `<li><span class="chat-avatar hub-chat-avatar" style="background:${escapeAttribute(PROFILE_COLORS[m.profileId] || '#ffd60a')}">${escapeHtml((m.profileId || 'f')[0].toUpperCase())}</span><span class="hub-chat-msg"><strong>${escapeHtml(m.threadTitle || 'Chat')}</strong> <span>${escapeHtml(m.body.length > 60 ? m.body.slice(0, 60) + '…' : m.body)}</span></span></li>`).join('') : '<li class="hub-empty-row">No family messages yet.</li>')}
    </section>`;
  $('#add').onclick = quickCapture;
  $('#new-title').placeholder = 'Add anything: “milk”, “trash Monday”, “dentist Thursday 3pm”…';
  const hgBtn = $('#hub-grocery-quick-add');
  if (hgBtn) {
    const hgInput = $('#hub-grocery-quick');
    const doAdd = async () => {
      const t = hgInput?.value.trim();
      if (!t) return;
      await api('/api/grocery', { method: 'POST', body: JSON.stringify({ title: t }) });
      renderHome();
    };
    hgBtn.onclick = doAdd;
    hgInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  }
}

function hubPanel(title, href, linkLabel, body) {
  return `<article class="hub-panel"><header><h3>${escapeHtml(title)}</h3><a class="hub-panel-link" href="${href}">${escapeHtml(linkLabel)} →</a></header><ul>${body}</ul></article>`;
}

function heroSummaryText(tasks, groceryItems, events) {
  const parts = [];
  parts.push(tasks.length === 0 ? 'Nothing due today.' : `${tasks.length} task${tasks.length === 1 ? '' : 's'} due today.`);
  parts.push(groceryItems.length === 0 ? 'Grocery list is clear.' : `${groceryItems.length} item${groceryItems.length === 1 ? '' : 's'} on the grocery list.`);
  return parts.join(' ');
}

function heroNextHtml(events) {
  if (!events.length) return '<p class="hub-next-empty">No upcoming events scheduled.</p>';
  const next = events[0];
  const more = events.slice(1, 3);
  return `<p class="eyebrow">Coming up</p><p class="hub-next-title">${escapeHtml(next.summary)}</p><p class="hub-next-meta">${escapeHtml(formatDateLabel(next.date))} · ${escapeHtml(next.time)}</p>${more.map(e => `<p class="hub-next-more">${escapeHtml(formatDateLabel(e.date))} — ${escapeHtml(e.summary)}</p>`).join('')}`;
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
  const calendarData = await api('/api/calendar');
  const calendars = calendarData.calendars || [];
  const events = filterVisibleCalendarEvents(calendarData.events || []);
  const grouped = events.reduce((acc, event) => {
    (acc[event.date] ||= []).push(event);
    return acc;
  }, {});
  content.innerHTML = viewHeader('Family Calendar', '14-day read-only view from the Family Google Calendar feed.', false, events.length) + `
    <section class="calendar-shell">
      ${calendars.length ? `<div class="calendar-source-row">${calendars.map(calendarSourceChip).join('')}<a href="/settings">Manage</a></div>` : ''}
      <div class="calendar-summary"><strong>${events.length}</strong><span>visible upcoming event${events.length === 1 ? '' : 's'}</span><small>Private iCal URLs stay server-side.</small></div>
      <div class="calendar-list">${Object.entries(grouped).length ? Object.entries(grouped).map(([date, dayEvents]) => `<section class="calendar-day"><time datetime="${escapeAttribute(date)}">${escapeHtml(formatDateLabel(date))}</time><div>${dayEvents.map(calendarEventCard).join('')}</div></section>`).join('') : '<div class="empty-state">No visible calendar events in the current window.</div>'}</div>
    </section>`;
  bindCalendarSourceToggles();
}

function calendarEventRow(event) {
  return `<li class="hub-cal-row"><span class="hub-event-date">${escapeHtml(formatDateLabel(event.date))}</span><strong>${escapeHtml(event.summary)}</strong><small>${escapeHtml(event.time)}</small></li>`;
}

function calendarEventCard(event) {
  return `<article class="calendar-event" style="--source-color:${escapeAttribute(event.sourceColor || '#f6c944')}"><span>${escapeHtml(event.time)}</span><strong>${escapeHtml(event.summary)}</strong><small>${escapeHtml(event.sourceLabel || 'Calendar')}</small></article>`;
}

function bindCalendarSourceToggles() {
  content.querySelectorAll('.calendar-source-toggle').forEach(input => {
    input.onchange = () => {
      const hidden = hiddenCalendarSourceIds();
      if (input.checked) hidden.delete(input.dataset.sourceId);
      else hidden.add(input.dataset.sourceId);
      saveHiddenCalendarSourceIds(hidden);
      render();
    };
  });
}

async function renderSettings() {
  setActiveNav();
  setBodyView('settings');
  const { calendars, events } = await api('/api/calendar');
  const hidden = hiddenCalendarSourceIds();
  const { profiles: settingsProfiles } = await api('/api/profiles').catch(() => ({ profiles: [] }));
  content.innerHTML = viewHeader('Settings', 'Personalize this device without changing the family source of truth.') + `
    <section class="settings-card">
      <header><div><p class="eyebrow">Profiles</p><h3>Avatars</h3><p>Avatars are stored on the server and shown on the login screen.</p></div></header>
      <div class="settings-profiles-grid">${settingsProfiles.map(p => {
        const color = p.color || PROFILE_COLORS[p.id] || '#ffd60a';
        const initial = (p.name || p.id)[0].toUpperCase();
        const avatarEl = p.avatar
          ? `<img src="${escapeAttribute(p.avatar)}" alt="${escapeHtml(p.name)}" class="settings-avatar-img">`
          : `<span class="settings-avatar-initial" style="background:${escapeAttribute(color)}">${escapeHtml(initial)}</span>`;
        return `<div class="settings-profile-row">
          <div class="settings-avatar-wrap">${avatarEl}</div>
          <span class="settings-profile-name">${escapeHtml(p.name)}</span>
          <label class="settings-avatar-upload-btn">
            ${p.avatar ? 'Change' : 'Upload'}
            <input type="file" accept="image/*" class="profile-avatar-upload" data-profile-id="${escapeAttribute(p.id)}" style="display:none">
          </label>
          ${p.avatar ? `<button type="button" class="profile-avatar-clear settings-avatar-clear-btn" data-profile-id="${escapeAttribute(p.id)}">Remove</button>` : ''}
        </div>`;
      }).join('')}</div>
    </section>
    <section class="settings-card">
      <header><div><p class="eyebrow">Calendar Sources</p><h3>Show or hide calendars</h3><p>These toggles are saved on this browser only. Private iCal URLs stay on the server.</p></div><a href="/calendar">View calendar →</a></header>
      <div class="settings-calendar-list">${(calendars || []).length ? calendars.map(source => `<div class="settings-calendar-row">${calendarSourceChip(source)}<small>${(events || []).filter(event => event.sourceId === source.id).length} upcoming</small></div>`).join('') : '<div class="empty-state">No calendar sources configured.</div>'}</div>
      ${hidden.size ? '<button type="button" id="show-all-calendars">Show all calendars</button>' : ''}
    </section>`;
  bindCalendarSourceToggles();
  $('#show-all-calendars')?.addEventListener('click', () => { saveHiddenCalendarSourceIds(new Set()); renderSettings(); });

  content.querySelectorAll('.profile-avatar-upload').forEach(input => {
    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const id = input.dataset.profileId;
      const reader = new FileReader();
      reader.onload = async ev => {
        const dataUrl = ev.target.result;
        try {
          await api(`/api/profiles/${encodeURIComponent(id)}/avatar`, { method: 'PATCH', body: JSON.stringify({ avatar: dataUrl }) });
          renderSettings();
        } catch (err) { alert('Upload failed: ' + (err?.message || 'unknown error')); }
      };
      reader.readAsDataURL(file);
    });
  });

  content.querySelectorAll('.profile-avatar-clear').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.profileId;
      await api(`/api/profiles/${encodeURIComponent(id)}/avatar`, { method: 'PATCH', body: JSON.stringify({ avatar: null }) });
      renderSettings();
    });
  });
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

const WORK_PERIODS = [
  ['today', 'Today'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
  ['all', 'All'],
];
let workPeriod = 'month';
const workMoneyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const workCompactMoneyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

function workMoney(value, compact = false) {
  const amount = Number(value || 0);
  return (compact ? workCompactMoneyFormatter : workMoneyFormatter).format(amount);
}

function workPeriodStart(period, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'today') return d;
  if (period === 'week') {
    const day = d.getDay();
    const mondayOffset = (day + 6) % 7;
    d.setDate(d.getDate() - mondayOffset);
    return d;
  }
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  if (period === 'year') return new Date(d.getFullYear(), 0, 1);
  return null;
}

function workEntriesForPeriod(entries, period) {
  const start = workPeriodStart(period);
  if (!start) return entries;
  return entries.filter(entry => new Date(`${entry.date}T12:00:00`) >= start);
}

function summarizeWorkEntries(entries) {
  const summary = entries.reduce((acc, entry) => {
    acc.entryCount += 1;
    acc.revenue += Number(entry.revenue || 0);
    acc.payout += Number(entry.payout || 0);
    acc.tips += Number(entry.tipAmount || 0);
    acc.totalEarnings += Number(entry.totalEarnings || 0);
    return acc;
  }, { entryCount: 0, revenue: 0, payout: 0, tips: 0, totalEarnings: 0 });
  return summary;
}

function workPeriodControlsHtml() {
  return `<div class="work-period-tabs" aria-label="Work timeframe">${WORK_PERIODS.map(([value, label]) => `<button type="button" class="work-period-tab ${workPeriod === value ? 'active' : ''}" data-work-period="${escapeAttribute(value)}">${escapeHtml(label)}</button>`).join('')}</div>`;
}

async function renderWork() {
  setActiveNav();
  setBodyView('work');
  const today = new Date().toISOString().slice(0, 10);
  const [summary, { entries }, settingsResponse, importResponse] = await Promise.all([api('/api/work/summary'), api('/api/work'), api('/api/work/settings'), api('/api/work/import/batches')]);
  const settings = settingsResponse.settings || { defaultCommissionRate: 0.1 };
  const pct = n => `${Math.round(Number(n || 0) * 1000) / 10}%`;
  const scopedEntries = workEntriesForPeriod(entries, workPeriod);
  const scopedSummary = summarizeWorkEntries(scopedEntries);
  const visibleEntries = scopedEntries.slice(0, 25);
  const periodLabel = WORK_PERIODS.find(([value]) => value === workPeriod)?.[1] || 'Month';
  content.innerHTML = viewHeader('Work', `${summary.entryCount.toLocaleString()} work entr${summary.entryCount === 1 ? 'y' : 'ies'} logged. Showing ${periodLabel.toLowerCase()} earnings first.`) + `
    <section class="work-dashboard-tools">
      ${workPeriodControlsHtml()}
      ${entries.length ? `<div class="tips-export-row work-actions-row"><a class="tips-export-btn" href="/api/work/export.csv" download="work-export.csv">↓ Export CSV</a></div>` : ''}
    </section>
    <section class="tips-summary-grid work-summary-grid">
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.revenue, true))}</span><small>Revenue · ${escapeHtml(periodLabel)}</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.payout, true))}</span><small>Payout</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.tips, true))}</span><small>Tips</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.totalEarnings, true))}</span><small>Total earnings</small></div>
    </section>
    <p class="work-history-note">All-time: ${escapeHtml(workMoney(summary.revenue))} revenue · ${escapeHtml(workMoney(summary.payout))} payout · ${escapeHtml(workMoney(summary.tips))} tips.</p>
    <section class="hub-panel tips-log-panel work-log-panel">
      <header><h3>Log work</h3><small>Default commission ${escapeHtml(pct(settings.defaultCommissionRate))}</small></header>
      <form id="work-form" class="tips-form work-form">
        <div class="tips-form-row work-form-grid">
          <label class="work-field-date">Date<input type="date" name="date" value="${escapeAttribute(today)}" required></label>
          <label class="work-field-client">Client<input type="text" name="clientName" placeholder="Client name"></label>
          <label class="work-field-service">Service/Product<input type="text" name="serviceName" placeholder="IPL, peel, product…"></label>
          <label>Revenue&nbsp;$<input type="number" name="revenue" placeholder="0" step="0.01" min="0" required></label>
          <label>Tip&nbsp;$<input type="number" name="tipAmount" placeholder="0" step="0.01" min="0"></label>
          <label>Tip type<select name="tipType"><option value=""></option>${(settings.tipTypes || ['Cash', 'Tippy', 'Venmo', 'Other']).map(type => `<option value="${escapeAttribute(type)}">${escapeHtml(type)}</option>`).join('')}</select></label>
          <button type="submit" class="tips-submit-btn">Save work</button>
          <details class="work-advanced-fields">
            <summary>Advanced fields</summary>
            <div>
              <label>Rate&nbsp;%<input type="number" name="commissionRatePercent" value="${escapeAttribute(String(Math.round(settings.defaultCommissionRate * 1000) / 10))}" step="0.1" min="0" max="100"></label>
              <label>Deductions&nbsp;$<input type="number" name="deductions" placeholder="0" step="0.01" min="0"></label>
              <label class="tips-notes-label">Notes<input type="text" name="notes" placeholder="Optional…"></label>
            </div>
          </details>
        </div>
      </form>
    </section>
    ${workChartsHtml(summary)}
    ${workImportPanelHtml(importResponse.batches || [])}
    <section class="work-recent-section">
      <header><h3>Recent entries</h3><small>${scopedEntries.length.toLocaleString()} in ${escapeHtml(periodLabel.toLowerCase())}${scopedEntries.length > visibleEntries.length ? ` · showing latest ${visibleEntries.length}` : ''}</small></header>
      <div id="work-list" class="tips-shifts work-shifts">
        ${visibleEntries.length ? visibleEntries.map(workEntryHtml).join('') : '<div class="empty-state">No work entries in this timeframe yet.</div>'}
      </div>
    </section>`;

  $('#work-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      date: fd.get('date'),
      clientName: fd.get('clientName') || '',
      serviceName: fd.get('serviceName') || '',
      revenue: parseFloat(fd.get('revenue')) || 0,
      commissionRate: (parseFloat(fd.get('commissionRatePercent')) || 0) / 100,
      deductions: parseFloat(fd.get('deductions')) || 0,
      tipAmount: parseFloat(fd.get('tipAmount')) || 0,
      tipType: fd.get('tipType') || '',
      notes: fd.get('notes') || '',
    };
    await api('/api/work', { method: 'POST', body: JSON.stringify(data) });
    renderWork();
  };

  bindWorkControls(visibleEntries);
  bindWorkImportControls();
  content.querySelectorAll('[data-work-period]').forEach(btn => {
    btn.onclick = () => {
      workPeriod = btn.dataset.workPeriod;
      renderWork();
    };
  });
}

function workImportPanelHtml(batches = []) {
  const defaultPaths = [
    '/home/agent/.hermes/cache/documents/doc_78fef06f7088_2023_Commission_Spreadsheet.xlsx',
    '/home/agent/.hermes/cache/documents/doc_01440aefb993_2024_Commission_Spreadsheet.xlsx',
    '/home/agent/.hermes/cache/documents/doc_9e7b3bebda79_2025_Commission_Spreadsheet.xlsx',
    '/home/agent/.hermes/cache/documents/doc_f0627a89bf12_2026_Commission_Spreadsheet.xlsx',
  ].join('\n');
  const latest = batches[0];
  const latestSummary = latest ? importBatchSummaryHtml(latest) : 'No import batch staged yet.';
  return `<details class="hub-panel work-import-panel">
    <summary><span><strong>Spreadsheet import</strong><small>${escapeHtml(latestSummary)}</small></span><span class="work-import-chevron">Admin</span></summary>
    <p class="work-import-help">Dry-run spreadsheet paths here only when migrating or rechecking historical workbooks.</p>
    <textarea id="work-import-paths" rows="4" spellcheck="false">${escapeHtml(defaultPaths)}</textarea>
    <div class="work-import-actions">
      <button type="button" id="work-import-dry-run" class="tips-submit-btn">Dry-run import</button>
      ${latest ? `<button type="button" id="work-import-open" data-batch-id="${escapeAttribute(latest.id)}">Review latest batch</button>` : ''}
    </div>
    <div id="work-import-status" class="tips-shift-breakdown">${escapeHtml(latestSummary)}</div>
    <div id="work-import-review"></div>
  </details>`;
}

function importBatchSummaryHtml(batch) {
  const s = batch.summary || {};
  return `Latest batch: ${(s.totalRows || 0).toLocaleString()} rows · ${(s.readyRows || 0).toLocaleString()} ready · ${(s.reviewRows || 0).toLocaleString()} need review · ${(s.duplicateRows || 0).toLocaleString()} duplicates · ${(s.committedRows || 0).toLocaleString()} committed`;
}

async function loadWorkImportBatch(batchId) {
  const { batch } = await api(`/api/work/import/batches/${encodeURIComponent(batchId)}`);
  const reviewRows = (batch.rows || []).filter(row => ['needs_review', 'approved'].includes(row.status)).slice(0, 20);
  const review = $('#work-import-review');
  review.innerHTML = `<div class="tips-shift-breakdown">${escapeHtml(importBatchSummaryHtml(batch))}</div>
    ${reviewRows.length ? reviewRows.map(row => workImportRowHtml(batch.id, row)).join('') : '<div class="empty-state">No review rows. This batch is ready to commit.</div>'}
    <div class="work-import-actions"><button type="button" id="work-import-commit" data-batch-id="${escapeAttribute(batch.id)}" class="tips-submit-btn">Commit ready rows</button></div>`;
  bindWorkImportReviewControls();
}

function workImportRowHtml(batchId, row) {
  const entry = row.entry || {};
  const suggested = row.suggestedDate ? ` Suggested: ${row.suggestedDate}` : '';
  return `<article class="tips-shift work-import-row" data-batch-id="${escapeAttribute(batchId)}" data-row-id="${escapeAttribute(row.id)}">
    <div class="tips-shift-header"><span>${escapeHtml(entry.date || 'No date')} <span class="badge waiting">${escapeHtml(row.status)}</span></span><span>${escapeHtml(entry.sourceSheet || '')} #${escapeHtml(entry.sourceRow || '')}</span></div>
    <div class="tips-shift-breakdown"><strong>${escapeHtml(entry.clientName || 'No client')}</strong> · ${escapeHtml(entry.serviceName || 'No service')}</div>
    <div class="tips-shift-breakdown">${escapeHtml((row.problems || []).join(', ') + suggested)}</div>
    <div class="tips-shift-actions"><button type="button" class="work-import-approve">Approve suggested date</button><button type="button" class="work-import-skip">Skip</button></div>
  </article>`;
}

function bindWorkImportControls() {
  const dryRun = $('#work-import-dry-run');
  if (dryRun) dryRun.onclick = async () => {
    const paths = $('#work-import-paths').value.split(/\n+/).map(path => path.trim()).filter(Boolean);
    $('#work-import-status').textContent = 'Running dry-run import…';
    const { batch } = await api('/api/work/import/dry-run', { method: 'POST', body: JSON.stringify({ paths }) });
    $('#work-import-status').textContent = importBatchSummaryHtml(batch);
    await loadWorkImportBatch(batch.id);
  };
  const open = $('#work-import-open');
  if (open) open.onclick = () => loadWorkImportBatch(open.dataset.batchId);
}

function bindWorkImportReviewControls() {
  content.querySelectorAll('.work-import-approve').forEach(btn => {
    btn.onclick = async e => {
      const card = e.currentTarget.closest('.work-import-row');
      const { batchId, rowId } = card.dataset;
      await api(`/api/work/import/batches/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', useSuggestedDate: true }) });
      await loadWorkImportBatch(batchId);
    };
  });
  content.querySelectorAll('.work-import-skip').forEach(btn => {
    btn.onclick = async e => {
      const card = e.currentTarget.closest('.work-import-row');
      const { batchId, rowId } = card.dataset;
      await api(`/api/work/import/batches/${encodeURIComponent(batchId)}/rows/${encodeURIComponent(rowId)}`, { method: 'PATCH', body: JSON.stringify({ status: 'skipped' }) });
      await loadWorkImportBatch(batchId);
    };
  });
  const commit = $('#work-import-commit');
  if (commit) commit.onclick = async () => {
    const batchId = commit.dataset.batchId;
    const result = await api(`/api/work/import/batches/${encodeURIComponent(batchId)}/commit`, { method: 'POST', body: JSON.stringify({}) });
    alert(`Committed ${result.committed} work entries.`);
    renderWork();
  };
}

function workChartsHtml(summary) {
  const serviceRows = (summary.topServices || []).slice(0, 5).map(service => `<tr><td>${escapeHtml(service.serviceName)}</td><td class="tip-num">${escapeHtml(workMoney(service.revenue))}</td><td class="tip-num tip-muted">${Number(service.count || 0).toLocaleString()}</td></tr>`).join('');
  const tipRows = Object.entries(summary.tipsByType || {}).map(([type, amount]) => `<tr><td>${escapeHtml(type)}</td><td class="tip-num">${escapeHtml(workMoney(amount))}</td></tr>`).join('');
  if (!serviceRows && !tipRows) return '';
  return `<div class="tips-breakdown work-breakdown">
    ${serviceRows ? `<section class="tips-breakdown-section"><h4>Top services</h4><table class="tips-breakdown-table"><tbody>${serviceRows}</tbody></table></section>` : ''}
    ${tipRows ? `<section class="tips-breakdown-section"><h4>Tips by type</h4><table class="tips-breakdown-table"><tbody>${tipRows}</tbody></table></section>` : ''}
  </div>`;
}

function bindWorkControls(entries) {
  content.querySelectorAll('.work-delete-btn').forEach(btn => {
    btn.onclick = async e => {
      const card = e.currentTarget.closest('.work-entry');
      const id = card.dataset.id;
      if (!confirm('Delete this work entry?')) return;
      await api(`/api/work/${id}`, { method: 'DELETE' });
      renderWork();
    };
  });
}

function workEntryHtml(entry) {
  const rate = Math.round(Number(entry.commissionRate || 0) * 1000) / 10;
  return `<article class="tips-shift work-entry" data-id="${escapeAttribute(entry.id)}">
    <div class="tips-shift-header">
      <span><span class="tips-shift-date">${escapeHtml(formatDateLabel(entry.date))}</span> ${entry.needsReview ? '<span class="badge waiting">Needs review</span>' : ''}</span>
      <span class="tips-shift-total">${escapeHtml(workMoney(entry.totalEarnings))}</span>
    </div>
    <div class="tips-shift-breakdown"><strong>${escapeHtml(entry.clientName || 'No client')}</strong> · ${escapeHtml(entry.serviceName || 'No service')}</div>
    <div class="tips-shift-breakdown">Revenue ${escapeHtml(workMoney(entry.revenue))} · Rate ${escapeHtml(String(rate))}% · Commission ${escapeHtml(workMoney(entry.commissionAmount))} · Payout ${escapeHtml(workMoney(entry.payout))}${entry.tipAmount ? ` · Tip ${escapeHtml(workMoney(entry.tipAmount))} ${escapeHtml(entry.tipType || '')}` : ''}</div>
    ${entry.notes ? `<div class="tips-shift-breakdown"><span class="tips-shift-notes">${escapeHtml(entry.notes)}</span></div>` : ''}
    <div class="tips-shift-actions"><button type="button" class="work-delete-btn">Delete</button></div>
  </article>`;
}

async function renderTips() {
  setActiveNav();
  setBodyView('tips');
  const today = new Date().toISOString().slice(0, 10);
  const [summary, { entries }, breakdown] = await Promise.all([api('/api/tips/summary'), api('/api/tips'), api('/api/tips/breakdown')]);
  const fmt = n => '$' + Number(n).toFixed(2).replace(/\.00$/, '');
  content.innerHTML = viewHeader('Tips', `${entries.length} tip${entries.length === 1 ? '' : 's'} logged.`) + `
    <section class="tips-summary-grid">
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(fmt(summary.thisWeek))}</span><small>This week</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(fmt(summary.thisMonth))}</span><small>This month</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(fmt(summary.avgPerTip))}</span><small>Avg / tip</small></div>
    </section>
    ${entries.length ? `<div class="tips-export-row"><a class="tips-export-btn" href="/api/tips/export.csv" download="tips-export.csv">↓ Export CSV</a></div>` : ''}
    ${tipsBreakdownHtml(breakdown)}
    <section class="hub-panel tips-log-panel">
      <header><h3>Log a Tip</h3></header>
      <form id="tips-form" class="tips-form">
        <div class="tips-form-row">
          <label>Date<input type="date" name="date" value="${escapeAttribute(today)}" required></label>
          <label>Amount&nbsp;$<input type="number" name="amount" placeholder="0" step="0.01" min="0" value="" required></label>
          <label class="tips-notes-label">Notes<input type="text" name="notes" placeholder="Optional…"></label>
          <button type="submit" class="tips-submit-btn">Log tip</button>
        </div>
      </form>
    </section>
    <div id="tips-list" class="tips-shifts">
      ${entries.length ? entries.map(tipEntryHtml).join('') : '<div class="empty-state">No tips logged yet. Add your first tip above.</div>'}
    </div>`;

  $('#tips-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      date: fd.get('date'),
      amount: parseFloat(fd.get('amount')) || 0,
      notes: fd.get('notes') || '',
    };
    await api('/api/tips', { method: 'POST', body: JSON.stringify(data) });
    renderTips();
  };

  bindTipsControls(entries);
}

function bindTipsControls(entries) {
  content.querySelectorAll('.tips-delete-btn').forEach(btn => {
    btn.onclick = async e => {
      const card = e.currentTarget.closest('.tips-shift');
      const id = card.dataset.id;
      if (!confirm('Delete this tip?')) return;
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
          amount: parseFloat(fd.get('amount')) || 0,
          notes: fd.get('notes') || '',
        };
        await api(`/api/tips/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
        renderTips();
      };
      card.querySelector('.tips-edit-cancel').onclick = () => renderTips();
    };
  });
}

function tipEntryHtml(entry) {
  const fmt = n => '$' + Number(n).toFixed(2).replace(/\.00$/, '');
  return `<article class="tips-shift" data-id="${escapeAttribute(entry.id)}">
    <div class="tips-shift-header">
      <span class="tips-shift-date">${escapeHtml(formatDateLabel(entry.date))}</span>
      <span class="tips-shift-total">${escapeHtml(fmt(entry.amount))}</span>
    </div>
    ${entry.notes ? `<div class="tips-shift-breakdown"><span class="tips-shift-notes">${escapeHtml(entry.notes)}</span></div>` : ''}
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
    .map(d => `<tr><td>${escapeHtml(d.label)}</td><td class="tip-num">${escapeHtml(fmt(d.total))}</td><td class="tip-num tip-muted">${d.count} tip${d.count === 1 ? '' : 's'}</td></tr>`)
    .join('');

  const monthRows = breakdown.month
    .map(w => {
      const startDate = new Date(w.start + 'T12:00:00Z');
      const label = 'Week of ' + startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      return `<tr><td>${escapeHtml(label)}</td><td class="tip-num">${escapeHtml(fmt(w.total))}</td><td class="tip-num tip-muted">${w.count} tip${w.count === 1 ? '' : 's'}</td></tr>`;
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
  return `<form class="tips-form tips-edit-form" data-id="${escapeAttribute(entry.id)}">
    <div class="tips-form-row">
      <label>Date<input type="date" name="date" value="${escapeAttribute(entry.date)}" required></label>
      <label>Amount&nbsp;$<input type="number" name="amount" value="${escapeAttribute(entry.amount)}" step="0.01" min="0" required></label>
      <label class="tips-notes-label">Notes<input type="text" name="notes" value="${escapeAttribute(entry.notes || '')}"></label>
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

async function renderChat() {
  setActiveNav();
  setBodyView('chat');
  const { threads } = await api('/api/chat/threads');
  content.innerHTML = viewHeader('Family Chat', 'Household message board — everyone can post and read.') + `
    <div class="chat-layout">
      <section class="chat-thread-list" id="chat-thread-list">
        <div class="chat-thread-header">
          <span>Threads</span>
          <button type="button" class="chat-new-thread-btn" id="chat-new-thread-btn">+ New</button>
        </div>
        <form id="chat-new-thread-form" class="chat-new-thread-form" hidden>
          <input type="text" id="chat-thread-title" placeholder="Thread title…" maxlength="120" autocomplete="off">
          <button type="submit">Create</button>
          <button type="button" id="chat-cancel-thread">Cancel</button>
        </form>
        <div id="chat-threads-inner">
          ${threads.length ? threads.map(chatThreadItemHtml).join('') : '<p class="chat-empty">No threads yet.</p>'}
        </div>
      </section>
      <section class="chat-message-pane" id="chat-message-pane">
        <div class="chat-message-pane-empty">Select a thread to read messages.</div>
      </section>
    </div>`;

  $('#chat-new-thread-btn').onclick = () => {
    $('#chat-new-thread-form').hidden = false;
    $('#chat-thread-title').focus();
    $('#chat-new-thread-btn').hidden = true;
  };
  $('#chat-cancel-thread').onclick = () => {
    $('#chat-new-thread-form').hidden = true;
    $('#chat-new-thread-btn').hidden = false;
  };
  $('#chat-new-thread-form').onsubmit = async e => {
    e.preventDefault();
    const title = $('#chat-thread-title').value.trim();
    if (!title) return;
    const { thread } = await api('/api/chat/threads', { method: 'POST', body: JSON.stringify({ title }) });
    await renderChat();
    openChatThread(thread.id, thread.title);
  };

  const isMobile = () => window.innerWidth <= 700;
  if (isMobile() && threads.length) {
    await openChatThread(threads[0].id, threads[0].title);
  }

  content.querySelectorAll('.chat-thread-item').forEach(item => {
    item.querySelector('.chat-thread-btn').onclick = () => openChatThread(item.dataset.id, item.dataset.title);
    const pinBtn = item.querySelector('.chat-pin-btn');
    if (pinBtn) pinBtn.onclick = async e => {
      e.stopPropagation();
      const pinned = pinBtn.dataset.pinned === 'true';
      await api(`/api/chat/threads/${item.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !pinned }) });
      renderChat();
    };
    const delBtn = item.querySelector('.chat-del-thread-btn');
    if (delBtn) delBtn.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`Delete thread "${item.dataset.title}" and all its messages?`)) return;
      await api(`/api/chat/threads/${item.dataset.id}`, { method: 'DELETE' });
      renderChat();
    };
  });
}

async function openChatThread(threadId, threadTitle) {
  const pane = $('#chat-message-pane');
  if (!pane) return;
  pane.innerHTML = '<div class="chat-loading">Loading…</div>';
  const { messages } = await api(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`);
  const latestDisplayedAt = messages[messages.length - 1]?.createdAt;
  if (latestDisplayedAt) {
    await api(`/api/chat/threads/${encodeURIComponent(threadId)}/read`, {
      method: 'POST',
      body: JSON.stringify({ lastReadAt: latestDisplayedAt }),
    }).catch(() => null);
  }
  document.querySelectorAll('.chat-thread-item').forEach(item => item.classList.toggle('active', item.dataset.id === threadId));
  const activeItem = $(`.chat-thread-item[data-id="${CSS.escape(threadId)}"]`);
  activeItem?.classList.remove('unread');
  activeItem?.querySelector('.chat-unread-badge')?.remove();

  const layout = pane.closest('.chat-layout');
  if (layout) layout.dataset.mobileView = 'messages';

  pane.innerHTML = `
    <div class="chat-pane-header">
      <button type="button" class="chat-back-btn" aria-label="Back to threads">‹</button>
      <strong>${escapeHtml(threadTitle)}</strong>
    </div>
    <div class="chat-messages" id="chat-messages">
      ${messages.length ? messages.map(m => chatMessageHtml(m, threadId)).join('') : '<p class="chat-empty">No messages yet. Say something!</p>'}
    </div>
    <form class="chat-compose" id="chat-compose">
      <textarea id="chat-body" placeholder="Write a message…" rows="2" maxlength="2000"></textarea>
      <button type="submit">Send</button>
    </form>`;

  const msgEl = $('#chat-messages');
  if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;

  pane.querySelector('.chat-back-btn')?.addEventListener('click', () => {
    const layout = pane.closest('.chat-layout');
    if (layout) delete layout.dataset.mobileView;
    content.querySelectorAll('.chat-thread-item').forEach(el => el.classList.remove('active'));
  });

  $('#chat-compose').onsubmit = async e => {
    e.preventDefault();
    const body = $('#chat-body').value.trim();
    if (!body) return;
    await api(`/api/chat/threads/${threadId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    openChatThread(threadId, threadTitle);
  };
  $('#chat-body').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-compose').requestSubmit(); }
  });

  pane.querySelectorAll('.chat-msg-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete this message?')) return;
      await api(`/api/chat/threads/${threadId}/messages/${btn.dataset.id}`, { method: 'DELETE' });
      openChatThread(threadId, threadTitle);
    };
  });
}

function chatThreadItemHtml(thread) {
  const badge = thread.pinned ? '<span class="chat-pin-badge">📌</span>' : '';
  const count = thread.messageCount > 0 ? `${thread.messageCount} msg${thread.messageCount === 1 ? '' : 's'}` : 'Empty';
  const preview = thread.lastMessage?.body
    ? `<small class="chat-thread-preview">${escapeHtml(thread.lastMessage.body.length > 48 ? thread.lastMessage.body.slice(0, 48) + '…' : thread.lastMessage.body)}</small>`
    : '<small class="chat-thread-preview chat-thread-preview-empty">No messages yet</small>';
  const unread = thread.unreadCount > 0 ? `<span class="chat-unread-badge" aria-label="${escapeAttribute(thread.unreadCount + ' unread message' + (thread.unreadCount === 1 ? '' : 's'))}">${escapeHtml(thread.unreadCount > 9 ? '9+' : String(thread.unreadCount))}</span>` : '';
  return `<div class="chat-thread-item${thread.unreadCount > 0 ? ' unread' : ''}" data-id="${escapeAttribute(thread.id)}" data-title="${escapeAttribute(thread.title)}">
    <button type="button" class="chat-thread-btn">${badge}<span class="chat-thread-copy"><span class="chat-thread-title">${escapeHtml(thread.title)}</span>${preview}</span>${unread}<small class="chat-thread-count">${escapeHtml(count)}</small></button>
    <div class="chat-thread-actions">
      <button type="button" class="chat-pin-btn" data-pinned="${thread.pinned}" title="${thread.pinned ? 'Unpin' : 'Pin'}">${thread.pinned ? '📌' : '·'}</button>
      <button type="button" class="chat-del-thread-btn" title="Delete thread">✕</button>
    </div>
  </div>`;
}

const PROFILE_COLORS = { justin: '#7dd3fc', kari: '#f0abfc', cohen: '#86efac', hudson: '#fb7185', family: '#ffd60a', wife: '#f0abfc' };

function chatMessageHtml(msg, threadId) {
  const color = PROFILE_COLORS[msg.profileId] || '#ffd60a';
  const name = msg.profileId.charAt(0).toUpperCase() + msg.profileId.slice(1);
  const time = new Date(msg.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `<article class="chat-message">
    <div class="chat-msg-meta"><span class="chat-avatar" style="background:${color}">${escapeHtml(name[0])}</span><strong>${escapeHtml(name)}</strong><time>${escapeHtml(time)}</time><button type="button" class="chat-msg-delete" data-id="${escapeAttribute(msg.id)}" data-thread="${escapeAttribute(threadId)}" title="Delete">✕</button></div>
    <p class="chat-msg-body">${escapeHtml(msg.body)}</p>
  </article>`;
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

function profileAvatarHtml(profile, size = 28) {
  const color = profile.color || PROFILE_COLORS[profile.id] || '#ffd60a';
  const initial = (profile.name || profile.id || '?')[0].toUpperCase();
  if (profile.avatar) {
    return `<img class="profile-avatar-img" src="${escapeAttribute(profile.avatar)}" alt="${escapeHtml(profile.name)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">`;
  }
  return `<span class="profile-avatar-dot" style="background:${escapeAttribute(color)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px">${escapeHtml(initial)}</span>`;
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
  if (pill && activeProfile) {
    pill.innerHTML = profileAvatarHtml(activeProfile, 22) + '<span>' + escapeHtml(activeProfile.name) + '</span>';
  }
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
  const path = appRoutePath(location.pathname);
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === path));
}

async function navigateTo(path, { replace = false } = {}) {
  const url = new URL(path, location.origin);
  if (!isAppRoute(url.pathname)) {
    location.href = url.pathname + url.search + url.hash;
    return;
  }
  const next = url.pathname + url.search + url.hash;
  if (next !== location.pathname + location.search + location.hash) {
    history[replace ? 'replaceState' : 'pushState']({}, '', next);
  }
  activeFilter = 'all';
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    await render();
  } catch (err) {
    content.innerHTML = `<pre>${escapeHtml(err.stack || err.message)}</pre>`;
  }
}

function bindAppNavigation() {
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin || !isAppRoute(url.pathname)) return;
    event.preventDefault();
    navigateTo(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', () => {
    render().catch(err => content.innerHTML = `<pre>${escapeHtml(err.stack || err.message)}</pre>`);
  });
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
  if (e.key === '1') { e.preventDefault(); navigateTo('/home'); }
  if (e.key === '2') { e.preventDefault(); navigateTo('/today'); }
  if (e.key === '3') { e.preventDefault(); navigateTo('/calendar'); }
  if (e.key === '4') { e.preventDefault(); navigateTo('/grocery'); }
});

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttribute(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }
bindAppNavigation();
render().catch(err => content.innerHTML = `<pre>${escapeHtml(err.stack || err.message)}</pre>`);
