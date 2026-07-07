import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.ts";
import { assertDbReady } from "./db.ts";
import { env } from "./env.ts";
import { videos } from "./routes/videos.ts";
import { notes } from "./routes/notes.ts";
import { settings } from "./routes/settings.ts";
import { chat } from "./routes/chat.ts";
import { realtime } from "./routes/realtime.ts";
import { ingest } from "./routes/ingest.ts";

const app = new Hono();

// Allow the frontend origin to call the API with session cookies.
app.use(
  "*",
  cors({
    origin: env.webOrigin,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", async (c) => {
  try {
    await assertDbReady();
    return c.json({ ok: true, db: "up", googleAuth: env.googleEnabled });
  } catch {
    return c.json({ ok: false, db: "down" }, 503);
  }
});

// better-auth owns everything under /api/auth/* (Google login, session, etc.)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/videos", videos);
app.route("/api/notes", notes);
app.route("/api/settings", settings);
app.route("/api/chat", chat);
app.route("/api/realtime", realtime);
app.route("/api/ingest", ingest);

// Serve the browser transcript userscript with the live API base injected, so
// Tampermonkey can install and auto-update it. Not CORS-restricted (fetched
// directly by the userscript manager, not by page JS).
app.get("/transcript-helper.user.js", async (c) => {
  const base = env.apiBaseUrl.replace(/\/$/, "");
  let host = "vidura-api.nipuntheekshana.com";
  try { host = new URL(base).host; } catch { /* keep default */ }
  const source = await Bun.file(
    new URL("../public/transcript-helper.user.js", import.meta.url),
  ).text();
  const body = source
    .replaceAll("__API_BASE__", base)
    .replaceAll("__API_HOST__", host);
  return new Response(body, {
    headers: { "Content-Type": "application/javascript; charset=utf-8" },
  });
});

// Explicit Bun.serve so idleTimeout is honored — SSE streams (chat + realtime)
// must outlive Bun's default 10s idle timeout. 255s is Bun's max, comfortably
// above the 20s realtime heartbeat.
Bun.serve({
  port: env.port,
  fetch: app.fetch,
  idleTimeout: 255,
});

console.log(`Vidura API listening on http://localhost:${env.port}`);
