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

if (!existsSync(indexFile)) {
  console.error(`Build output not found. Expected ${indexFile}. Run "npm run build" first.`);
  process.exit(1);
}


app.use(express.static(distFolder, { index: false, maxAge: '1y' }));

app.use((_req, res) => {
  res.sendFile(indexFile);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
