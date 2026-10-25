import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("mep_pm.db");

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

const defaultPassword = "ChangeMe123!";
const defaultHash = hashPassword(defaultPassword);
const now = new Date().toISOString();

// 1. Get or create primary project
let project: any = db.prepare("SELECT * FROM projects LIMIT 1").get();
if (!project) {
  const projId = crypto.randomUUID();
  db.prepare("INSERT INTO projects (id, name, client, status, start_date, end_date, budget) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(projId, "Skyline Heights MEP Package", "Apex Real Estate Ltd", "Active", "2026-01-15", "2027-06-30", 4500000);
  project = db.prepare("SELECT * FROM projects WHERE id=?").get(projId);
}
console.log("Project:", project.name, `(${project.id})`);

// 2. Ensure a Construction Site exists with GPS coordinates
let site: any = db.prepare("SELECT * FROM sites WHERE project_id=? LIMIT 1").get(project.id);
if (!site) {
  const siteId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sites (id, project_id, name, address, city, country, latitude, longitude, geofence_radius_m, geofence_warning_radius_m, timezone, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    siteId,
    project.id,
    "Tower A - Commercial Core Site",
    "Plot 42 Financial District",
    "Dubai",
    "UAE",
    25.2048,
    55.2708,
    150,
    200,
    "Asia/Dubai",
    "Active",
    now
  );
  site = db.prepare("SELECT * FROM sites WHERE id=?").get(siteId);
}
console.log("Site:", site.name, `(GPS: ${site.latitude}, ${site.longitude})`);

// 3. Define all 10 enterprise access layers
const rolesToCreate = [
  { username: "admin", name: "Executive Administrator", role: "Admin", email: "admin@fieldhub.internal", trade: null, company: "Main MEP Contractor Ltd" },
  { username: "pm", name: "David Sterling (PM)", role: "ProjectManager", email: "pm@fieldhub.internal", trade: "General MEP", company: "Main MEP Contractor Ltd" },
  { username: "site_engineer", name: "Kiran Patel (Site Eng)", role: "SiteEngineer", email: "engineer@fieldhub.internal", trade: "Electrical", company: "Main MEP Contractor Ltd" },
  { username: "commercial", name: "Sarah Jenkins (QS)", role: "CommercialManager", email: "commercial@fieldhub.internal", trade: "Commercial & Cost", company: "Main MEP Contractor Ltd" },
  { username: "qaqc", name: "Marcus Thorne (QA/QC)", role: "QAQC", email: "qaqc@fieldhub.internal", trade: "Quality Assurance", company: "Main MEP Contractor Ltd" },
  { username: "safety", name: "Elena Ramos (HSE)", role: "SafetyOfficer", email: "safety@fieldhub.internal", trade: "Health & Safety", company: "Main MEP Contractor Ltd" },
  { username: "consultant", name: "Dr. Alistair Vance (Consultant)", role: "Consultant", email: "consultant@apexengineering.com", trade: "Building Services", company: "Apex Engineering Consultants" },
  { username: "subcontractor", name: "Apex Thermal Solutions", role: "Subcontractor", email: "subcontractor@apexthermal.com", trade: "HVAC", company: "Apex Thermal Solutions LLC" },
  { username: "client", name: "Jonathan Ward (Client Rep)", role: "Client", email: "client@apexrealestate.com", trade: "Client Management", company: "Apex Real Estate Ltd" },
  { username: "worker", name: "Alex Kumar (Electrician)", role: "Worker", email: "worker@fieldhub.internal", trade: "Electrical", company: "Main MEP Contractor Ltd" }
];

for (const u of rolesToCreate) {
  const existing: any = db.prepare("SELECT id FROM users WHERE username=?").get(u.username);
  const userId = existing ? existing.id : crypto.randomUUID();
  if (existing) {
    db.prepare(`
      UPDATE users SET name=?, role=?, email=?, trade=?, company=?, password_hash=?, must_change_password=0, status=?
      WHERE id=?
    `).run(u.name, u.role, u.email, u.trade, u.company, defaultHash, "Active", userId);
  } else {
    db.prepare(`
      INSERT INTO users (id, username, name, role, email, trade, company, password_hash, must_change_password, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(userId, u.username, u.name, u.role, u.email, u.trade, u.company, defaultHash, "Active", now);
  }

  // Ensure project membership
  db.prepare(`
    INSERT OR REPLACE INTO project_memberships (user_id, project_id, access_role, active)
    VALUES (?, ?, ?, 1)
  `).run(userId, project.id, u.role === "Admin" ? "Owner" : "Member");

  // If Worker role, also register in workers table for GPS Punch Clock
  if (u.role === "Worker") {
    const workerRecord: any = db.prepare("SELECT id FROM workers WHERE user_id=?").get(userId);
    const workerId = workerRecord ? workerRecord.id : crypto.randomUUID();
    if (!workerRecord) {
      db.prepare(`
        INSERT INTO workers (id, project_id, site_id, user_id, name, employee_id, trade, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(workerId, project.id, site.id, userId, u.name, "EMP-1042", u.trade, "Active", now);
    } else {
      db.prepare(`UPDATE workers SET project_id=?, site_id=?, name=?, trade=?, status=? WHERE id=?`)
        .run(project.id, site.id, u.name, u.trade, "Active", workerId);
    }

    // Worker assignment
    db.prepare(`
      INSERT OR REPLACE INTO worker_assignments (id, worker_id, project_id, site_id, role_on_site, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), workerId, project.id, site.id, "Lead Journeyman", "Active", now);
  }
}

console.log(`Seeded all ${rolesToCreate.length} enterprise access layers successfully!`);
