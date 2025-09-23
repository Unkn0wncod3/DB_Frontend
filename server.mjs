import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const distFolder = join(__dirname, 'dist', 'db-frontend');
const indexFile = join(distFolder, 'index.html');
const port = process.env.PORT || 8080;

app.use(express.static(distFolder, { index: false, maxAge: '1y' }));

app.use((_req, res) => {
  res.sendFile(indexFile);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
