import { Router } from 'express';
import {
  consultNeon,
  getLatestNeonBriefing,
  getNeonAdvisorStatus,
  listAvailableLlmModels,
} from '../services/neonAdvisor.js';

export const advisorRouter = Router();

advisorRouter.get('/status', (_req, res) => {
  res.json(getNeonAdvisorStatus());
});

advisorRouter.get('/models', async (_req, res) => {
  const result = await listAvailableLlmModels();
  res.json(result);
});

advisorRouter.get('/latest', (_req, res) => {
  res.json({ briefing: getLatestNeonBriefing() });
});

advisorRouter.post('/ask-neon', async (req, res) => {
  try {
    const body = req.body ?? {};
    const budgetIsk =
      body.budgetIsk !== undefined && body.budgetIsk !== null && body.budgetIsk !== ''
        ? Number(body.budgetIsk)
        : null;
    const minRoiPct =
      body.minRoiPct !== undefined && body.minRoiPct !== null && body.minRoiPct !== ''
        ? Number(body.minRoiPct)
        : 10;
    const marketGroupId =
      body.marketGroupId !== undefined && body.marketGroupId !== null && body.marketGroupId !== ''
        ? Number(body.marketGroupId)
        : null;
    const marketGroupIds = Array.isArray(body.marketGroupIds)
      ? body.marketGroupIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n))
      : [];

    const briefing = await consultNeon({
      budgetIsk: budgetIsk !== null && Number.isFinite(budgetIsk) ? budgetIsk : null,
      sessionStyle: body.sessionStyle,
      userNote: typeof body.userNote === 'string' ? body.userNote : '',
      minRoiPct: Number.isFinite(minRoiPct) ? minRoiPct : 10,
      marketGroupId: marketGroupId !== null && Number.isFinite(marketGroupId) ? marketGroupId : null,
      marketGroupIds,
      model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
      thinkingLevel:
        body.thinkingLevel === 'LOW' ||
        body.thinkingLevel === 'MEDIUM' ||
        body.thinkingLevel === 'HIGH'
          ? body.thinkingLevel
          : undefined,
    });

    res.json({ briefing });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to consult Neon advisor';
    const isClientConfigError =
      /API key is not configured|No Jita 4-4|No .*matched/i.test(message);
    res.status(isClientConfigError ? 400 : 500).json({ error: message });
  }
});
