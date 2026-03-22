import express from 'express';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = join(__dirname, 'dist', 'db-frontend');
const browserDir = join(distRoot, 'browser');
const distFolder = existsSync(join(browserDir, 'index.html')) ? browserDir : distRoot;
const indexFile = join(distFolder, 'index.html');
const port = process.env.PORT || 8080;
const apiBaseUrl = process.env.API_BASE_URL || '/api';

if (!existsSync(indexFile)) {
  console.error(`Build output not found. Expected ${indexFile}. Run "npm run build" first.`);
  process.exit(1);
}

function escapeForScript(value) {
  return JSON.stringify(String(value));
}

app.get('/env.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.__env = Object.assign({}, window.__env, { API_BASE_URL: ${escapeForScript(apiBaseUrl)} });`);
});

app.use(express.static(distFolder, { index: false, maxAge: '1y' }));

app.use((_req, res) => {
  res.sendFile(indexFile);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
