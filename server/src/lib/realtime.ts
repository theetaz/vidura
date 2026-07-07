import { sql } from "../db.ts";

export type ChangeEvent = {
  table: string;
  videoId: string | null;
  op: string;
};

type Subscriber = { ownerId: string; send: (event: ChangeEvent) => void };

// A single Postgres LISTEN connection fans changes out to all connected SSE
// clients, scoped to the owner named in the notification payload.
const subscribers = new Set<Subscriber>();
let listenStarted = false;

async function ensureListening() {
  if (listenStarted) return;
  listenStarted = true;

  await sql.listen("vidura_changes", (payload) => {
    try {
      const data = JSON.parse(payload) as {
        table: string;
        op: string;
        owner_id: string | null;
        video_id: string | null;
      };
      if (!data.owner_id) return;

      for (const sub of subscribers) {
        if (sub.ownerId === data.owner_id) {
          sub.send({ table: data.table, videoId: data.video_id, op: data.op });
        }
      }
    } catch {
      // Ignore malformed payloads.
    }
  });
}

export async function addSubscriber(sub: Subscriber): Promise<() => void> {
  await ensureListening();
  subscribers.add(sub);
  return () => {
    subscribers.delete(sub);
  };
}
