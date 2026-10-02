import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(currentDir, '../data');
const databasePath = process.env.DATABASE_PATH ?? resolve(dataDir, 'bookmarks.sqlite');

export const db = createDatabase(databasePath);
