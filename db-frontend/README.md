# DB Frontend

Angular 17 Anwendung, die gegen eine bereits auf Railway deployte DB_API spricht. Das Projekt bringt einen einfachen API-Explorer mit, ueber den sich beliebige Requests gegen die konfigurierbare Basis-URL absetzen lassen.

## Voraussetzungen
- Node.js >= 20.12 (empfohlen 20.19 fuer Angular CLI 17)
- npm (wird mit Node installiert)

## Installation
```bash
npm install
```

## Entwicklung
```bash
npm run dev
```
Der Dev-Server laeuft auf `http://localhost:4200`. Die Entwicklungsbasis-URL fuer API-Calls steht in `src/environments/environment.development.ts`.

## Produktion / Preview
```bash
npm run preview
```
Kompiliert die App (`npm run build`) und startet anschliessend den Express-Server (`npm start`).

## Railway Deploy
1. Passe `src/environments/environment.ts` an und hinterlege die Railway-URL deiner DB_API.
2. Setze in Railway als *Build Command* `npm run build` und als *Start Command* `npm start`.
3. Railway stellt zur Laufzeit `PORT` bereit, der Express-Server (`server.mjs`) nutzt diesen automatisch.
4. Optional: Lege Railway-Environment-Variablen fuer spaetere Anpassungen an und baue die App neu, falls sich die Basis-URL aendert.

## Projektstruktur (Auszug)
- `src/environments/` - Build-spezifische Einstellungen (API-Basis-URL fuer Dev/Prod)
- `src/app/core/services/api.service.ts` - Zentrale HTTP-Kommunikation (basierend auf `API_BASE_URL`)
- `src/app/features/home/home.component.*` - API-Explorer-UI
- `server.mjs` - Express-Server fuer Railway/Produktion

## Naechste Schritte
- Komponenten fuer konkrete Endpunkte deiner DB_API anlegen
- Authentifizierung (z. B. Token) in `home.component.ts` via Header-Feld hinterlegen
- Tests erweitern (`npm test`) und ggf. E2E-Setup hinzufuegen
