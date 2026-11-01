const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('mep_pm.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
console.log("TABLES IN DB:", tables.sort());
