import { Router } from 'express';
import { checkForUpdates } from '../services/updateService.js';

export const appRouter = Router();

appRouter.get('/update', async (req, res) => {
  const force = req.query.force === 'true' || req.query.force === '1';
  const result = await checkForUpdates({ force });
  res.json(result);
});
