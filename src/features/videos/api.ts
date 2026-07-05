import type { TranscriptSegment, Video } from "@/features/videos/data";
import { supabase } from "@/lib/supabase";
import { LanguagesIcon } from "lucide-react";

type CreateVideoJobResponse = {
  video: {
    id: string;
    youtube_video_id: string;
    youtube_url: string;
    title: string;
    status: string;
    created_at: string;
  };
  job: {
    id: string;
    video_id: string;
    status: string;
    progress: number;
    created_at: string;
  };
};

type ProcessVideoJobResponse = {
  job: {
    id: string;
    status: string;
    progress: number;
  };
  video: {
    id: string;
    status: string;
  };
  translatedSegments: number;
};

export async function createVideoJob(input: {
  youtubeUrl: string;
  title?: string;
  targetLanguage?: string;
}) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await supabase.functions.invoke<CreateVideoJobResponse>(
    "create-video-job",
    {
      body: input,
    },
  );

  if (error) {
    throw error;
  }

  if (!data?.video || !data.job) {
    throw new Error("The create-video-job function returned an invalid response.");
  }

  return data;
}

export async function processVideoJob(input: {
  jobId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: TranscriptSegment[];
}) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await supabase.functions.invoke<ProcessVideoJobResponse>(
    "process-video-job",
    {
      body: {
        jobId: input.jobId,
        sourceLanguage: input.sourceLanguage ?? "en",
        targetLanguage: input.targetLanguage ?? "si-LK",
        segments: input.segments.map((segment, index) => ({
          startMs: segment.startMs ?? timestampToMilliseconds(segment.time),
          endMs: segment.endMs ??
            timestampToMilliseconds(segment.time) + 4500,
          text: segment.original,
          index,
        })),
      },
    },
  );

  if (error) {
    throw error;
  }

  if (!data?.job || !data.video) {
    throw new Error("The process-video-job function returned an invalid response.");
  }

  return data;
}

export function mapCreatedVideoToLibraryVideo(
  response: CreateVideoJobResponse,
): Video {
  return {
    id: response.video.id,
    youtubeVideoId: response.video.youtube_video_id,
    youtubeUrl: response.video.youtube_url,
    title: response.video.title,
    channel: "Pending transcript import",
    category: "Imported",
    duration: "--:--",
    progress: response.job.status === "queued" ? "Queued" : response.job.status,
    status: "queued",
    accent: "bg-vidura-sky",
    Icon: LanguagesIcon,
  };
}

function timestampToMilliseconds(timestamp: string) {
  const [minutes = "0", seconds = "0"] = timestamp.split(":");
  return (Number(minutes) * 60 + Number(seconds)) * 1000;
}
