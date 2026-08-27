import fs from 'fs';
import os from 'os';
import path from 'path';

const API_PORT = 8765;

function tandemDir(...subpath: string[]): string {
  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), '.tandem')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Tandem Browser')
      : path.join(os.homedir(), '.tandem');
  return path.join(base, ...subpath);
}

function readApiPortFromBootstrap(): number {
  const envPort = process.env.TANDEM_API_PORT;
  if (envPort && /^\d+$/.test(envPort.trim())) {
    const port = Number(envPort.trim());
    if (port >= 1 && port <= 65535) return port;
  }

  const portPath = tandemDir('api-port');
  try {
    const port = Number(fs.readFileSync(portPath, 'utf8').trim());
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  } catch {
    // Fall back to config/default when the bootstrap file is absent.
  }

  try {
    const config = JSON.parse(fs.readFileSync(tandemDir('config.json'), 'utf8')) as { general?: { apiPort?: unknown } };
    const port = Number(config.general?.apiPort);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  } catch {
    // Fall back to the default port when config is absent or invalid.
  }
  return API_PORT;
}

const API_BASE = process.env.TANDEM_API || `http://127.0.0.1:${readApiPortFromBootstrap()}`;
const TOKEN_PATH = tandemDir('api-token');

function getToken(): string {
  try {
    return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
  } catch {
    return '';
  }
}

export async function api(
  method: string,
  endpoint: string,
  body?: unknown,
  session?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  };
  if (session) headers['X-Session'] = session;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  return res.json();
}

export async function apiRaw(
  method: string,
  endpoint: string,
  session?: string
): Promise<Buffer> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
  };
  if (session) headers['X-Session'] = session;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`Error: ${(err as { error: string }).error}`);
    process.exit(1);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
