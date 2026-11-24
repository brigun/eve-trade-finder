# JITA IV // MONOLITH — EVE Online Jita 4-4 Trade Terminal

A standalone desktop and local web station-trading terminal for **Jita IV - Moon 4 - Caldari Navy Assembly Plant** (`location_id = 60003760`, region `The Forge = 10000002`), featuring an **Obsidian Telemetry** React interface and a persisted **Node.js + SQLite** backend (`node:sqlite`).

Available as a **1-click downloadable desktop app** for Windows, macOS, and Linux (no Node.js, Git, or terminal required), or runnable directly from source.

---

## Download & Install (Desktop App)

Download the installer for your operating system from the [Latest GitHub Release](https://github.com/brigun/eve-trade-finder/releases/latest):

| Platform | Download File | How to Install & Launch |
|---|---|---|
| **Windows (x64)** | `Jita-Monolith-Setup-<version>-win-x64.exe` | Double-click to run the standard Setup wizard. On first launch, if Windows SmartScreen says *"Windows protected your PC"*, click **More info → Run anyway** (standard for unsigned third-party apps). |
| **macOS (Apple Silicon / Intel)** | `Jita-Monolith-<version>-mac-arm64.dmg` (M1–M4)<br>`Jita-Monolith-<version>-mac-x64.dmg` (Intel) | Open the `.dmg` and drag **JITA IV Monolith** into **Applications**. On first launch, if Gatekeeper warns the app is from an unidentified developer, **Right-click → Open** (or allow it in **System Settings → Privacy & Security → Open Anyway**). |
| **Linux (x64)** | `Jita-Monolith-<version>-linux-x64.AppImage` | Make executable (`chmod +x Jita-Monolith-*.AppImage`) and run `./Jita-Monolith-*.AppImage` (or double-click in your file manager). |

### First-Time Setup (Desktop App)

1. Launch **JITA IV Monolith** from your Desktop or Start Menu / Applications.
2. Click **Initialize SDE & Sync Jita 4-4** (or **Sync Jita** in the top bar) to download CCP's official item catalog and live Jita 4-4 market orders (~19,000+ items).
3. Open **Settings** to enter your character's **Broker Fee %** and **Sales Tax %** (or open **My Orders** and click **Connect via EVE Online SSO** in 1 click to auto-import skills and standings without creating an EVE Developers account).

### Data Storage & Updating

Your local SQLite database (`jita-terminal.db`)—including your **Watchlist**, **Filter Presets**, **Settings**, and **30-day market history cache**—is stored in your user profile directory, separate from the installed application files:

- **Windows:** `%APPDATA%\JITA IV Monolith\data\jita-terminal.db`
- **macOS:** `~/Library/Application Support/JITA IV Monolith/data/jita-terminal.db`
- **Linux:** `~/.config/JITA IV Monolith/data/jita-terminal.db`

Installing a newer version preserves your database and saved settings automatically.

---

## Features

- **SQLite Persistence & Official CCP SDE**: Persists orders, snapshots, 30-day history, presets, and watchlists locally, streaming item names, volumes, and market group hierarchies directly from CCP's official SDE (`https://sde.evetech.net/tranquility/latest`).
- **Multi-Factor Trade Score (0–100) & Best Recommended Trade**: Ranks trades by combining net profit & ROI %, 7-day sales volume, order book depth, active competitor count / 1h undercut churn, momentum, and risk penalties, highlighting top opportunities right above the scanner.
- **Curated Segment Filters & Constraints**:
  - One-click presets including **Best Ammo**, **Best Modules**, **Best PI Materials**, **Best Components**, and **Best PI & Components** (default `10%` Min Profit %)
  - Nested **Market Segment** tree picker, Min/Max Profit %, Min/Max Price (`100k`, `5m`, `1.5b` shorthand), Buy/Sell price basis, Min Daily ISK Volume, Min Daily Units, Max 2% Competing Orders, Max 1h Order Updates
  - **Quick Excludes** (`Ship SKINs`, `Apparel`, `Blueprints & Reactions`) and automated **Anomaly Guards** (min-volume traps, inflated asks vs 30d avg, depressed bids, >150% spreads, low history, single-seller monopolies)
- **Smart Search Lookup & Breaking-Filter Highlighting**: Type or paste any item name or Type ID into the search bar to look up its live Jita evaluations even if it is currently unprofitable or misses numeric/toggle constraints—breaking filters are highlighted directly in `FilterBar` with one-click relaxation, while Quick Excludes remain active so skins, apparel, and blueprints stay filtered out unless toggled on. You can inspect or **★ Watchlist** any item directly.
- **Tactical Item Detail Drawer**:
  - Interactive **Station Profit Simulator** with American comma-formatted inputs (`123,456,789`), shorthand support (`10m`), and EVE 4-significant-figure tick stepping (`+1T` / `-1T`)
  - **The Forge Price Candlesticks & Buy/Sell Flow** chart (daily Low–High wicks, Prev Avg → Avg bodies, inferred Buy-Order vs Sell-Order volume split, **Two-Sided / Sell-Order Heavy / Buy-Order Heavy** verdicts, `14d` / `30d` / `45d` windows, plus Line view toggle)
  - **Game Info ("Show Info") Modal** showing EVE Online in-game item descriptions, clickable `showinfo:` links, ship/drone/structure renders, physical specs, Required Skills, and searchable Dogma attributes
  - Live split Jita 4-4 Buy/Sell order book with minimum-fill warnings and your active order markers
- **Ask Neon (Optional AI Trade Advisor)**: Consult Google Gemini or a local Ollama / OpenAI-compatible model to return Top 3 grounded trade picks for your session budget and style (`Quick Flip`, `Balanced`, `Overnight`) with selectable model and thinking level.
- **Persisted Watchlist & Optional EVE Online SSO (OAuth2 + PKCE)**: Works out of the box with public ESI, or connect an EVE character to auto-import `Accounting` / `Broker Relations` skills, Caldari standings, and track `BEST` vs `UNDERCUT` / `OUTBID` Jita orders.

---

## Optional Setup Guides

### Optional EVE SSO Setup

1. Open the **My Orders** tab in the app and click **Connect via EVE Online SSO**.
2. Sign in on official `login.eveonline.com` (OAuth2 + PKCE `S256` with the app's built-in public Client ID — no client secret or EVE Developers account registration is needed).
3. Approve the read-only scopes:
   - `esi-skills.read_skills.v1`
   - `esi-characters.read_standings.v1`
   - `esi-markets.read_character_orders.v1`

Your character's OAuth tokens, skills, standings, and active Jita orders are stored **only** in your local SQLite database (`jita-terminal.db`).

#### Using Your Own EVE Developers App (Optional)

If you are self-hosting or prefer your own EVE Developers application:

1. Create an application at <https://developers.eveonline.com> with Callback URL `http://localhost:3001/api/auth/callback` and the three read-only scopes above.
2. Enter your **Client ID** under **Settings → EVE Online SSO Configuration** and click **Save SSO Settings** (use **Reset to Built-In** anytime to restore the default).

### Optional Ask Neon (AI Advisor) Setup

- **Google Gemini API:** Open **Settings → Ask Neon AI Advisor**, select **Google Gemini API**, paste your Gemini API key (`GEMINI_API_KEY`), choose your preferred model, and save. Your key is stored only in your local SQLite `settings` table (or read from the `GEMINI_API_KEY` environment variable when running from source) and sent only to the configured LLM API.
- **Local LLM (Ollama / OpenAI-Compatible):** Select **OpenAI-Compatible / Local Ollama** and point Base URL to your local server (default `http://localhost:11434/v1`) — no external API key required.

---

## Development & Building from Source

Requires **Node.js 22.14+** (Node 24 recommended) with built-in `node:sqlite`.

```bash
# Install workspace dependencies
npm install

# Start backend (:3001) and React frontend (:5173) together
npm run dev
```

Then open `http://localhost:5173`.

### Production Build, Single-Port Web Serve & Tests

```bash
# Run all server unit tests
npm test

# Build server and client
npm run build

# Serve API + built React app on http://localhost:3001
npm start
```

### Local Desktop Build

```bash
# Launch Electron desktop app locally from compiled build
npm run desktop:dev

# Package Windows NSIS installer into release/
npm run desktop:build:win
```

### Automated Cross-Platform GitHub Releases (`.exe`, `.dmg`, `.AppImage`)

Pushing any `v*` tag triggers [.github/workflows/release.yml](.github/workflows/release.yml) to run tests, build the app on `windows-latest`, `macos-latest`, and `ubuntu-latest`, and publish installers to GitHub Releases:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## Legal & EVE Online Copyright

© 2026 Fenris Creations. All rights reserved. EVE Online®, Fenris Creations™, the EVE logo, and all associated logos, images, artwork, screenshots, characters, vehicles, storylines, world facts, and Static Data Export (SDE) / ESI game data are the intellectual property and trademarks of Fenris Creations (formerly CCP hf.). All other trademarks are the property of their respective owners.

This application is an independent, non-commercial third-party tool using the official EVE Swagger Interface (ESI), official Static Data Export (SDE), and EVE Online Single Sign-On (SSO) in accordance with the Fenris Creations (EVE Online) Developer License Agreement, and is not affiliated with or endorsed by Fenris Creations.
