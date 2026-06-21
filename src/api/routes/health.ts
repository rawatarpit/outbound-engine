import { Router } from "express";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const router = Router();

router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/ping", (_req, res) => {
  res.send("pong");
});

export { router as healthRouter };
