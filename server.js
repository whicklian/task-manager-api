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

// ---------- Constants ----------
const VALID_STATUSES = [
  'not_started', 'in_progress', 'blocked',
  'on_hold', 'completed', 'cancelled'
];

// New tasks can only start in these statuses
const ALLOWED_INITIAL_STATUSES = ['not_started', 'in_progress'];

// ---------- Helpers ----------
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

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

// ---------- Handlers ----------

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

async function createTask(req, res) {
  const { title, status, start_time, end_time } = await readBody(req);

  // 1. Validate title
  if (typeof title !== 'string' || !title.trim()) {
    return sendJSON(res, 400, { error: 'Title is required' });
  }

  // 2. Validate status
  const finalStatus = status ?? 'not_started';

  if (!ALLOWED_INITIAL_STATUSES.includes(finalStatus)) {
    return sendJSON(res, 400, {
      error: 'A new task can only have status not_started or in_progress'
    });
  }

  // 3. Validate required times
  if (!start_time || !end_time) {
    return sendJSON(res, 400, {
      error: 'start_time and end_time are required'
    });
  }

  // 4. Parse dates
  const start = new Date(start_time);
  const end = new Date(end_time);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return sendJSON(res, 400, {
      error: 'start_time and end_time must be valid dates'
    });
  }

  // 5. Start cannot be in the past
  if (start < new Date()) {
    return sendJSON(res, 400, {
      error: 'start_time cannot be before the current time'
    });
  }

  // 6. End must be after start
  if (end <= start) {
    return sendJSON(res, 400, {
      error: 'end_time must be after start_time'
    });
  }

  // 7. Insert
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

  // Fetch existing task so we can validate combined state
  const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    return sendJSON(res, 404, { error: 'Task not found' });
  }
  const current = existing.rows[0];

  // 1. Validate title if provided
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return sendJSON(res, 400, { error: 'Title must be a non-empty string' });
    }
  }

  // 2. Validate status if provided
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return sendJSON(res, 400, {
      error: `status must be one of: ${VALID_STATUSES.join(', ')}`
    });
  }

  // 3. Determine the final start/end times (merging with existing)
  const finalStart = start_time !== undefined
    ? new Date(start_time)
    : new Date(current.start_time);

  const finalEnd = end_time !== undefined
    ? new Date(end_time)
    : new Date(current.end_time);

  if (isNaN(finalStart.getTime())) {
    return sendJSON(res, 400, { error: 'start_time must be a valid date' });
  }
  if (isNaN(finalEnd.getTime())) {
    return sendJSON(res, 400, { error: 'end_time must be a valid date' });
  }

  // 4. Validate combined time range
  if (finalEnd <= finalStart) {
    return sendJSON(res, 400, {
      error: 'end_time must be after start_time'
    });
  }

  // 5. Update
  const { rows } = await pool.query(
    `UPDATE tasks
        SET title      = COALESCE($1, title),
            status     = COALESCE($2, status),
            start_time = COALESCE($3, start_time),
            end_time   = COALESCE($4, end_time)
      WHERE id = $5
      RETURNING *`,
    [
      title !== undefined ? title.trim() : null,
      status ?? null,
      start_time !== undefined ? finalStart : null,
      end_time !== undefined ? finalEnd : null,
      id,
    ]
  );

  sendJSON(res, 200, rows[0]);
}

async function bulkUpdateTasks(req, res) {
  const updates = await readBody(req);

  // Must be a non-empty array
  if (!Array.isArray(updates) || updates.length === 0) {
    return sendJSON(res, 400, {
      error: 'Body must be a non-empty array of updates'
    });
  }

  // Validate shape of each item up front
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
    if (item.title !== undefined) {
      if (typeof item.title !== 'string' || !item.title.trim()) {
        return sendJSON(res, 400, {
          error: `title must be a non-empty string for id ${item.id}`
        });
      }
    }
  }

  // Run all updates in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const item of updates) {
      const { id, title, status, start_time, end_time } = item;

      // Fetch existing so we can validate merged times
      const existing = await client.query(
        'SELECT * FROM tasks WHERE id = $1',
        [id]
      );
      if (existing.rows.length === 0) {
        throw new Error(`Task id ${id} not found`);
      }
      const current = existing.rows[0];

      const finalStart = start_time !== undefined
        ? new Date(start_time)
        : new Date(current.start_time);

      const finalEnd = end_time !== undefined
        ? new Date(end_time)
        : new Date(current.end_time);

      if (isNaN(finalStart.getTime())) {
        throw new Error(`Invalid start_time for id ${id}`);
      }
      if (isNaN(finalEnd.getTime())) {
        throw new Error(`Invalid end_time for id ${id}`);
      }
      if (finalEnd <= finalStart) {
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
        [
          title !== undefined ? title.trim() : null,
          status ?? null,
          start_time !== undefined ? finalStart : null,
          end_time !== undefined ? finalEnd : null,
          id,
        ]
      );

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

// ---------- The server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // GET /tasks (with optional ?title=)
    if (pathname === '/tasks' && req.method === 'GET') {
      const title = url.searchParams.get('title');
      return await listTasks(res, title);
    }

    // POST /tasks
    if (pathname === '/tasks' && req.method === 'POST') {
      return await createTask(req, res);
    }

    // PUT /tasks (bulk update)
    if (pathname === '/tasks' && req.method === 'PUT') {
      return await bulkUpdateTasks(req, res);
    }

    // /tasks/:id
    const match = pathname.match(/^\/tasks\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);
      if (req.method === 'GET')    return await getTask(res, id);
      if (req.method === 'PUT')    return await updateTask(req, res, id);
      if (req.method === 'DELETE') return await deleteTask(res, id);
    }

    // Static files
    if (req.method === 'GET') {
      const filePath = pathname === '/' ? '/index.html' : pathname;
      const fullPath = path.join(PUBLIC_DIR, filePath);

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

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);

    // Invalid JSON body → 400; everything else → 500
    const status = err.message === 'Invalid JSON' ? 400 : 500;
    sendJSON(res, status, { error: err.message });
  }
});

// ---------- Start ----------
try {
  await pool.query('SELECT 1');
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
} catch (err) {
  console.error('Unable to connect to PostgreSQL:', err.message);
  await pool.end();
  process.exitCode = 1;
}