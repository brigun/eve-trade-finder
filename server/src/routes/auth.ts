import { Router } from 'express';
import { CLIENT_ORIGIN } from '../config.js';
import { getDb } from '../db/database.js';
import { getAllSettings } from '../services/settingsService.js';
import {
  buildSsoAuthorizeUrl,
  disconnectSso,
  getActiveSession,
  handleSsoCallback,
  syncCharacterData,
} from '../services/ssoService.js';
import { nextEveTick } from '../services/tradeAnalytics.js';

export const authRouter = Router();

authRouter.get('/status', (_req, res) => {
  const session = getActiveSession();
  const settings = getAllSettings();
  const db = getDb();
  const ordersRow = db.prepare('SELECT COUNT(*) AS cnt FROM character_orders').get() as {
    cnt: number;
  };

  if (!session) {
    res.json({
      connected: false,
      clientIdConfigured: Boolean(settings.esiClientId.trim()),
      redirectUri: settings.ssoRedirectUri,
      jitaOrdersCount: 0,
    });
    return;
  }

  res.json({
    connected: true,
    characterId: session.character_id,
    characterName: session.character_name,
    scopes: session.scopes.split(' ').filter(Boolean),
    expiresAt: session.expires_at,
    updatedAt: session.updated_at,
    clientIdConfigured: Boolean(settings.esiClientId.trim()),
    redirectUri: settings.ssoRedirectUri,
    jitaOrdersCount: ordersRow.cnt,
  });
});

authRouter.get('/login', (req, res) => {
  try {
    const { url } = buildSsoAuthorizeUrl();
    if (req.query.redirect === '1') {
      res.redirect(url);
      return;
    }
    res.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

authRouter.get('/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  if (!code || !state) {
    res.status(400).send('Missing OAuth code or state parameter.');
    return;
  }

  try {
    await handleSsoCallback(code, state);
    const target =
      process.env.NODE_ENV === 'production'
        ? '/?tab=orders&sso=connected'
        : `${CLIENT_ORIGIN}/?tab=orders&sso=connected`;
    res.redirect(target);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(`EVE SSO authentication failed: ${message}`);
  }
});

authRouter.post('/sync', async (_req, res, next) => {
  try {
    const result = await syncCharacterData();
    res.json({ synced: true, ...result });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (_req, res) => {
  disconnectSso();
  res.json({ disconnected: true });
});

authRouter.get('/orders', (_req, res) => {
  const session = getActiveSession();
  if (!session) {
    res.json({ connected: false, orders: [] });
    return;
  }

  const db = getDb();
  const rows = db
    .prepare(`
      SELECT
        co.*,
        it.name AS item_name,
        it.root_group_name,
        ms.best_bid,
        ms.best_ask
      FROM character_orders co
      LEFT JOIN item_types it ON it.type_id = co.type_id
      LEFT JOIN market_summary ms ON ms.type_id = co.type_id
      WHERE co.character_id = ?
      ORDER BY co.is_buy_order ASC, co.issued DESC
    `)
    .all(session.character_id) as Array<{
    order_id: number;
    type_id: number;
    is_buy_order: number;
    price: number;
    volume_remain: number;
    volume_total: number;
    issued: string;
    escrow: number;
    updated_at: string;
    item_name: string | null;
    root_group_name: string | null;
    best_bid: number | null;
    best_ask: number | null;
  }>;

  const orders = rows.map((row) => {
    const isBuy = row.is_buy_order === 1;
    const marketBestPrice = isBuy ? row.best_bid : row.best_ask;

    let status: 'BEST' | 'UNDERCUT' | 'OUTBID' | 'NO_MARKET' = 'NO_MARKET';
    let deltaIsk = 0;
    let suggestedRelistPrice: number | null = null;

    if (marketBestPrice !== null && marketBestPrice > 0) {
      if (isBuy) {
        if (marketBestPrice > row.price + 0.001) {
          status = 'OUTBID';
          deltaIsk = marketBestPrice - row.price;
          suggestedRelistPrice = nextEveTick(marketBestPrice, 'up');
        } else {
          status = 'BEST';
        }
      } else {
        if (marketBestPrice < row.price - 0.001) {
          status = 'UNDERCUT';
          deltaIsk = row.price - marketBestPrice;
          suggestedRelistPrice = nextEveTick(marketBestPrice, 'down');
        } else {
          status = 'BEST';
        }
      }
    }

    return {
      orderId: row.order_id,
      typeId: row.type_id,
      itemName: row.item_name ?? `Type #${row.type_id}`,
      rootGroupName: row.root_group_name ?? 'Uncategorized',
      isBuyOrder: isBuy,
      price: row.price,
      volumeRemain: row.volume_remain,
      volumeTotal: row.volume_total,
      issued: row.issued,
      escrow: row.escrow,
      updatedAt: row.updated_at,
      marketBestPrice,
      status,
      deltaIsk,
      suggestedRelistPrice,
    };
  });

  res.json({
    connected: true,
    characterName: session.character_name,
    orders,
  });
});
