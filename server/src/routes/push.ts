import { Hono } from "hono";
import { sql } from "../db.ts";
import { env } from "../env.ts";
import { type AppEnv, requireUser } from "../middleware/auth.ts";

export const push = new Hono<AppEnv>();

// Public: the VAPID key the browser needs to create a subscription.
push.get("/vapid-key", (c) => {
  return c.json({ publicKey: env.pushEnabled ? env.vapidPublicKey : null });
});

push.use("*", requireUser);

type SubscribeBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

// POST /api/push/subscribe — save (or refresh) this device's subscription.
push.post("/subscribe", async (c) => {
  const ownerId = c.get("user").id;
  const body = await c.req.json().catch(() => null) as SubscribeBody | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return c.json({ error: "Invalid subscription" }, 400);
  }

  await sql`
    insert into push_subscription (owner_id, endpoint, p256dh, auth)
    values (${ownerId}, ${endpoint}, ${p256dh}, ${auth})
    on conflict (endpoint) do update set
      owner_id = excluded.owner_id, p256dh = excluded.p256dh, auth = excluded.auth
  `;
  return c.json({ ok: true });
});

// POST /api/push/unsubscribe — remove this device's subscription.
push.post("/unsubscribe", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { endpoint?: string }
    | null;
  if (body?.endpoint) {
    await sql`delete from push_subscription where endpoint = ${body.endpoint}`;
  }
  return c.json({ ok: true });
});
