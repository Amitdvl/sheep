/**
 * Sheep Dashboard — lightweight web GUI for controlling the Discord bot.
 * Runs alongside the main Sheep process on a separate port.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getAllRegisteredGroups,
  getAllTasks,
  getTaskById,
  updateTask,
  deleteTask,
} from '../db.js';
import { ASSISTANT_NAME, GROUPS_DIR, STORE_DIR, TIMEZONE } from '../config.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'dashboard',
  'public',
);

export const DASHBOARD_PORT = parseInt(
  process.env.DASHBOARD_PORT || '3800',
  10,
);

interface RouteHandler {
  (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ): Promise<void> | void;
}

interface DashboardLifecycleHandlers {
  onShutdown?: () => Promise<void> | void;
  onRestart?: () => Promise<void> | void;
}

interface StartDashboardOptions extends DashboardLifecycleHandlers {
  port?: number;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// --- API Routes ---

function apiStatus(_req: IncomingMessage, res: ServerResponse): void {
  const groups = getAllRegisteredGroups();
  const tasks = getAllTasks();
  const activeTasks = tasks.filter((t) => t.status === 'active');

  json(res, {
    name: ASSISTANT_NAME,
    timezone: TIMEZONE,
    groups: Object.entries(groups).map(([jid, g]) => ({
      jid,
      name: g.name,
      folder: g.folder,
      isMain: g.isMain || false,
      requiresTrigger: g.requiresTrigger !== false,
    })),
    tasks: {
      total: tasks.length,
      active: activeTasks.length,
      paused: tasks.filter((t) => t.status === 'paused').length,
    },
    uptime: process.uptime(),
  });
}

function apiTasks(_req: IncomingMessage, res: ServerResponse): void {
  json(res, getAllTasks());
}

async function apiTaskAction(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const taskId = params.id;
  const task = getTaskById(taskId);
  if (!task) return json(res, { error: 'Task not found' }, 404);

  if (req.method === 'DELETE') {
    deleteTask(taskId);
    return json(res, { ok: true });
  }

  const body = JSON.parse(await readBody(req));
  if (body.status) {
    updateTask(taskId, { status: body.status });
  }
  if (body.prompt) {
    updateTask(taskId, { prompt: body.prompt });
  }
  json(res, { ok: true });
}

function apiMemory(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const folder = params.folder || 'discord_main';
  const groupDir = path.join(GROUPS_DIR, folder);

  if (!fs.existsSync(groupDir))
    return json(res, { error: 'Group not found' }, 404);

  const files: { name: string; content: string; size: number }[] = [];
  for (const file of fs.readdirSync(groupDir)) {
    if (file === 'logs' || file === 'conversations') continue;
    const filePath = path.join(groupDir, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile() && file.endsWith('.md')) {
      files.push({
        name: file,
        content: fs.readFileSync(filePath, 'utf-8'),
        size: stat.size,
      });
    }
  }
  json(res, files);
}

function apiConversations(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const folder = params.folder || 'discord_main';
  const convDir = path.join(GROUPS_DIR, folder, 'conversations');

  if (!fs.existsSync(convDir)) return json(res, []);

  const files = fs
    .readdirSync(convDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 50)
    .map((f) => {
      const filePath = path.join(convDir, f);
      const stat = fs.statSync(filePath);
      return {
        name: f,
        content: fs.readFileSync(filePath, 'utf-8'),
        size: stat.size,
        date: stat.mtime.toISOString(),
      };
    });

  json(res, files);
}

async function apiMemoryUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const folder = params.folder || 'discord_main';
  const body = JSON.parse(await readBody(req));
  if (!body.name || !body.content)
    return json(res, { error: 'name and content required' }, 400);

  // Sanitize filename
  const safeName = path.basename(body.name);
  if (!safeName.endsWith('.md'))
    return json(res, { error: 'Only .md files allowed' }, 400);

  const filePath = path.join(GROUPS_DIR, folder, safeName);
  fs.writeFileSync(filePath, body.content, 'utf-8');
  json(res, { ok: true });
}

function triggerLifecycleAction(
  action: 'shutdown' | 'restart',
  handler?: () => Promise<void> | void,
): void {
  const fallbackExitCode = action === 'restart' ? 75 : 0;

  setImmediate(() => {
    Promise.resolve()
      .then(() => {
        if (handler) return handler();
        process.exit(fallbackExitCode);
      })
      .catch((err) => {
        logger.error({ err, action }, 'Dashboard lifecycle hook failed');
        process.exit(1);
      });
  });
}

function apiShutdown(
  _req: IncomingMessage,
  res: ServerResponse,
  onShutdown?: () => Promise<void> | void,
): void {
  json(res, { ok: true, action: 'shutdown' });
  logger.info('Shutdown requested via dashboard');
  triggerLifecycleAction('shutdown', onShutdown);
}

function apiRestart(
  _req: IncomingMessage,
  res: ServerResponse,
  onRestart?: () => Promise<void> | void,
): void {
  json(res, { ok: true, action: 'restart' });
  logger.info('Restart requested via dashboard');
  // Exit with code 75 — the launchd/systemd service or wrapper script
  // should detect this and restart the process.
  // If running raw (npm run dev), this just stops — user restarts manually.
  triggerLifecycleAction('restart', onRestart);
}

// --- Router ---

function matchRoute(
  method: string,
  url: string,
  lifecycleHandlers: DashboardLifecycleHandlers,
): { handler: RouteHandler; params: Record<string, string> } | null {
  const routes: Array<{
    method: string;
    pattern: RegExp;
    handler: RouteHandler;
  }> = [
    { method: 'GET', pattern: /^\/api\/status$/, handler: apiStatus },
    { method: 'GET', pattern: /^\/api\/tasks$/, handler: apiTasks },
    {
      method: 'PATCH',
      pattern: /^\/api\/tasks\/(?<id>[^/]+)$/,
      handler: apiTaskAction,
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/tasks\/(?<id>[^/]+)$/,
      handler: apiTaskAction,
    },
    {
      method: 'GET',
      pattern: /^\/api\/memory(?:\/(?<folder>[^/]+))?$/,
      handler: apiMemory,
    },
    {
      method: 'PUT',
      pattern: /^\/api\/memory(?:\/(?<folder>[^/]+))?$/,
      handler: apiMemoryUpdate,
    },
    {
      method: 'GET',
      pattern: /^\/api\/conversations(?:\/(?<folder>[^/]+))?$/,
      handler: apiConversations,
    },
    {
      method: 'POST',
      pattern: /^\/api\/shutdown$/,
      handler: (req, res) =>
        apiShutdown(req, res, lifecycleHandlers.onShutdown),
    },
    {
      method: 'POST',
      pattern: /^\/api\/restart$/,
      handler: (req, res) => apiRestart(req, res, lifecycleHandlers.onRestart),
    },
  ];

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = url.match(route.pattern);
    if (match) {
      return { handler: route.handler, params: match.groups || {} };
    }
  }
  return null;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  let urlPath = req.url || '/';
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // Strip query strings
  const qIdx = urlPath.indexOf('?');
  if (qIdx !== -1) urlPath = urlPath.slice(0, qIdx);

  const ext = path.extname(urlPath);
  const filePath = path.join(PUBLIC_DIR, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath)) return false;

  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// --- Server ---

export function startDashboard(options: StartDashboardOptions = {}): Server {
  const server = createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    const apiPath = url.split('?')[0];
    const route = matchRoute(method, apiPath, options);
    if (route) {
      try {
        await route.handler(req, res, route.params);
      } catch (err) {
        logger.error({ err, url }, 'Dashboard API error');
        if (!res.headersSent) json(res, { error: 'Internal error' }, 500);
      }
      return;
    }

    // Static files
    if (method === 'GET' && serveStatic(req, res)) return;

    // 404 — serve index.html for SPA routing
    if (method === 'GET') {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  const port = options.port ?? DASHBOARD_PORT;
  server.listen(port, () => {
    logger.info({ port }, 'Dashboard started');
  });

  return server;
}
