import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { CLIENT_DIST_DIR, CLIENT_ORIGIN, PORT } from './config.js';
import { initDatabase } from './db/database.js';
import { authRouter } from './routes/auth.js';
import { marketRouter } from './routes/market.js';
import { presetsRouter } from './routes/presets.js';
import { settingsRouter } from './routes/settings.js';
import { syncRouter } from './routes/sync.js';
import { watchlistRouter } from './routes/watchlist.js';
import { startScheduler } from './services/scheduler.js';

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

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isDirectEntry) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[JITA IV // MONOLITH] Backend listening on http://localhost:${PORT}`);
    startScheduler();
  });
}
