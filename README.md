# JITA IV // MONOLITH — EVE Online Jita 4-4 Trade Terminal

A local full-stack station-trading terminal for **Jita IV - Moon 4 - Caldari Navy Assembly Plant** (`location_id = 60003760`, region `The Forge = 10000002`), featuring a custom **Obsidian Telemetry** React frontend and a persisted **Node.js + SQLite** backend (`node:sqlite`).

## Features

- **SQLite Persistence & Official CCP SDE**: Persists orders, 7-day snapshots, 30-day history, presets, and watchlists locally in `data/jita-terminal.db`, streaming item names & market groups directly from CCP's official SDE (`https://sde.evetech.net/tranquility/latest`).
- **Smart Auto-Sync & Incremental 30d History**: Configurable background sync interval (default 15 minutes) plus prioritized 24h-cached 30-day market history backfills to calculate 7d vs 30d volume and price trends.
- **Station Trading Constraints & Anomaly Guards**:
  - Min/Max Profit % (ROI), Min/Max Price (supports `100k`, `5m`, `1.5b` shorthand), Buy/Sell price basis
  - Min Daily ISK Volume, Min Daily Units, Max 2% Competing Orders, Max 1h Order Updates
  - EVE Market Group filters & quick excludes (`Ship SKINs`, `Apparel`, `Blueprints & Reactions`)
  - Automated risk flags for minimum-volume traps, inflated asks vs 30d average, depressed bids, extreme margins (>150% ROI), low trading days, and monopoly sellers
- **Tactical Item Detail Drawer**: Interactive Profit & Tax Simulator with EVE 4-significant-figure tick stepping (`+1T` / `-1T`), quick-copy prices, Recharts 30-day price & volume chart, and live split Buy/Sell order depth.
- **Persisted Watchlist & Filter Presets**: Bookmark items with target buy/sell prices and notes, and save/load custom filter presets in SQLite.
- **Optional EVE Online SSO (OAuth2 + PKCE)**: Works immediately with public ESI and configurable fees, or connect an EVE character to auto-import `Accounting` / `Broker Relations` skills, Caldari standings, and track `BEST` vs `UNDERCUT` / `OUTBID` Jita orders.

## Quick Start

```bash
# Install workspace dependencies
npm install

# Start backend (:3001) and React frontend (:5173) together
npm run dev
```

Open `http://localhost:5173` and click **Initialize SDE & Sync Jita 4-4** (or **Sync Jita** in the top bar).

### Production Build & Single-Port Serve

```bash
npm run build
npm start
```

Then open `http://localhost:3001` (Express serves both the API and the built React app).

### Tests

```bash
npm test
```

## Optional EVE SSO Setup

1. Create an application at <https://developers.eveonline.com>.
2. Set the Callback URL to `http://localhost:3001/api/auth/callback`.
3. Add the following scopes:
   - `esi-skills.read_skills.v1`
   - `esi-characters.read_standings.v1`
   - `esi-markets.read_character_orders.v1`
4. Paste your **Client ID** in **Settings** (or in the **My Orders** tab) and click **Connect via EVE Online SSO**. No client secret is needed because PKCE (`S256`) is used.

## Legal & EVE Online Copyright

© 2026 Fenris Creations. All rights reserved. EVE Online®, Fenris Creations™, the EVE logo, and all associated logos, images, artwork, screenshots, characters, vehicles, storylines, world facts, and Static Data Export (SDE) / ESI game data are the intellectual property and trademarks of Fenris Creations (formerly CCP hf.). All other trademarks are the property of their respective owners.

This application is an independent, non-commercial third-party tool using the official EVE Swagger Interface (ESI), official Static Data Export (SDE), and EVE Online Single Sign-On (SSO) in accordance with the Fenris Creations (EVE Online) Developer License Agreement, and is not affiliated with or endorsed by Fenris Creations.
