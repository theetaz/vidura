import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  BadgeCheckIcon,
  BellIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  CirclePlayIcon,
  ClockIcon,
  Trash2Icon,
  DownloadIcon,
  FilterIcon,
  HomeIcon,
  LinkIcon,
  ListVideoIcon,
  MenuIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  UploadIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/features/auth/use-auth";
import {
  createVideoJob,
  deleteVideo,
  fetchChatMessages,
  fetchLibraryVideos,
  fetchVideoTranscript,
  sendVideoChatMessage,
  videoQueryKeys,
  type LibraryVideo,
} from "@/features/videos/api";
import { useVideoRealtime } from "@/features/videos/use-video-realtime";
import {
  languageOptions,
  quickPrompts,
  type TranscriptSegment,
} from "@/features/videos/data";
import { hasSupabaseConfig } from "@/lib/supabase";
import { fetchDevYouTubeVideoData, parseTranscriptFile } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import {
  buildYouTubeWatchUrl,
  isYouTubeVideoId,
  parseYouTubeUrl,
} from "@/lib/youtube";
import { useAppStore, type AppView } from "@/stores/app-store";
import {
  CartoonButton,
  MascotBubble,
  StickerCard,
  StickerPanel,
} from "@/components/vidura/cartoon";

const navItems: Array<{
  view: AppView;
  label: string;
  Icon: typeof HomeIcon;
  path: string;
}> = [
  { view: "library", label: "Library", Icon: HomeIcon, path: "/library" },
  { view: "add", label: "Add", Icon: PlusIcon, path: "/add" },
  { view: "watch", label: "Watch", Icon: CirclePlayIcon, path: "/watch" },
  { view: "chat", label: "Chats", Icon: MessageCircleIcon, path: "/chats" },
  { view: "settings", label: "Settings", Icon: SettingsIcon, path: "/settings" },
];

function App() {
  return (
    <TooltipProvider>
      <ViduraApp />
    </TooltipProvider>
  );
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function viewFromPath(pathname: string): AppView {
  if (pathname.startsWith("/add")) {
    return "add";
  }

  if (pathname.startsWith("/watch") || pathname.startsWith("/processing")) {
    return "watch";
  }

  if (pathname.startsWith("/chats")) {
    return "chat";
  }

  if (pathname.startsWith("/settings")) {
    return "settings";
  }

  return "library";
}

function navPathFor(view: AppView, selectedVideoId: string | null) {
  if (view === "watch" && selectedVideoId) {
    return `/watch/${selectedVideoId}`;
  }

  if (view === "chat" && selectedVideoId) {
    return `/chats/${selectedVideoId}`;
  }

  return navItems.find((item) => item.view === view)?.path ?? "/library";
}

let youtubeIframeApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve();
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Could not load YouTube player."));
    document.head.append(script);
  });

  return youtubeIframeApiPromise;
}

function ViduraApp() {
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const setSelectedVideoId = useAppStore((state) => state.setSelectedVideoId);
  const auth = useAuth();
  const videosQuery = useLibraryVideos(auth.configured && Boolean(auth.session));

  useVideoRealtime(auth.configured && Boolean(auth.session));

  useEffect(() => {
    if (!videosQuery.data) {
      return;
    }

    if (videosQuery.data.length === 0) {
      setSelectedVideoId(null);
      return;
    }

    const selectedVideoStillExists = videosQuery.data.some(
      (video) => video.id === selectedVideoId,
    );

    if (!selectedVideoStillExists) {
      setSelectedVideoId(videosQuery.data[0].id);
    }
  }, [selectedVideoId, setSelectedVideoId, videosQuery.data]);

  if (auth.loading) {
    return <LoadingScreen />;
  }

  if (auth.configured && !auth.session) {
    return <AuthScreen onSignIn={auth.signInWithGoogle} />;
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1760px] flex-col lg:flex-row">
        <DesktopSidebar />
        <main className="min-w-0 flex-1 px-4 pb-36 pt-4 sm:px-6 lg:px-6 lg:pb-7 xl:px-7">
          <TopBar />
          <Routes>
            <Route element={<Navigate replace to="/library" />} path="/" />
            <Route
              element={
                <LibraryScreen
                  error={videosQuery.error}
                  isPending={videosQuery.isPending}
                  videos={videosQuery.data ?? []}
                />
              }
              path="/library"
            />
            <Route element={<AddVideoScreen />} path="/add" />
            <Route element={<ProcessingRoute />} path="/processing/:videoId" />
            <Route
              element={<WatchScreen videos={videosQuery.data ?? []} />}
              path="/watch"
            />
            <Route
              element={<WatchScreen videos={videosQuery.data ?? []} />}
              path="/watch/:videoId"
            />
            <Route
              element={<ChatScreen standalone videos={videosQuery.data ?? []} />}
              path="/chats"
            />
            <Route
              element={<ChatScreen standalone videos={videosQuery.data ?? []} />}
              path="/chats/:videoId"
            />
            <Route element={<SettingsScreen />} path="/settings" />
            <Route element={<Navigate replace to="/library" />} path="*" />
          </Routes>
        </main>
        {auth.configured ? (
          <Button
            className="fixed right-4 top-4 z-40 hidden border-2 border-foreground bg-card lg:inline-flex"
            onClick={auth.signOut}
            size="sm"
            variant="outline"
          >
            Sign out
          </Button>
        ) : null}
        <MobileNav />
      </div>
    </div>
  );
}

function useLibraryVideos(enabled: boolean) {
  return useQuery({
    queryKey: videoQueryKeys.all,
    queryFn: fetchLibraryVideos,
    enabled,
    refetchInterval: (query) =>
      hasActiveVideoJob(query.state.data as LibraryVideo[] | undefined)
        ? 1_000
        : 15_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    staleTime: 0,
  });
}

function hasActiveVideoJob(videos: LibraryVideo[] | undefined) {
  return videos?.some((video) => {
    const jobStatus = video.latestJob?.status;

    return video.status !== "ready" || jobStatus === "queued" ||
      jobStatus === "running";
  }) ?? false;
}

function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <StickerCard className="w-full max-w-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <div className="size-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
          <p className="font-black">Loading Vidura...</p>
        </CardContent>
      </StickerCard>
    </main>
  );
}

function AuthScreen({
  onSignIn,
}: {
  onSignIn: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setSubmitting(true);
    setError("");

    try {
      await onSignIn();
      setSubmitting(false);
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Could not start Google sign in.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <StickerCard className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-lg border-2 border-foreground bg-vidura-sun shadow-[3px_3px_0_var(--vidura-ink)]">
              <BookOpenIcon />
            </div>
            <div>
              <CardTitle className="font-display text-4xl font-black">
                Vidura
              </CardTitle>
              <CardDescription>Sign in to save your lessons.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Field data-invalid={Boolean(error)}>
              <FieldLabel>Google account</FieldLabel>
              <FieldDescription className="font-bold text-foreground/60">
                Continue with Google to save your video library and chats.
              </FieldDescription>
              {error ? (
                <FieldDescription className="font-bold text-destructive">
                  {error}
                </FieldDescription>
              ) : null}
            </Field>
            <CartoonButton disabled={submitting} onClick={handleSignIn} type="button">
              <span className="grid size-6 place-items-center rounded-full border-2 border-foreground bg-card font-black">
                G
              </span>
              {submitting ? "Opening Google..." : "Continue with Google"}
              <ChevronRightIcon data-icon="inline-end" />
            </CartoonButton>
          </div>
        </CardContent>
      </StickerCard>
    </main>
  );
}

function TopBar() {
  const location = useLocation();
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const currentView = viewFromPath(location.pathname);
  const title = {
    library: "Library",
    add: "Add video",
    watch: "Watch",
    chat: "Chat",
    settings: "Settings",
  }[currentView];

  return (
    <header className="mb-4 flex items-center justify-between gap-3 lg:hidden">
      <div>
        <p className="font-display text-3xl font-black leading-none tracking-normal">
          {title}
        </p>
        <p className="text-sm font-medium text-foreground/55">
          Learn better, one video at a time.
        </p>
      </div>
      <Sheet>
        <SheetTrigger asChild>
          <Button className="vidura-icon-button" size="icon-lg" variant="outline">
            <MenuIcon />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent className="border-2 border-foreground bg-background" side="left">
          <SheetHeader>
            <SheetTitle className="font-display text-3xl font-black">
              Vidura
            </SheetTitle>
            <SheetDescription>
              Your playful Sinhala study companion.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4">
            {navItems.map(({ view, label, Icon }) => (
              <Button
                asChild
                className="justify-start"
                key={view}
                variant={currentView === view ? "default" : "ghost"}
              >
                <NavLink to={navPathFor(view, selectedVideoId)}>
                  <Icon data-icon="inline-start" />
                  {label}
                </NavLink>
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function DesktopSidebar() {
  const location = useLocation();
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const currentView = viewFromPath(location.pathname);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[216px] shrink-0 border-r-2 border-foreground bg-background px-4 py-5 lg:block 2xl:w-[224px]">
      <div className="flex h-full flex-col gap-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="grid size-12 place-items-center rounded-lg border-2 border-foreground bg-vidura-sun shadow-[3px_3px_0_var(--vidura-ink)]">
              <BookOpenIcon />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-3xl font-black leading-none tracking-normal">
                Vidura
              </h1>
              <p className="truncate text-[0.72rem] font-semibold text-foreground/55">
                Sinhala video study
              </p>
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-1.5">
          {navItems.map(({ view, label, Icon }) => (
            <Button
              asChild
              className={cn(
                "h-9 justify-start rounded-md border-2 border-transparent px-2 text-sm font-black",
                currentView === view &&
                  "border-foreground bg-vidura-mint text-foreground shadow-[3px_3px_0_var(--vidura-ink)] hover:bg-vidura-mint"
              )}
              key={view}
              variant={currentView === view ? "secondary" : "ghost"}
            >
              <NavLink to={navPathFor(view, selectedVideoId)}>
                <Icon data-icon="inline-start" />
                {label}
              </NavLink>
            </Button>
          ))}
        </nav>
        <div className="rounded-lg border-2 border-foreground bg-card p-3 shadow-[3px_3px_0_var(--vidura-ink)]">
          <div className="mb-2 flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-md border-2 border-foreground bg-vidura-sun">
              <BadgeCheckIcon />
            </div>
            <div>
              <p className="text-sm font-black leading-none">Level 3</p>
              <p className="text-[0.68rem] font-bold text-foreground/55">
                Study sync
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs font-semibold leading-snug text-foreground/65">
            Library updates live from Supabase.
          </p>
        </div>
      </div>
    </aside>
  );
}

function MobileNav() {
  const location = useLocation();
  const selectedVideoId = useAppStore((state) => state.selectedVideoId);
  const currentView = viewFromPath(location.pathname);

  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 rounded-lg border-2 border-foreground bg-card px-2 py-1.5 shadow-[4px_4px_0_var(--vidura-ink)] lg:hidden">
      <div className="grid grid-cols-5 gap-1">
        {navItems.map(({ view, label, Icon }) => (
          <Button
            asChild
            className={cn(
              "h-12 flex-col gap-0.5 rounded-md px-1 text-[0.66rem] font-bold",
              currentView === view &&
                "border-2 border-foreground bg-vidura-mint text-foreground hover:bg-vidura-mint"
            )}
            key={view}
            variant="ghost"
          >
            <NavLink to={navPathFor(view, selectedVideoId)}>
              <Icon data-icon="inline-start" />
              {label}
            </NavLink>
          </Button>
        ))}
      </div>
    </nav>
  );
}

function LibraryScreen({
  videos,
  isPending,
  error,
}: {
  videos: LibraryVideo[];
  isPending: boolean;
  error: Error | null;
}) {
  const [category, setCategory] = useState("All");
  const selectVideo = useAppStore((state) => state.selectVideo);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteVideoMutation = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });
    },
  });
  const filteredVideos = useMemo(
    () =>
      category === "All"
        ? videos
        : videos.filter((video) => video.category === category),
    [category, videos]
  );
  const categoryOptions = useMemo(
    () => ["All", ...Array.from(new Set(videos.map((video) => video.category)))],
    [videos],
  );
  const learningStats = useMemo(
    () => [
      { label: "Videos processed", value: videos.length.toString() },
      {
        label: "Ready",
        value: videos.filter((video) => video.status === "ready").length.toString(),
      },
      {
        label: "Processing",
        value: videos.filter((video) => video.status !== "ready").length.toString(),
      },
    ],
    [videos],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="hidden items-end justify-between gap-4 lg:flex">
        <div>
          <h2 className="font-display text-5xl font-black tracking-normal">
            Library
          </h2>
          <p className="text-base font-medium text-foreground/60">
            Pick up where your translated lessons stopped.
          </p>
        </div>
        <SearchTools />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          className="justify-start overflow-x-auto"
          onValueChange={(value) => value && setCategory(value)}
          type="single"
          value={category}
        >
          {categoryOptions.map((item) => (
            <ToggleGroupItem
              className="rounded-md border-2 border-foreground bg-card data-[state=on]:bg-vidura-mint"
              key={item}
              value={item}
            >
              {item}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="lg:hidden">
          <SearchTools compact />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          {isPending ? (
            <StickerCard>
              <CardContent className="p-4 font-black">Loading videos...</CardContent>
            </StickerCard>
          ) : null}
          {error ? (
            <StickerCard className="bg-vidura-coral">
              <CardContent className="p-4 font-black">
                Could not load library: {error.message}
              </CardContent>
            </StickerCard>
          ) : null}
          {!isPending && !error && filteredVideos.length === 0 ? (
            <StickerCard>
              <CardContent className="p-5">
                <h3 className="font-display text-3xl font-black">No videos yet</h3>
                <p className="mt-1 text-sm font-semibold text-foreground/60">
                  Add a YouTube link to start your first Sinhala study session.
                </p>
              </CardContent>
            </StickerCard>
          ) : null}
          {filteredVideos.map((video) => (
            <StickerCard
              className="cursor-pointer transition-transform hover:-translate-y-0.5"
              key={video.id}
              onClick={() => {
                selectVideo(video.id);
                navigate(`/watch/${video.id}`);
              }}
            >
              <CardContent className="grid gap-3 p-3 sm:grid-cols-[164px_1fr_auto] sm:items-center">
                <div
                  className={cn(
                    "relative flex aspect-video items-center justify-center overflow-hidden rounded-md border-2 border-foreground text-foreground",
                    video.accent
                  )}
                >
                  {video.thumbnailUrl ? (
                    <img
                      alt=""
                      className="size-full object-cover"
                      src={video.thumbnailUrl}
                    />
                  ) : (
                    <video.Icon className="size-12" />
                  )}
                  <Badge className="absolute bottom-2 right-2 border border-foreground bg-card text-foreground">
                    {video.duration}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-black leading-tight sm:text-lg">
                        {video.title}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-foreground/60">
                        {video.channel}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          onClick={(event) => event.stopPropagation()}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <MoreHorizontalIcon />
                          <span className="sr-only">Open video menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onClick={() => {
                              selectVideo(video.id);
                              navigate(`/watch/${video.id}`);
                            }}
                          >
                            Open video
                          </DropdownMenuItem>
                          <DropdownMenuItem>Download subtitles</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => deleteVideoMutation.mutate(video.id)}
                          >
                            Delete video
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-foreground/65">
                    <Badge variant="secondary">{video.category}</Badge>
                    <span>{video.latestJob?.status ?? video.status}</span>
                    <span>
                      {(video.latestJob?.metadata.stage as string | undefined) ??
                        "created"}
                    </span>
                  </div>
                </div>
                <Badge
                  className={cn(
                    "w-fit border-2 border-foreground",
                    video.status === "ready"
                      ? "bg-vidura-mint text-foreground"
                      : "bg-vidura-sun text-foreground"
                  )}
                >
                  {video.progress}
                </Badge>
              </CardContent>
            </StickerCard>
          ))}
        </div>
        <aside className="flex flex-col gap-4">
          <StickerPanel title="Keep learning">
            <div className="grid grid-cols-3 gap-2 xl:grid-cols-1">
              {learningStats.map((stat) => (
                <div
                  className="rounded-md border-2 border-foreground bg-vidura-cream p-3"
                  key={stat.label}
                >
                  <p className="font-display text-2xl font-black">
                    {stat.value}
                  </p>
                  <p className="text-xs font-bold text-foreground/60">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </StickerPanel>
          <MascotBubble tone="sky">
            Add a difficult video, translate it once, and keep asking questions
            as you study.
          </MascotBubble>
        </aside>
      </div>
    </section>
  );
}

function SearchTools({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <InputGroup className={cn("border-2 border-foreground bg-card", compact && "h-10")}>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search videos..." />
      </InputGroup>
      <Button className="vidura-icon-button" size="icon-lg" variant="outline">
        <FilterIcon />
        <span className="sr-only">Filter videos</span>
      </Button>
    </div>
  );
}

function AddVideoScreen() {
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState("");
  const [transcriptFileName, setTranscriptFileName] = useState("");
  const [transcriptSegments, setTranscriptSegmentsState] = useState<
    TranscriptSegment[]
  >([]);
  const [transcriptError, setTranscriptError] = useState("");
  const setSelectedVideoId = useAppStore((state) => state.setSelectedVideoId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleStartProcessing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedUrl = parseYouTubeUrl(youtubeUrl);

    if (!parsedUrl) {
      setUrlError("Paste a valid YouTube video, Shorts, embed, or youtu.be link.");
      return;
    }

    setIsSubmitting(true);
    setSubmitStep("Preparing video...");

    try {
      let segmentsForJob = transcriptSegments;
      let devMetadata: {
        title?: string;
        channelTitle?: string;
        thumbnailUrl?: string;
      } = {};

      if (import.meta.env.DEV && segmentsForJob.length === 0) {
        setSubmitStep("Fetching transcript locally...");
        const videoData = await fetchDevYouTubeVideoData(parsedUrl.videoId);
        segmentsForJob = videoData.segments;
        devMetadata = videoData.metadata;
      }

      if (import.meta.env.DEV && segmentsForJob.length === 0) {
        throw new Error("No transcript segments were found for this video.");
      }

      setSubmitStep("Creating processing job...");
      const response = await createVideoJob({
        youtubeUrl: parsedUrl.canonicalUrl,
        title: devMetadata.title,
        channelTitle: devMetadata.channelTitle,
        thumbnailUrl: devMetadata.thumbnailUrl,
        targetLanguage: "si-LK",
        segments: segmentsForJob,
      });

      setSelectedVideoId(response.video.id);
      await queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });

      setUrlError("");
      navigate(`/processing/${response.video.id}`);
    } catch (createError) {
      setUrlError(
        createError instanceof Error
          ? createError.message
          : "Could not create the video job.",
      );
    } finally {
      setIsSubmitting(false);
      setSubmitStep("");
    }
  }

  async function handleTranscriptFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsedTranscript = await parseTranscriptFile(file);

      if (parsedTranscript.length === 0) {
        throw new Error("No transcript lines were found in that file.");
      }

      setTranscriptSegmentsState(parsedTranscript);
      setTranscriptFileName(file.name);
      setTranscriptError("");
    } catch (parseError) {
      setTranscriptSegmentsState([]);
      setTranscriptFileName("");
      setTranscriptError(
        parseError instanceof Error
          ? parseError.message
          : "Could not read that transcript file.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setYoutubeUrl(text);
      setUrlError("");
    } catch {
      setUrlError("Clipboard access was not available. Paste the link manually.");
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_360px]">
      <StickerPanel
        description="Paste a YouTube link. If captions are missing, import a transcript file."
        title="Add video"
      >
        <form onSubmit={handleStartProcessing}>
          <FieldGroup>
            <Field data-invalid={Boolean(urlError)}>
              <FieldLabel htmlFor="youtube-url">YouTube link</FieldLabel>
              <InputGroup className="h-12 border-2 border-foreground bg-card">
                <InputGroupInput
                  aria-invalid={Boolean(urlError)}
                  id="youtube-url"
                  onChange={(event) => {
                    setYoutubeUrl(event.target.value);
                    if (urlError) {
                      setUrlError("");
                    }
                  }}
                  placeholder="Paste YouTube URL here..."
                  value={youtubeUrl}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton onClick={pasteFromClipboard} size="icon-sm">
                    <LinkIcon />
                    <span className="sr-only">Paste link</span>
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {urlError ? (
                <FieldDescription className="font-bold text-destructive">
                  {urlError}
                </FieldDescription>
              ) : (
                <FieldDescription>
                  Supports `youtube.com/watch`, `youtu.be`, Shorts, and embed
                  links.
                </FieldDescription>
              )}
            </Field>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs font-black uppercase text-foreground/50">
                or
              </span>
              <Separator className="flex-1" />
            </div>
            <Field>
              <FieldLabel>Import transcript optional</FieldLabel>
              <div className="rounded-lg border-2 border-dashed border-foreground bg-vidura-cream p-5 text-center">
                <UploadIcon className="mx-auto mb-3 size-8" />
                <FieldTitle className="mx-auto">
                  Drop `.srt`, `.vtt`, or `.txt`
                </FieldTitle>
                <FieldDescription className="mx-auto max-w-sm text-center">
                  {transcriptSegments.length > 0
                    ? `Loaded ${transcriptSegments.length} lines from ${transcriptFileName}.`
                    : "Manual transcripts keep the workflow available when a video has no public captions."}
                </FieldDescription>
                <input
                  accept=".srt,.vtt,.txt"
                  className="sr-only"
                  onChange={handleTranscriptFileChange}
                  ref={transcriptInputRef}
                  type="file"
                />
                <Button
                  className="mt-4 border-2 border-foreground"
                  onClick={() => transcriptInputRef.current?.click()}
                  type="button"
                  variant="outline"
                >
                  {transcriptSegments.length > 0 ? "Replace file" : "Choose file"}
                </Button>
              </div>
              {transcriptError ? (
                <FieldDescription className="font-bold text-destructive">
                  {transcriptError}
                </FieldDescription>
              ) : null}
            </Field>
            <MascotBubble tone="sun">
              We will fetch the transcript if available, translate it to Sinhala,
              and generate synced subtitles.
            </MascotBubble>
            <CartoonButton disabled={isSubmitting} type="submit">
              {isSubmitting ? submitStep || "Creating job..." : "Start processing"}
              <ChevronRightIcon data-icon="inline-end" />
            </CartoonButton>
          </FieldGroup>
        </form>
      </StickerPanel>

      <div className="flex flex-col gap-4">
        <StickerPanel title="How it works">
          <div className="flex flex-col gap-3">
            {[
              "Fetch or import transcript",
              "Translate with context",
              "Sync Sinhala subtitles",
              "Save to your library",
            ].map((item, index) => (
              <div className="flex items-center gap-3" key={item}>
                <div className="grid size-8 place-items-center rounded-md border-2 border-foreground bg-vidura-mint font-black">
                  {index + 1}
                </div>
                <p className="font-bold">{item}</p>
              </div>
            ))}
          </div>
        </StickerPanel>
        <StickerPanel title="Connection">
          <Badge
            className={cn(
              "w-fit border-2 border-foreground",
              hasSupabaseConfig ? "bg-vidura-mint" : "bg-vidura-sun"
            )}
          >
            {hasSupabaseConfig ? "Supabase configured" : "Local mock mode"}
          </Badge>
          <p className="mt-3 text-sm font-medium text-foreground/65">
            The UI is ready for Supabase Auth and Edge Functions. Add env vars
            when backend wiring starts.
          </p>
        </StickerPanel>
      </div>
    </section>
  );
}

function ProcessingRoute() {
  const { videoId } = useParams();
  const navigate = useNavigate();

  return (
    <ProcessingScreen
      onOpenWatch={() => navigate(videoId ? `/watch/${videoId}` : "/watch")}
      videoId={videoId ?? null}
    />
  );
}

function ProcessingScreen({
  onOpenWatch,
  videoId,
}: {
  onOpenWatch: () => void;
  videoId: string | null;
}) {
  const videosQuery = useLibraryVideos(Boolean(videoId));
  const video = videosQuery.data?.find((item) => item.id === videoId) ?? null;
  const job = video?.latestJob ?? null;
  const stage = typeof job?.metadata.stage === "string"
    ? job.metadata.stage
    : job?.status ?? "queued";
  const totalSegments = Number(job?.metadata.total_segments ?? 0);
  const translatedSegments = Number(job?.metadata.translated_segments ?? 0);
  const currentSegmentText =
    typeof job?.metadata.current_segment_text === "string"
      ? job.metadata.current_segment_text
      : null;

  return (
    <section className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_340px]">
      <StickerPanel
        description={video?.title ?? "Waiting for the new video job"}
        title="Processing"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full border-2 border-foreground bg-vidura-sun font-black">
                {job?.status === "ready" ? <CheckIcon /> : <ClockIcon />}
              </div>
              <div className="flex-1">
                <p className="font-black">{titleCase(stage.replaceAll("_", " "))}</p>
                <Progress
                  className="mt-2 h-3 border border-foreground"
                  value={job?.progress ?? 0}
                />
              </div>
              <Badge className="border-2 border-foreground bg-vidura-sun text-foreground">
                {job?.progress ?? 0}%
              </Badge>
            </div>
            {totalSegments > 0 ? (
              <StickerCard className="bg-vidura-cream">
                <CardContent className="p-4">
                  <p className="font-black">
                    Translating {translatedSegments} of {totalSegments} segments
                  </p>
                  {currentSegmentText ? (
                    <p className="mt-2 text-sm font-semibold text-foreground/65">
                      Current: {currentSegmentText}
                    </p>
                  ) : null}
                </CardContent>
              </StickerCard>
            ) : null}
            {job?.errorMessage ? (
              <StickerCard className="bg-vidura-coral">
                <CardContent className="p-4 text-sm font-black">
                  {job.errorMessage}
                </CardContent>
              </StickerCard>
            ) : null}
          </div>
          <StickerCard className="bg-vidura-sky">
            <CardContent className="flex items-center gap-3 p-4">
              <BellIcon className="size-8" />
              <p className="text-sm font-bold">
                You will get a notification when it is ready.
              </p>
            </CardContent>
          </StickerCard>
          <CartoonButton onClick={onOpenWatch}>
            Open watch screen
            <CirclePlayIcon data-icon="inline-end" />
          </CartoonButton>
          <Button asChild className="border-2 border-foreground" variant="outline">
            <NavLink to="/library">
              Send to background
              <HomeIcon data-icon="inline-end" />
            </NavLink>
          </Button>
        </div>
      </StickerPanel>
      <MascotBubble tone="mint">
        Long videos will run as background jobs so mobile users can leave this
        screen and come back later.
      </MascotBubble>
    </section>
  );
}

function WatchScreen({ videos }: { videos: LibraryVideo[] }) {
  const subtitleEnabled = useAppStore((state) => state.subtitleEnabled);
  const subtitleSize = useAppStore((state) => state.subtitleSize);
  const subtitleOpacity = useAppStore((state) => state.subtitleOpacity);
  const [playbackTime, setPlaybackTime] = useState<{
    videoId: string | null;
    milliseconds: number;
  }>({ videoId: null, milliseconds: 0 });
  const { videoId } = useParams();
  const navigate = useNavigate();
  const storedSelectedVideoId = useAppStore((state) => state.selectedVideoId);
  const setSelectedVideoId = useAppStore((state) => state.setSelectedVideoId);
  const selectedVideoId = videoId ?? storedSelectedVideoId;
  const selectedVideo =
    videos.find((video) => video.id === selectedVideoId) ?? videos[0] ?? null;
  const transcriptQuery = useQuery({
    queryKey: videoQueryKeys.transcript(selectedVideo?.id ?? null),
    queryFn: () => fetchVideoTranscript(selectedVideo?.id ?? null),
    enabled: Boolean(selectedVideo),
  });
  const selectedTranscript = transcriptQuery.data ?? [];
  const currentPlaybackMs = playbackTime.videoId === selectedVideo?.id
    ? playbackTime.milliseconds
    : 0;
  const activeSubtitle = findActiveTranscriptSegment(
    selectedTranscript,
    currentPlaybackMs,
  );
  const youtubeVideoId = isYouTubeVideoId(selectedVideo?.youtubeVideoId)
    ? selectedVideo.youtubeVideoId
    : null;
  const videoWatchUrl = selectedVideo?.youtubeUrl ??
    (youtubeVideoId ? buildYouTubeWatchUrl(youtubeVideoId) : null);
  const handlePlaybackTimeChange = useCallback((milliseconds: number) => {
    setPlaybackTime((currentTime) => {
      if (
        currentTime.videoId === selectedVideo?.id &&
        Math.abs(currentTime.milliseconds - milliseconds) < 250
      ) {
        return currentTime;
      }

      return {
        videoId: selectedVideo?.id ?? null,
        milliseconds,
      };
    });
  }, [selectedVideo?.id]);

  useEffect(() => {
    if (selectedVideo?.id && selectedVideo.id !== storedSelectedVideoId) {
      setSelectedVideoId(selectedVideo.id);
    }
  }, [selectedVideo?.id, setSelectedVideoId, storedSelectedVideoId]);

  if (!selectedVideo) {
    return (
      <StickerCard>
        <CardContent className="p-5">
          <h2 className="font-display text-3xl font-black">No video selected</h2>
          <p className="mt-1 text-sm font-semibold text-foreground/60">
            Add a video or open one from the library.
          </p>
        </CardContent>
      </StickerCard>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="hidden items-center justify-between gap-3 lg:flex">
          <div>
            <h2 className="font-display text-4xl font-black tracking-normal">
              Watch
            </h2>
            <p className="font-medium text-foreground/60">
              {selectedVideo.title}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button className="border-2 border-foreground" variant="outline">
              <DownloadIcon data-icon="inline-start" />
              Subtitles
            </Button>
            <Button
              className="border-2 border-foreground bg-vidura-mint text-foreground"
              onClick={() => navigate("/settings")}
              variant="secondary"
            >
              <SettingsIcon data-icon="inline-start" />
              SI subtitles
            </Button>
          </div>
        </div>
        <StickerCard className="overflow-hidden bg-vidura-ink p-0">
          <div className="relative aspect-video overflow-hidden bg-vidura-ink">
            {youtubeVideoId ? (
              <YouTubePlayerFrame
                key={youtubeVideoId}
                onTimeChange={handlePlaybackTimeChange}
                title={selectedVideo.title}
                videoId={youtubeVideoId}
                watchUrl={videoWatchUrl}
              />
            ) : (
              <>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,#8b7cf6_0_9%,transparent_10%),radial-gradient(circle_at_70%_35%,#ffcf4a_0_5%,transparent_6%),radial-gradient(circle_at_50%_75%,#4ecdc4_0_7%,transparent_8%)]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="grid size-28 place-items-center rounded-full border-2 border-white bg-vidura-purple text-white shadow-[6px_6px_0_#ff6b5a] sm:size-40">
                    <CirclePlayIcon className="size-16 sm:size-24" />
                  </div>
                </div>
              </>
            )}
            {subtitleEnabled ? (
              <div
                className={cn(
                  "absolute inset-x-3 mx-auto max-w-[min(88%,720px)] rounded-md border-2 border-white px-2.5 py-1.5 text-center font-black leading-tight text-white shadow-[4px_4px_0_#000] sm:px-3 sm:py-2 sm:leading-snug",
                  youtubeVideoId ? "bottom-3 sm:bottom-5" : "bottom-12",
                )}
                style={{
                  backgroundColor: `rgb(17 24 39 / ${subtitleOpacity / 100})`,
                  display: "-webkit-box",
                  fontSize: `clamp(14px, 3.4vw, ${subtitleSize}px)`,
                  maxHeight: "4.8em",
                  overflow: "hidden",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                }}
              >
                {activeSubtitle?.sinhala ??
                  (transcriptQuery.isPending
                    ? "Sinhala subtitles are loading."
                    : "Subtitles will appear when the video reaches a translated line.")}
              </div>
            ) : null}
            {!youtubeVideoId ? (
              <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 text-white">
                <CirclePlayIcon className="size-5" />
                <div className="h-2 flex-1 rounded-full bg-white/25">
                  <div className="h-2 w-[32%] rounded-full bg-vidura-coral" />
                </div>
                <span className="text-xs font-black">4:12 / 22:47</span>
              </div>
            ) : null}
          </div>
        </StickerCard>
        <div className="grid gap-4 xl:hidden">
          <TranscriptPanel
            activeSegmentId={activeSubtitle?.id ?? null}
            videoId={selectedVideo.id}
          />
          <ChatPanel videoId={selectedVideo.id} />
        </div>
        <div className="hidden xl:block">
          <TranscriptPanel
            activeSegmentId={activeSubtitle?.id ?? null}
            videoId={selectedVideo.id}
          />
        </div>
      </div>
      <aside className="hidden min-h-0 flex-col gap-4 xl:flex">
        <ChatPanel videoId={selectedVideo.id} />
        <VideoInfoPanel video={selectedVideo} />
      </aside>
    </section>
  );
}

function findActiveTranscriptSegment(
  segments: TranscriptSegment[],
  playbackMs: number,
) {
  if (segments.length === 0) {
    return null;
  }

  const activeSegment = segments.find(
    (segment) => {
      if (!hasSegmentTiming(segment)) {
        return false;
      }

      return playbackMs >= segment.startMs - 500 &&
        playbackMs < segment.endMs + 250;
    },
  );

  if (activeSegment) {
    return activeSegment;
  }

  const firstTimedSegment = segments.find(hasSegmentTiming);

  if (!firstTimedSegment || playbackMs < firstTimedSegment.startMs) {
    return null;
  }

  return null;
}

function hasSegmentTiming(
  segment: TranscriptSegment,
): segment is TranscriptSegment & { startMs: number; endMs: number } {
  return typeof segment.startMs === "number" &&
    typeof segment.endMs === "number";
}

function YouTubePlayerFrame({
  onTimeChange,
  title,
  videoId,
  watchUrl,
}: {
  onTimeChange: (milliseconds: number) => void;
  title: string;
  videoId: string;
  watchUrl: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const lastReportedTimeRef = useRef(-1);
  const [playerError, setPlayerError] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeInterval: ReturnType<typeof window.setInterval> | null = null;
    const startTimePolling = () => {
      if (timeInterval) {
        return;
      }

      timeInterval = window.setInterval(() => {
        const player = playerRef.current;

        if (!player || typeof player.getCurrentTime !== "function") {
          return;
        }

        const currentTime = player.getCurrentTime();

        if (typeof currentTime !== "number" || Number.isNaN(currentTime)) {
          return;
        }

        const milliseconds = Math.max(0, Math.floor(currentTime * 1000));

        if (Math.abs(milliseconds - lastReportedTimeRef.current) < 250) {
          return;
        }

        lastReportedTimeRef.current = milliseconds;
        onTimeChange(milliseconds);
      }, 250);
    };

    void loadYouTubeIframeApi()
      .then(() => {
        if (cancelled || !containerRef.current || !window.YT?.Player) {
          return;
        }

        playerRef.current?.destroy();
        playerRef.current = new window.YT.Player(containerRef.current, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            enablejsapi: 1,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: startTimePolling,
            onError: (event) => {
              if ([2, 5, 100, 101, 150].includes(event.data)) {
                setPlayerError(event.data);
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerError(0);
        }
      });

    return () => {
      cancelled = true;
      if (timeInterval) {
        window.clearInterval(timeInterval);
      }
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [onTimeChange, videoId]);

  return (
    <>
      <div
        aria-label={title}
        className={cn(
          "absolute inset-0 [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:size-full",
          playerError ? "pointer-events-none opacity-0" : null,
        )}
        ref={containerRef}
      />
      {playerError ? (
        <div className="absolute inset-0 grid place-items-center bg-vidura-ink p-6 text-center text-white">
          <div className="max-w-sm">
            <div className="mx-auto grid size-16 place-items-center rounded-full border-2 border-white/70 text-white/80">
              <CirclePlayIcon className="size-8" />
            </div>
            <h3 className="mt-4 text-2xl font-black">Playback blocked here</h3>
            <p className="mt-2 text-sm font-bold text-white/70">
              This video can only be watched on YouTube.
            </p>
            <Button
              asChild
              className="mt-5 border-2 border-white bg-vidura-sun text-foreground hover:bg-vidura-sun/90"
            >
              <a href={watchUrl ?? buildYouTubeWatchUrl(videoId)} rel="noreferrer" target="_blank">
                <LinkIcon data-icon="inline-start" />
                Open on YouTube
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function TranscriptPanel({
  activeSegmentId,
  videoId,
}: {
  activeSegmentId?: string | null;
  videoId: string;
}) {
  const transcriptQuery = useQuery({
    queryKey: videoQueryKeys.transcript(videoId),
    queryFn: () => fetchVideoTranscript(videoId),
  });
  const selectedTranscript = transcriptQuery.data ?? [];

  return (
    <StickerCard>
      <Tabs defaultValue="sinhala">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="font-display text-2xl font-black">
              Transcript
            </CardTitle>
            <TabsList className="border-2 border-foreground bg-vidura-cream">
              <TabsTrigger value="sinhala">Sinhala</TabsTrigger>
              <TabsTrigger value="bilingual">Bilingual</TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>
        <CardContent>
          {transcriptQuery.isPending ? (
            <p className="text-sm font-black text-foreground/60">
              Loading transcript...
            </p>
          ) : null}
          {!transcriptQuery.isPending && selectedTranscript.length === 0 ? (
            <p className="text-sm font-black text-foreground/60">
              Transcript lines will appear here as processing stores them.
            </p>
          ) : null}
          <TabsContent className="mt-0" value="sinhala">
            <TranscriptRows
              activeSegmentId={activeSegmentId}
              mode="sinhala"
              segments={selectedTranscript}
            />
          </TabsContent>
          <TabsContent className="mt-0" value="bilingual">
            <TranscriptRows
              activeSegmentId={activeSegmentId}
              mode="bilingual"
              segments={selectedTranscript}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
    </StickerCard>
  );
}

function TranscriptRows({
  activeSegmentId,
  mode,
  segments,
}: {
  activeSegmentId?: string | null;
  mode: "sinhala" | "bilingual";
  segments: TranscriptSegment[];
}) {
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeSegmentId]);

  return (
    <ScrollArea className="h-[260px] pr-3">
      <div className="flex flex-col gap-2">
        {segments.map((segment) => (
          <button
            className={cn(
              "grid grid-cols-[56px_1fr] gap-3 rounded-md border-2 border-foreground bg-card p-3 text-left shadow-[2px_2px_0_var(--vidura-ink)]",
              segment.id === activeSegmentId && "bg-vidura-mint"
            )}
            key={segment.id}
            ref={segment.id === activeSegmentId ? activeRowRef : null}
            type="button"
          >
            <Badge className="border border-foreground bg-vidura-sun text-foreground">
              {segment.time}
            </Badge>
            <span className="text-sm font-semibold leading-relaxed">
              {mode === "bilingual" ? (
                <>
                  <span>{segment.original}</span>
                  <span className="mt-1 block text-foreground/65">
                    {segment.sinhala}
                  </span>
                </>
              ) : (
                segment.sinhala
              )}
            </span>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

function ChatPanel({ videoId }: { videoId: string }) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const transcriptQuery = useQuery({
    queryKey: videoQueryKeys.transcript(videoId),
    queryFn: () => fetchVideoTranscript(videoId),
  });
  const chatQuery = useQuery({
    queryKey: videoQueryKeys.chat(videoId),
    queryFn: () => fetchChatMessages(videoId),
  });
  const sendMessageMutation = useMutation({
    mutationFn: sendVideoChatMessage,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: videoQueryKeys.chat(videoId),
      });
    },
  });
  const messages = chatQuery.data ?? [];
  const selectedTranscript = transcriptQuery.data ?? [];

  function askVideo(question: string) {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    sendMessageMutation.mutate({
      videoId,
      question: trimmedQuestion,
      transcript: selectedTranscript,
    });
    setDraft("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    askVideo(draft);
  }

  return (
    <StickerCard className="min-h-[360px]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="font-display text-2xl font-black">
              Chat
            </CardTitle>
            <CardDescription>Ask about this video.</CardDescription>
          </div>
          <Avatar className="border-2 border-foreground bg-vidura-purple">
            <AvatarFallback className="bg-transparent font-black text-foreground">
              AI
            </AvatarFallback>
          </Avatar>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {quickPrompts.slice(0, 3).map((prompt) => (
            <Button
              className="h-auto rounded-md border-2 border-foreground bg-vidura-cream px-3 py-2 text-xs"
              key={prompt}
              onClick={() => askVideo(prompt)}
              type="button"
              variant="outline"
            >
              {prompt}
            </Button>
          ))}
        </div>
        <ScrollArea className="h-[230px] pr-3">
          <div className="flex flex-col gap-3">
            {chatQuery.isPending ? (
              <div className="rounded-lg border-2 border-dashed border-foreground bg-vidura-cream p-3 text-sm font-bold leading-relaxed text-foreground/65">
                Loading chat...
              </div>
            ) : null}
            {!chatQuery.isPending && messages.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-foreground bg-vidura-cream p-3 text-sm font-bold leading-relaxed text-foreground/65">
                Ask a question after importing or selecting a video transcript.
              </div>
            ) : null}
            {messages.map((message) => (
              <div
                className={cn(
                  "max-w-[88%] rounded-lg border-2 border-foreground p-3 text-sm font-medium leading-relaxed shadow-[2px_2px_0_var(--vidura-ink)]",
                  message.role === "user"
                    ? "ml-auto bg-vidura-purple"
                    : "bg-card"
                )}
                key={message.id}
              >
                <p>{message.content}</p>
                {message.citation ? (
                  <Badge className="mt-2 border border-foreground bg-vidura-sun text-foreground">
                    {message.citation}
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
        <form onSubmit={handleSubmit}>
          <InputGroup className="h-auto border-2 border-foreground bg-card">
            <InputGroupTextarea
              className="min-h-16"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about this video..."
              value={draft}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                className="bg-vidura-purple text-foreground"
                disabled={!draft.trim() || sendMessageMutation.isPending}
                size="icon-sm"
                type="submit"
              >
                <SendIcon />
                <span className="sr-only">Send message</span>
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </CardContent>
    </StickerCard>
  );
}

function ChatScreen({
  standalone = false,
  videos,
}: {
  standalone?: boolean;
  videos: LibraryVideo[];
}) {
  const { videoId } = useParams();
  const storedSelectedVideoId = useAppStore((state) => state.selectedVideoId);
  const setSelectedVideoId = useAppStore((state) => state.setSelectedVideoId);
  const selectedVideoId = videoId ?? storedSelectedVideoId;
  const selectedVideo =
    videos.find((video) => video.id === selectedVideoId) ?? videos[0] ?? null;

  useEffect(() => {
    if (selectedVideo?.id && selectedVideo.id !== storedSelectedVideoId) {
      setSelectedVideoId(selectedVideo.id);
    }
  }, [selectedVideo?.id, setSelectedVideoId, storedSelectedVideoId]);

  return (
    <section className={cn("mx-auto max-w-3xl", standalone && "pt-0")}>
      {selectedVideo ? (
        <ChatPanel videoId={selectedVideo.id} />
      ) : (
        <StickerCard>
          <CardContent className="p-5 font-black">
            Add a video before starting a chat.
          </CardContent>
        </StickerCard>
      )}
    </section>
  );
}

function VideoInfoPanel({ video }: { video: LibraryVideo }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deleteVideoMutation = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: videoQueryKeys.all });
      navigate("/library");
    },
  });
  const videoUrl =
    video.youtubeUrl ??
    (isYouTubeVideoId(video.youtubeVideoId)
      ? buildYouTubeWatchUrl(video.youtubeVideoId)
      : null);

  async function shareVideo() {
    if (!videoUrl) {
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: video.title,
          url: videoUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(videoUrl);
    } catch {
      // Sharing can be cancelled by the user or blocked by browser permissions.
    }
  }

  function openVideo() {
    if (!videoUrl) {
      return;
    }

    window.open(videoUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <StickerPanel title="Video info">
      <div className="flex gap-3">
        <div
          className={cn(
            "grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border-2 border-foreground",
            video.accent
          )}
        >
          {video.thumbnailUrl ? (
            <img alt="" className="size-full object-cover" src={video.thumbnailUrl} />
          ) : (
            <video.Icon className="size-9" />
          )}
        </div>
        <div>
          <p className="font-black leading-tight">{video.title}</p>
          <p className="mt-1 text-xs font-semibold text-foreground/60">
            {video.channel}
          </p>
        </div>
      </div>
      <Separator className="my-4" />
      <div className="flex flex-col gap-2">
        <Button className="justify-start border-2 border-foreground" variant="outline">
          <ListVideoIcon data-icon="inline-start" />
          Add to watch later
        </Button>
        <Button
          className="justify-start border-2 border-foreground"
          disabled={!videoUrl}
          onClick={() => void shareVideo()}
          variant="outline"
        >
          <ListVideoIcon data-icon="inline-start" />
          Share video
        </Button>
        <Button
          className="justify-start border-2 border-foreground"
          disabled={!videoUrl}
          onClick={openVideo}
          variant="outline"
        >
          <ListVideoIcon data-icon="inline-start" />
          Open in YouTube
        </Button>
        <Button
          className="justify-start border-2 border-foreground"
          disabled={deleteVideoMutation.isPending}
          onClick={() => deleteVideoMutation.mutate(video.id)}
          variant="outline"
        >
          <Trash2Icon data-icon="inline-start" />
          Delete video
        </Button>
      </div>
    </StickerPanel>
  );
}

function SettingsScreen() {
  const subtitleEnabled = useAppStore((state) => state.subtitleEnabled);
  const subtitleSize = useAppStore((state) => state.subtitleSize);
  const subtitleOpacity = useAppStore((state) => state.subtitleOpacity);
  const setSubtitleEnabled = useAppStore((state) => state.setSubtitleEnabled);
  const setSubtitleSize = useAppStore((state) => state.setSubtitleSize);
  const setSubtitleOpacity = useAppStore((state) => state.setSubtitleOpacity);

  return (
    <section className="mx-auto max-w-3xl">
      <StickerPanel
        description="Tune subtitle readability for mobile and desktop playback."
        title="Settings"
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <div className="flex-1">
              <FieldLabel>SI subtitles</FieldLabel>
              <FieldDescription>Show translated Sinhala captions.</FieldDescription>
            </div>
            <Switch
              checked={subtitleEnabled}
              onCheckedChange={setSubtitleEnabled}
            />
          </Field>
          <Field>
            <FieldLabel>Language</FieldLabel>
            <Select defaultValue="si">
              <SelectTrigger className="h-11 border-2 border-foreground bg-card">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <FieldSet>
            <FieldTitle>Subtitle size</FieldTitle>
            <div className="flex items-center gap-3">
              <Badge className="border-2 border-foreground bg-card text-foreground">
                A-
              </Badge>
              <Slider
                max={28}
                min={16}
                onValueChange={([value]) => setSubtitleSize(value)}
                step={1}
                value={[subtitleSize]}
              />
              <Badge className="border-2 border-foreground bg-card text-foreground">
                A+
              </Badge>
            </div>
          </FieldSet>
          <FieldSet>
            <FieldTitle>Background opacity</FieldTitle>
            <div className="flex items-center gap-3">
              <Slider
                max={100}
                min={35}
                onValueChange={([value]) => setSubtitleOpacity(value)}
                step={1}
                value={[subtitleOpacity]}
              />
              <Badge className="border-2 border-foreground bg-vidura-sun text-foreground">
                {subtitleOpacity}%
              </Badge>
            </div>
          </FieldSet>
          <Field>
            <FieldLabel>Study notes</FieldLabel>
            <Textarea
              className="min-h-28 border-2 border-foreground bg-card"
              placeholder="Add personal notes for this lesson..."
            />
          </Field>
        </FieldGroup>
      </StickerPanel>
    </section>
  );
}

export default App;
