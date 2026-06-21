import express from "express";
import cors from "cors";
import pino from "pino";
import { env } from "../config/env";
import { authMiddleware } from "./middleware/auth";
import { chatRouter } from "./routes/chat";
import { healthRouter } from "./routes/health";
import { approvalRouter } from "./routes/approval";
import { savedQueriesRouter } from "./routes/saved-queries";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export function createApp(): express.Application {
  const app = express();

  const allowedOrigins = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(",").map((s) => s.trim())
    : "*";
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter);
  app.use("/api/chat", authMiddleware, chatRouter);
  app.use("/api/approval", authMiddleware, approvalRouter);
  app.use("/api/saved-queries", authMiddleware, savedQueriesRouter);

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error({ err }, "Unhandled API error");
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}

export async function startAPIServer(): Promise<void> {
  const app = createApp();
  const port = env.PORT;

  return new Promise((resolve) => {
    app.listen(port, () => {
      logger.info(`API server listening on port ${port}`);
      resolve();
    });
  });
}
