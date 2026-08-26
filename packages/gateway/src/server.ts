import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildRouteTable } from '@sml/protocol';
import type { WireRequest } from '@sml/protocol';
import { loadConfig } from './config.ts';
import { createForwarder } from './forward.ts';

const config = loadConfig();
const forward = createForwarder(config);

const server = createServer(async (req, res) => {
  // The host shell reaches this through Vite's proxy, so it is same-origin.
  // CORS is only here for calling the gateway directly while debugging.
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');

  if (req.method === 'OPTIONS') return end(res, 204, '');

  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      cm: config.cm,
      tokenSource: config.tokenSource,
      hasToken: Boolean(config.token),
    });
  }

  if (url.pathname === '/routes') {
    return json(res, 200, buildRouteTable(config.cm));
  }

  if (url.pathname === '/request' && req.method === 'POST') {
    try {
      const wire = JSON.parse(await readBody(req)) as WireRequest;
      const result = await forward(wire);
      log(wire, result.status, result.route?.target);
      return json(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json(res, 500, { error: message });
    }
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(config.port, () => {
  console.log(`local marketplace gateway  http://localhost:${config.port}`);
  console.log(`  CM      ${config.cm}`);
  console.log(`  token   ${config.token ? `yes (${config.tokenSource})` : 'NONE - authenticated calls will 401'}`);
  console.log(`  TLS     ${config.insecureTls ? 'accepting the self-signed dev cert' : 'verifying'}`);
});

function log(wire: WireRequest, status: number, target?: string | null) {
  const flag = status >= 500 ? '!!' : status >= 400 ? ' !' : ' ok';
  console.log(`${flag} ${status} ${wire.method} ${wire.path} -> ${target ?? '(refused)'}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.setHeader('content-type', 'application/json');
  end(res, status, JSON.stringify(payload));
}

function end(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.end(body);
}
