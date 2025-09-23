# DB Frontend

Single-page Angular application that talks to the Railway-hosted DB_API and ships with an Express server for production hosting.

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

## Project Highlights
- `src/environments/` - Environment-specific API base URLs for dev/prod builds.
- `src/app/core/services/api.service.ts` - Centralised HTTP client that uses the injected base URL.
- `src/app/core/services/stats.service.ts` - Cached access to `/stats/overview` (20 minute TTL).
- `src/app/features/dashboard/dashboard.component.*` - Overview dashboard consuming `/stats/overview` with translations and refresh control.
- `src/app/features/home/home.component.*` - Lightweight API explorer UI for ad-hoc requests.
- `server.mjs` - Express server that serves the built SPA and performs a build-output check on startup.

Have fun building on top of it!
