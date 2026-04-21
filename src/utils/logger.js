import pino from "pino";
import fs from "fs";
import path from "path";

const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Determine if we should use pretty printing (local development, not in GitHub Actions)
const isDev =
  !process.env.GITHUB_ACTIONS && process.env.NODE_ENV !== "production";

const targets = [
  {
    target: "pino/file",
    level: "info",
    options: { destination: "./logs/app.log" },
  },
  {
    target: "pino/file",
    level: "error",
    options: { destination: "./logs/error.log" },
  },
];

if (isDev) {
  // Only try to use pino-pretty if in development
  try {
    targets.push({
      target: "pino-pretty",
      level: "info",
      options: { colorize: true, translateTime: true },
    });
  } catch (err) {
    // If pino-pretty not installed, fallback to console
    console.warn("pino-pretty not installed, using default console output");
  }
} else {
  // In production/GitHub Actions, just log to console in JSON format
  targets.push({
    target: "pino/file",
    level: "info",
    options: { destination: 1 },
  }); // stdout
}

const transport = pino.transport({ targets });
export const logger = pino(transport);
