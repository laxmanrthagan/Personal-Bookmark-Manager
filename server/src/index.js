import { createApp } from './app.js';
import { db } from './db.js';

const port = Number(process.env.PORT ?? 3001);
const app = createApp({ database: db });

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Bookmark Manager API listening at http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
