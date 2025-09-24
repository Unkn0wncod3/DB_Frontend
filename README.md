# DB Frontend

Single-page Angular application that talks to the Railway-hosted DB_API and ships with an Express server for production hosting.

## Screenshots
> Drop your latest UI captures here (e.g. dashboard overview, entry list, entry detail). Keep each image on its own line for readability.

## Project Highlights
- `src/environments/` – Environment-specific API base URLs for dev/prod builds.
- `src/app/core/services/api.service.ts` – Centralised HTTP client that uses the injected base URL.
- `src/app/core/services/entry.service.ts` – Shared abstraction for GET/PATCH/DELETE plus paged list retrieval with search.
- `src/app/core/services/stats.service.ts` – Cached access to `/stats/overview` (20 minute TTL) powering dashboard insights.
- `src/app/features/dashboard/` – Overview dashboard with quick navigation to per-type lists and recent changes.
- `src/app/features/entry-list/` – Paginated entity browser with search and per-row navigation to the detail screen.
- `src/app/features/entry-detail/` – Standalone editor for individual records with PATCH/DELETE support and smart value parsing.
- `src/app/features/api-explorer/` – Lightweight API explorer UI for ad-hoc requests.
- `server.mjs` – Express server that serves the built SPA and performs a build-output check on startup.

## Feature Tour
### Dashboard
- Totals become navigable cards: each card opens the corresponding `/entries/:type` list.
- "Latest" and "Recent" widgets link straight to the entry detail pages when an ID is available.
- Manual refresh control keeps the cached overview data in sync with the API.

### Entry List
- Accessible at `/entries/:type` (e.g. `/entries/persons`).
- Provides search, adjustable page size (10/25/50/100), pagination controls, and per-row navigation to the detail view.
- Uses conservative query defaults (`page`, `pageSize`, `search`) to stay API-agnostic and efficient.

### Entry Detail
- Located at `/entries/:type/:id`.
- Renders all fields in an editable form, disabling IDs/timestamps to avoid accidental updates.
- Sends compact PATCH payloads that only include modified fields; DELETE redirects back to the dashboard.

## Repository Layout
- `db-frontend/` – Angular 17 workspace containing the SPA, API explorer feature, and Express server (`server.mjs`).
- `LICENSE` – MIT license file.

## Requirements
- Node.js >= 20.12 (Angular CLI 17 recommends >= 20.19)
- npm (bundled with Node.js)

## Getting Started
```bash
cd db-frontend
npm install
```

### Local Development
```bash
npm run dev
```
Runs the Angular dev server on `http://localhost:4200` with hot reload. The default development API base URL lives in `src/environments/environment.development.ts`.

### Production Preview (Express)
```bash
npm run preview
```
Builds the SPA and serves the compiled assets through `server.mjs` on `http://localhost:8080`. Use this to mirror the Railway setup locally.

## Railway Deployment
1. Set the API URL in `src/environments/environment.ts` before building (this value is baked into the bundle).
2. Configure the service in Railway with:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
3. Ensure your DB_API allows CORS requests from the frontend domain, e.g. `https://dbfrontend-production.up.railway.app`.

## Useful npm Scripts (root workspace)
The root `package.json` forwards commands to the Angular project:
- `npm run build` – Production build (`ng build`).
- `npm start` – Launches `server.mjs` (used by Railway).
- `npm run dev` – Angular dev server (alias for `ng serve`).
- `npm run preview` – Build + serve via Express.

Have fun building on top of it!
