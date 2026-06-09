const $ = sel => document.querySelector(sel);
const content = $('#content');
let activeFilter = 'all';
let draggedId = null;
let quickReaddDeleteMode = false;
document.addEventListener('pointerdown', e => {
  if (!quickReaddDeleteMode) return;
  if (!e.target.closest('.recent-grocery')) {
    quickReaddDeleteMode = false;
    document.querySelector('.recent-grocery')?.classList.remove('quick-readd-delete-mode');
  }
}, true);
let activeProfile = null;
let activeModules = [];
const APP_ROUTES = new Set(['/home', '/today', '/future', '/grocery', '/calendar', '/documents', '/work', '/chat', '/settings', '/profile', '/done', '/projects', '/inbox']);

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
  if (path === '/chat') return { key: 'chat', title: 'Chat', chat: true };
  if (path === '/settings') return { key: 'settings', title: 'Settings', settings: true };
  if (path === '/profile') return { key: 'profile', title: 'Profile', profile: true };
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
  if (view.chat) return renderChat();
  if (view.settings) return renderSettings();
  if (view.profile) return renderProfileSettings();
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
  const countLabel = Number.isInteger(count) ? ` ${count}` : '';
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
  content.innerHTML = `<div class="mobile-appbar" aria-hidden="true"></div>${mobileCategoryNav()}` + `
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
  return `<article class="hub-panel"><header><h3>${escapeHtml(title)}</h3><a class="hub-panel-link" href="${href}">${escapeHtml(linkLabel)}<svg class="hub-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></a></header><ul>${body}</ul></article>`;
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
  const [calendarData, { profiles: settingsProfiles }, workSettingsData] = await Promise.all([
    api('/api/calendar'),
    api('/api/profiles').catch(() => ({ profiles: [] })),
    api('/api/work/settings').catch(() => ({ settings: {} })),
  ]);
  const { calendars, events } = calendarData;
  const hidden = hiddenCalendarSourceIds();
  const workSettings = workSettingsData.settings || {};
  const serviceNames = workSettings.serviceNames || ['IPL', 'Peel', 'Facial', 'Wax', 'Lash', 'Product', 'Other'];
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
    </section>
    <section class="settings-card" id="work-settings-card">
      <header><div><p class="eyebrow">Work · Kari</p><h3>Service names</h3><p>These appear in the dropdown when logging work. Drag to reorder, click × to remove.</p></div><a href="/work">Go to Work →</a></header>
      <div class="work-settings-services" id="work-settings-services">
        ${serviceNames.map(n => `<div class="work-settings-service-chip">${escapeHtml(n)}<button type="button" class="work-settings-remove-service" data-name="${escapeAttribute(n)}" aria-label="Remove ${escapeHtml(n)}">×</button></div>`).join('')}
      </div>
      <div class="work-settings-add-row">
        <input type="text" id="work-settings-new-service" placeholder="Add a service…" autocomplete="off" maxlength="40">
        <button type="button" id="work-settings-add-service" class="tips-submit-btn">Add</button>
      </div>
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

  async function saveServiceNames(names) {
    await api('/api/work/settings', { method: 'PATCH', body: JSON.stringify({ ...workSettings, serviceNames: names }) });
  }

  function currentServiceNames() {
    return [...$('#work-settings-services').querySelectorAll('.work-settings-service-chip')].map(el => el.firstChild.textContent.trim());
  }

  content.querySelectorAll('.work-settings-remove-service').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.name;
      const updated = serviceNames.filter(n => n !== name);
      await saveServiceNames(updated);
      renderSettings();
    };
  });

  const addBtn = $('#work-settings-add-service');
  const addInput = $('#work-settings-new-service');
  if (addBtn && addInput) {
    const doAdd = async () => {
      const name = addInput.value.trim();
      if (!name || serviceNames.includes(name)) { addInput.value = ''; return; }
      await saveServiceNames([...currentServiceNames(), name]);
      renderSettings();
    };
    addBtn.onclick = doAdd;
    addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  }
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
let workViewMode = 'cards';
let workClientSearch = '';
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
  const filteredEntries = workClientSearch
    ? scopedEntries.filter(e => (e.clientName || '').toLowerCase().includes(workClientSearch.toLowerCase()))
    : scopedEntries;
  const visibleEntries = filteredEntries.slice(0, 50);
  const periodLabel = WORK_PERIODS.find(([value]) => value === workPeriod)?.[1] || 'Month';
  const serviceNames = settings.serviceNames || ['IPL', 'Peel', 'Facial', 'Wax', 'Lash', 'Product', 'Other'];

  content.innerHTML = viewHeader('Work', `${summary.entryCount.toLocaleString()} entr${summary.entryCount === 1 ? 'y' : 'ies'} · ${periodLabel} summary below.`) + `
    <section class="work-dashboard-tools">
      ${workPeriodControlsHtml()}
      <div class="tips-export-row work-actions-row">
        ${entries.length ? `<a class="tips-export-btn" href="/api/work/export.csv" download="work-export.csv">↓ Export</a>` : ''}
        <button type="button" class="tips-export-btn work-import-toggle-btn" id="work-import-toggle">↑ Import</button>
        <a class="work-gear-btn tips-export-btn" href="/settings" title="Work settings" aria-label="Work settings"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M11.9 3.4l-.7.7M4.1 11.9l-.7.7"/></svg></a>
      </div>
    </section>
    <div id="work-import-panel-container" class="work-import-container" hidden>${workImportPanelInner(importResponse.batches || [])}</div>
    <section class="tips-summary-grid work-summary-grid">
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.revenue, true))}</span><small>Revenue · ${escapeHtml(periodLabel)}</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.payout, true))}</span><small>Payout</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.tips, true))}</span><small>Tips</small></div>
      <div class="tip-stat"><span class="tip-stat-amount">${escapeHtml(workMoney(scopedSummary.totalEarnings, true))}</span><small>Total earnings</small></div>
    </section>
    <p class="work-history-note">All-time: ${escapeHtml(workMoney(summary.revenue))} revenue · ${escapeHtml(workMoney(summary.payout))} payout · ${escapeHtml(workMoney(summary.tips))} tips.</p>
    ${workChartsHtml(summary, scopedEntries, workPeriod)}
    <section class="hub-panel tips-log-panel work-log-panel">
      <header>
        <div><h3>Log work</h3><small>Commission ${escapeHtml(pct(settings.defaultCommissionRate))} · <a href="/settings">Change in settings ⚙</a></small></div>
        <button type="button" class="work-voice-btn" id="work-voice-btn" title="Speak to fill form">🎤 Voice</button>
      </header>
      <form id="work-form" class="tips-form work-form">
        <datalist id="work-service-names">${serviceNames.map(n => `<option value="${escapeAttribute(n)}">`).join('')}</datalist>
        <div class="tips-form-row work-form-grid">
          <label class="work-field-date">Date<input type="date" name="date" value="${escapeAttribute(today)}" required></label>
          <label class="work-field-client">Client<input type="text" name="clientName" placeholder="Client name" autocomplete="off"></label>
          <label class="work-field-service">Service/Product<input type="text" name="serviceName" list="work-service-names" placeholder="Choose or type…" autocomplete="off"></label>
          <label>Revenue&nbsp;$<input type="number" name="revenue" placeholder="0" step="0.01" min="0" required></label>
          <label>Tip&nbsp;$<input type="number" name="tipAmount" placeholder="0" step="0.01" min="0"></label>
          <label>Tip type<select name="tipType"><option value=""></option>${(settings.tipTypes || ['Cash', 'Tippy', 'Venmo', 'Other']).map(type => `<option value="${escapeAttribute(type)}">${escapeHtml(type)}</option>`).join('')}</select></label>
          <div class="work-form-submit-row">
            <button type="submit" class="tips-submit-btn">Save</button>
          </div>
        </div>
      </form>
    </section>
    <section class="work-recent-section">
      <header>
        <div><h3>Entries</h3><small>${workClientSearch ? `${visibleEntries.length} match${visibleEntries.length === 1 ? '' : 'es'}` : `${scopedEntries.length.toLocaleString()} · ${periodLabel}`}</small></div>
        <div class="work-view-toggle" role="group" aria-label="View mode">
          <button type="button" class="work-view-btn ${workViewMode === 'cards' ? 'active' : ''}" data-view-mode="cards">Cards</button>
          <button type="button" class="work-view-btn ${workViewMode === 'table' ? 'active' : ''}" data-view-mode="table">Table</button>
        </div>
      </header>
      <div class="work-search-row">
        <input type="search" id="work-client-search" class="work-client-search" placeholder="Search by client…" value="${escapeAttribute(workClientSearch)}" autocomplete="off">
      </div>
      <div id="work-list">
        ${visibleEntries.length
          ? workViewMode === 'table'
            ? workTableHtml(visibleEntries, settings)
            : workCardsGroupedHtml(visibleEntries, settings)
          : `<div class="empty-state">${workClientSearch ? 'No entries match that client name.' : 'No work entries yet. Log your first entry above.'}</div>`}
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
      tipAmount: parseFloat(fd.get('tipAmount')) || 0,
      tipType: fd.get('tipType') || '',
    };
    const btn = e.currentTarget.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/work', { method: 'POST', body: JSON.stringify(data) });
      e.currentTarget.reset();
      e.currentTarget.querySelector('[name=date]').value = today;
      renderWork();
    } finally {
      btn.disabled = false;
    }
  };

  $('#work-import-toggle').onclick = () => {
    const panel = $('#work-import-panel-container');
    if (panel) {
      panel.hidden = !panel.hidden;
      $('#work-import-toggle').textContent = panel.hidden ? '↑ Import' : '✕ Import';
    }
  };

  content.querySelectorAll('.work-view-btn').forEach(btn => {
    btn.onclick = () => {
      workViewMode = btn.dataset.viewMode;
      renderWork();
    };
  });

  const searchInput = $('#work-client-search');
  if (searchInput) {
    searchInput.oninput = () => {
      workClientSearch = searchInput.value.trim();
      const filtered = workClientSearch
        ? scopedEntries.filter(e => (e.clientName || '').toLowerCase().includes(workClientSearch.toLowerCase()))
        : scopedEntries;
      const visible = filtered.slice(0, 50);
      const listEl = document.getElementById('work-list');
      listEl.innerHTML = visible.length
        ? workViewMode === 'table'
          ? workTableHtml(visible, settings)
          : workCardsGroupedHtml(visible, settings)
        : `<div class="empty-state">${workClientSearch ? 'No entries match that client name.' : 'No entries for this period.'}</div>`;
      bindWorkControls(visible, settings);
      const small = content.querySelector('.work-recent-section header small');
      if (small) small.textContent = workClientSearch ? `${visible.length} match${visible.length === 1 ? '' : 'es'}` : `${scopedEntries.length.toLocaleString()} · ${periodLabel}`;
    };
  }

  bindWorkControls(visibleEntries, settings);
  bindWorkImportControls();
  setupWorkVoiceInput(settings);
  content.querySelectorAll('[data-work-period]').forEach(btn => {
    btn.onclick = () => {
      workPeriod = btn.dataset.workPeriod;
      renderWork();
    };
  });
}

function workImportPanelInner(batches = []) {
  const defaultPaths = [
    '/home/agent/.hermes/cache/documents/doc_78fef06f7088_2023_Commission_Spreadsheet.xlsx',
    '/home/agent/.hermes/cache/documents/doc_01440aefb993_2024_Commission_Spreadsheet.xlsx',
    '/home/agent/.hermes/cache/documents/doc_9e7b3bebda79_2025_Commission_Spreadsheet.xlsx',
    '/home/agent/.hermes/cache/documents/doc_f0627a89bf12_2026_Commission_Spreadsheet.xlsx',
  ].join('\n');
  const latest = batches[0];
  const latestSummary = latest ? importBatchSummaryHtml(latest) : 'No import batch staged yet.';
  return `<div class="hub-panel work-import-panel">
    <header><h3>Spreadsheet import</h3><small>${escapeHtml(latestSummary)}</small></header>
    <p class="work-import-help">Paste workbook paths below, then dry-run to preview rows before committing.</p>
    <textarea id="work-import-paths" rows="4" spellcheck="false">${escapeHtml(defaultPaths)}</textarea>
    <div class="work-import-actions">
      <button type="button" id="work-import-dry-run" class="tips-submit-btn">Dry-run import</button>
      ${latest ? `<button type="button" id="work-import-open" data-batch-id="${escapeAttribute(latest.id)}">Review latest batch</button>` : ''}
    </div>
    <div id="work-import-status" class="tips-shift-breakdown">${escapeHtml(latestSummary)}</div>
    <div id="work-import-review"></div>
  </div>`;
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

function workChartsHtml(summary, scopedEntries, period) {
  if (!scopedEntries.length) return '';
  const periodLabel = WORK_PERIODS.find(([v]) => v === period)?.[1] || 'Period';
  const buckets = buildWorkBuckets(scopedEntries, period);
  const areaChart = buildWorkAreaChart(buckets, periodLabel);
  // Derive service and tip breakdowns from scoped entries so they react to the period selector
  const svcMap = new Map();
  const tipsByType = {};
  for (const e of scopedEntries) {
    const key = e.serviceName || 'Unspecified';
    if (!svcMap.has(key)) svcMap.set(key, { serviceName: key, revenue: 0, count: 0 });
    svcMap.get(key).revenue += Number(e.revenue || 0);
    svcMap.get(key).count += 1;
    if (Number(e.tipAmount) > 0) tipsByType[e.tipType || 'Other'] = (tipsByType[e.tipType || 'Other'] || 0) + Number(e.tipAmount);
  }
  const topServices = [...svcMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const donutChart = buildServiceDonutChart(topServices);
  const tipsChart = buildTipsTypeChart(tipsByType);
  const payBreakdown = buildPayBreakdownChart(scopedEntries);
  const hasSecondRow = donutChart || tipsChart;
  return `<div class="work-charts-grid">
    ${areaChart ? `<div class="work-chart-card work-chart-full">${areaChart}</div>` : ''}
    ${hasSecondRow ? `<div class="work-charts-row">
      ${donutChart ? `<div class="work-chart-card work-chart-donut">${donutChart}</div>` : ''}
      ${tipsChart ? `<div class="work-chart-card work-chart-tips">${tipsChart}</div>` : ''}
      ${payBreakdown ? `<div class="work-chart-card work-chart-pay">${payBreakdown}</div>` : ''}
    </div>` : ''}
  </div>`;
}

function buildWorkBuckets(entries, period) {
  const now = new Date();
  let buckets = [];
  if (period === 'today') {
    const todayStr = now.toISOString().slice(0, 10);
    for (let h = 7; h <= 20; h++) {
      const label = `${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}`;
      const value = entries.filter(e => e.date === todayStr).reduce((s, e) => s + Number(e.totalEarnings || 0), 0) / 13;
      buckets.push({ label, value: h === now.getHours() ? value * 13 : 0 });
    }
    const todayTotal = entries.filter(e => e.date === todayStr).reduce((s, e) => s + Number(e.totalEarnings || 0), 0);
    buckets = [{ label: 'Today', value: todayTotal }];
  } else if (period === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const value = entries.filter(e => e.date === dateStr).reduce((s, e) => s + Number(e.totalEarnings || 0), 0);
      buckets.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), value, date: dateStr });
    }
  } else if (period === 'month') {
    const monthStr = now.toISOString().slice(0, 7);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const weekBuckets = new Map();
    for (let day = 1; day <= daysInMonth; day++) {
      const weekNum = Math.ceil(day / 7);
      if (!weekBuckets.has(weekNum)) weekBuckets.set(weekNum, { label: `Wk ${weekNum}`, value: 0, count: 0 });
      const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
      entries.filter(e => e.date === dateStr).forEach(e => {
        const b = weekBuckets.get(weekNum);
        b.value += Number(e.totalEarnings || 0);
        b.count += 1;
      });
    }
    buckets = [...weekBuckets.values()];
  } else {
    const monthMap = new Map();
    for (let m = 11; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = d.toISOString().slice(0, 7);
      monthMap.set(key, { label: d.toLocaleDateString('en-US', { month: 'short' }), value: 0, count: 0 });
    }
    entries.forEach(e => {
      const key = e.date.slice(0, 7);
      if (monthMap.has(key)) { monthMap.get(key).value += Number(e.totalEarnings || 0); monthMap.get(key).count += 1; }
    });
    buckets = [...monthMap.values()];
  }
  return buckets;
}

function buildWorkAreaChart(buckets, periodLabel) {
  if (!buckets.some(b => b.value > 0)) return '';
  const W = 340, H = 110, padL = 44, padB = 24, padT = 22, padR = 12;
  const cW = W - padL - padR, cH = H - padT - padB;
  const n = buckets.length;
  const maxVal = Math.max(...buckets.map(b => b.value), 1);
  const xPos = i => padL + (n < 2 ? cW / 2 : (i / (n - 1)) * cW);
  const yPos = v => padT + cH - (v / maxVal) * cH;
  const pts = buckets.map((b, i) => `${xPos(i).toFixed(1)},${yPos(b.value).toFixed(1)}`).join(' ');
  const areaD = `M${padL},${padT + cH} ${buckets.map((b, i) => `L${xPos(i).toFixed(1)},${yPos(b.value).toFixed(1)}`).join(' ')} L${padL + cW},${padT + cH} Z`;
  const gridLines = [0, 0.5, 1].map(f => {
    const y = yPos(maxVal * f).toFixed(1);
    return `<line x1="${padL}" y1="${y}" x2="${padL + cW}" y2="${y}" class="wc-grid"/>
      <text x="${padL - 4}" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end" class="wc-axis">${workMoney(maxVal * f, true)}</text>`;
  }).join('');
  const step = n > 9 ? 2 : 1;
  const xLabels = buckets.map((b, i) => i % step === 0
    ? `<text x="${xPos(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="wc-axis">${escapeHtml(b.label)}</text>` : '').join('');
  const dots = buckets.map((b, i) => b.value > 0
    ? `<circle cx="${xPos(i).toFixed(1)}" cy="${yPos(b.value).toFixed(1)}" r="3.5" class="wc-dot"/>` : '').join('');
  return `<div class="work-chart-header"><span class="work-chart-title">Earnings trend</span><span class="work-chart-sub">${escapeHtml(periodLabel)}</span></div>
  <div class="work-chart-scroll">
    <svg viewBox="0 0 ${W} ${H}" class="work-area-svg" aria-label="Earnings trend">
      <defs><linearGradient id="wag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffd60a" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#ffd60a" stop-opacity="0.03"/>
      </linearGradient></defs>
      ${gridLines}
      <path d="${areaD}" fill="url(#wag)"/>
      <polyline points="${pts}" fill="none" stroke="#ffd60a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${xLabels}${dots}
    </svg>
  </div>`;
}

function buildServiceDonutChart(topServices) {
  const services = topServices.slice(0, 6);
  if (!services.length) return '';
  const colors = ['#ffd60a', '#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa'];
  const cx = 62, cy = 62, r = 50, ir = 32;
  const total = services.reduce((s, sv) => s + Number(sv.revenue || 0), 0) || 1;
  let angle = -Math.PI / 2;
  const slices = services.map((svc, i) => {
    const frac = Number(svc.revenue || 0) / total;
    const sweep = frac * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle);
    const ix1 = cx + ir * Math.cos(angle - sweep), iy1 = cy + ir * Math.sin(angle - sweep);
    const ix2 = cx + ir * Math.cos(angle), iy2 = cy + ir * Math.sin(angle);
    const la = sweep > Math.PI ? 1 : 0;
    const d = `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${la},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${ir},${ir} 0 ${la},0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`;
    return { d, color: colors[i % colors.length], svc, pct: Math.round(frac * 100) };
  });
  const legend = slices.map(({ svc, color, pct }) =>
    `<div class="wc-legend-row"><span class="wc-legend-dot" style="background:${color}"></span><span class="wc-legend-name">${escapeHtml(svc.serviceName)}</span><span class="wc-legend-pct">${pct}%</span></div>`
  ).join('');
  return `<div class="work-chart-header"><span class="work-chart-title">Service mix</span></div>
  <div class="wc-donut-wrap">
    <svg viewBox="0 0 124 124" class="wc-donut-svg" aria-label="Service revenue mix">
      ${slices.map(s => `<path d="${s.d}" fill="${s.color}" class="wc-donut-slice"/>`).join('')}
      <circle cx="${cx}" cy="${cy}" r="${ir - 2}" class="wc-donut-hole"/>
      <text x="${cx}" y="${cy - 3}" text-anchor="middle" class="wc-donut-total">${escapeHtml(workMoney(total, true))}</text>
      <text x="${cx}" y="${cy + 13}" text-anchor="middle" class="wc-donut-sub">revenue</text>
    </svg>
    <div class="wc-legend">${legend}</div>
  </div>`;
}

function buildTipsTypeChart(tipsByType) {
  const rows = Object.entries(tipsByType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) return '';
  const total = rows.reduce((s, [, v]) => s + v, 0) || 1;
  const colors = ['#ffd60a', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];
  const bars = rows.map(([type, amt], i) => {
    const pct = Math.round((amt / total) * 100);
    return `<div class="wc-hbar-row">
      <span class="wc-hbar-label">${escapeHtml(type)}</span>
      <div class="wc-hbar-track"><div class="wc-hbar-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div></div>
      <span class="wc-hbar-val">${escapeHtml(workMoney(amt, true))}</span>
    </div>`;
  }).join('');
  return `<div class="work-chart-header"><span class="work-chart-title">Tips by type</span></div>
  <div class="wc-hbars">${bars}</div>`;
}

function buildPayBreakdownChart(entries) {
  if (!entries.length) return '';
  const totalPayout = entries.reduce((s, e) => s + Number(e.payout || 0), 0);
  const totalTips = entries.reduce((s, e) => s + Number(e.tipAmount || 0), 0);
  const totalEarnings = totalPayout + totalTips;
  if (!totalEarnings) return '';
  const payoutPct = Math.round((totalPayout / totalEarnings) * 100);
  const tipsPct = 100 - payoutPct;
  const avgPerEntry = totalEarnings / entries.length;
  return `<div class="work-chart-header"><span class="work-chart-title">Pay breakdown</span></div>
  <div class="wc-pay-breakdown">
    <div class="wc-pay-bar-wrap">
      <div class="wc-pay-bar-track">
        <div class="wc-pay-bar-payout" style="width:${payoutPct}%" title="Commission ${payoutPct}%"></div>
        <div class="wc-pay-bar-tips" style="width:${tipsPct}%" title="Tips ${tipsPct}%"></div>
      </div>
    </div>
    <div class="wc-pay-legend">
      <span><span class="wc-pay-dot wc-pay-dot-payout"></span>Commission <b>${payoutPct}%</b></span>
      <span><span class="wc-pay-dot wc-pay-dot-tips"></span>Tips <b>${tipsPct}%</b></span>
    </div>
    <div class="wc-pay-avg">Avg ${escapeHtml(workMoney(avgPerEntry))} / entry</div>
  </div>`;
}

function bindWorkControls(entries, settings) {
  content.querySelectorAll('.work-delete-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id || btn.closest('[data-id]')?.dataset.id;
      if (!id || !confirm('Delete this work entry?')) return;
      await api(`/api/work/${id}`, { method: 'DELETE' });
      renderWork();
    };
  });
  content.querySelectorAll('.work-edit-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id || btn.closest('[data-id]')?.dataset.id;
      const entry = entries.find(en => en.id === id);
      if (!entry) return;
      openWorkEditModal(entry, settings);
    };
  });
}

function ensureWorkEditModal() {
  let modal = document.getElementById('work-edit-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'work-edit-modal';
    modal.className = 'work-modal-overlay';
    modal.setAttribute('hidden', '');
    modal.innerHTML = `<div class="work-modal-box" role="dialog" aria-modal="true" aria-label="Edit work entry">
      <div class="work-modal-header">
        <h3>Edit entry</h3>
        <button class="work-modal-close" aria-label="Close">✕</button>
      </div>
      <div id="work-modal-inner"></div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeWorkEditModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeWorkEditModal(); });
    modal.querySelector('.work-modal-close').onclick = closeWorkEditModal;
  }
  return modal;
}

function openWorkEditModal(entry, settings) {
  const modal = ensureWorkEditModal();
  document.getElementById('work-modal-inner').innerHTML = workEditFormHtml(entry, settings);
  modal.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  modal.querySelector('.work-edit-form').onsubmit = async e => {
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
    const btn = e.currentTarget.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api(`/api/work/${entry.id}`, { method: 'PATCH', body: JSON.stringify(data) });
      closeWorkEditModal();
      renderWork();
    } finally {
      btn.disabled = false;
    }
  };
  modal.querySelector('.work-edit-cancel-btn').onclick = closeWorkEditModal;
  modal.querySelector('[name=date]')?.focus();
}

function closeWorkEditModal() {
  const modal = document.getElementById('work-edit-modal');
  if (modal) modal.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

function workEditFormHtml(entry, settings) {
  const rateVal = String(Math.round(Number(entry.commissionRate || 0) * 1000) / 10);
  const serviceNames = settings.serviceNames || ['IPL', 'Peel', 'Facial', 'Wax', 'Lash', 'Product', 'Other'];
  return `<datalist id="work-edit-service-names">${serviceNames.map(n => `<option value="${escapeAttribute(n)}">`).join('')}</datalist>
  <form class="work-edit-form tips-form">
    <div class="work-edit-grid">
      <label>Date<input type="date" name="date" value="${escapeAttribute(entry.date)}" required></label>
      <label>Client<input type="text" name="clientName" value="${escapeAttribute(entry.clientName || '')}" autocomplete="off"></label>
      <label>Service<input type="text" name="serviceName" list="work-edit-service-names" value="${escapeAttribute(entry.serviceName || '')}" autocomplete="off"></label>
      <label>Revenue&nbsp;$<input type="number" name="revenue" value="${escapeAttribute(String(entry.revenue || 0))}" step="0.01" min="0" required></label>
      <label>Tip&nbsp;$<input type="number" name="tipAmount" value="${escapeAttribute(String(entry.tipAmount || 0))}" step="0.01" min="0"></label>
      <label>Tip type<select name="tipType"><option value=""></option>${(settings.tipTypes || ['Cash', 'Tippy', 'Venmo', 'Other']).map(t => `<option value="${escapeAttribute(t)}"${entry.tipType === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>
      <label>Rate&nbsp;%<input type="number" name="commissionRatePercent" value="${escapeAttribute(rateVal)}" step="0.1" min="0" max="100"></label>
      <label>Deductions&nbsp;$<input type="number" name="deductions" value="${escapeAttribute(String(entry.deductions || 0))}" step="0.01" min="0"></label>
      <label class="work-edit-notes">Notes<input type="text" name="notes" value="${escapeAttribute(entry.notes || '')}" placeholder="Optional…"></label>
    </div>
    <div class="work-modal-actions">
      <button type="submit" class="tips-submit-btn">Save changes</button>
      <button type="button" class="work-edit-cancel-btn tips-export-btn">Cancel</button>
    </div>
  </form>`;
}

function startVoice(btn, originalLabel, onTranscript) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  btn.textContent = '🔴 Listening…';
  btn.disabled = true;
  let gotResult = false;
  rec.start();
  rec.onresult = e => {
    gotResult = true;
    onTranscript(e.results[0][0].transcript);
  };
  rec.onerror = () => { btn.textContent = originalLabel; btn.disabled = false; };
  rec.onend = () => { if (!gotResult) { btn.textContent = originalLabel; btn.disabled = false; } };
}

function setupWorkVoiceInput(settings) {
  const btn = $('#work-voice-btn');
  if (!btn) return;
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    btn.title = 'Voice input not supported in this browser';
    btn.style.opacity = '0.4';
    return;
  }
  btn.onclick = () => startVoice(btn, '🎤 Voice', async transcript => {
    btn.textContent = '⏳ Parsing…';
    try {
      const result = await api('/api/voice/parse', { method: 'POST', body: JSON.stringify({ transcript, schema: 'work' }) });
      applyWorkVoiceResult(result, settings);
    } catch {
      parseVoiceWorkEntryFallback(transcript.toLowerCase(), settings);
    } finally {
      btn.textContent = '🎤 Voice';
      btn.disabled = false;
    }
  });
}

function applyWorkVoiceResult(result, settings) {
  const form = $('#work-form');
  if (!form) return;
  if (result.clientName) form.clientName.value = result.clientName;
  if (result.serviceName) form.serviceName.value = result.serviceName;
  if (result.revenue) form.revenue.value = result.revenue;
  if (result.tipAmount) form.tipAmount.value = result.tipAmount;
  if (result.tipType) form.tipType.value = result.tipType;
}

function setupGroceryVoiceInput() {
  const btn = $('#grocery-voice-btn');
  if (!btn) return;
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    btn.style.display = 'none';
    return;
  }
  btn.onclick = () => startVoice(btn, '🎤', async transcript => {
    btn.textContent = '⏳';
    try {
      const { items } = await api('/api/voice/parse', { method: 'POST', body: JSON.stringify({ transcript, schema: 'grocery' }) });
      if (Array.isArray(items) && items.length) {
        await Promise.all(items.map(item => api('/api/grocery', { method: 'POST', body: JSON.stringify({ ...item, source: 'voice' }) })));
        renderGrocery();
      }
    } catch {
      // fail silently — user can type manually
    } finally {
      btn.textContent = '🎤';
      btn.disabled = false;
    }
  });
}

function resizeImage(file, maxPx) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

function openGrocerySheet() {
  const sheet = $('#grocery-add-sheet');
  if (!sheet) return;
  sheet.classList.add('open');
  requestAnimationFrame(() => $('#grocery-title')?.focus());
}

function closeGrocerySheet() {
  const sheet = $('#grocery-add-sheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  const sugg = $('#grocery-suggestions');
  if (sugg) sugg.hidden = true;
}

function startGroceryVoice(triggerBtn) {
  const fab = triggerBtn || $('#grocery-fab');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { openGrocerySheet(); return; }
  if (navigator.vibrate) navigator.vibrate(14);
  const originalHTML = fab.innerHTML;
  fab.textContent = '🔴 Listening…';
  fab.disabled = true;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.start();
  let handled = false;
  rec.onresult = async e => {
    handled = true;
    const transcript = e.results[0][0].transcript;
    fab.textContent = '⏳ Adding…';
    try {
      const { items } = await api('/api/voice/parse', { method: 'POST', body: JSON.stringify({ transcript, schema: 'grocery' }) });
      if (Array.isArray(items) && items.length) {
        await Promise.all(items.map(item => api('/api/grocery', { method: 'POST', body: JSON.stringify({ ...item, source: 'voice' }) })));
        fab.innerHTML = originalHTML;
        fab.disabled = false;
        renderGrocery();
        return;
      }
    } catch { /* fall through to text input */ }
    fab.innerHTML = originalHTML;
    fab.disabled = false;
    openGrocerySheet();
    const input = $('#grocery-title');
    if (input) input.value = transcript;
  };
  rec.onerror = () => { fab.innerHTML = originalHTML; fab.disabled = false; openGrocerySheet(); };
  rec.onend = () => { if (!handled) { fab.innerHTML = originalHTML; fab.disabled = false; } };
}

function setupGroceryFab() {
  const fab = $('#grocery-fab');
  const sheet = $('#grocery-add-sheet');
  if (!fab) return;
  let holdTimer = null;
  let startPos = null;
  fab.addEventListener('pointerdown', e => {
    startPos = { x: e.clientX, y: e.clientY };
    holdTimer = setTimeout(() => {
      holdTimer = null;
      startPos = null;
      startGroceryVoice(fab);
    }, 520);
  });
  fab.addEventListener('pointerup', () => {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    startPos = null;
    openGrocerySheet();
  });
  fab.addEventListener('pointermove', e => {
    if (!startPos) return;
    const d = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);
    if (d > 12) { clearTimeout(holdTimer); holdTimer = null; startPos = null; }
  });
  fab.addEventListener('pointercancel', () => { clearTimeout(holdTimer); holdTimer = null; startPos = null; });
  document.addEventListener('pointerdown', e => {
    if (!sheet?.classList.contains('open')) return;
    if (!sheet.contains(e.target) && !fab.contains(e.target)) closeGrocerySheet();
  }, true);
}

function setupGroceryScanInput() {
  const scanBtn = $('#grocery-scan-btn');
  const scanInput = $('#grocery-scan-input');
  if (!scanBtn || !scanInput) return;
  scanBtn.onclick = () => scanInput.click();
  scanInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    scanBtn.textContent = '⏳';
    scanBtn.disabled = true;
    scanInput.value = '';
    try {
      let body;
      if ('BarcodeDetector' in window) {
        try {
          const detector = new BarcodeDetector();
          const bitmap = await createImageBitmap(file);
          const codes = await detector.detect(bitmap);
          if (codes.length) body = { barcode: codes[0].rawValue };
        } catch {}
      }
      if (!body) body = { image: await resizeImage(file, 1024) };
      const { items } = await api('/api/grocery/scan', { method: 'POST', body: JSON.stringify(body) });
      if (Array.isArray(items) && items.length) {
        await Promise.all(items.map(item => api('/api/grocery', { method: 'POST', body: JSON.stringify({ ...item, source: 'scan' }) })));
        renderGrocery();
      }
    } catch {
      // fail silently — user can type manually
    } finally {
      scanBtn.textContent = '📷';
      scanBtn.disabled = false;
    }
  };
}

function parseVoiceWorkEntryFallback(transcript, settings) {
  const form = $('#work-form');
  if (!form) return;
  const serviceNames = settings.serviceNames || ['IPL', 'Peel', 'Facial', 'Wax', 'Lash', 'Product', 'Other'];
  const matchedService = serviceNames.find(s => transcript.includes(s.toLowerCase()));
  if (matchedService) form.serviceName.value = matchedService;
  const revenueMatch = transcript.match(/(\d+(?:\.\d{1,2})?)\s*(?:dollars?|revenue|service)/i)
    || transcript.match(/revenue\s+(?:of\s+)?(\d+(?:\.\d{1,2})?)/i);
  if (revenueMatch) form.revenue.value = revenueMatch[1];
  const tipMatch = transcript.match(/tip\s+(?:of\s+)?(\d+(?:\.\d{1,2})?)/i)
    || transcript.match(/(\d+(?:\.\d{1,2})?)\s*(?:dollar\s+)?tip/i);
  if (tipMatch) form.tipAmount.value = tipMatch[1];
  const clientMatch = transcript.match(/(?:client|customer)\s+(?:named?\s+)?([a-z]+)/i);
  if (clientMatch) form.clientName.value = clientMatch[1].charAt(0).toUpperCase() + clientMatch[1].slice(1);
}

function workCardsGroupedHtml(entries, settings) {
  if (!entries.length) return '<div class="empty-state">No work entries yet.</div>';
  const grouped = new Map();
  for (const e of entries) {
    const key = e.date ? e.date.slice(0, 7) : 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(e);
  }
  return [...grouped.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, monthEntries]) => {
      const label = month === 'other' ? 'Unknown date'
        : new Date(month + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return `<div class="work-month-group">
        <div class="work-month-label">${escapeHtml(label)}</div>
        <div class="work-cards-grid">${monthEntries.map(e => workEntryHtml(e, settings)).join('')}</div>
      </div>`;
    }).join('');
}

function workTableHtml(entries, settings) {
  if (!entries.length) return `<p class="empty-state" style="margin-top:1rem">No entries to display.</p>`;
  const rows = entries.map(entry => {
    const rate = Math.round(Number(entry.commissionRate || 0) * 1000) / 10;
    const dateLabel = escapeHtml(entry.date ? new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
    return `<tr data-id="${escapeAttribute(entry.id)}" class="wt-row">
      <td class="wt-date">${dateLabel}</td>
      <td class="wt-svc">${escapeHtml(entry.serviceName || '—')}</td>
      <td class="wt-client">${escapeHtml(entry.clientName || '—')}</td>
      <td class="wt-num">${escapeHtml(workMoney(entry.revenue))}</td>
      <td class="wt-num">${rate}%</td>
      <td class="wt-num">${escapeHtml(workMoney(entry.payout))}</td>
      <td class="wt-num wt-tip">${escapeHtml(entry.tipAmount > 0 ? workMoney(entry.tipAmount) : '—')}</td>
      <td class="wt-num wt-total"><b>${escapeHtml(workMoney(entry.totalEarnings))}</b></td>
      <td class="wt-actions">
        <button class="work-edit-btn wt-icon-btn wt-edit" data-id="${escapeAttribute(entry.id)}" aria-label="Edit entry" title="Edit"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z"/></svg></button>
        <button class="work-delete-btn wt-icon-btn wt-delete" data-id="${escapeAttribute(entry.id)}" aria-label="Delete entry" title="Delete"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h10M6 5V3h4v2M6 8v4M10 8v4M4 5l1 8h6l1-8"/></svg></button>
      </td>
    </tr>`;
  }).join('');
  return `<div class="work-table-wrap">
    <table class="work-table">
      <thead>
        <tr>
          <th>Date</th><th>Service</th><th>Client</th>
          <th class="wt-num">Revenue</th><th class="wt-num">Rate</th>
          <th class="wt-num">Payout</th><th class="wt-num">Tip</th>
          <th class="wt-num">Total</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function workEntryHtml(entry, settings) {
  const rate = Math.round(Number(entry.commissionRate || 0) * 1000) / 10;
  const sourceTag = entry.source === 'import' ? `<span class="badge work-import-badge">Imported</span>` : '';
  return `<article class="tips-shift work-entry" data-id="${escapeAttribute(entry.id)}">
    <div class="tips-shift-header">
      <span class="work-entry-left">
        <span class="tips-shift-date">${escapeHtml(formatDateLabel(entry.date))}</span>
        ${entry.needsReview ? '<span class="badge waiting">Review</span>' : ''}
        ${sourceTag}
      </span>
      <span class="tips-shift-total work-entry-total">${escapeHtml(workMoney(entry.totalEarnings))}</span>
    </div>
    <div class="tips-shift-breakdown work-entry-service-row">
      ${entry.serviceName ? `<span class="work-service-chip">${escapeHtml(entry.serviceName)}</span>` : ''}
      <span class="work-entry-client">${escapeHtml(entry.clientName || 'No client')}</span>
    </div>
    <div class="tips-shift-breakdown work-entry-numbers">
      <span>Revenue <b>${escapeHtml(workMoney(entry.revenue))}</b></span>
      <span class="tip-muted">·</span>
      <span>Payout <b>${escapeHtml(workMoney(entry.payout))}</b></span>
      ${entry.tipAmount ? `<span class="tip-muted">·</span><span>Tip <b>${escapeHtml(workMoney(entry.tipAmount))}</b>${entry.tipType ? ` <span class="tip-muted">${escapeHtml(entry.tipType)}</span>` : ''}</span>` : ''}
    </div>
    ${entry.notes ? `<div class="tips-shift-breakdown work-entry-notes">${escapeHtml(entry.notes)}</div>` : ''}
    <div class="tips-shift-actions">
      <button type="button" class="work-edit-btn" data-id="${escapeAttribute(entry.id)}">Edit</button>
      <button type="button" class="work-delete-btn" data-id="${escapeAttribute(entry.id)}">Delete</button>
    </div>
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

function ensureChatDeleteModal() {
  let m = document.getElementById('chat-delete-modal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'chat-delete-modal';
  m.className = 'work-modal-overlay';
  m.hidden = true;
  m.innerHTML = `<div class="work-modal-box chat-modal-box">
    <h3 id="chat-delete-modal-title"></h3>
    <p id="chat-delete-modal-msg"></p>
    <div class="chat-modal-actions">
      <button type="button" class="chat-modal-cancel">Cancel</button>
      <button type="button" class="chat-modal-confirm">Delete</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
  m.querySelector('.chat-modal-cancel').onclick = () => { m.hidden = true; };
  return m;
}

function showChatDeleteModal(title, msg, onConfirm) {
  const m = ensureChatDeleteModal();
  m.querySelector('#chat-delete-modal-title').textContent = title;
  m.querySelector('#chat-delete-modal-msg').textContent = msg;
  m.querySelector('.chat-modal-confirm').onclick = () => { m.hidden = true; onConfirm(); };
  m.hidden = false;
}

function bindChatThreadItems(scope) {
  scope.querySelectorAll('.chat-thread-item').forEach(item => {
    item.querySelector('.chat-thread-btn').onclick = () => openChatThread(item.dataset.id, item.dataset.title);
    const pinBtn = item.querySelector('.chat-pin-btn');
    if (pinBtn) pinBtn.onclick = async e => {
      e.stopPropagation();
      const pinned = pinBtn.dataset.pinned === 'true';
      await api(`/api/chat/threads/${item.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !pinned }) });
      renderChat();
    };
    const editTitleBtn = item.querySelector('.chat-edit-thread-btn');
    if (editTitleBtn) editTitleBtn.onclick = e => {
      e.stopPropagation();
      const titleEl = item.querySelector('.chat-thread-title');
      const current = item.dataset.title;
      titleEl.innerHTML = `<input class="chat-title-input" value="${escapeAttribute(current)}" maxlength="120" />`;
      const inp = titleEl.querySelector('.chat-title-input');
      inp.focus();
      inp.select();
      const save = async () => {
        const val = inp.value.trim();
        if (val && val !== current) await api(`/api/chat/threads/${item.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ title: val }) });
        renderChat();
      };
      inp.addEventListener('keydown', ke => { if (ke.key === 'Enter') { ke.preventDefault(); save(); } if (ke.key === 'Escape') renderChat(); });
      inp.addEventListener('blur', save);
    };
    const delBtn = item.querySelector('.chat-del-thread-btn');
    if (delBtn) delBtn.onclick = e => {
      e.stopPropagation();
      showChatDeleteModal('Delete Thread', `Delete "${item.dataset.title}" and all its messages?`, async () => {
        await api(`/api/chat/threads/${item.dataset.id}`, { method: 'DELETE' });
        renderChat();
      });
    };
  });
}

async function renderChat() {
  setActiveNav();
  setBodyView('chat');
  const { threads } = await api('/api/chat/threads');
  content.innerHTML = `
    <div class="chat-layout">
      <section class="chat-thread-list" id="chat-thread-list">
        <div class="chat-thread-header"><span>Threads</span></div>
        <form id="chat-new-thread-form" class="chat-new-thread-form">
          <input type="text" id="chat-thread-title" placeholder="New thread…" maxlength="120" autocomplete="off">
          <button type="submit">Create</button>
        </form>
        <div id="chat-threads-inner">
          ${threads.length ? threads.map(chatThreadItemHtml).join('') : '<p class="chat-empty">No threads yet.</p>'}
        </div>
      </section>
      <section class="chat-message-pane" id="chat-message-pane">
        <div class="chat-message-pane-empty">Select a thread to read messages.</div>
      </section>
    </div>`;

  $('#chat-new-thread-form').onsubmit = async e => {
    e.preventDefault();
    const title = $('#chat-thread-title').value.trim();
    if (!title) return;
    $('#chat-thread-title').value = '';
    const { thread } = await api('/api/chat/threads', { method: 'POST', body: JSON.stringify({ title }) });
    await renderChat();
    openChatThread(thread.id, thread.title);
  };

  if (window.innerWidth <= 720 && threads.length) {
    await openChatThread(threads[0].id, threads[0].title);
  }

  bindChatThreadItems(content);
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
      <textarea id="chat-body" placeholder="Write a message…" rows="1" maxlength="2000"></textarea>
      <button type="submit" class="chat-send-btn" aria-label="Send message"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
    </form>`;

  const msgEl = $('#chat-messages');
  if (msgEl) msgEl.scrollTop = msgEl.scrollHeight;

  pane.querySelector('.chat-back-btn')?.addEventListener('click', async () => {
    const layout = pane.closest('.chat-layout');
    if (layout) delete layout.dataset.mobileView;
    content.querySelectorAll('.chat-thread-item').forEach(el => el.classList.remove('active'));
    const { threads: updated } = await api('/api/chat/threads').catch(() => ({ threads: [] }));
    const inner = document.getElementById('chat-threads-inner');
    if (inner) {
      inner.innerHTML = updated.length ? updated.map(chatThreadItemHtml).join('') : '<p class="chat-empty">No threads yet.</p>';
      bindChatThreadItems(content);
    }
  });

  const chatTextarea = $('#chat-body');
  const chatSendBtn = document.querySelector('#chat-compose .chat-send-btn');
  const syncSendBtn = () => chatSendBtn?.classList.toggle('active', !!(chatTextarea?.value.trim()));
  chatTextarea?.addEventListener('input', () => {
    syncSendBtn();
    chatTextarea.style.height = 'auto';
    chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 120) + 'px';
  });

  $('#chat-compose').onsubmit = async e => {
    e.preventDefault();
    const body = chatTextarea.value.trim();
    if (!body) return;
    await api(`/api/chat/threads/${threadId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    openChatThread(threadId, threadTitle);
  };
  chatTextarea?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-compose').requestSubmit(); }
  });

  pane.querySelectorAll('.chat-msg-delete').forEach(btn => {
    btn.onclick = () => {
      showChatDeleteModal('Delete Message', 'Delete this message? This cannot be undone.', async () => {
        await api(`/api/chat/threads/${threadId}/messages/${btn.dataset.id}`, { method: 'DELETE' });
        openChatThread(threadId, threadTitle);
      });
    };
  });

  pane.querySelectorAll('.chat-msg-edit').forEach(btn => {
    btn.onclick = () => {
      const article = btn.closest('.chat-message');
      if (article.classList.contains('editing')) return;
      article.classList.add('editing');
      const bodyEl = article.querySelector('.chat-msg-body');
      const currentText = bodyEl.textContent;
      bodyEl.innerHTML = `<textarea class="chat-edit-textarea" maxlength="2000">${escapeHtml(currentText)}</textarea><div class="chat-edit-actions"><button type="button" class="chat-edit-save">Save</button><button type="button" class="chat-edit-cancel">Cancel</button></div>`;
      const ta = bodyEl.querySelector('.chat-edit-textarea');
      ta.focus();
      ta.style.height = Math.min(ta.scrollHeight + 4, 200) + 'px';
      ta.setSelectionRange(ta.value.length, ta.value.length);
      bodyEl.querySelector('.chat-edit-save').onclick = async () => {
        const newBody = ta.value.trim();
        if (!newBody) return;
        await api(`/api/chat/threads/${threadId}/messages/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ body: newBody }) });
        openChatThread(threadId, threadTitle);
      };
      bodyEl.querySelector('.chat-edit-cancel').onclick = () => openChatThread(threadId, threadTitle);
      ta.addEventListener('keydown', ke => { if (ke.key === 'Escape') openChatThread(threadId, threadTitle); });
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
      <button type="button" class="chat-edit-thread-btn" title="Edit title">✎</button>
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
    <div class="chat-msg-meta"><span class="chat-avatar" style="background:${color}">${escapeHtml(name[0])}</span><strong>${escapeHtml(name)}</strong><time>${escapeHtml(time)}</time><button type="button" class="chat-msg-edit" data-id="${escapeAttribute(msg.id)}" title="Edit">✎</button><button type="button" class="chat-msg-delete" data-id="${escapeAttribute(msg.id)}" data-thread="${escapeAttribute(threadId)}" title="Delete">✕</button></div>
    <p class="chat-msg-body">${escapeHtml(msg.body)}</p>
  </article>`;
}

async function renderGrocery() {
  setActiveNav();
  setBodyView('grocery');
  const [{ items }, { items: recentItems }] = await Promise.all([
    api('/api/grocery?checked=false'),
    api('/api/grocery/recent?limit=8'),
  ]);
  const grouped = items.reduce((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});
  const activeItems = items.filter(i => !i.checked);
  const listText = activeItems.map(i => `${i.quantity ? i.quantity + ' ' : ''}${i.title}`).join('\n');
  content.innerHTML = viewHeader('Grocery', 'Fast shared capture for Walmart and household shopping.', false, activeItems.length) + `
    <div id="grocery-add-sheet" class="grocery-add-sheet">
      <div class="grocery-sheet-row">
        <button id="grocery-scan-btn" class="grocery-sheet-icon-btn" type="button" title="Scan photo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
        <button id="grocery-voice-btn" class="grocery-sheet-icon-btn" type="button" title="Voice input"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
        <input id="grocery-title" placeholder="Add item…" autocomplete="off">
        <button id="grocery-add" class="grocery-sheet-submit" type="button" aria-label="Add item">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <input type="file" id="grocery-scan-input" accept="image/*" capture="environment" style="display:none">
      <div id="grocery-suggestions" class="grocery-suggestions" hidden></div>
    </div>
    <section class="grocery-panel">
      ${recentItems.length ? recentGroceryHtml(recentItems) : ''}
      <div class="grocery-actions">
        <button id="copy-grocery" class="grocery-action-btn" title="Copy list to clipboard" aria-label="Copy list"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>
        <button id="clear-grocery" class="grocery-action-btn" title="Clear all checked items" aria-label="Clear checked"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Clear</button>
      </div>
      <textarea id="grocery-copy" readonly>${escapeHtml(listText)}</textarea>
    </section>
    ${items.length ? Object.entries(grouped).map(([category, group]) => groceryGroupHtml(category, group)).join('') : '<div class="empty-state">Grocery list is empty. Add milk, bananas, or walmart 2 paper towels.</div>'}
    <div id="grocery-kebab-menu" class="grocery-kebab-menu" hidden>
      <a id="grocery-kebab-search" class="grocery-kebab-item" target="_blank" rel="noopener">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Search Walmart
      </a>
    </div>
    <div class="grocery-fab-wrap">
      <p class="grocery-fab-hint">Tap to type · Hold for voice</p>
      <button id="grocery-fab" class="grocery-fab-btn" aria-label="Add grocery item" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add new item
      </button>
    </div>`;
  $('#grocery-add').onclick = addGroceryFromInput;
  $('#grocery-title').addEventListener('keydown', e => { if (e.key === 'Enter') addGroceryFromInput(); if (e.key === 'Escape') closeGrocerySheet(); });
  setupGroceryFab();
  setupGroceryScanInput();
  setupGroceryAutocomplete();
  $('#clear-grocery').onclick = async () => { await api('/api/grocery/clear-checked', { method: 'POST' }); renderGrocery(); };
  $('#copy-grocery').onclick = async () => {
    const text = $('#grocery-copy').value;
    if (navigator.clipboard) await navigator.clipboard.writeText(text);
    $('#copy-grocery').textContent = 'Copied!';
    setTimeout(() => renderGrocery(), 1200);
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
  const kebabMenu = $('#grocery-kebab-menu');
  document.querySelectorAll('.grocery-item-menu-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const searchUrl = `https://www.walmart.com/search?${new URLSearchParams({ q: btn.dataset.query, facet: 'fulfillment_method_in_store:In-store' })}`;
      $('#grocery-kebab-search').href = searchUrl;
      const rect = btn.getBoundingClientRect();
      kebabMenu.style.top = `${rect.bottom + window.scrollY + 4}px`;
      kebabMenu.style.right = `${window.innerWidth - rect.right}px`;
      kebabMenu.hidden = false;
    };
  });
  document.addEventListener('click', () => { if (kebabMenu) kebabMenu.hidden = true; });
  $('#clear-readd-all')?.addEventListener('click', async () => {
    await Promise.all(recentItems.map(item => api(`/api/grocery/${item.id}`, { method: 'DELETE' })));
    renderGrocery();
  });
  $('#grocery-voice-btn')?.addEventListener('click', () => startGroceryVoice($('#grocery-voice-btn')));
  document.querySelectorAll('.qty-plus').forEach(btn => btn.onclick = async e => {
    e.stopPropagation();
    const id = btn.dataset.id;
    const item = items.find(i => i.id === id);
    if (!item) return;
    const n = parseQtyNum(item.quantity);
    const note = parseQtyNote(item.quantity);
    const newQty = `${n + 1}${note ? ' ' + note : ''}`;
    btn.closest('.qty-stepper').querySelector('.qty-num').textContent = n + 1;
    item.quantity = newQty;
    await api(`/api/grocery/${id}`, { method: 'PATCH', body: JSON.stringify({ quantity: newQty }) });
  });
  document.querySelectorAll('.qty-minus').forEach(btn => btn.onclick = async e => {
    e.stopPropagation();
    const id = btn.dataset.id;
    const item = items.find(i => i.id === id);
    if (!item) return;
    const n = parseQtyNum(item.quantity);
    if (n <= 1) return;
    const note = parseQtyNote(item.quantity);
    const newQty = n - 1 === 1 && !note ? '' : `${n - 1}${note ? ' ' + note : ''}`;
    btn.closest('.qty-stepper').querySelector('.qty-num').textContent = n - 1;
    item.quantity = newQty;
    await api(`/api/grocery/${id}`, { method: 'PATCH', body: JSON.stringify({ quantity: newQty }) });
  });
}

function recentGroceryHtml(items) {
  const pills = items.map(item => `<span class="recent-grocery-pill" data-id="${escapeAttribute(item.id)}"><button type="button" class="recent-grocery-chip" data-id="${escapeAttribute(item.id)}"><span class="readd-plus">+</span> ${escapeHtml(item.quantity ? item.quantity + ' ' : '')}${escapeHtml(item.title)}</button><button type="button" class="recent-grocery-delete" data-id="${escapeAttribute(item.id)}" aria-label="Remove from quick re-add">×</button></span>`).join('');
  return `<div class="recent-grocery ${quickReaddDeleteMode ? 'quick-readd-delete-mode' : ''}">
    <div class="recent-grocery-header">
      <div class="recent-grocery-title-group">
        <span class="recent-grocery-title"><svg width="13" height="13" viewBox="0 0 24 24" fill="#ffd60a" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Quick re-add</span>
        <span class="recent-grocery-subtitle">Tap a frequently added item to re-add it to your list.</span>
      </div>
      <button type="button" class="recent-grocery-clear-all" id="clear-readd-all">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        Clear all
      </button>
    </div>
    <div class="recent-grocery-pills">${pills}</div>
  </div>`;
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
      if (e.target.closest('.recent-grocery-delete')) return;
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

const GROCERY_CAT_EMOJI = { dairy: '🥛', produce: '🥦', meat: '🥩', frozen: '❄️', beverages: '🥤', snacks: '🍿', household: '🏠', 'personal care': '🧴', pets: '🐾', pantry: '🥫', bakery: '🍞', uncategorized: '🛒' };

function parseQtyNum(qty) {
  const m = String(qty || '').match(/^(\d+)/);
  return m ? parseInt(m[1]) : 1;
}
function parseQtyNote(qty) {
  return String(qty || '').replace(/^\d+\s*/, '').trim();
}

function groceryGroupHtml(category, items) {
  const emoji = GROCERY_CAT_EMOJI[category.toLowerCase()] || '🛒';
  return `<section class="grocery-group">
    <h3><span class="grocery-cat-emoji">${emoji}</span>${escapeHtml(category)}</h3>
    ${items.map(item => {
      const qtyNum = parseQtyNum(item.quantity);
      const qtyNote = parseQtyNote(item.quantity);
      return `<article class="grocery-item ${item.checked ? 'checked' : ''}" data-id="${escapeAttribute(item.id)}">
        <label class="grocery-item-main">
          <input class="grocery-check" type="checkbox" ${item.checked ? 'checked' : ''}>
          <div class="grocery-item-body">
            <span class="grocery-item-name">${escapeHtml(item.title)}</span>
            ${qtyNote ? `<span class="grocery-item-qty-note">${escapeHtml(qtyNote)}</span>` : ''}
          </div>
        </label>
        <div class="grocery-item-right">
          <div class="qty-stepper">
            <button type="button" class="qty-btn qty-minus" data-id="${escapeAttribute(item.id)}">−</button>
            <span class="qty-num">${qtyNum}</span>
            <button type="button" class="qty-btn qty-plus" data-id="${escapeAttribute(item.id)}">+</button>
          </div>
          <button type="button" class="grocery-item-menu-btn" data-id="${escapeAttribute(item.id)}" data-query="${escapeHtml(item.title)}" aria-label="More options"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg></button>
        </div>
      </article>`;
    }).join('')}
  </section>`;
}

let _grocerySuggestion = null;

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function setupGroceryAutocomplete() {
  const input = $('#grocery-title');
  const dropdown = $('#grocery-suggestions');
  if (!input || !dropdown) return;

  const search = debounce(async q => {
    if (q.length < 2) { dropdown.hidden = true; return; }
    try {
      const { suggestions } = await api(`/api/grocery/suggest?q=${encodeURIComponent(q)}`);
      if (!suggestions.length) { dropdown.hidden = true; return; }
      dropdown.innerHTML = suggestions.map((s, i) =>
        `<div class="grocery-suggestion" data-idx="${i}" role="option">
          <span class="gs-title">${escapeHtml(s.title)}</span>
          <span class="gs-cat">${escapeHtml(s.category)}</span>
        </div>`
      ).join('');
      dropdown._suggestions = suggestions;
      dropdown.hidden = false;
      dropdown.querySelectorAll('.grocery-suggestion').forEach(el => {
        el.onmousedown = e => {
          e.preventDefault();
          const s = suggestions[Number(el.dataset.idx)];
          input.value = s.title;
          _grocerySuggestion = s;
          dropdown.hidden = true;
        };
      });
    } catch { dropdown.hidden = true; }
  }, 220);

  input.addEventListener('input', e => {
    _grocerySuggestion = null;
    search(e.target.value.trim());
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.hidden = true; _grocerySuggestion = null; }
    if (e.key === 'ArrowDown' && !dropdown.hidden) {
      const first = dropdown.querySelector('.grocery-suggestion');
      first?.focus();
    }
  });
  dropdown.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('.grocery-suggestion')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') items[idx + 1]?.focus();
    if (e.key === 'ArrowUp') { if (idx === 0) input.focus(); else items[idx - 1]?.focus(); }
    if (e.key === 'Enter' && idx >= 0) items[idx].onmousedown({ preventDefault: () => {} });
    if (e.key === 'Escape') { dropdown.hidden = true; input.focus(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { dropdown.hidden = true; }, 150));
}

async function addGroceryFromInput() {
  const input = $('#grocery-title');
  const text = input.value.trim();
  if (!text) return;
  const suggestion = _grocerySuggestion;
  _grocerySuggestion = null;
  const suggestEl = $('#grocery-suggestions');
  if (suggestEl) suggestEl.hidden = true;
  if (suggestion && suggestion.title === text) {
    await api('/api/grocery', { method: 'POST', body: JSON.stringify({
      title: suggestion.title,
      category: suggestion.category,
      store: suggestion.store || 'walmart',
      source: 'app',
    })});
  } else {
    await api('/api/quick-add', { method: 'POST', body: JSON.stringify({ text: text.match(/^(walmart|grocery)\s+/i) ? text : `grocery ${text}`, source: 'app' }) });
  }
  input.value = '';
  closeGrocerySheet();
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
  if (pill) pill.textContent = activeProfile?.name || '';
  const mobileProfileBtn = document.getElementById('mobile-profile-btn');
  if (mobileProfileBtn && activeProfile) {
    mobileProfileBtn.innerHTML = profileAvatarHtml(activeProfile, 30);
    mobileProfileBtn.onclick = () => navigateTo('/profile');
  }
}

async function renderProfileSettings() {
  setActiveNav();
  setBodyView('profile');
  const { profiles } = await api('/api/profiles').catch(() => ({ profiles: [] }));
  const me = activeProfile;
  content.innerHTML = `
    <div class="pspage">
      <div class="pspage-hero">
        <div class="pspage-avatar-ring" id="pspage-avatar-ring" style="background:${escapeAttribute(me?.color || '#ffd60a')}">${profileAvatarHtml(me, 72)}</div>
        <h2 class="pspage-name">${escapeHtml(me?.name || '')}</h2>
        <label class="pspage-change-photo" role="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Change photo
          <input type="file" accept="image/*" id="pspage-file" style="display:none">
        </label>
        ${me?.avatar ? `<button class="pspage-remove-photo" type="button">Remove photo</button>` : ''}
      </div>
      <section class="pspage-section">
        <h3>Switch Profile</h3>
        <div class="pspage-profile-list">
          ${profiles.map(p => `
            <button class="pspage-profile-row${p.id === me?.id ? ' is-active' : ''}" data-id="${escapeAttribute(p.id)}" type="button">
              <div class="pspage-profile-av" style="background:${escapeAttribute(p.color || '#ffd60a')}">${profileAvatarHtml(p, 36)}</div>
              <span class="pspage-profile-name">${escapeHtml(p.name)}</span>
              ${p.id === me?.id ? '<span class="pspage-active-chip">Active</span>' : '<span class="pspage-switch-label">Switch →</span>'}
            </button>`).join('')}
        </div>
      </section>
    </div>`;

  $('#pspage-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        await api(`/api/profiles/${encodeURIComponent(me.id)}/avatar`, { method: 'PATCH', body: JSON.stringify({ avatar: ev.target.result }) });
        await loadProfileChrome();
        renderProfileSettings();
      } catch (err) { alert('Upload failed. ' + (err?.message || '')); }
    };
    reader.readAsDataURL(file);
  };

  content.querySelector('.pspage-remove-photo')?.addEventListener('click', async () => {
    await api(`/api/profiles/${encodeURIComponent(me.id)}/avatar`, { method: 'PATCH', body: JSON.stringify({ avatar: null }) });
    await loadProfileChrome();
    renderProfileSettings();
  });

  content.querySelectorAll('.pspage-profile-row:not(.is-active)').forEach(btn => {
    btn.onclick = async () => {
      await api('/api/profile/select', { method: 'POST', body: JSON.stringify({ profileId: btn.dataset.id }) });
      await loadProfileChrome();
      navigateTo('/home');
    };
  });
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
  if (nav && modules?.length) {
    nav.innerHTML = modules.flatMap(moduleLinks).map(module => `<a href="${escapeAttribute(module.href)}" data-nav="${escapeAttribute(module.href)}"><span>${escapeHtml(module.icon || '•')}</span> ${escapeHtml(module.label)}</a>`).join('');
  }
  const drawerNav = document.getElementById('mobile-nav-drawer-links');
  if (drawerNav && modules?.length) {
    drawerNav.innerHTML = modules.flatMap(moduleLinks).map(m => `<a href="${escapeAttribute(m.href)}" data-nav="${escapeAttribute(m.href)}">${escapeHtml(m.icon || '•')} ${escapeHtml(m.label)}</a>`).join('');
  }
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

function openMobileDrawer() {
  document.getElementById('mobile-nav-drawer')?.classList.add('open');
  document.getElementById('mobile-nav-backdrop')?.classList.add('open');
}
function closeMobileDrawer() {
  document.getElementById('mobile-nav-drawer')?.classList.remove('open');
  document.getElementById('mobile-nav-backdrop')?.classList.remove('open');
}
function bindMobileDrawer() {
  document.querySelector('.mobile-greeting')?.addEventListener('click', openMobileDrawer);
  document.getElementById('mobile-nav-close')?.addEventListener('click', closeMobileDrawer);
  document.getElementById('mobile-nav-backdrop')?.addEventListener('click', closeMobileDrawer);
  document.getElementById('mobile-nav-drawer-links')?.addEventListener('click', e => {
    if (e.target.closest('a[href]')) closeMobileDrawer();
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttribute(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }
bindAppNavigation();
bindMobileDrawer();
render().catch(err => content.innerHTML = `<pre>${escapeHtml(err.stack || err.message)}</pre>`);
