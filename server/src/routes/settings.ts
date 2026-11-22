import { Router } from 'express';
import { refreshSchedulerSchedule } from '../services/scheduler.js';
import { getAllSettings, updateSettings, type AppSettings } from '../services/settingsService.js';
import { calculateEveFees } from '../services/tradeAnalytics.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json({ settings: getAllSettings() });
});

settingsRouter.put('/', (req, res) => {
  const body = req.body ?? {};
  const current = getAllSettings();
  const patch: Partial<AppSettings> = {};

  if (typeof body.accountingLevel === 'number') patch.accountingLevel = body.accountingLevel;
  if (typeof body.brokerRelationsLevel === 'number') {
    patch.brokerRelationsLevel = body.brokerRelationsLevel;
  }
  if (typeof body.factionStanding === 'number') patch.factionStanding = body.factionStanding;
  if (typeof body.corpStanding === 'number') patch.corpStanding = body.corpStanding;

  if (body.recalculateFromSkills === true) {
    const calculated = calculateEveFees({
      accountingLevel: patch.accountingLevel ?? current.accountingLevel,
      brokerRelationsLevel: patch.brokerRelationsLevel ?? current.brokerRelationsLevel,
      factionStanding: patch.factionStanding ?? current.factionStanding,
      corpStanding: patch.corpStanding ?? current.corpStanding,
    });
    patch.brokerFeePct = calculated.brokerFeePct;
    patch.salesTaxPct = calculated.salesTaxPct;
  } else {
    if (typeof body.brokerFeePct === 'number') patch.brokerFeePct = body.brokerFeePct;
    if (typeof body.salesTaxPct === 'number') patch.salesTaxPct = body.salesTaxPct;
  }

  if (typeof body.autoSyncEnabled === 'boolean') patch.autoSyncEnabled = body.autoSyncEnabled;
  if (typeof body.autoSyncIntervalMin === 'number') {
    patch.autoSyncIntervalMin = Math.max(5, Math.min(180, Math.round(body.autoSyncIntervalMin)));
  }
  if (typeof body.captureSharePct === 'number') {
    patch.captureSharePct = Math.max(1, Math.min(100, body.captureSharePct));
  }
  if (typeof body.esiClientId === 'string') patch.esiClientId = body.esiClientId.trim();
  if (typeof body.ssoRedirectUri === 'string' && body.ssoRedirectUri.trim()) {
    patch.ssoRedirectUri = body.ssoRedirectUri.trim();
  }

  const updated = updateSettings(patch);
  refreshSchedulerSchedule();
  res.json({ settings: updated });
});
