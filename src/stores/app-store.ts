import { create } from "zustand";
import { activeVideo, videos, type Video } from "@/features/videos/data";

export type AppView = "library" | "add" | "watch" | "chat" | "settings";

type AppState = {
  currentView: AppView;
  selectedVideo: Video;
  subtitleEnabled: boolean;
  subtitleSize: number;
  subtitleOpacity: number;
  setCurrentView: (view: AppView) => void;
  selectVideo: (videoId: string) => void;
  setSubtitleEnabled: (enabled: boolean) => void;
  setSubtitleSize: (value: number) => void;
  setSubtitleOpacity: (value: number) => void;
};

export const useAppStore = create<AppState>((set) => ({
  currentView: "library",
  selectedVideo: activeVideo,
  subtitleEnabled: true,
  subtitleSize: 20,
  subtitleOpacity: 82,
  setCurrentView: (currentView) => set({ currentView }),
  selectVideo: (videoId) =>
    set({
      selectedVideo: videos.find((video) => video.id === videoId) ?? activeVideo,
      currentView: "watch",
    }),
  setSubtitleEnabled: (subtitleEnabled) => set({ subtitleEnabled }),
  setSubtitleSize: (subtitleSize) => set({ subtitleSize }),
  setSubtitleOpacity: (subtitleOpacity) => set({ subtitleOpacity }),
}));

