import { Router } from 'express';
import { getDb } from '../db/database.js';

export const presetsRouter = Router();

presetsRouter.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM filter_presets ORDER BY id ASC').all() as Array<{
    id: number;
    name: string;
    filters_json: string;
    created_at: string;
    updated_at: string;
  }>;

  const presets = rows.map((row) => ({
    id: row.id,
    name: row.name,
    filters: JSON.parse(row.filters_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  res.json({ presets });
});

presetsRouter.post('/', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  const filters = req.body?.filters;
  if (!name || !filters || typeof filters !== 'object') {
    res.status(400).json({ error: 'Preset name and filters object are required' });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const json = JSON.stringify(filters);

  db.prepare(`
    INSERT INTO filter_presets (name, filters_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      filters_json = excluded.filters_json,
      updated_at = excluded.updated_at
  `).run(name, json, now, now);

  const saved = db.prepare('SELECT * FROM filter_presets WHERE name = ?').get(name) as {
    id: number;
    name: string;
    filters_json: string;
    created_at: string;
    updated_at: string;
  };

  res.status(201).json({
    preset: {
      id: saved.id,
      name: saved.name,
      filters: JSON.parse(saved.filters_json),
      createdAt: saved.created_at,
      updatedAt: saved.updated_at,
    },
  });
});

presetsRouter.delete('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid preset id' });
    return;
  }

  const db = getDb();
  db.prepare('DELETE FROM filter_presets WHERE id = ?').run(id);
  res.json({ deleted: true, id });
});
