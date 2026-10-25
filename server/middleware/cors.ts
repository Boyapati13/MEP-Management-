import express, { Express, Request, Response, NextFunction } from "express";

export function configureAppMiddleware(app: Express): void {
  app.use(express.json({ limit: "150mb" }));
  app.use(express.urlencoded({ extended: true, limit: "150mb" }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && err.type === "entity.too.large") {
      res.status(413).json({
        error: "This file is too large to upload. The maximum attachment size is approximately 110MB - try compressing the file or splitting it into smaller documents."
      });
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        error: "Could not read the request - the data may be corrupted. Please try again."
      });
      return;
    }
    next(err);
  });
}
