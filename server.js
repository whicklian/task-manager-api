import http from 'node:http';
import dotenv from 'dotenv';
import { pool } from './db.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 8000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.ico':  'image/x-icon',
};

// --- Helper: send a JSON response ---
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// --- Helper: read request body as JSON ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// --- Handlers ---

async function listTasks(res, title) {
  if (title) {
    const { rows } = await pool.query(
      'SELECT * FROM tasks WHERE title ILIKE $1 ORDER BY id ASC',
      [`%${title}%`]
    );
    return sendJSON(res, 200, rows);
  }

  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id ASC');
  sendJSON(res, 200, rows);
}

async function getTask(res, id) {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
  if (rows.length === 0) return sendJSON(res, 404, { error: 'Task not found' });
  sendJSON(res, 200, rows[0]);
}

const VALID_STATUSES = [
  'not_started', 'in_progress', 'blocked',
  'on_hold', 'completed', 'cancelled'
];

async function createTask(req, res) {
  const { title, status, start_time, end_time } = await readBody(req);

  // Validate title
  if (!title || typeof title !== 'string' || !title.trim()) {
    return sendJSON(res, 400, { error: 'Title is required' });
  }

  // Validate status (default if missing)
  const finalStatus = status ?? 'not_started';
  if (!VALID_STATUSES.includes(finalStatus)) {
    return sendJSON(res, 400, {
      error: `status must be one of: ${VALID_STATUSES.join(', ')}`
    });
  }

  // Validate times
  if (!start_time || !end_time) {
    return sendJSON(res, 400, { error: 'start_time and end_time are required' });
  }

  const start = new Date(start_time);
  const end = new Date(end_time);

  if (isNaN(start) || isNaN(end)) {
    return sendJSON(res, 400, { error: 'start_time and end_time must be valid dates' });
  }

  if (end <= start) {
    return sendJSON(res, 400, { error: 'end_time must be after start_time' });
  }

  const { rows } = await pool.query(
    `INSERT INTO tasks (title, status, start_time, end_time)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [title.trim(), finalStatus, start, end]
  );

  sendJSON(res, 201, rows[0]);
}

async function updateTask(req, res, id) {
  const { title, status, start_time, end_time } = await readBody(req);

  // Validate status if provided
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return sendJSON(res, 400, {
      error: `status must be one of: ${VALID_STATUSES.join(', ')}`
    });
  }

  // Parse times if provided
  let start = null;
  let end = null;

  if (start_time !== undefined) {
    start = new Date(start_time);
    if (isNaN(start)) {
      return sendJSON(res, 400, { error: 'start_time must be a valid date' });
    }
  }

  if (end_time !== undefined) {
    end = new Date(end_time);
    if (isNaN(end)) {
      return sendJSON(res, 400, { error: 'end_time must be a valid date' });
    }
  }

  // If both times provided, validate the order
  if (start && end && end <= start) {
    return sendJSON(res, 400, { error: 'end_time must be after start_time' });
  }

  const { rows } = await pool.query(
    `UPDATE tasks
        SET title      = COALESCE($1, title),
            status     = COALESCE($2, status),
            start_time = COALESCE($3, start_time),
            end_time   = COALESCE($4, end_time)
      WHERE id = $5
      RETURNING *`,
    [title ?? null, status ?? null, start, end, id]
  );

  if (rows.length === 0) {
    return sendJSON(res, 404, { error: 'Task not found' });
  }

  sendJSON(res, 200, rows[0]);
}

async function bulkUpdateTasks(req, res) {
  const updates = await readBody(req);

  // Must be a non-empty array
  if (!Array.isArray(updates) || updates.length === 0) {
    return sendJSON(res, 400, { error: 'Body must be a non-empty array of updates' });
  }

  // Validate each item up front
  for (const item of updates) {
    if (!item || typeof item !== 'object') {
      return sendJSON(res, 400, { error: 'Each item must be an object' });
    }
    if (!Number.isInteger(item.id)) {
      return sendJSON(res, 400, { error: 'Each item must have an integer id' });
    }
    if (item.status !== undefined && !VALID_STATUSES.includes(item.status)) {
      return sendJSON(res, 400, {
        error: `status must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }
  }

  // Run all updates in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const item of updates) {
      const { id, title, status, start_time, end_time } = item;

      const start = start_time !== undefined ? new Date(start_time) : null;
      const end   = end_time   !== undefined ? new Date(end_time)   : null;

      if (start && isNaN(start)) {
        throw new Error(`Invalid start_time for id ${id}`);
      }
      if (end && isNaN(end)) {
        throw new Error(`Invalid end_time for id ${id}`);
      }
      if (start && end && end <= start) {
        throw new Error(`end_time must be after start_time for id ${id}`);
      }

      const { rows } = await client.query(
        `UPDATE tasks
            SET title      = COALESCE($1, title),
                status     = COALESCE($2, status),
                start_time = COALESCE($3, start_time),
                end_time   = COALESCE($4, end_time)
          WHERE id = $5
          RETURNING *`,
        [title ?? null, status ?? null, start, end, id]
      );

      if (rows.length === 0) {
        throw new Error(`Task id ${id} not found`);
      }

      results.push(rows[0]);
    }

    await client.query('COMMIT');
    sendJSON(res, 200, results);
  } catch (err) {
    await client.query('ROLLBACK');
    sendJSON(res, 400, { error: err.message });
  } finally {
    client.release();
  }
}

async function deleteTask(res, id) {
  const { rowCount } = await pool.query(
    'DELETE FROM tasks WHERE id = $1',
    [id]
  );

  if (rowCount === 0) {
    return sendJSON(res, 404, { error: 'Task not found' });
  }

  sendJSON(res, 200, { message: 'Task deleted' });
}

// --- The server ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // Route 1: GET /tasks  (with optional ?title=)
    if (pathname === '/tasks' && req.method === 'GET') {
      const title = url.searchParams.get('title');
      return await listTasks(res, title);
    }

    // Route 1.5: POST /tasks (Create a new task)
    if (pathname === '/tasks' && req.method === 'POST') {
      return await createTask(req, res);
    }

    // Route 2: PUT /tasks  (bulk update)
    if (pathname === '/tasks' && req.method === 'PUT') {
      return await bulkUpdateTasks(req, res);
    }

    // Routes 3 & 4: PUT/DELETE/GET /tasks/:id
    const match = pathname.match(/^\/tasks\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);
      if (req.method === 'GET')    return await getTask(res, id);
      if (req.method === 'PUT')    return await updateTask(res, res, id);
      if (req.method === 'DELETE') return await deleteTask(res, id);
    }

    // Static file serving for the frontend
    if (req.method === 'GET') {
      const filePath = pathname === '/' ? '/index.html' : pathname;
      const fullPath = path.join(PUBLIC_DIR, filePath);

      // Security: ensure the resolved path is inside PUBLIC_DIR
      if (!fullPath.startsWith(PUBLIC_DIR)) {
        return sendJSON(res, 403, { error: 'Forbidden' });
      }

      if (fs.existsSync(fullPath)) {
        const ext = path.extname(fullPath);
        const contentType = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(fs.readFileSync(fullPath));
      }
    }

    // Fallback: nothing matched
    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});