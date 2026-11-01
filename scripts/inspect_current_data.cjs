const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('mep_pm.db');

console.log("=== PROJECT COLS ===");
console.log(db.prepare('PRAGMA table_info(projects)').all().map(c => c.name));

console.log("\n=== PROJECTS ===");
console.log(db.prepare('SELECT * FROM projects').all());

console.log("\n=== USERS ===");
console.log(db.prepare('SELECT id, username, name, role, email, company FROM users').all());
