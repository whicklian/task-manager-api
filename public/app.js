const API = '/tasks';

// ---------- DOM ----------
const listEl = document.getElementById('task-list');
const emptyEl = document.getElementById('empty-state');
const searchEl = document.getElementById('search-input');
const filterStatusEl = document.getElementById('filter-status');

// ---------- State ----------
// Keep the last full list in memory so the status filter can work client-side
let allTasks = [];

// ---------- Fetch helpers ----------
async function loadTasks() {
  const search = searchEl.value.trim();
  const url = search
    ? `${API}?title=${encodeURIComponent(search)}`
    : API;

  const res = await fetch(url);
  allTasks = await res.json();
  render();
}

// ---------- Format helpers ----------
const STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatTimeRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d) => d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return `${fmt(s)} → ${fmt(e)}`;
}

// ---------- Render ----------
function render() {
  // Apply the status filter client-side
  const filter = filterStatusEl.value;
  const tasks = filter
    ? allTasks.filter(t => t.status === filter)
    : allTasks;

  listEl.innerHTML = '';
  emptyEl.hidden = tasks.length > 0;

  for (const task of tasks) {
    const li = document.createElement('li');
    li.dataset.id = task.id;
    if (task.status === 'completed' || task.status === 'cancelled') {
      li.classList.add(task.status);
    }

    // ---- Select checkbox ----
    const select = document.createElement('input');
    select.type = 'checkbox';
    select.className = 'select-check';
    select.title = 'Select for bulk action';
    select.addEventListener('change', onSelectChange);
    li.appendChild(select);

    // ---- Content ----
    const content = document.createElement('div');
    content.className = 'content';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = task.title;
    content.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'meta';

    const badge = document.createElement('span');
    badge.className = `badge ${task.status}`;
    badge.textContent = STATUS_LABELS[task.status] || task.status;
    meta.appendChild(badge);

    const range = document.createElement('span');
    range.className = 'time-range';
    range.textContent = formatTimeRange(task.start_time, task.end_time);
    meta.appendChild(range);

    content.appendChild(meta);
    li.appendChild(content);

    // ---- Per-row status dropdown ----
    const statusSelect = document.createElement('select');
    statusSelect.className = 'status-select';
    statusSelect.dataset.id = task.id;
    for (const [value, label] of Object.entries(STATUS_LABELS)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === task.status) opt.selected = true;
      statusSelect.appendChild(opt);
    }
    statusSelect.addEventListener('change', onRowStatusChange);
    li.appendChild(statusSelect);

    // ---- Delete button ----
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.title = 'Delete';
    delBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
           viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/>
        <path d="M14 11v6"/>
      </svg>`;
    delBtn.addEventListener('click', () => deleteTask(task.id));
    li.appendChild(delBtn);

    listEl.appendChild(li);
  }
}

// ---------- Placeholder handlers (filled in later sub-steps) ----------
function onSelectChange() {}
function onRowStatusChange() {}
async function deleteTask(id) {}

// ---------- Toolbar ----------
searchEl.addEventListener('input', () => {
  clearTimeout(searchEl._timer);
  searchEl._timer = setTimeout(loadTasks, 250);
});

filterStatusEl.addEventListener('change', render);

// ---------- Boot ----------
loadTasks();