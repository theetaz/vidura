import { getBoss, PROCESS_VIDEO_QUEUE, type ProcessVideoJobData } from "./jobs/boss.ts";
import { runProcessVideoJob } from "./jobs/process-video.ts";

// Background worker: consumes the process-video queue. Run as a separate
// process from the API (bun run worker) so long translations never block
// request handling.
const boss = await getBoss();

await boss.createQueue(PROCESS_VIDEO_QUEUE);

await boss.work<ProcessVideoJobData>(
  PROCESS_VIDEO_QUEUE,
  { batchSize: 2 },
  async ([job]) => {
    if (!job) return;
    console.log(`process-video: job ${job.data.jobId} started`);
    await runProcessVideoJob(job.data);
    console.log(`process-video: job ${job.data.jobId} done`);
  },
);

console.log("Vidura worker ready, consuming", PROCESS_VIDEO_QUEUE);
