# DB Frontend

Angular-Frontend fuer deine Railway DB_API.

## Struktur
- `db-frontend/` - Angular 17 Projekt mit API-Explorer und Express-Server fuer Railway
- `LICENSE` - MIT Lizenz

## Schnellstart
1. `cd db-frontend`
2. `npm install`
3. `npm start`

## Deployment (Railway)
- Build Command: `npm run build`
- Start Command: `npm run serve:dist`
- Passe `src/environments/environment.ts` vor dem Build an, damit die richtige API-URL gebundled wird.
