import { create } from "zustand";
import { activeVideo, videos, type Video } from "@/features/videos/data";

export type AppView = "library" | "add" | "watch" | "chat" | "settings";

type AppState = {
  currentView: AppView;
  libraryVideos: Video[];
  selectedVideo: Video;
  subtitleEnabled: boolean;
  subtitleSize: number;
  subtitleOpacity: number;
  addVideo: (video: Video) => void;
  setCurrentView: (view: AppView) => void;
  selectVideo: (videoId: string) => void;
  setSubtitleEnabled: (enabled: boolean) => void;
  setSubtitleSize: (value: number) => void;
  setSubtitleOpacity: (value: number) => void;
};

export const useAppStore = create<AppState>((set) => ({
  currentView: "library",
  libraryVideos: videos,
  selectedVideo: activeVideo,
  subtitleEnabled: true,
  subtitleSize: 20,
  subtitleOpacity: 82,
  addVideo: (video) =>
    set((state) => {
      const existingVideo = state.libraryVideos.find(
        (libraryVideo) =>
          libraryVideo.youtubeVideoId === video.youtubeVideoId ||
          libraryVideo.id === video.id
      );

      if (existingVideo) {
        return {
          selectedVideo: existingVideo,
          currentView: "watch",
        };
      }

      return {
        libraryVideos: [video, ...state.libraryVideos],
        selectedVideo: video,
      };
    }),
  setCurrentView: (currentView) => set({ currentView }),
  selectVideo: (videoId) =>
    set((state) => ({
      selectedVideo:
        state.libraryVideos.find((video) => video.id === videoId) ??
        activeVideo,
      currentView: "watch",
    })),
  setSubtitleEnabled: (subtitleEnabled) => set({ subtitleEnabled }),
  setSubtitleSize: (subtitleSize) => set({ subtitleSize }),
  setSubtitleOpacity: (subtitleOpacity) => set({ subtitleOpacity }),
}));
