const Database = require('better-sqlite3');
const db = new Database('database.sqlite');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
console.log('Tables:', tables.join(', '));
