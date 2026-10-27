import { Express } from "express";
import { registerAuthController } from "../controllers/authController";
import { registerUserController } from "../controllers/userController";
import { registerOperationsController } from "../controllers/operationsController";
import { registerAiDrawingController } from "../controllers/aiDrawingController";
import { registerCommercialController } from "../controllers/commercialController";
import { registerWorkforceController } from "../controllers/workforceController";
import { registerControlTowerController } from "../controllers/controlTowerController";
import { registerCrudController } from "../controllers/crudController";
import { registerProgressRoutes } from "./progressRoutes";
import { registerOctoRoutes } from "./octoRoutes";
import { db } from "../db/connection";
import { authRequired, hasProjectAccess } from "../middleware/auth";
import { writeAudit } from "../services/auditService";

export function registerAllServerRoutes(app: Express): void {
  registerAuthController(app);
  registerUserController(app);
  registerOperationsController(app);
  registerAiDrawingController(app);
  registerCommercialController(app);
  registerWorkforceController(app);
  registerControlTowerController(app);
  registerCrudController(app);
  registerProgressRoutes(app, db, authRequired, hasProjectAccess, writeAudit);
  registerOctoRoutes(app, db, authRequired, hasProjectAccess, writeAudit);
}

