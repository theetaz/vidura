import { Hono } from "hono";
import { type AppEnv, requireUser } from "../middleware/auth.ts";
import { addSubscriber } from "../lib/realtime.ts";

export const realtime = new Hono<AppEnv>();
realtime.use("*", requireUser);

// GET /api/realtime — Server-Sent Events stream of this user's data changes.
// The browser EventSource sends the session cookie automatically, so
// requireUser authenticates it. Clients invalidate queries on each event.
realtime.get("/", (c) => {
  const ownerId = c.get("user").id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({ type: "ready" });

      const unsubscribe = await addSubscriber({
        ownerId,
        send: (event) => send({ type: "change", ...event }),
      });

      // Heartbeat keeps the connection alive through proxies/idle timeouts.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 20_000);

      c.req.raw.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
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
