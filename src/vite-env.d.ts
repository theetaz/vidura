/// <reference types="vite/client" />

type YouTubePlayerEvent = {
  data: number;
};

type YouTubePlayerInstance = {
  destroy: () => void;
};

type YouTubePlayerOptions = {
  width?: string | number;
  height?: string | number;
  videoId: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: () => void;
    onError?: (event: YouTubePlayerEvent) => void;
  };
};

type YouTubeIframeApi = {
  Player: new (
    element: HTMLElement | string,
    options: YouTubePlayerOptions,
  ) => YouTubePlayerInstance;
};

interface Window {
  YT?: YouTubeIframeApi;
  onYouTubeIframeAPIReady?: () => void;
}
