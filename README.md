# Northstar GM

Northstar GM is a private decision-support app for NHL simulation leagues. The current build scores players and draft picks, flags extension decisions, highlights roster weaknesses, and suggests trade targets.

The app now supports two server-side data modes:

- `demo`: uses the checked-in sample roster and league pool.
- `live-file`: reads a local JSON cache file that matches the normalized dashboard input shape.

## Run locally

Install dependencies and start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Configure the data source

Create a `.env.local` file from `.env.example`.

```env
NHL_SIM_DATA_SOURCE=demo
# NHL_SIM_LIVE_DATA_PATH=C:\absolute\path\to\live-dashboard.json
```

### Demo mode

Use this for UI and valuation work without any external data setup.

```env
NHL_SIM_DATA_SOURCE=demo
```

### Live-file mode

Use this when you have scraped or exported league data and want the app to consume it through the new server-side adapter.

```env
NHL_SIM_DATA_SOURCE=live-file
NHL_SIM_LIVE_DATA_PATH=C:\absolute\path\to\live-dashboard.json
```

If `NHL_SIM_LIVE_DATA_PATH` is omitted, the app looks for `data/live-dashboard.json` in the repo root.

An example payload lives at `data/live-dashboard.example.json`. The required top-level shape is:

```json
{
	"teamName": "Quebec Voyageurs",
	"roster": [],
	"leagueTargets": [],
	"draftPicks": []
}
```

If live-file loading fails or the file is invalid, the app falls back to demo data and shows the reason in the UI.

## Import normalized data

The app can now accept a normalized dashboard payload over HTTP and write it to the live cache file.

Send a `POST` request to:

```text
/api/dashboard
```

with the same JSON shape used by `data/live-dashboard.example.json`.

### PowerShell example

```powershell
$payload = Get-Content .\data\live-dashboard.example.json -Raw
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/dashboard -ContentType 'application/json' -Body $payload
```

The response includes:

- whether the import succeeded
- the saved roster, target, and pick counts
- the resolved live file path
- a warning if the app is still configured to use demo mode

For the imported data to drive the UI, set:

```env
NHL_SIM_DATA_SOURCE=live-file
```

The import route invalidates the dashboard cache and revalidates `/` so the next page load picks up the latest file-backed data.

## API route

The normalized dashboard data is also exposed through:

```text
/api/dashboard
```

That route returns the computed snapshot plus source metadata, which makes it a stable handoff point for future scraping and import flows.

## PlayHockeyOnline player import

The player API you provided is authenticated. An unauthenticated request currently returns `{"message":"Unauthenticated"}`.

Northstar GM now includes a server-side PHO player import route that can fetch that API with credentials and cache the raw payload locally for mapping work.

### Configure PHO access

Add one of these to `.env.local`:

```env
PHO_PLAYERS_API_URL=https://playhockeyonline.com/api/players
PHO_TEAMS_API_URL=https://playhockeyonline.com/api/teams
PHO_DRAFT_PICKS_API_URL=https://playhockeyonline.com/api/draft_picks
PHO_AUTH_COOKIE=laravel_session=...; XSRF-TOKEN=...
# optional if your setup uses bearer auth instead
# PHO_AUTH_BEARER_TOKEN=...
# optional if the endpoint requires an explicit XSRF header
# PHO_XSRF_TOKEN=...
```

### Inspect importer config

```text
GET /api/import/playhockeyonline/players
```

That returns which auth inputs are currently configured, without echoing the secret values.

### Fetch and cache the raw player payload

```text
POST /api/import/playhockeyonline/players
```

If the request succeeds, the raw API response is written to `data/playhockeyonline-players.raw.json` by default. The response also includes:

- HTTP status and content type
- whether the payload is an array or wrapped object
- likely collection path such as `$`, `data`, or `players`
- a sample of top-level keys and first-player keys

### PowerShell example

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/import/playhockeyonline/players
```

This route does not normalize the PHO payload into `DashboardInput` yet. It solves the next blocking step: authenticated acquisition and local inspection of the real player dataset so the mapper can be implemented against actual fields instead of guessed ones.

## PlayHockeyOnline dashboard import

Northstar GM can now fetch the full paginated PHO player pool, map it into the normalized dashboard shape, and write the result to the live dashboard cache.

Optional team label override in `.env.local`:

```env
PHO_CURRENT_TEAM_NAME=Current Team
```

The importer identifies your roster using the PHO `belongs_to_current_team` flag from the authenticated API response.

### Import PHO players into the live dashboard

```text
POST /api/import/playhockeyonline/dashboard
```

This route will:

- fetch every page from the PHO player API
- fetch team metadata from the PHO teams API so `team_id` values map to real team names
- fetch PHO draft picks and keep the picks owned by your current team
- keep the raw combined payload in `data/playhockeyonline-players.raw.json`
- map the PHO stats bag into the existing dashboard `Player` model
- use `belongs_to_current_team` to split your roster from the league pool
- map owned draft picks into the dashboard `DraftPick` model using a neutral slot fallback when PHO does not expose pick rank
- write the normalized result to the live dashboard cache file

### PowerShell example

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/import/playhockeyonline/dashboard
```

This is a first-pass mapping. Team names for non-roster players now come from the PHO teams API, and owned draft picks now come from the PHO draft-picks API. Your own roster label still uses `PHO_CURRENT_TEAM_NAME` so you can override it locally. Because the PHO draft-picks response does not populate `rank`, projected slot currently falls back to a neutral round midpoint.

## Trade history scoring weight

Past approved PHO trades can now nudge player and pick scores. The trade signal is blended into the base valuation model with an environment setting:

```env
NHL_SIM_TRADE_SIGNAL_WEIGHT=0.15
```

- `0` disables the trade-history adjustment entirely.
- `0.15` is the default blend.
- `1` makes the score follow the trade-derived signal as much as possible.

The current weight is also shown on the `/trades` page.

## PlayHockeyOnline trade refresh

Trade history can be refreshed independently of the full dashboard import.

### Inspect trade importer config

```text
GET /api/import/playhockeyonline/trades
```

This returns the configured PHO trades API URL, cache path, and which non-secret auth inputs are present.

### Refresh the cached PHO trade log

```text
POST /api/import/playhockeyonline/trades
```

This route will:

- fetch the paginated PHO trades API
- write the raw response to `data/playhockeyonline-trades.raw.json`
- revalidate the main dashboard, players, teams, and trades pages
- fall back to the existing cached trade file if PHO responds with `Too Many Attempts` or `429`

The `/trades` page now includes a manual refresh button that calls this route and shows whether the refresh succeeded, fell back to cached data, or failed.

## Validation

Run the project checks with:

```bash
npm run lint
npm run build
```

In this workspace terminal, Node may not be on `PATH`. If that happens in PowerShell, prepend `C:\Program Files\nodejs` to `PATH` before running project scripts.

## What is implemented now

- Shared normalized dashboard types
- Pure valuation layer that accepts injected inputs
- Server-side data loader with demo/live-file switching
- Cached live-file adapter with validation and fallback
- Dashboard API route at `/api/dashboard`

## What comes next

The next implementation slice should replace the live JSON file with a real ingestion pipeline:

1. authenticated sim-league scraping
2. normalization into the `DashboardInput` shape
3. optional cache refresh route or import action
