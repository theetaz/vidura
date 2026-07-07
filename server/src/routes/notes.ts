import { Hono } from "hono";
import { sql } from "../db.ts";
import { type AppEnv, requireUser } from "../middleware/auth.ts";

export const notes = new Hono<AppEnv>();
notes.use("*", requireUser);

type NoteRow = {
  id: string;
  video_id: string;
  timestamp_ms: number;
  content: string;
  created_at: string;
};

function mapNote(note: NoteRow) {
  return {
    id: note.id,
    videoId: note.video_id,
    timestampMs: note.timestamp_ms,
    content: note.content,
    createdAt: note.created_at,
  };
}

// GET /api/notes?videoId=...
notes.get("/", async (c) => {
  const ownerId = c.get("user").id;
  const videoId = c.req.query("videoId");
  if (!videoId) return c.json([]);

  const rows = await sql<NoteRow[]>`
    select id, video_id, timestamp_ms, content, created_at from video_notes
    where video_id = ${videoId} and owner_id = ${ownerId}
    order by timestamp_ms asc
  `;
  return c.json(rows.map(mapNote));
});

// POST /api/notes
notes.post("/", async (c) => {
  const ownerId = c.get("user").id;
  const body = await c.req.json().catch(() => null) as
    | { videoId?: string; timestampMs?: number; content?: string }
    | null;

  const content = body?.content?.trim();
  if (!body?.videoId || !content) {
    return c.json({ error: "videoId and content are required" }, 400);
  }

  // Ensure the video belongs to the user before attaching a note.
  const [video] = await sql<Array<{ id: string }>>`
    select id from videos where id = ${body.videoId} and owner_id = ${ownerId}
  `;
  if (!video) return c.json({ error: "Video not found" }, 404);

  const [note] = await sql<NoteRow[]>`
    insert into video_notes (owner_id, video_id, timestamp_ms, content)
    values (${ownerId}, ${body.videoId},
      ${Math.max(0, Math.floor(body.timestampMs ?? 0))}, ${content})
    returning id, video_id, timestamp_ms, content, created_at
  `;
  return c.json(mapNote(note!), 201);
});

// DELETE /api/notes/:id
notes.delete("/:id", async (c) => {
  const ownerId = c.get("user").id;
  await sql`
    delete from video_notes where id = ${c.req.param("id")} and owner_id = ${ownerId}
  `;
  return c.json({ ok: true });
});
