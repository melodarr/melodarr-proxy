"use client";

import { FormEvent, useState } from "react";
import { fetchJson } from "@/lib/fetcher";
import { Braces, Disc3, Grid2X2, Loader2, Music2, Search, UserRound } from "lucide-react";

type SearchMode = "artist" | "song" | "album" | "artistSong";

type Candidate = {
  artistName: string;
  type: string;
  source: string;
  match?: string;
  disambiguation?: string;
  score?: number;
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
};

const modes: Array<{ id: SearchMode; label: string; icon: typeof UserRound; placeholder: string }> = [
  { id: "artist", label: "Artist", icon: UserRound, placeholder: "Radiohead" },
  { id: "song", label: "Song", icon: Music2, placeholder: "Paranoid Android" },
  { id: "album", label: "Album", icon: Disc3, placeholder: "OK Computer" },
  { id: "artistSong", label: "Artist + Song", icon: Music2, placeholder: "Radiohead / Paranoid Android" },
];

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
      id,
    };
  });
}

function ProviderPill({ provider }: { provider?: string }) {
  if (!provider) return null;

  return (
    <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-xs capitalize text-gray-400">
      {provider}
    </span>
  );
}

function AlbumArtwork({ album }: { album: AlbumCard }) {
  return album.imageUrl ? (
    <img src={album.imageUrl} alt="" className="aspect-square w-full rounded-md object-cover" />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center rounded-md border border-border/60 bg-white/5 text-gray-500">
      <Disc3 className="h-8 w-8" />
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

  const inspectArtist = async (artistName: string) => {
    if (!artistName.trim()) return;

    setLookupLoading(true);
    setError(null);
    setSelectedArtist(artistName);
    setArtistResult(null);

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
  const cacheMeta = artistResult?.cache as CacheMeta | undefined;

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
            ) : discoverResult.candidates.map((candidate) => (
              <button
                key={`${candidate.artistName}-${candidate.match}-${candidate.ids?.musicbrainzArtistId}`}
                type="button"
                onClick={() => inspectArtist(candidate.artistName)}
                className={`rounded-lg border p-4 text-left transition-colors hover:bg-white/5 ${
                  selectedArtist === candidate.artistName ? "border-blue-500/50 bg-blue-500/10" : "border-border/60 bg-background/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-gray-100">{candidate.artistName}</div>
                    <div className="mt-1 text-sm text-gray-500">{candidate.match || discoverResult.query}</div>
                  </div>
                  {candidate.score !== undefined && <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-gray-400">{candidate.score}</span>}
                </div>
                {candidate.disambiguation && <p className="mt-2 text-xs text-gray-500">{candidate.disambiguation}</p>}
              </button>
            ))}
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
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {artistAlbums.length === 0 ? (
                <p className="col-span-full text-sm text-gray-500">No releases found for this artist.</p>
              ) : artistAlbums.map((album, index) => (
                <article key={`${album.id || album.title}-${index}`} className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <AlbumArtwork album={album} />
                  <div className="mt-3 min-w-0 space-y-2">
                    <div className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-gray-100">{album.title}</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">{album.year || "--"}</span>
                      <ProviderPill provider={album.provider} />
                    </div>
                    {album.id && <div className="truncate text-[11px] text-gray-600">{album.id}</div>}
                  </div>
                </article>
              ))}
            </div>
          )
        ) : (
          <p className="mt-4 text-sm text-gray-500">Run a query to inspect ranking, normalization, raw provider output, and cache behavior.</p>
        )}
      </section>
    </main>
  );
}
