const $ = sel => document.querySelector(sel);
const content = $('#content');
let activeFilter = 'all';
let draggedId = null;

function todayString() { return new Date().toISOString().slice(0, 10); }
function routeView() {
  const path = location.pathname;
  if (path === '/today') return { title: 'Today', subtitle: 'Due today, overdue, or intentionally undated.', query: 'view=today', filters: true };
  if (path === '/future') return { title: 'Future', subtitle: 'Scheduled tasks that are not ready for today yet.', future: true, filters: true };
  if (path === '/grocery') return { title: 'Grocery', grocery: true };
  if (path === '/done') return { title: 'Done', subtitle: 'Completed tasks.', query: 'view=done' };
  if (path === '/projects') return { title: 'Projects', projects: true };
  if (path === '/eink') return { title: 'E-ink', eink: true };
  return { title: 'Inbox', subtitle: 'Unsorted tasks waiting to be clarified or scheduled.', query: 'view=inbox', filters: true };
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

async function render() {
  setActiveNav();
  await refreshProjectOptions();
  const view = routeView();
  if (view.eink) return renderEink();
  if (view.projects) return renderProjects();
  if (view.grocery) return renderGrocery();

  const { tasks: allOpenTasks } = await api('/api/tasks?status=open');
  let tasks;
  if (view.future) {
    tasks = allOpenTasks.filter(t => t.dueDate && t.dueDate > todayString());
  } else {
    ({ tasks } = await api(`/api/tasks?${view.query}`));
  }
  tasks = applyFilter(tasks);
  content.innerHTML = summaryCards(allOpenTasks) + viewHeader(view.title, view.subtitle, view.filters) + (tasks.length ? workSectionsHtml(tasks) : emptyState(view.title));
  bindTaskControls();
}

function applyFilter(tasks) {
  const today = todayString();
  if (activeFilter === 'overdue') return tasks.filter(t => t.status === 'open' && t.dueDate && t.dueDate < today);
  if (activeFilter === 'no-date') return tasks.filter(t => t.status === 'open' && !t.dueDate);
  if (activeFilter === 'waiting') return tasks.filter(t => t.waiting);
  if (activeFilter === 'eink') return tasks.filter(t => t.showOnEink);
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

function viewHeader(title, subtitle = '', showFilters = false) {
  return `<div class="view-header"><div><p class="eyebrow">Personal tasks</p><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${showFilters ? filterBar() : ''}</div>`;
}

function filterBar() {
  const filters = [['all', 'All'], ['overdue', 'Overdue'], ['no-date', 'No date'], ['waiting', 'Waiting'], ['eink', 'E-ink']];
  return `<div class="filters">${filters.map(([id, label]) => `<button class="filter ${activeFilter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div>`;
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
        <button type="button" class="section-add" onclick="document.querySelector('#new-project').value='${escapeAttribute(project)}';document.querySelector('#new-title').focus()">+</button>
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
  const due = t.dueDate ? `<span class="badge due">${escapeHtml(t.dueDate)}</span>` : '<span class="badge muted">No date</span>';
  const recur = t.recurrence && t.recurrence !== 'none' ? `<span class="badge recur">${escapeHtml(t.recurrence)}</span>` : '';
  const status = t.status === 'done' ? ' done' : '';
  return `<article class="task${status}" draggable="true" data-id="${t.id}">
    <button class="complete" title="Complete" aria-label="Complete task">Complete</button>
    <div class="task-main">
      <strong class="task-title" contenteditable="true" data-field="title">${escapeHtml(t.title)}</strong>
      <div class="meta"><span class="badge project">${escapeHtml(t.project)}</span>${due}${recur}${t.status === 'done' ? '<span class="badge done">done</span>' : ''}${t.showOnEink ? '<span class="badge">e-ink</span>' : ''}${t.waiting ? '<span class="badge waiting">waiting</span>' : ''}</div>
      <details class="task-editors">
        <summary>Edit details</summary>
        <div class="editor-grid">
          <label>Due <input class="due-input" type="date" value="${escapeHtml(t.dueDate || '')}"></label>
          <label>Project <input class="project-input" value="${escapeHtml(t.project)}" list="project-options"></label>
          <label>Repeat <select class="recurrence-input">${['none','daily','weekly','monthly'].map(r => `<option value="${r}" ${t.recurrence === r ? 'selected' : ''}>${r === 'none' ? 'none' : r}</option>`).join('')}</select></label>
        </div>
      </details>
    </div>
    <div class="task-due-cell">${due}</div>
    <div class="task-actions">
      <button class="waiting-toggle ${t.waiting ? 'active' : ''}">${t.waiting ? 'Waiting' : 'Wait'}</button>
      <button class="eink-toggle">${t.showOnEink ? 'Hide e-ink' : 'E-ink'}</button>
      <span class="drag-handle" title="Drag to reorder">☰</span>
    </div>
  </article>`;
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
  document.querySelectorAll('[contenteditable]').forEach(el => el.onblur = async e => {
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
      const list = [...document.querySelectorAll('.task')].map(el => el.dataset.id);
      const from = list.indexOf(draggedId);
      const to = list.indexOf(task.dataset.id);
      list.splice(to, 0, list.splice(from, 1)[0]);
      await api('/api/tasks/reorder', { method: 'POST', body: JSON.stringify({ ids: list }) });
      render();
    });
  });
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
  const { items } = await api('/api/grocery');
  const grouped = items.reduce((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});
  const listText = items.filter(i => !i.checked).map(i => `${i.quantity ? i.quantity + ' ' : ''}${i.title}`).join('\n');
  content.innerHTML = viewHeader('Grocery', 'Fast shared capture for Walmart and household shopping.') + `
    <section class="grocery-panel">
      <div class="grocery-add">
        <input id="grocery-title" placeholder="Add grocery item… e.g. walmart 2 paper towels" autofocus>
        <button id="grocery-add">Add item</button>
      </div>
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
  document.querySelectorAll('.grocery-check').forEach(cb => cb.onchange = async e => {
    await api(`/api/grocery/${e.target.closest('.grocery-item').dataset.id}`, { method: 'PATCH', body: JSON.stringify({ checked: e.target.checked }) });
    renderGrocery();
  });
  document.querySelectorAll('.walmart-link').forEach(a => a.href = `https://www.walmart.com/search?q=${encodeURIComponent(a.dataset.query)}`);
}

function groceryGroupHtml(category, items) {
  return `<section class="grocery-group"><h3>${escapeHtml(category)}</h3>${items.map(item => `<article class="grocery-item ${item.checked ? 'checked' : ''}" data-id="${item.id}">
    <label><input class="grocery-check" type="checkbox" ${item.checked ? 'checked' : ''}> <span>${escapeHtml(item.quantity ? item.quantity + ' ' : '')}${escapeHtml(item.title)}</span></label>
    <span class="badge project">${escapeHtml(item.store)}</span>
    <a class="walmart-link" data-query="${escapeHtml(item.title)}" target="_blank" rel="noopener">Search Walmart</a>
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

async function renderEink() {
  setActiveNav();
  const data = await api('/api/eink/today');
  content.innerHTML = viewHeader('E-ink', 'Preview of the Today list formatted for the e-paper display.') + `<section class="eink-preview"><h2>${escapeHtml(data.title).toUpperCase()}</h2><ul>${data.tasks.map(t => `<li>□ ${escapeHtml(t)}</li>`).join('')}</ul>${data.waiting.length ? `<h2>WAITING</h2><ul>${data.waiting.map(t => `<li>• ${escapeHtml(t)}</li>`).join('')}</ul>` : ''}</section><p><a href="/api/eink/today.svg">SVG endpoint</a></p>`;
}

async function refreshProjectOptions() {
  const datalist = $('#project-options');
  if (!datalist) return;
  const { projects } = await api('/api/projects');
  datalist.innerHTML = projects.map(p => `<option value="${escapeHtml(p.project)}"></option>`).join('');
}

function setActiveNav() {
  const path = location.pathname === '/' ? '/inbox' : location.pathname;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === path));
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
['#new-title', '#new-project', '#new-due', '#new-recurrence'].forEach(sel => $(sel).addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); }));
document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, [contenteditable="true"]')) return;
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); $('#new-title').focus(); }
  if (e.key === '1') location.href = '/today';
  if (e.key === '2') location.href = '/future';
  if (e.key === '3') location.href = '/inbox';
  if (e.key === '4') location.href = '/grocery';
});

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttribute(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }
render().catch(err => content.innerHTML = `<pre>${escapeHtml(err.stack || err.message)}</pre>`);
