const API = '/tasks';

const listEl = document.getElementById('task-list');
const emptyEl = document.getElementById('empty-state');
const errorEl = document.getElementById('error-state');
const searchEl = document.getElementById('search-input');
const filterStatusEl = document.getElementById('filter-status');
const formEl = document.getElementById('task-form');
const bulkBarEl = document.getElementById('bulk-bar');
const bulkCountEl = document.getElementById('bulk-count');
const bulkStatusEl = document.getElementById('bulk-status');
const bulkApplyEl = document.getElementById('bulk-apply');
const bulkClearEl = document.getElementById('bulk-clear');
const startInputEl = document.getElementById('start-input');
const endInputEl = document.getElementById('end-input');

let allTasks = [];
const selectedIds = new Set();

async function request(url, options) {
  const response = await fetch(url, options);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an invalid response');
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function showError(error) {
  errorEl.textContent = error.message || String(error);
  errorEl.hidden = false;
}

function clearError() {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

async function loadTasks() {
  const search = searchEl.value.trim();
  const url = search ? `${API}?title=${encodeURIComponent(search)}` : API;

  try {
    allTasks = await request(url);
    render();
    clearError();
  } catch (error) {
    showError(error);
  }
}

const STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatTimeRange(start, end) {
  const format = (value) => new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${format(start)} → ${format(end)}`;
}

function toLocalDateTimeValue(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function setDefaultTaskTimes() {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() + 5);
  const end = new Date(now.getTime() + 60 * 60_000);
  startInputEl.value = toLocalDateTimeValue(now);
  endInputEl.value = toLocalDateTimeValue(end);
  startInputEl.min = toLocalDateTimeValue(new Date(Date.now() + 60_000));
  endInputEl.min = startInputEl.value;
}

function updateSelectionUI() {
  bulkBarEl.hidden = selectedIds.size === 0;
  bulkCountEl.textContent = `${selectedIds.size} selected`;
  bulkApplyEl.disabled = selectedIds.size === 0 || !bulkStatusEl.value;
}

function render() {
  const filter = filterStatusEl.value;
  const tasks = filter
    ? allTasks.filter((task) => task.status === filter)
    : allTasks;

  listEl.innerHTML = '';
  emptyEl.hidden = tasks.length > 0;
  emptyEl.textContent = allTasks.length === 0
    ? 'No tasks yet. Add one above!'
    : 'No tasks match your filters.';

  for (const task of tasks) {
    const li = document.createElement('li');
    li.dataset.id = task.id;
    if (task.status === 'completed' || task.status === 'cancelled') {
      li.classList.add(task.status);
    }

    const select = document.createElement('input');
    select.type = 'checkbox';
    select.className = 'select-check';
    select.title = 'Select for bulk action';
    select.checked = selectedIds.has(task.id);
    if (select.checked) li.classList.add('selected');
    select.addEventListener('change', onSelectChange);
    li.appendChild(select);

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

    const statusSelect = document.createElement('select');
    statusSelect.className = 'status-select';
    statusSelect.dataset.id = task.id;
    for (const [value, label] of Object.entries(STATUS_LABELS)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === task.status;
      statusSelect.appendChild(option);
    }
    statusSelect.addEventListener('change', onRowStatusChange);
    li.appendChild(statusSelect);

    const editButton = document.createElement('button');
    editButton.className = 'edit-btn';
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.setAttribute('aria-expanded', 'false');
    li.appendChild(editButton);

    const editForm = document.createElement('form');
    editForm.className = 'task-editor';
    editForm.hidden = true;

    const editTitle = document.createElement('label');
    editTitle.textContent = 'Title';
    const editTitleInput = document.createElement('input');
    editTitleInput.type = 'text';
    editTitleInput.value = task.title;
    editTitleInput.required = true;
    editTitle.appendChild(editTitleInput);
    editForm.appendChild(editTitle);

    const editEnd = document.createElement('label');
    editEnd.textContent = 'End time (can only be moved later)';
    const editEndInput = document.createElement('input');
    editEndInput.type = 'datetime-local';
    editEndInput.value = toLocalDateTimeValue(task.end_time);
    editEndInput.min = editEndInput.value;
    editEndInput.required = true;
    const originalEndValue = editEndInput.value;
    editEnd.appendChild(editEndInput);
    editForm.appendChild(editEnd);

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.textContent = 'Save';
    editForm.appendChild(saveButton);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'cancel-edit-btn';
    cancelButton.textContent = 'Cancel';
    editForm.appendChild(cancelButton);

    editButton.addEventListener('click', () => {
      editForm.hidden = !editForm.hidden;
      editButton.setAttribute('aria-expanded', String(!editForm.hidden));
    });
    cancelButton.addEventListener('click', () => {
      editForm.hidden = true;
      editButton.setAttribute('aria-expanded', 'false');
    });
    editForm.addEventListener('submit', (event) => {
      event.preventDefault();
      updateTask(
        task.id,
        editTitleInput.value,
        editEndInput.value,
        originalEndValue,
      );
    });
    li.appendChild(editForm);

    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-btn';
    deleteButton.type = 'button';
    deleteButton.title = 'Delete';
    deleteButton.setAttribute('aria-label', `Delete ${task.title}`);
    deleteButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
           viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/>
        <path d="M14 11v6"/>
      </svg>`;
    deleteButton.addEventListener('click', () => deleteTask(task.id));
    li.appendChild(deleteButton);

    listEl.appendChild(li);
  }

  updateSelectionUI();
}

function onSelectChange(event) {
  const checkbox = event.currentTarget;
  const id = Number(checkbox.closest('li').dataset.id);
  if (checkbox.checked) {
    selectedIds.add(id);
    checkbox.closest('li').classList.add('selected');
  } else {
    selectedIds.delete(id);
    checkbox.closest('li').classList.remove('selected');
  }
  updateSelectionUI();
}

async function onRowStatusChange(event) {
  const select = event.currentTarget;
  try {
    await request(`${API}/${select.dataset.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: select.value }),
    });
    await loadTasks();
  } catch (error) {
    await loadTasks();
    showError(error);
  }
}

async function deleteTask(id) {
  try {
    await request(`${API}/${id}`, { method: 'DELETE' });
    selectedIds.delete(id);
    await loadTasks();
  } catch (error) {
    showError(error);
  }
}

async function updateTask(id, title, endTime, originalEndTime) {
  const update = { title };
  if (endTime !== originalEndTime) {
    update.end_time = new Date(endTime).toISOString();
  }

  try {
    await request(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    clearError();
    await loadTasks();
  } catch (error) {
    await loadTasks();
    showError(error);
  }
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const start = new Date(startInputEl.value);
  const end = new Date(endInputEl.value);
  const submitButton = formEl.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    startInputEl.min = toLocalDateTimeValue(new Date(Date.now() + 60_000));
    if (start < new Date()) {
      throw new Error('Start time cannot be before the current time');
    }
    if (end <= start) {
      throw new Error('End time must be after start time');
    }
    await request(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('title-input').value,
        status: document.getElementById('status-input').value,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      }),
    });
    formEl.reset();
    setDefaultTaskTimes();
    clearError();
    await loadTasks();
  } catch (error) {
    showError(error);
  } finally {
    submitButton.disabled = false;
  }
});

startInputEl.addEventListener('change', () => {
  endInputEl.min = startInputEl.value;
});

bulkApplyEl.addEventListener('click', async () => {
  const status = bulkStatusEl.value;
  if (!status || selectedIds.size === 0) return;

  try {
    await request(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        [...selectedIds].map((id) => ({ id, status })),
      ),
    });
    selectedIds.clear();
    bulkStatusEl.value = '';
    await loadTasks();
  } catch (error) {
    showError(error);
  }
});

bulkClearEl.addEventListener('click', () => {
  selectedIds.clear();
  bulkStatusEl.value = '';
  render();
});

bulkStatusEl.addEventListener('change', updateSelectionUI);

searchEl.addEventListener('input', () => {
  clearTimeout(searchEl._timer);
  searchEl._timer = setTimeout(loadTasks, 250);
});

filterStatusEl.addEventListener('change', render);

setDefaultTaskTimes();
loadTasks();
