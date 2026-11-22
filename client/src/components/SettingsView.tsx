import { useEffect, useState } from 'react';
import { Calculator, Database, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatRelativeTime } from '../lib/format.ts';
import type { AppSettings, SyncStatusResponse } from '../types/api.ts';

interface SettingsViewProps {
  syncStatus: SyncStatusResponse | null;
  onSettingsUpdated: () => Promise<void>;
  onTriggerSde: () => void;
  onTriggerBackfill: () => void;
  onNotify: (msg: string) => void;
}

export function SettingsView({
  syncStatus,
  onSettingsUpdated,
  onTriggerSde,
  onTriggerBackfill,
  onNotify,
}: SettingsViewProps) {
  const [form, setForm] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.getSettings().then((res) => setForm(res.settings));
  }, []);

  if (!form) {
    return (
      <div className="bg-[#0F1118] border border-[#262938] rounded-md p-8 text-center text-xs font-mono-num text-[#9CA0B0]">
        Loading persisted settings...
      </div>
    );
  }

  const saveAll = async (recalculateFromSkills = false) => {
    setSaving(true);
    try {
      const res = await api.updateSettings({ ...form, recalculateFromSkills });
      setForm(res.settings);
      await onSettingsUpdated();
      onNotify(
        recalculateFromSkills
          ? `Recalculated Jita fees: ${res.settings.brokerFeePct}% broker · ${res.settings.salesTaxPct}% tax`
          : 'Saved settings to SQLite',
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Trading Fee & Skill Calculator */}
        <section className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#9B7BFF]" />
              <h2 className="font-display text-sm font-semibold text-[#EFEAE0]">
                Jita 4-4 Fee & Tax Parameters
              </h2>
            </div>
            <span className="font-mono-num text-xs text-[#46E595]">
              {form.brokerFeePct.toFixed(3)}% / {form.salesTaxPct.toFixed(3)}%
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                Accounting (0-5)
              </span>
              <input
                type="number"
                min={0}
                max={5}
                value={form.accountingLevel}
                onChange={(e) => setForm({ ...form, accountingLevel: Number(e.target.value) })}
                className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                Broker Rel. (0-5)
              </span>
              <input
                type="number"
                min={0}
                max={5}
                value={form.brokerRelationsLevel}
                onChange={(e) =>
                  setForm({ ...form, brokerRelationsLevel: Number(e.target.value) })
                }
                className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                Faction Standing
              </span>
              <input
                type="number"
                step="0.1"
                min={-10}
                max={10}
                value={form.factionStanding}
                onChange={(e) => setForm({ ...form, factionStanding: Number(e.target.value) })}
                className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                Caldari Navy St.
              </span>
              <input
                type="number"
                step="0.1"
                min={-10}
                max={10}
                value={form.corpStanding}
                onChange={(e) => setForm({ ...form, corpStanding: Number(e.target.value) })}
                className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAll(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#9B7BFF]/45 hover:bg-[#9B7BFF]/20 text-xs text-[#EFEAE0] cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#9B7BFF]" />
            <span>Calculate & Apply From Skills</span>
          </button>

          <div className="pt-3 border-t border-[#262938] grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                Direct Broker Fee %
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                max={10}
                value={form.brokerFeePct}
                onChange={(e) => setForm({ ...form, brokerFeePct: Number(e.target.value) })}
                className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                Direct Sales Tax %
              </span>
              <input
                type="number"
                step="0.01"
                min={0}
                max={15}
                value={form.salesTaxPct}
                onChange={(e) => setForm({ ...form, salesTaxPct: Number(e.target.value) })}
                className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                Market Share Est %
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={form.captureSharePct}
                onChange={(e) => setForm({ ...form, captureSharePct: Number(e.target.value) })}
                className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAll(false)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#9B7BFF] text-[#08090D] font-semibold text-xs hover:bg-[#B298FF] cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Manual Overrides</span>
          </button>
        </section>

        {/* Sync Scheduler & Optional EVE SSO Settings */}
        <section className="space-y-5">
          <div className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#46E595]" />
              <h2 className="font-display text-sm font-semibold text-[#EFEAE0]">
                Smart Auto-Sync & Local SDE
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs text-[#EFEAE0] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.autoSyncEnabled}
                  onChange={(e) => setForm({ ...form, autoSyncEnabled: e.target.checked })}
                  className="accent-[#9B7BFF]"
                />
                <span>Enable Background Jita Auto-Sync</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-[#9CA0B0]">
                <span>Interval (min):</span>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={form.autoSyncIntervalMin}
                  onChange={(e) =>
                    setForm({ ...form, autoSyncIntervalMin: Number(e.target.value) })
                  }
                  className="w-20 px-2 py-1 rounded bg-[#08090D] border border-[#262938] font-mono-num text-xs text-[#EFEAE0]"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveAll(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#9B7BFF] text-[#08090D] font-semibold text-xs hover:bg-[#B298FF] cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Sync Config</span>
              </button>
              <button
                type="button"
                onClick={onTriggerSde}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#9B7BFF] text-xs text-[#EFEAE0] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#9B7BFF]" />
                <span>Refresh EVE SDE</span>
              </button>
              <button
                type="button"
                onClick={onTriggerBackfill}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#46E595] text-xs text-[#EFEAE0] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#46E595]" />
                <span>Backfill 150 History Items</span>
              </button>
            </div>
          </div>

          <div className="bg-[#0F1118] border border-[#262938] rounded-md p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#9B7BFF]" />
              <h2 className="font-display text-sm font-semibold text-[#EFEAE0]">
                Optional EVE SSO Client Configuration
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                  EVE Application Client ID
                </span>
                <input
                  type="text"
                  value={form.esiClientId}
                  onChange={(e) => setForm({ ...form, esiClientId: e.target.value })}
                  placeholder="Optional — paste Client ID from developers.eveonline.com"
                  className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-mono-num uppercase text-[#656A7C]">
                  OAuth Redirect URI
                </span>
                <input
                  type="text"
                  value={form.ssoRedirectUri}
                  onChange={(e) => setForm({ ...form, ssoRedirectUri: e.target.value })}
                  className="px-2.5 py-1.5 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
                />
              </label>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAll(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#9B7BFF]/45 hover:bg-[#9B7BFF]/20 text-xs text-[#EFEAE0] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 text-[#9B7BFF]" />
              <span>Save SSO Settings</span>
            </button>
          </div>
        </section>
      </div>

      {/* Persisted SQLite Sync Audit Log */}
      <section className="bg-[#0F1118] border border-[#262938] rounded-md overflow-hidden">
        <div className="px-4 py-3 bg-[#161923] border-b border-[#262938] flex items-center justify-between">
          <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-[#EFEAE0]">
            Persisted SQLite Sync Audit Log
          </h3>
          <span className="font-mono-num text-[11px] text-[#656A7C]">
            Latest {syncStatus?.recentRuns.length ?? 0} runs
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-[#161923]/50 border-b border-[#262938] text-[10px] font-mono-num uppercase text-[#9CA0B0]">
              <tr>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2">Detail / Error</th>
                <th className="px-3 py-2 text-right">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#262938]/60">
              {(syncStatus?.recentRuns ?? []).map((run) => (
                <tr key={run.id} className="hover:bg-[#161923]/40">
                  <td className="px-3 py-2 font-mono-num uppercase text-[11px] text-[#B298FF]">
                    {run.kind}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num uppercase ${
                        run.status === 'completed'
                          ? 'bg-[#46E595]/15 text-[#46E595]'
                          : run.status === 'failed'
                            ? 'bg-[#FF4D6D]/15 text-[#FF4D6D]'
                            : 'bg-[#9B7BFF]/15 text-[#B298FF]'
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono-num text-[#EFEAE0]">
                    {run.items_updated.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[#9CA0B0] max-w-xl truncate">
                    {run.error_message || run.detail || '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono-num text-[11px] text-[#656A7C] whitespace-nowrap">
                    {formatRelativeTime(run.started_at)}
                  </td>
                </tr>
              ))}
              {(syncStatus?.recentRuns.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#656A7C]">
                    No sync runs recorded yet. Click Sync Jita in the top bar to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
