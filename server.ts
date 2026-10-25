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

  // Catch unmatched API routes - NEVER let API calls fall through to Vite SPA middleware
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  // Global Express error handler for API routes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api/")) {
      console.error(`API Error on ${req.method} ${req.path}:`, err);
      const statusCode = typeof err?.status === "number" ? err.status : 500;
      res.status(statusCode).json({
        error: err?.message || "Internal server error",
        code: err?.code || "INTERNAL_ERROR",
      });
      return;
    }
    next(err);
  });

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
