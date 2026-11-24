import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CLIENT_DIST_DIR, CLIENT_ORIGIN, PORT } from './config.js';
import { initDatabase } from './db/database.js';
import { advisorRouter } from './routes/advisor.js';
import { authRouter } from './routes/auth.js';
import { marketRouter } from './routes/market.js';
import { presetsRouter } from './routes/presets.js';
import { settingsRouter } from './routes/settings.js';
import { syncRouter } from './routes/sync.js';
import { watchlistRouter } from './routes/watchlist.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

export function createApp() {
  initDatabase();

  const app = express();
  app.use(
    cors({
      origin: [CLIENT_ORIGIN, `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'jita-monolith-backend', timestamp: new Date().toISOString() });
  });

  app.use('/api/market', marketRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/watchlist', watchlistRouter);
  app.use('/api/presets', presetsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/advisor', advisorRouter);

  if (fs.existsSync(CLIENT_DIST_DIR)) {
    app.use(express.static(CLIENT_DIST_DIR));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[server error]', err);
    res.status(500).json({ error: message });
  });

  return app;
}

export interface StartedServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(preferredPort = PORT): Promise<StartedServer> {
  const app = createApp();

  const listenOnHost = (
    targetPort: number,
    host: string,
  ): Promise<{ server: http.Server; port: number }> =>
    new Promise((resolve, reject) => {
      const server = http.createServer(app);
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(targetPort, host, () => {
        server.off('error', onError);
        const addr = server.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : targetPort;
        resolve({ server, port: boundPort });
      });
    });

  let bound: { server: http.Server; port: number };
  try {
    bound = await listenOnHost(preferredPort, '127.0.0.1');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EADDRINUSE' && preferredPort !== 0) {
      bound = await listenOnHost(0, '127.0.0.1');
    } else {
      throw err;
    }
  }

  bound.server.requestTimeout = 200_000;
  bound.server.headersTimeout = 205_000;

  let ipv6Server: http.Server | null = null;
  try {
    const v6Bound = await listenOnHost(bound.port, '::1');
    ipv6Server = v6Bound.server;
    ipv6Server.requestTimeout = 200_000;
    ipv6Server.headersTimeout = 205_000;
  } catch {
    // IPv6 loopback may be unavailable or already bound; 127.0.0.1 remains active.
  }

  startScheduler();

  return {
    server: bound.server,
    port: bound.port,
    close: async () => {
      stopScheduler();
      await Promise.all([
        new Promise<void>((resolve) => {
          bound.server.close(() => resolve());
        }),
        ipv6Server
          ? new Promise<void>((resolve) => {
              ipv6Server.close(() => resolve());
            })
          : Promise.resolve(),
      ]);
    },
  };
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isDirectEntry) {
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[JITA IV // MONOLITH] Backend listening on http://localhost:${PORT}`);
    startScheduler();
  });
  server.requestTimeout = 200_000;
  server.headersTimeout = 205_000;
}
