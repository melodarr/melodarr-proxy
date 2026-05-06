"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetcher";
import { Braces, ChevronLeft, ChevronRight, Disc3, Grid2X2, Loader2, Music2, Search, Star, UserRound, X } from "lucide-react";

type SearchMode = "artist" | "song" | "album" | "artistSong";
type ImageTab = "albums" | "artist" | "debug";

type ImageResource = {
  coverType?: string;
  url?: string;
  remoteUrl?: string;
  imageUrl?: string;
  imageSource?: string;
  source?: string;
  type?: string;
  height?: number;
  width?: number;
};

type Candidate = {
  artistName: string;
  type: string;
  source: string;
  match?: string;
  disambiguation?: string;
  score?: number;
  imageUrl?: string;
  images?: ImageResource[];
  ids?: Record<string, string>;
};

type DiscoverResult = {
  query: string;
  type: SearchMode;
  candidates: Candidate[];
  traceId?: string;
};
type SongAlbumResult = {
  artist: string;
  song: string;
  source: string;
  albums: Array<{
    albumName: string;
    artistName: string;
    songName: string;
    year?: number | null;
    imageUrl?: string;
    source: string;
    ids?: Record<string, string>;
  }>;
  traceId?: string;
};

type CacheMeta = {
  hit: boolean;
  status: "HIT" | "MISS";
  ttlSeconds: number;
  remainingSeconds: number;
  generatedAt?: string | null;
  expiresAt?: string | null;
};

type ResultView = "visual" | "json";

type AlbumCard = {
  title: string;
  year?: string | number | null;
  imageUrl?: string;
  provider?: string;
  id?: string;
  rating?: {
    count: number;
    value: number;
  };
};

type ArtistPreview = {
  artistName: string;
  disambiguation?: string;
  overview?: string;
  imageUrl?: string;
};

type ArtistImageCard = {
  url: string;
  coverType: string;
  source?: string;
  type?: string;
  height?: number;
  width?: number;
};

type ImageDebugCard = {
  url: string;
  score?: number;
  source?: string;
  type?: string;
};

type LightboxImage = {
  url: string;
  title: string;
  subtitle?: string;
  meta?: string;
};

const modes: Array<{ id: SearchMode; label: string; icon: typeof UserRound; placeholder: string }> = [
  { id: "artist", label: "Artist", icon: UserRound, placeholder: "Radiohead" },
  { id: "song", label: "Song", icon: Music2, placeholder: "Paranoid Android" },
  { id: "album", label: "Album", icon: Disc3, placeholder: "OK Computer" },
  { id: "artistSong", label: "Artist + Song", icon: Music2, placeholder: "Radiohead / Paranoid Android" },
];

function pickImageUrl(images?: ImageResource[], preferredTypes: string[] = []): string {
  if (!Array.isArray(images) || images.length === 0) return "";

  const normalizedTypes = preferredTypes.map((type) => type.toLowerCase());
  const ordered = [
    ...images.filter((image) => normalizedTypes.includes(String(image.coverType || "").toLowerCase())),
    ...images,
  ];
  const image = ordered.find((item) => item?.url || item?.remoteUrl || item?.imageUrl);
  return image?.url || image?.remoteUrl || image?.imageUrl || "";
}

function getCandidateImageUrl(candidate: Candidate): string {
  return candidate.imageUrl || pickImageUrl(candidate.images, ["poster", "fanart", "clearlogo"]);
}

function getArtistPreview(result: any): ArtistPreview | null {
  const raw = result?.rawResults || {};
  const normalized = result?.normalizedResults?.[0] || {};
  const rawImages = Array.isArray(raw.images) ? raw.images : [];
  const normalizedImages = Array.isArray(normalized.images) ? normalized.images : [];
  const imageUrl =
    raw.imageUrl ||
    raw.remotePoster ||
    pickImageUrl(rawImages, ["poster", "fanart", "clearlogo"]) ||
    pickImageUrl(normalizedImages, ["poster", "fanart", "clearlogo"]);
  const artistName = raw.artistName || normalized.artistName || "";

  if (!artistName && !imageUrl) return null;

  return {
    artistName,
    disambiguation: raw.disambiguation || normalized.disambiguation || "",
    overview: raw.overview || normalized.overview || "",
    imageUrl,
  };
}

function getArtistImages(result: any): ArtistImageCard[] {
  const raw = result?.rawResults || {};
  const normalized = result?.normalizedResults?.[0] || {};
  const sources = [
    ...(Array.isArray(raw.images) ? raw.images : []),
    ...(Array.isArray(normalized.images) ? normalized.images : []),
  ];
  const images: ArtistImageCard[] = [];
  const seen = new Set<string>();

  for (const image of sources) {
    const url = image?.url || image?.remoteUrl || image?.imageUrl || "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({
      url,
      coverType: image.coverType || "poster",
      source: image.imageSource || image.source || "",
      type: image.type || "artist",
      height: image.height,
      width: image.width,
    });
  }

  const fallbackUrl = raw.imageUrl || raw.remotePoster || normalized.imageUrl || normalized.remotePoster || "";
  if (fallbackUrl && !seen.has(fallbackUrl)) {
    images.push({ url: fallbackUrl, coverType: "poster", source: "result", type: "artist" });
  }

  return images;
}

function getImageDebug(result: any): ImageDebugCard[] {
  const rawDebug = result?.rawResults?.imageDebug;
  const debug = Array.isArray(rawDebug) ? rawDebug : [];
  return debug
    .map((item: any) => ({
      url: item?.url || "",
      score: Number(item?.score ?? 0) || 0,
      source: item?.source || "",
      type: item?.type || "",
    }))
    .filter((item) => item.url);
}

function getArtistAlbums(result: any): AlbumCard[] {
  const rawAlbums = result?.rawResults?.albums;
  const normalizedAlbums = result?.normalizedResults?.[0]?.albums;
  const albums = Array.isArray(rawAlbums) && rawAlbums.length > 0 ? rawAlbums : Array.isArray(normalizedAlbums) ? normalizedAlbums : [];

  return albums.map((album: any) => {
    const ids = album?.ids || {};
    const id = ids.musicbrainzReleaseGroupId || ids.theAudioDbAlbumId || ids.itunesCollectionId || ids.discogsId || ids.musicbrainzAlbumId || album?.id || "";

    return {
      title: album?.name || album?.title || "Untitled",
      year: album?.year || album?.firstReleaseDate || null,
      imageUrl: album?.imageUrl || album?.coverUrl || "",
      provider: album?.provider || "",
      rating: normalizeAlbumRating(album),
      id,
    };
  });
}

function normalizeAlbumRating(album: any): { count: number; value: number } {
  const rating = album?.rating || album?.ratings || {};
  return {
    count: Number(rating.count ?? rating.votes ?? 0) || 0,
    value: Number(rating.value ?? 0) || 0,
  };
}

function AlbumRating({ rating }: { rating?: { count: number; value: number } }) {
  const value = Number(rating?.value ?? 0) || 0;
  const count = Number(rating?.count ?? 0) || 0;
  const rounded = Math.max(0, Math.min(5, Math.round(value)));

  return (
    <div className="space-y-1" aria-label={`Rating ${value > 0 ? `${value.toFixed(1)} out of 5` : "unrated"}`}>
      <div className="flex items-center gap-1">
        {Array.from({ length: 5 }).map((_, index) => {
          const filled = index < rounded;

          return (
            <Star
              key={index}
              className={`h-4 w-4 ${filled ? "fill-amber-400 text-amber-400" : "text-gray-700"}`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-gray-300">{value > 0 ? value.toFixed(1) : "--"} <span className="text-gray-600">/ 5</span></span>
        <span className="text-gray-600">{count === 1 ? "1 vote" : count > 0 ? `${count} votes` : "No votes"}</span>
      </div>
    </div>
  );
}

function getAlbumLightboxImages(albums: AlbumCard[]): LightboxImage[] {
  return albums
    .filter((album) => album.imageUrl)
    .map((album) => ({
      url: album.imageUrl || "",
      title: album.title,
      subtitle: [album.year, album.provider].filter(Boolean).join(" / "),
      meta: album.id,
    }));
}

function getArtistLightboxImages(images: ArtistImageCard[], artistName?: string): LightboxImage[] {
  return images.map((image) => ({
    url: image.url,
    title: `${artistName || "Artist"} ${image.coverType}`,
    subtitle: [image.type, image.source].filter(Boolean).join(" / "),
    meta: image.width || image.height ? `${image.width || 0} x ${image.height || 0}` : image.url,
  }));
}

function getDebugLightboxImages(images: ImageDebugCard[]): LightboxImage[] {
  return images.map((image) => ({
    url: image.url,
    title: `${image.type || "Image"} score ${image.score ?? 0}`,
    subtitle: image.source,
    meta: image.url,
  }));
}

function ProviderPill({ provider }: { provider?: string }) {
  if (!provider) return null;

  return (
    <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-xs capitalize text-gray-400">
      {provider}
    </span>
  );
}

function AlbumArtwork({ album, onOpen }: { album: AlbumCard; onOpen?: () => void }) {
  const [failed, setFailed] = useState(false);

  if (album.imageUrl && !failed) {
    const artworkLabel = album.title ? `${album.title} album cover` : "Album cover";
    const image = (
      <img
        src={album.imageUrl}
        alt={onOpen ? "" : artworkLabel}
        onError={() => setFailed(true)}
        className="aspect-square w-full rounded-md object-cover transition-transform group-hover:scale-[1.02]"
      />
    );
    return onOpen ? (
      <button
        type="button"
        onClick={onOpen}
        aria-label={artworkLabel}
        className="group block w-full overflow-hidden rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {image}
      </button>
    ) : image;
  }

  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-md border border-border/60 bg-white/5 text-gray-500">
      <Disc3 className="h-8 w-8" />
    </div>
  );
}

function ArtistArtwork({ imageUrl, artistName }: { imageUrl?: string; artistName?: string }) {
  const [failed, setFailed] = useState(false);

  if (imageUrl && !failed) {
    return <img src={imageUrl} alt={artistName ? `${artistName} artwork` : ""} onError={() => setFailed(true)} className="h-20 w-20 rounded-md object-cover" />;
  }

  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-md border border-border/60 bg-white/5 text-gray-500">
      <UserRound className="h-8 w-8" />
    </div>
  );
}

function ImagePreview({ url, alt, onOpen }: { url: string; alt: string; onOpen?: () => void }) {
  const [failed, setFailed] = useState(false);

  if (url && !failed) {
    const image = <img src={url} alt={alt} onError={() => setFailed(true)} className="aspect-square w-full rounded-md object-cover transition-transform group-hover:scale-[1.02]" />;
    return onOpen ? (
      <button type="button" onClick={onOpen} className="group block w-full overflow-hidden rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        {image}
      </button>
    ) : image;
  }

  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-md border border-border/60 bg-white/5 text-gray-500">
      <UserRound className="h-8 w-8" />
    </div>
  );
}

function ImageLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const image = images[index];
  const canNavigate = images.length > 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canNavigate) onNavigate((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight" && canNavigate) onNavigate((index + 1) % images.length);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNavigate, images.length, index, onClose, onNavigate]);

  if (!image) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close image preview" onClick={onClose} className="absolute right-4 top-4 rounded-md border border-white/15 bg-black/60 p-2 text-gray-200 hover:bg-white/10">
        <X className="h-5 w-5" />
      </button>

      {canNavigate && (
        <button
          type="button"
          aria-label="Previous image"
          onClick={() => onNavigate((index - 1 + images.length) % images.length)}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-md border border-white/15 bg-black/60 p-3 text-gray-200 hover:bg-white/10"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      <div className="flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-4">
        <img src={image.url} alt={image.title} className="max-h-[78vh] max-w-[92vw] rounded-md object-contain" />
        <div className="max-w-3xl text-center">
          <div className="text-base font-semibold text-white">{image.title}</div>
          {image.subtitle && <div className="mt-1 text-sm text-gray-300">{image.subtitle}</div>}
          {image.meta && <div className="mt-1 break-all text-xs text-gray-500">{image.meta}</div>}
          {images.length > 1 && <div className="mt-2 text-xs text-gray-500">{index + 1} / {images.length}</div>}
        </div>
      </div>

      {canNavigate && (
        <button
          type="button"
          aria-label="Next image"
          onClick={() => onNavigate((index + 1) % images.length)}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-white/15 bg-black/60 p-3 text-gray-200 hover:bg-white/10"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}

function formatDuration(seconds?: number | null) {
  const safeSeconds = Math.max(0, Number(seconds || 0));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${safeSeconds}s`;
}

export default function ExplorerPage() {
  const [query, setQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("artist");
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [songAlbumResult, setSongAlbumResult] = useState<SongAlbumResult | null>(null);
  const [artistResult, setArtistResult] = useState<any>(null);
  const [selectedArtist, setSelectedArtist] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [resultView, setResultView] = useState<ResultView>("visual");
  const [imageTab, setImageTab] = useState<ImageTab>("albums");
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const inspectArtist = async (artistName: string) => {
    if (!artistName.trim()) return;

    setLookupLoading(true);
    setError(null);
    setSelectedArtist(artistName);
    setArtistResult(null);
    setImageTab("albums");

    try {
      setArtistResult(await fetchJson(`/debug/search?q=${encodeURIComponent(artistName.trim())}`));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLookupLoading(false);
    }
  };

  const inspect = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setDiscoverResult(null);
    setSongAlbumResult(null);
    setArtistResult(null);
    setSelectedArtist("");
    setResultView("visual");

    try {
      if (mode === "artist") {
        await inspectArtist(query.trim());
      } else if (mode === "artistSong") {
        const result = await fetchJson<SongAlbumResult>(
          `/debug/song-albums?artist=${encodeURIComponent(artistQuery.trim())}&song=${encodeURIComponent(query.trim())}`
        );
        setSongAlbumResult(result);
      } else {
        const result = await fetchJson<DiscoverResult>(`/debug/discover?type=${mode}&q=${encodeURIComponent(query.trim())}`);
        setDiscoverResult(result);
        if (result.candidates[0]?.artistName) {
          await inspectArtist(result.candidates[0].artistName);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentMode = modes.find((item) => item.id === mode) ?? modes[0];
  const queryRequired = mode === "artistSong" ? query.trim() && artistQuery.trim() : query.trim();
  const artistAlbums = getArtistAlbums(artistResult);
  const artistPreview = getArtistPreview(artistResult);
  const artistImages = getArtistImages(artistResult);
  const imageDebug = getImageDebug(artistResult);
  const albumLightboxImages = getAlbumLightboxImages(artistAlbums);
  const artistLightboxImages = getArtistLightboxImages(artistImages, artistPreview?.artistName || selectedArtist);
  const debugLightboxImages = getDebugLightboxImages(imageDebug);
  const cacheMeta = artistResult?.cache as CacheMeta | undefined;

  const openLightbox = (images: LightboxImage[], index: number) => {
    if (images.length === 0) return;
    setLightboxImages(images);
    setLightboxIndex(index);
  };

  return (
    <main className="container mx-auto max-w-screen-2xl space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Explorer</h1>
        <p className="mt-2 text-gray-400">Find artists directly, or discover artists from a song or album title.</p>
      </div>

      <form onSubmit={inspect} className="space-y-4 rounded-lg border border-border/60 bg-card p-5">
        <div className="flex flex-wrap gap-2">
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors ${
                  mode === item.id ? "border-blue-500/50 bg-blue-500/10 text-blue-200" : "border-border/70 bg-background text-gray-300 hover:bg-white/5"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 md:flex-row">
          {mode === "artistSong" && (
            <div className="relative flex-1">
              <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={artistQuery}
                onChange={(event) => setArtistQuery(event.target.value)}
                placeholder="Artist, e.g. Radiohead"
                className="w-full rounded-md border border-border/60 bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-blue-500"
              />
            </div>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search by ${currentMode.label.toLowerCase()}, e.g. ${currentMode.placeholder}`}
              className="w-full rounded-md border border-border/60 bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-blue-500"
            />
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50" disabled={loading || lookupLoading || !queryRequired}>
            {loading || lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {mode === "artist" ? "Inspect artist" : mode === "artistSong" ? "Find albums" : "Find artist"}
          </button>
        </div>
      </form>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

      {discoverResult && (
        <section className="rounded-lg border border-border/60 bg-card p-6">
          <h2 className="font-semibold">Artist candidates from {discoverResult.type}</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {discoverResult.candidates.length === 0 ? (
              <p className="text-sm text-gray-500">No artist candidates found.</p>
            ) : discoverResult.candidates.map((candidate) => {
              const imageUrl = getCandidateImageUrl(candidate);

              return (
                <button
                  key={`${candidate.artistName}-${candidate.match}-${candidate.ids?.musicbrainzArtistId}`}
                  type="button"
                  onClick={() => inspectArtist(candidate.artistName)}
                  className={`rounded-lg border p-4 text-left transition-colors hover:bg-white/5 ${
                    selectedArtist === candidate.artistName ? "border-blue-500/50 bg-blue-500/10" : "border-border/60 bg-background/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <ArtistArtwork imageUrl={imageUrl} artistName={candidate.artistName} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-100">{candidate.artistName}</div>
                          <div className="mt-1 truncate text-sm text-gray-500">{candidate.match || discoverResult.query}</div>
                        </div>
                        {candidate.score !== undefined && <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-xs text-gray-400">{candidate.score}</span>}
                      </div>
                      {candidate.disambiguation && <p className="mt-2 line-clamp-2 text-xs text-gray-500">{candidate.disambiguation}</p>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {songAlbumResult && (
        <section className="rounded-lg border border-border/60 bg-card p-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold">Albums containing "{songAlbumResult.song}"</h2>
            <p className="text-sm text-gray-500">Artist: {songAlbumResult.artist} / Source: {songAlbumResult.source}</p>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {songAlbumResult.albums.length === 0 ? (
              <p className="text-sm text-gray-500">No albums found for that artist and song.</p>
            ) : songAlbumResult.albums.map((album) => (
              <div key={`${album.albumName}-${album.ids?.itunesCollectionId || album.ids?.musicbrainzReleaseId}`} className="rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="flex gap-3">
                  {album.imageUrl ? (
                    <img src={album.imageUrl} alt="" className="h-16 w-16 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-md bg-white/5 text-gray-500">
                      <Disc3 className="h-6 w-6" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-100">{album.albumName}</div>
                    <div className="mt-1 text-sm text-gray-500">{album.year ?? "--"} / {album.source}</div>
                    <div className="mt-1 truncate text-xs text-gray-600">{album.songName}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border/60 bg-card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">{selectedArtist ? `Result for ${selectedArtist}` : "Result"}</h2>
            {artistResult && (
              <p className="mt-1 text-sm text-gray-500">
                {artistAlbums.length} releases {artistResult.traceId ? `/ trace ${artistResult.traceId}` : ""}
              </p>
            )}
          </div>
          {artistResult && (
            <div className="flex flex-wrap items-center gap-3">
              {cacheMeta && (
                <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cacheMeta.hit ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                    Cache {cacheMeta.status}
                  </span>
                  <span className="text-gray-500">
                    TTL {formatDuration(cacheMeta.ttlSeconds)}
                    {cacheMeta.hit ? ` / ${formatDuration(cacheMeta.remainingSeconds)} left` : ""}
                  </span>
                </div>
              )}
              <div className="inline-flex rounded-md border border-border/70 bg-background p-1">
                <button
                  type="button"
                  onClick={() => setResultView("visual")}
                  className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors ${
                    resultView === "visual" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  <Grid2X2 className="h-4 w-4" />
                  Visual
                </button>
                <button
                  type="button"
                  onClick={() => setResultView("json")}
                  className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors ${
                    resultView === "json" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  <Braces className="h-4 w-4" />
                  JSON
                </button>
              </div>
            </div>
          )}
        </div>
        {lookupLoading ? (
          <div className="mt-4 text-sm text-gray-500">Loading artist details...</div>
        ) : artistResult ? (
          resultView === "json" ? (
            <pre className="mt-4 max-h-[620px] overflow-auto rounded-md bg-black/30 p-4 text-xs text-gray-300">{JSON.stringify(artistResult, null, 2)}</pre>
          ) : (
            <div className="mt-5 space-y-5">
              {artistPreview && (
                <div className="flex gap-4 rounded-lg border border-border/60 bg-background/40 p-4">
                  <ArtistArtwork imageUrl={artistPreview.imageUrl} artistName={artistPreview.artistName} />
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold text-gray-100">{artistPreview.artistName || selectedArtist}</div>
                    {artistPreview.disambiguation && <div className="mt-1 text-sm text-gray-500">{artistPreview.disambiguation}</div>}
                    {artistPreview.overview && <p className="mt-2 line-clamp-3 text-sm text-gray-400">{artistPreview.overview}</p>}
                  </div>
                </div>
              )}

              <div className="inline-flex flex-wrap rounded-md border border-border/70 bg-background p-1">
                {[
                  { id: "albums", label: "Album Covers", count: artistAlbums.length },
                  { id: "artist", label: "Artist Images", count: artistImages.length },
                  { id: "debug", label: "Image Debug", count: imageDebug.length },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setImageTab(tab.id as ImageTab)}
                    className={`rounded px-3 py-1.5 text-sm transition-colors ${
                      imageTab === tab.id ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {tab.label} <span className="text-xs text-gray-500">{tab.count}</span>
                  </button>
                ))}
              </div>

              {imageTab === "albums" && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {artistAlbums.length === 0 ? (
                    <p className="col-span-full text-sm text-gray-500">No releases found for this artist.</p>
                  ) : artistAlbums.map((album, index) => (
                    <article key={`${album.id || album.title}-${index}`} className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <AlbumArtwork
                        album={album}
                        onOpen={album.imageUrl ? () => {
                          const imageIndex = albumLightboxImages.findIndex((image) => image.url === album.imageUrl);

                          if (imageIndex !== -1) {
                            openLightbox(albumLightboxImages, imageIndex);
                          }
                        } : undefined}
                      />
                      <div className="mt-3 min-w-0 space-y-2">
                        <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-100">{album.title}</div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-500">{album.year || "--"}</span>
                          <ProviderPill provider={album.provider} />
                        </div>
                        <AlbumRating rating={album.rating} />
                        {album.id && <div className="truncate text-[11px] text-gray-600">{album.id}</div>}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {imageTab === "artist" && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {artistImages.length === 0 ? (
                    <p className="col-span-full text-sm text-gray-500">No artist images found for this result.</p>
                  ) : artistImages.map((image, index) => (
                    <article key={`${image.coverType}-${image.url}`} className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <ImagePreview url={image.url} alt={`${image.coverType} image`} onOpen={() => openLightbox(artistLightboxImages, index)} />
                      <div className="mt-3 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-xs capitalize text-gray-300">{image.coverType}</span>
                          {image.type && <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-xs capitalize text-gray-500">{image.type}</span>}
                        </div>
                        <div className="truncate text-xs text-gray-500">{image.source || "source unknown"}</div>
                        {(image.width || image.height) && <div className="text-xs text-gray-600">{image.width || 0} x {image.height || 0}</div>}
                        <div className="truncate text-[11px] text-gray-600">{image.url}</div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {imageTab === "debug" && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {imageDebug.length === 0 ? (
                    <p className="col-span-full text-sm text-gray-500">No image scoring data found for this result.</p>
                  ) : imageDebug.map((image, index) => (
                    <article key={`${image.source}-${image.type}-${image.url}`} className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <ImagePreview url={image.url} alt={`${image.type || "debug"} image`} onOpen={() => openLightbox(debugLightboxImages, index)} />
                      <div className="mt-3 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-xs capitalize text-gray-300">{image.type || "unknown"}</span>
                          <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-xs text-gray-500">score {image.score ?? 0}</span>
                        </div>
                        <div className="truncate text-xs text-gray-500">{image.source || "source unknown"}</div>
                        <div className="truncate text-[11px] text-gray-600">{image.url}</div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )
        ) : (
          <p className="mt-4 text-sm text-gray-500">Run a query to inspect ranking, normalization, raw provider output, and cache behavior.</p>
        )}
      </section>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={lightboxImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </main>
  );
}
