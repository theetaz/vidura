import PgBoss from "pg-boss";
import { env } from "../env.ts";

export const PROCESS_VIDEO_QUEUE = "process-video";

let bossPromise: Promise<PgBoss> | null = null;

// A single pg-boss instance backed by the app database (schema "pgboss").
export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    const boss = new PgBoss({
      connectionString: env.databaseUrl,
      schema: "pgboss",
      // Long videos translate for several minutes; give jobs room and retry
      // transient failures with backoff.
      retryLimit: 2,
      retryBackoff: true,
    });
    boss.on("error", (error) => console.error("pg-boss error", error));
    bossPromise = boss.start();
  }

  return bossPromise;
}

export type ProcessVideoJobData = {
  jobId: string;
  videoId: string;
  ownerId: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: Array<{ startMs?: number; endMs?: number; text?: string }>;
  forceRetranslate: boolean;
  rebuildContext: boolean;
  forceRefetchTranscript: boolean;
};

export async function enqueueProcessVideo(data: ProcessVideoJobData) {
  const boss = await getBoss();
  await boss.send(PROCESS_VIDEO_QUEUE, data, {
    // One active run per processing_jobs row; a re-enqueue replaces the wait.
    singletonKey: data.jobId,
    expireInMinutes: 30,
  });
}
