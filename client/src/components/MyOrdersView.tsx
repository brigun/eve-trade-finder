import { useEffect, useState } from 'react';
import {
  Copy,
  ExternalLink,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  characterPortraitUrl,
  formatIskExact,
  formatRelativeTime,
} from '../lib/format.ts';
import type { CharacterOrderItem, SsoStatusResponse } from '../types/api.ts';
import { ItemIcon } from './ItemIcon.tsx';

interface MyOrdersViewProps {
  ssoStatus: SsoStatusResponse | null;
  onRefreshAuth: () => Promise<void>;
  onSelectTypeId: (typeId: number) => void;
  onNotify: (msg: string) => void;
}

export function MyOrdersView({
  ssoStatus,
  onRefreshAuth,
  onSelectTypeId,
  onNotify,
}: MyOrdersViewProps) {
  const [orders, setOrders] = useState<CharacterOrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');

  const loadOrders = async () => {
    setLoading(true);
    try {
      const res = await api.getCharacterOrders();
      setOrders(res.orders);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ssoStatus?.connected) {
      void loadOrders();
    } else {
      setOrders([]);
    }
  }, [ssoStatus?.connected]);

  const handleSaveClientAndConnect = async () => {
    try {
      if (clientIdInput.trim()) {
        await api.updateSettings({ esiClientId: clientIdInput.trim() });
      }
      const { url } = await api.getAuthLoginUrl();
      window.location.href = url;
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to start EVE SSO login');
    }
  };

  const handleSyncChar = async () => {
    setSyncing(true);
    try {
      const res = await api.syncCharacter();
      onNotify(
        `Synced ${res.characterName}: ${res.jitaOrdersCount} active Jita 4-4 orders & updated fees`,
      );
      await onRefreshAuth();
      await loadOrders();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Character sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    await api.logoutAuth();
    onNotify('Disconnected EVE SSO session');
    await onRefreshAuth();
  };

  const copyRelist = async (price: number) => {
    await navigator.clipboard.writeText(String(price));
    onNotify(`Copied 4-sig-fig relist price: ${formatIskExact(price)}`);
  };

  if (!ssoStatus?.connected) {
    return (
      <div className="corner-frame bg-[#0F1118] border border-[#262938] rounded-md p-6 sm:p-8 max-w-2xl mx-auto space-y-5">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-md bg-[#9B7BFF]/15 border border-[#9B7BFF]/40 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-[#9B7BFF]" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-[#EFEAE0]">
              Optional EVE Online SSO Integration (PKCE)
            </h2>
            <p className="mt-1 text-xs text-[#9CA0B0]">
              Connect your EVE character to automatically import your{' '}
              <span className="text-[#EFEAE0]">Accounting</span> &{' '}
              <span className="text-[#EFEAE0]">Broker Relations</span> skills, Caldari Navy / State
              standings, and track whether your active Jita 4-4 orders are{' '}
              <span className="text-[#46E595]">BEST</span> or{' '}
              <span className="text-[#FF4D6D]">UNDERCUT / OUTBID</span>.
            </p>
          </div>
        </div>

        <div className="bg-[#161923] border border-[#262938] rounded p-4 space-y-2 text-xs text-[#9CA0B0]">
          <div className="font-mono-num text-[11px] uppercase tracking-wider text-[#EFEAE0]">
            Setup Steps (No Client Secret Needed)
          </div>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              Register an application at{' '}
              <a
                href="https://developers.eveonline.com"
                target="_blank"
                rel="noreferrer"
                className="text-[#B298FF] hover:underline inline-flex items-center gap-0.5"
              >
                developers.eveonline.com <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>
              Set Callback URL to:{' '}
              <code className="px-1.5 py-0.5 rounded bg-[#08090D] font-mono-num text-[#EFEAE0]">
                {ssoStatus?.redirectUri ?? 'http://localhost:3001/api/auth/callback'}
              </code>
            </li>
            <li>
              Add scopes:{' '}
              <code className="font-mono-num text-[#EFEAE0]">
                esi-skills.read_skills.v1 esi-characters.read_standings.v1
                esi-markets.read_character_orders.v1
              </code>
            </li>
          </ol>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          {!ssoStatus?.clientIdConfigured && (
            <input
              type="text"
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              placeholder="Paste EVE Application Client ID..."
              className="flex-1 px-3 py-2 rounded bg-[#08090D] border border-[#262938] focus:border-[#9B7BFF] focus:outline-none font-mono-num text-xs text-[#EFEAE0]"
            />
          )}
          <button
            type="button"
            onClick={() => void handleSaveClientAndConnect()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded bg-[#9B7BFF] text-[#08090D] font-semibold text-xs hover:bg-[#B298FF] cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Connect via EVE Online SSO</span>
          </button>
        </div>

        <p className="text-[11px] text-[#656A7C] leading-relaxed">
          Authentication uses official EVE Online SSO (OAuth2 + PKCE) on{' '}
          <span className="font-mono-num text-[#9CA0B0]">login.eveonline.com</span>; your EVE Online
          credentials are never entered into or stored by this local tool. Read-only scopes are used
          strictly in accordance with the Fenris Creations (EVE Online) Developer License Agreement.
        </p>
      </div>
    );
  }

  const undercutCount = orders.filter((o) => o.status === 'UNDERCUT' || o.status === 'OUTBID').length;

  return (
    <div className="space-y-4">
      <div className="bg-[#0F1118] border border-[#262938] rounded-md p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {ssoStatus.characterId && (
            <img
              src={characterPortraitUrl(ssoStatus.characterId, 64)}
              alt={ssoStatus.characterName}
              className="w-11 h-11 rounded border border-[#46E595]/50 object-cover"
            />
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm font-semibold text-[#EFEAE0]">
                {ssoStatus.characterName}
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono-num bg-[#46E595]/15 text-[#46E595] border border-[#46E595]/35">
                CONNECTED
              </span>
            </div>
            <p className="text-xs font-mono-num text-[#9CA0B0]">
              {orders.length} active Jita 4-4 orders ·{' '}
              <span className={undercutCount > 0 ? 'text-[#FF4D6D]' : 'text-[#46E595]'}>
                {undercutCount} undercut/outbid
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSyncChar()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#9B7BFF] text-[#08090D] text-xs font-semibold hover:bg-[#B298FF] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync Orders & Skills</span>
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#161923] border border-[#262938] hover:border-[#FF4D6D] text-xs text-[#9CA0B0] hover:text-[#FF4D6D] cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Disconnect</span>
          </button>
        </div>
      </div>

      <div className="bg-[#0F1118] border border-[#262938] rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs font-mono-num text-[#9CA0B0]">
            Loading character orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#9CA0B0]">
            No active buy or sell orders found in Jita 4-4 for this character.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-[#161923] border-b border-[#262938] text-[10px] font-mono-num uppercase tracking-wider text-[#9CA0B0]">
                <tr>
                  <th className="px-3 py-2.5">Side</th>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">Your Price</th>
                  <th className="px-3 py-2.5 text-right">Jita Best</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Remaining</th>
                  <th className="px-3 py-2.5 text-right">Issued</th>
                  <th className="px-3 py-2.5 text-right">Relist Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262938]/70 text-xs">
                {orders.map((order) => {
                  const isBest = order.status === 'BEST';
                  const isBeat = order.status === 'UNDERCUT' || order.status === 'OUTBID';
                  return (
                    <tr
                      key={order.orderId}
                      onClick={() => onSelectTypeId(order.typeId)}
                      className="hover:bg-[#161923]/80 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono-num font-semibold ${
                            order.isBuyOrder
                              ? 'bg-[#46E595]/15 text-[#46E595]'
                              : 'bg-[#9B7BFF]/15 text-[#B298FF]'
                          }`}
                        >
                          {order.isBuyOrder ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <ItemIcon typeId={order.typeId} name={order.itemName} size={32} className="w-7 h-7" />
                          <span className="font-medium text-[#EFEAE0]">{order.itemName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num text-[#EFEAE0]">
                        {formatIskExact(order.price)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num text-[#9CA0B0]">
                        {formatIskExact(order.marketBestPrice)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono-num border ${
                            isBest
                              ? 'bg-[#46E595]/15 text-[#46E595] border-[#46E595]/40'
                              : isBeat
                                ? 'bg-[#FF4D6D]/15 text-[#FF4D6D] border-[#FF4D6D]/45'
                                : 'bg-[#161923] text-[#656A7C] border-[#262938]'
                          }`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num text-[#EFEAE0]">
                        {order.volumeRemain.toLocaleString()} / {order.volumeTotal.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-num text-[11px] text-[#656A7C]">
                        {formatRelativeTime(order.issued)}
                      </td>
                      <td
                        className="px-3 py-2 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {order.suggestedRelistPrice !== null ? (
                          <button
                            type="button"
                            onClick={() => void copyRelist(order.suggestedRelistPrice!)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#161923] border border-[#9B7BFF]/45 hover:bg-[#9B7BFF]/20 text-[11px] font-mono-num text-[#EFEAE0] cursor-pointer"
                          >
                            <Copy className="w-3 h-3 text-[#9B7BFF]" />
                            <span>{formatIskExact(order.suggestedRelistPrice)}</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#656A7C]">Leading</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
