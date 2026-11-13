import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { assertConfig, config } from "./config.js";
import { closeDb } from "./db.js";
import { registerAuth } from "./auth.js";
import { HttpError } from "./lib/http.js";
import { startJobs, stopJobs } from "./jobs.js";
import accountRoutes from "./routes/accounts.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import clientRoutes from "./routes/client.js";
import meRoutes from "./routes/me.js";
import publicRoutes from "./routes/public.js";

assertConfig();

const app = Fastify({
  trustProxy: config.trustProxy,
  bodyLimit: 256 * 1024,
  logger: {
    level: config.isProd ? "info" : "debug",
    redact: ["req.headers.cookie", "req.headers.authorization"],
  },
  disableRequestLogging: config.isProd,
});

await app.register(helmet, {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      // ddragon (champions/icons), discord avatars, and user-chosen https wallpapers
      "img-src": ["'self'", "data:", "https:"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: config.isProd ? { maxAge: 15552000 } : false,
});
await app.register(compress, { threshold: 1024 });
await app.register(cookie);
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

registerAuth(app);

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, code: err.code });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: err.message });
  req.log.error(err);
  return reply.code(500).send({ error: "Something went wrong on our side" });
});

await app.register(publicRoutes);
await app.register(authRoutes);
await app.register(meRoutes);
await app.register(accountRoutes);
await app.register(adminRoutes);
await app.register(clientRoutes);

// Serve the built SPA (single container: same origin, no CORS, no cross-site cookies).
const indexHtml = path.join(config.webDist, "index.html");
const hasWeb = fs.existsSync(indexHtml);
if (hasWeb) {
  await app.register(fastifyStatic, {
    root: config.webDist,
    wildcard: false,
    index: false,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header("Cache-Control", "public, max-age=31536000, immutable");
      else res.header("Cache-Control", "public, max-age=3600");
    },
  });
  // fastify-static with wildcard:false registers routes for files present at boot.
} else {
  app.log.warn(`No web build at ${config.webDist}; API only (run the Vite dev server for the UI).`);
}

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api/") || req.method !== "GET" || !hasWeb) {
    return reply.code(404).send({ error: "Not found" });
  }
  // SPA fallback
  reply.header("Cache-Control", "no-cache");
  return reply.sendFile("index.html");
});

startJobs();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopJobs();
  await app.close();
  closeDb();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: config.host });
