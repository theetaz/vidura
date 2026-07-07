import { Hono } from "hono";
import { sql } from "../db.ts";
import { type AppEnv, requireUser } from "../middleware/auth.ts";
import { parseYouTubeUrl } from "../lib/youtube.ts";
import { enqueueProcessVideo } from "../jobs/boss.ts";

// Two audiences share this router:
//   * /token endpoints — called by the Vidura app with the session cookie.
//   * /transcript — called by the browser userscript on youtube.com, which
//     can't send the cross-site cookie, so it authenticates with a bearer
//     token (GET /token issues it).
export const ingest = new Hono<AppEnv>();

type TokenRow = { owner_id: string; token: string };

function newToken(): string {
  return "vid_" +
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
}

// --- Token management (session-authenticated) ---

ingest.get("/token", requireUser, async (c) => {
  const ownerId = c.get("user").id;
  const [row] = await sql<TokenRow[]>`
    insert into ingest_token (owner_id, token) values (${ownerId}, ${newToken()})
    on conflict (owner_id) do update set owner_id = excluded.owner_id
    returning owner_id, token
  `;
  return c.json({ token: row?.token ?? null });
});

ingest.post("/token/rotate", requireUser, async (c) => {
  const ownerId = c.get("user").id;
  const [row] = await sql<TokenRow[]>`
    insert into ingest_token (owner_id, token) values (${ownerId}, ${newToken()})
    on conflict (owner_id) do update set token = excluded.token, created_at = now()
    returning owner_id, token
  `;
  return c.json({ token: row?.token ?? null });
});

// --- Transcript ingest (bearer-token-authenticated) ---

type IngestBody = {
  youtubeUrl?: string;
  youtubeVideoId?: string;
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  targetLanguage?: string;
  segments?: Array<{ startMs?: number; endMs?: number; text?: string }>;
};

ingest.post("/transcript", async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return c.json({ error: "Missing bearer token" }, 401);

  const [tokenRow] = await sql<Array<{ owner_id: string }>>`
    update ingest_token set last_used_at = now()
    where token = ${token} returning owner_id
  `;
  if (!tokenRow) return c.json({ error: "Invalid ingest token" }, 401);
  const ownerId = tokenRow.owner_id;

  const body = await c.req.json().catch(() => null) as IngestBody | null;

  const parsed = parseYouTubeUrl(
    body?.youtubeUrl ?? `https://www.youtube.com/watch?v=${body?.youtubeVideoId ?? ""}`,
  );
  if (!parsed) return c.json({ error: "Missing or invalid YouTube video id/url" }, 400);

  const segments = (body?.segments ?? [])
    .map((s) => ({
      startMs: Math.max(0, Math.floor(Number(s.startMs) || 0)),
      endMs: Math.max(1, Math.floor(Number(s.endMs) || 0)),
      text: (s.text ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text);
  if (segments.length === 0) {
    return c.json({ error: "No transcript segments were provided" }, 400);
  }

  const targetLanguage = body?.targetLanguage ?? "si-LK";
  const title = body?.title?.trim().slice(0, 180) ||
    `YouTube lesson ${parsed.videoId}`;
  const durationMs = Number.isFinite(body?.durationMs)
    ? Math.max(0, Math.floor(body!.durationMs!))
    : null;

  const [video] = await sql<Array<{ id: string; status: string }>>`
    insert into videos (owner_id, youtube_video_id, youtube_url, title,
      channel_title, thumbnail_url, duration_ms, target_language, status)
    values (${ownerId}, ${parsed.videoId}, ${parsed.canonicalUrl}, ${title},
      ${body?.channelTitle?.trim() || null},
      ${body?.thumbnailUrl?.trim() ||
    `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`},
      ${durationMs}, ${targetLanguage}, 'queued')
    on conflict (owner_id, youtube_video_id) do update set
      youtube_url = excluded.youtube_url,
      title = excluded.title,
      channel_title = coalesce(excluded.channel_title, videos.channel_title),
      thumbnail_url = coalesce(excluded.thumbnail_url, videos.thumbnail_url),
      duration_ms = coalesce(excluded.duration_ms, videos.duration_ms),
      status = 'queued', error_message = null
    returning id, status
  `;
  if (!video) return c.json({ error: "Failed to create video" }, 500);

  // A fresh transcript from the userscript supersedes any stored one.
  await sql`delete from transcript_segments where video_id = ${video.id}`;

  const [job] = await sql<Array<{ id: string }>>`
    insert into processing_jobs (owner_id, video_id, kind, status, progress, metadata)
    values (${ownerId}, ${video.id}, 'process_video', 'queued', 0,
      ${sql.json({
    stage: "queued",
    requested_language_code: targetLanguage,
    transcript_source: "userscript",
  })})
    returning id
  `;
  if (!job) return c.json({ error: "Failed to create job" }, 500);

  await enqueueProcessVideo({
    jobId: job.id,
    videoId: video.id,
    ownerId,
    sourceLanguage: "en",
    targetLanguage,
    segments,
    forceRetranslate: false,
    rebuildContext: false,
    forceRefetchTranscript: false,
  });

  return c.json({ ok: true, videoId: video.id, segmentCount: segments.length });
});
