import http from 'node:http';
import dotenv from 'dotenv';
import { pool } from './db.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function listTasks(res) {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id ASC');
  sendJSON(res, 200, rows);
}

async function createTask(req, res) {
  const { title } = await readBody(req);

  if (!title || typeof title !== 'string' || !title.trim()) {
    return sendJSON(res, 400, { error: 'Title is required' });
  }

  const { rows } = await pool.query(
    'INSERT INTO tasks (title) VALUES ($1) RETURNING *',
    [title.trim()]
  );

  sendJSON(res, 201, rows[0]);
}

async function updateTask(req, res, id) {
  const { title, completed } = await readBody(req);

  const { rows } = await pool.query(
    `UPDATE tasks
        SET title = COALESCE($1, title),
            completed = COALESCE($2, completed)
      WHERE id = $3
      RETURNING *`,
    [title ?? null, completed ?? null, id]
  );

  if (rows.length === 0) {
    return sendJSON(res, 404, { error: 'Task not found' });
  }

  sendJSON(res, 200, rows[0]);
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
    // Route 1: GET /tasks
    if (pathname === '/tasks' && req.method === 'GET') {
      return await listTasks(res);
    }

    // Route 2: POST /tasks
    if (pathname === '/tasks' && req.method === 'POST') {
      return await createTask(req, res);
    }

    // Routes 3 & 4: PUT/DELETE /tasks/:id
    const match = pathname.match(/^\/tasks\/(\d+)$/);
    if (match) {
      const id = Number(match[1]);
      if (req.method === 'PUT')    return await updateTask(req, res, id);
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