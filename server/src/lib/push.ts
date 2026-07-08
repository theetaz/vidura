// Web Push delivery. Sends a notification to every device a user has subscribed,
// and prunes subscriptions the push service reports as gone (404/410).

import webpush from "web-push";
import { sql } from "../db.ts";
import { env } from "../env.ts";

let configured = false;
function ensureConfigured(): boolean {
  if (!env.pushEnabled) return false;
  if (!configured) {
    webpush.setVapidDetails(
      env.vapidSubject,
      env.vapidPublicKey,
      env.vapidPrivateKey,
    );
    configured = true;
  }
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

export async function sendPushToOwner(
  ownerId: string,
  payload: PushPayload,
): Promise<void> {
  if (!ensureConfigured()) return;

  const subs = await sql<SubRow[]>`
    select id, endpoint, p256dh, auth
    from push_subscription where owner_id = ${ownerId}
  `;
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      // 404/410 = subscription expired or unsubscribed → drop it.
      if (status === 404 || status === 410) {
        await sql`delete from push_subscription where id = ${sub.id}`.catch(
          () => {},
        );
      } else {
        console.error("push send failed", status ?? error);
      }
    }
  }));
}
