import express from "express";
import path from "path";
import { db, PORT } from "./server/db/connection";
import { initDb } from "./server/db/schema";
import { runMigrations } from "./server/db/migrations";
import { configureAppMiddleware } from "./server/middleware/cors";
import { registerAllServerRoutes } from "./server/routes";

try {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 10000;");
  initDb();
  runMigrations(db);
} catch (e: any) {
  console.error("Database initialization / migration runner warning:", e?.message);
}

async function startServer() {
  initDb();

  const app = express();
  configureAppMiddleware(app);
  registerAllServerRoutes(app);

  // Vite development middleware or static file serving
  if (process.env.NODE_ENV === "test") {
    // In test mode, omit Vite dev server to allow instantaneous startup
  } else if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
