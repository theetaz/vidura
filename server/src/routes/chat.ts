import { Hono } from "hono";
import { sql } from "../db.ts";
import { env } from "../env.ts";
import { type AppEnv, requireUser } from "../middleware/auth.ts";
import { resolveAgent } from "../lib/agents.ts";
import { buildLibraryContext, buildVideoContext, fetchChatSettings } from "../lib/chat.ts";
import { requestOpenRouterText, streamOpenRouter } from "../lib/openrouter.ts";

export const chat = new Hono<AppEnv>();
chat.use("*", requireUser);

const chatModel = env.openRouterChatModel || env.openRouterModel;

type MessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    citation: typeof row.metadata?.citation === "string"
      ? row.metadata.citation
      : undefined,
  };
}

// GET /api/chat/sessions — library chat sessions (threads with no video).
chat.get("/sessions", async (c) => {
  const ownerId = c.get("user").id;
  const rows = await sql<
    Array<{ id: string; title: string | null; created_at: string; updated_at: string }>
  >`
    select id, title, created_at, updated_at from chat_threads
    where owner_id = ${ownerId} and video_id is null
    order by updated_at desc
  `;
  return c.json(rows.map((r) => ({
    id: r.id,
    title: r.title?.trim() || "New chat",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
});

// GET /api/chat/sessions/:threadId/messages
chat.get("/sessions/:threadId/messages", async (c) => {
  const ownerId = c.get("user").id;
  const rows = await sql<MessageRow[]>`
    select m.id, m.role, m.content, m.metadata, m.created_at
    from chat_messages m
    join chat_threads t on t.id = m.thread_id
    where m.thread_id = ${c.req.param("threadId")} and t.owner_id = ${ownerId}
      and m.role <> 'system'
    order by m.created_at asc
  `;
  return c.json(rows.map(mapMessage));
});

// GET /api/chat/messages?videoId=... — messages of a video's thread.
chat.get("/messages", async (c) => {
  const ownerId = c.get("user").id;
  const videoId = c.req.query("videoId");
  if (!videoId) return c.json([]);

  const rows = await sql<MessageRow[]>`
    select m.id, m.role, m.content, m.metadata, m.created_at
    from chat_messages m
    join chat_threads t on t.id = m.thread_id
    where t.owner_id = ${ownerId} and t.video_id = ${videoId}
      and m.role <> 'system'
    order by m.created_at asc
  `;
  return c.json(rows.map(mapMessage));
});

// PATCH /api/chat/sessions/:threadId — rename.
chat.patch("/sessions/:threadId", async (c) => {
  const ownerId = c.get("user").id;
  const body = await c.req.json().catch(() => null) as { title?: string } | null;
  const title = body?.title?.trim().slice(0, 80);
  if (!title) return c.json({ error: "title required" }, 400);

  await sql`
    update chat_threads set title = ${title}
    where id = ${c.req.param("threadId")} and owner_id = ${ownerId}
  `;
  return c.json({ ok: true });
});

// DELETE /api/chat/sessions/:threadId
chat.delete("/sessions/:threadId", async (c) => {
  const ownerId = c.get("user").id;
  await sql`
    delete from chat_threads where id = ${c.req.param("threadId")} and owner_id = ${ownerId}
  `;
  return c.json({ ok: true });
});

// POST /api/chat/send — streams an answer over SSE and persists the exchange.
chat.post("/send", async (c) => {
  const ownerId = c.get("user").id;
  const body = await c.req.json().catch(() => null) as
    | { question?: string; videoId?: string | null; threadId?: string | null }
    | null;

  const question = body?.question?.trim();
  if (!question) return c.json({ error: "question is required" }, 400);

  let videoId = body?.videoId ?? null;
  let threadId = body?.threadId ?? null;
  let isNewThread = false;

  if (threadId) {
    const [thread] = await sql<Array<{ video_id: string | null }>>`
      select video_id from chat_threads where id = ${threadId} and owner_id = ${ownerId}
    `;
    if (!thread) return c.json({ error: "Chat session not found" }, 404);
    videoId = thread.video_id;
  } else if (videoId) {
    const [video] = await sql<Array<{ id: string }>>`
      select id from videos where id = ${videoId} and owner_id = ${ownerId}
    `;
    if (!video) return c.json({ error: "Video not found" }, 404);
  }

  const settings = await fetchChatSettings(ownerId);
  const agent = resolveAgent(videoId ? "video" : "library", settings);

  if (!threadId) {
    threadId = videoId
      ? await ensureVideoThread(ownerId, videoId)
      : await createThread(ownerId, null);
    isNewThread = videoId ? false : true;
  }
  const activeThreadId = threadId;

  const history = await fetchRecentMessages(activeThreadId, agent.maxHistoryMessages);
  await sql`
    insert into chat_messages (thread_id, owner_id, role, content, metadata)
    values (${activeThreadId}, ${ownerId}, 'user', ${question},
      ${sql.json({ video_id: videoId })})
  `;

  const context = videoId
    ? await buildVideoContext(ownerId, videoId)
    : await buildLibraryContext(ownerId, question, agent.maxMatchedSegments);
  const systemPrompt = `${agent.instructions}\n\n${context.contextBlock}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      send({ type: "meta", threadId: activeThreadId, mode: videoId ? "video" : "library" });

      let answer = "";
      try {
        for await (
          const delta of streamOpenRouter({
            model: chatModel,
            temperature: agent.temperature,
            messages: [
              { role: "system", content: systemPrompt },
              ...history,
              { role: "user", content: question },
            ],
          })
        ) {
          answer += delta;
          send({ type: "delta", text: delta });
        }

        const trimmed = answer.trim();
        if (!trimmed) throw new Error("The chat model returned an empty answer");

        const [saved] = await sql<Array<{ id: string }>>`
          insert into chat_messages (thread_id, owner_id, role, content, metadata)
          values (${activeThreadId}, ${ownerId}, 'assistant', ${trimmed},
            ${sql.json({ video_id: videoId, mode: videoId ? "video" : "library" })})
          returning id
        `;

        if (isNewThread) {
          // Auto-title the new session in the background; failure is harmless.
          void generateThreadTitle({
            threadId: activeThreadId,
            titleInstructions: agent.titleInstructions,
            question,
            answer: trimmed,
          });
        }

        send({ type: "done", messageId: saved?.id ?? null, threadId: activeThreadId });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Chat response failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

async function ensureVideoThread(ownerId: string, videoId: string) {
  const [existing] = await sql<Array<{ id: string }>>`
    select id from chat_threads where owner_id = ${ownerId} and video_id = ${videoId}
    order by created_at asc limit 1
  `;
  if (existing) return existing.id;
  return createThread(ownerId, videoId);
}

async function createThread(ownerId: string, videoId: string | null) {
  const [thread] = await sql<Array<{ id: string }>>`
    insert into chat_threads (owner_id, video_id, title)
    values (${ownerId}, ${videoId}, ${videoId ? "Video chat" : null})
    returning id
  `;
  if (!thread) throw new Error("Could not create chat thread");
  return thread.id;
}

async function fetchRecentMessages(threadId: string, limit: number) {
  const rows = await sql<Array<{ role: "user" | "assistant"; content: string }>>`
    select role, content from chat_messages where thread_id = ${threadId}
      and role <> 'system' order by created_at desc limit ${limit}
  `;
  return rows.reverse().map((m) => ({ role: m.role, content: m.content }));
}

async function generateThreadTitle(input: {
  threadId: string;
  titleInstructions: string;
  question: string;
  answer: string;
}) {
  try {
    const raw = await requestOpenRouterText({
      model: chatModel,
      temperature: 0.2,
      timeoutMs: 20_000,
      messages: [
        { role: "system", content: input.titleInstructions },
        {
          role: "user",
          content:
            `First user message:\n${input.question.slice(0, 500)}\n\n` +
            `Assistant answer:\n${input.answer.slice(0, 500)}`,
        },
      ],
    });
    const title = raw.replaceAll('"', "").replaceAll("*", "").trim().slice(0, 80);
    if (title) {
      await sql`update chat_threads set title = ${title} where id = ${input.threadId}`;
    }
  } catch (error) {
    console.warn("Thread title generation failed", error);
  }
}
