const API = '/tasks';

const listEl = document.getElementById('task-list');
const emptyEl = document.getElementById('empty-state');

async function loadTasks() {
  const res = await fetch(API);
  const tasks = await res.json();
  render(tasks);
}

function render(tasks) {
  // Clear the current list
  listEl.innerHTML = '';

  // Show/hide the empty state
  emptyEl.hidden = tasks.length > 0;

  // Build one <li> per task
  for (const task of tasks) {
    const li = document.createElement('li');
    if (task.completed) li.classList.add('completed');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.addEventListener('change', () => toggleTask(task));

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;

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
      </svg>
    `;
    delBtn.addEventListener('click', () => deleteTask(task));

    li.append(checkbox, title, delBtn);
    listEl.appendChild(li);
  }
}

loadTasks();

// --- Handle form submit ---
const formEl = document.getElementById('task-form');
const inputEl = document.getElementById('task-input');

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = inputEl.value.trim();
  if (!title) return;

  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });

  inputEl.value = '';
  inputEl.focus();

  await loadTasks();
});

// --- Toggle a task's completed state ---
async function toggleTask(task) {
  await fetch(`${API}/${task.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: !task.completed }),
  });

  await loadTasks();
}

// --- Delete a task ---
async function deleteTask(task) {
  const ok = confirm(`Delete "${task.title}"?`);
  if (!ok) return;

  await fetch(`${API}/${task.id}`, { method: 'DELETE' });

  await loadTasks();
}