import http from 'http';
import { once } from 'events';
import { AddressInfo } from 'net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDashboard } from './server.js';

let server: http.Server | null = null;

async function startTestDashboard(
  options: Parameters<typeof startDashboard>[0] = {},
): Promise<void> {
  server = startDashboard({ port: 0, ...options });
  await once(server, 'listening');
}

async function post(path: string): Promise<{ statusCode?: number; body: string }> {
  if (!server) throw new Error('dashboard server not started');

  const { port } = server.address() as AddressInfo;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        method: 'POST',
        path,
        port,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

afterEach(async () => {
  if (!server) return;

  await new Promise<void>((resolve) => {
    server!.close(() => resolve());
  });
  server = null;
});

describe('dashboard lifecycle routes', () => {
  it('invokes the injected shutdown handler', async () => {
    const onShutdown = vi.fn();

    await startTestDashboard({ onShutdown });

    const response = await post('/api/shutdown');

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, action: 'shutdown' });
    await vi.waitFor(() => {
      expect(onShutdown).toHaveBeenCalledTimes(1);
    });
  });

  it('invokes the injected restart handler', async () => {
    const onRestart = vi.fn();

    await startTestDashboard({ onRestart });

    const response = await post('/api/restart');

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, action: 'restart' });
    await vi.waitFor(() => {
      expect(onRestart).toHaveBeenCalledTimes(1);
    });
  });
});
