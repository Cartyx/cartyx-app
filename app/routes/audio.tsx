import { useCallback, useMemo, useRef, useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMutation, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getMe } from '~/server/functions/rpc';
import { Topbar } from '~/components/Topbar';
import { AudioLibraryBrowser } from '~/components/audio/AudioLibraryBrowser';
import { AudioUploadDropzone } from '~/components/audio/AudioUploadDropzone';
import { AudioQuotaBar } from '~/components/audio/AudioQuotaBar';
import { AudioBulkTagBar } from '~/components/audio/AudioBulkTagBar';
import type { BulkTagPayload } from '~/components/audio/AudioBulkTagBar';
import { AudioAssetDetail } from '~/components/audio/AudioAssetDetail';
import { AudioOrphanCleanup } from '~/components/audio/AudioOrphanCleanup';
import type { AudioAssetDetailPayload } from '~/components/audio/AudioAssetDetail';
import type { AudioFilters } from '~/components/audio/AudioFilterBar';
import { ConfirmDialog } from '~/components/shared/ConfirmDialog';
import { useDeleteConfirm } from '~/hooks/useDeleteConfirm';
import {
  listAudioAssetsFn,
  bulkTagAudioAssetsFn,
  updateAudioAssetFn,
  deleteAudioAssetFn,
  retryAudioAssetFn,
  scanOrphanAudioFn,
  deleteOrphanAudioFn,
  getAudioStorageUsageFn,
} from '~/utils/audio-server-fns';
import { uploadOnceVariantFile } from '~/utils/uploadAudio';
import { queryKeys } from '~/utils/queryKeys';
import { captureException } from '~/utils/telemetry-client';
import type { AudioAssetData, AudioEnvironment, AudioMood } from '~/types/audio';
import type { ScanOrphanAudioResult } from '~/types/schemas/audio';

const POLL_MS = 4000;

/**
 * Server-side page size. The server caps `limit` at 200; 50 keeps the first
 * paint small while making "Load more" a rare click for a normal library.
 */
const PAGE_SIZE = 50;

/** One server page of the library: the rows plus the cursor to the next page. */
export type AudioPage = { items: AudioAssetData[]; nextCursor: string | null };

/**
 * Flattens the infinite query's page structure into the single list the UI
 * renders. Exported so `shouldPoll`'s "across pages" behaviour is directly
 * testable: a `pending` asset on page 2 must keep the poll alive exactly like
 * one on page 1, and a naive `pages[0].items` would silently stop polling as
 * soon as the user loaded a second page.
 */
export function flattenAudioPages(data: { pages: AudioPage[] } | undefined): AudioAssetData[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/** Stop polling once nothing is in flight — a settled library must go quiet. */
export function shouldPoll(assets: Pick<AudioAssetData, 'status'>[]): boolean {
  return assets.some(
    (a) => a.status === 'pending' || a.status === 'processing' || a.status === 'uploading'
  );
}

/**
 * Ordered `<source>` candidates for the plain `<audio>` preview element (see
 * the design doc: preview deliberately skips the Web Audio graph — that
 * engine arrives with the board). Opus/Ogg is listed first (Chrome/Firefox),
 * AAC/MP4 second (Safari/iOS): letting the browser negotiate over a
 * `<source>` list means each engine's actual codec support decides, rather
 * than us guessing at it with `canPlayType` ourselves. An asset whose
 * renditions haven't finished transcoding yet contributes zero candidates —
 * callers use that to skip mounting the `<audio>` element altogether, so a
 * not-yet-ready asset never produces a player with nothing playable inside.
 */
export function pickPlaybackSources(asset: AudioAssetData): { src: string; type: string }[] {
  const sources: { src: string; type: string }[] = [];
  if (asset.renditions.opus?.url) {
    sources.push({ src: asset.renditions.opus.url, type: 'audio/ogg' });
  }
  if (asset.renditions.aac?.url) {
    sources.push({ src: asset.renditions.aac.url, type: 'audio/mp4' });
  }
  return sources;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Exported (not inlined into the `createFileRoute` call) so it's directly
 * unit-testable without depending on the shape of whatever object
 * `createFileRoute` returns — that shape is a TanStack Router implementation
 * detail this route shouldn't need to know at test time. Matches
 * `dashboard.tsx`'s guard exactly: this is a per-user library, and every
 * server fn it calls throws without a session.
 */
export async function audioBeforeLoad() {
  const user = await getMe();
  if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
  return { user };
}

export const Route = createFileRoute('/audio')({
  beforeLoad: audioBeforeLoad,
  component: AudioLibraryPage,
});

export function AudioLibraryPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<AudioFilters>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<AudioAssetData | null>(null);
  const [orphanScan, setOrphanScan] = useState<ScanOrphanAudioResult | null>(null);
  const [lastOrphanDelete, setLastOrphanDelete] = useState<{
    deleted: number;
    failed: number;
  } | null>(null);

  // Generics pinned explicitly: without them TS widens the page type to
  // `unknown` (server-fn return inference doesn't survive useInfiniteQuery's
  // five-parameter inference), and every read off `query.data` silently loses
  // its type.
  const query = useInfiniteQuery<
    AudioPage,
    Error,
    InfiniteData<AudioPage>,
    QueryKey,
    string | null
  >({
    queryKey: queryKeys.audio.list(filters),
    queryFn: ({ pageParam }) =>
      listAudioAssetsFn({
        data: {
          ...filters,
          cursor: pageParam ?? undefined,
          // AudioFilterBar's `AudioFilters.environment`/`.mood` are declared
          // as plain `string[]` even though every value that ever lands in
          // them comes from `AUDIO_ENVIRONMENTS`/`AUDIO_MOODS` (that
          // component's own chip UI) — the schema's enum arrays are the
          // real constraint. Tightening `AudioFilters` itself is a Task 16
          // fix outside this route's scope; the server's zod schema
          // (`listAudioAssetsSchema`) is the actual runtime enforcement
          // boundary regardless of this cast.
          environment: filters.environment as AudioEnvironment[] | undefined,
          mood: filters.mood as AudioMood[] | undefined,
          limit: PAGE_SIZE,
        },
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Across every loaded page, not just the first: a `pending` asset the
    // user has paged down to must keep the poll alive, and a settled library
    // must still go quiet.
    refetchInterval: (q) => (shouldPoll(flattenAudioPages(q.state.data)) ? POLL_MS : false),
  });

  // Task 5: usage against the storage quota, shown near the dropzone. Not
  // part of the poll above — the quota only moves on ingest/delete, not on
  // transcode progress, so it doesn't need the 4s refetch. `invalidateAudio`
  // covers it below alongside every other audio-branch query.
  const usageQuery = useQuery({
    queryKey: queryKeys.audio.usage(),
    queryFn: () => getAudioStorageUsageFn(),
  });

  const assets = useMemo(() => flattenAudioPages(query.data), [query.data]);
  // The live record for whichever asset is being edited — not the snapshot
  // captured when Edit was clicked. AudioAssetDetail's reset effect keys off
  // `asset.id`, not object identity, specifically so this 4s poll can keep
  // its read-only fields (duration/status/lastError) fresh without wiping an
  // in-progress, unsaved edit out from under the user. See that component's
  // doc comment.
  const editingAsset = editingAssetId
    ? (assets.find((a) => a.id === editingAssetId) ?? null)
    : null;

  const invalidateAudio = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.audio.all });
  }, [qc]);

  /**
   * The whole `packages` key space, not one package's detail: this page never
   * learns WHICH packages referenced the asset that was just deleted — the
   * server-side prune does — so the only honest invalidation is the branch.
   * See `deleteMutation` below for why an asset delete is a package mutation.
   */
  const invalidatePackages = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.packages.all });
  }, [qc]);

  const bulk = useMutation({
    mutationFn: (payload: BulkTagPayload) =>
      bulkTagAudioAssetsFn({ data: { ids: selectedIds, ...payload } }),
    onSuccess: () => {
      setSelectedIds([]);
      invalidateAudio();
    },
    onError: (e) => captureException(e, { action: 'AudioLibraryPage.bulkTag' }),
  });

  const update = useMutation({
    mutationFn: (payload: AudioAssetDetailPayload & { id: string }) =>
      updateAudioAssetFn({ data: payload }),
    onSuccess: () => {
      setEditingAssetId(null);
      invalidateAudio();
    },
    onError: (e) => captureException(e, { action: 'AudioLibraryPage.updateAsset' }),
  });

  const retry = useMutation({
    mutationFn: (asset: AudioAssetData) => retryAudioAssetFn({ data: { id: asset.id } }),
    onSuccess: invalidateAudio,
    onError: (e) => captureException(e, { action: 'AudioLibraryPage.retryAsset' }),
  });

  // Task 18: attach a once-variant. Kept as its own mutation (not folded
  // into `update`) because it's a file upload with a different
  // presign/PUT/confirm shape, not a `updateAudioAssetFn` field edit — and
  // because the two can legitimately be in flight at once (editing facets
  // while the once-variant transcodes).
  const attachOnceVariant = useMutation({
    mutationFn: ({ assetId, file }: { assetId: string; file: File }) =>
      uploadOnceVariantFile(assetId, file),
    onSuccess: invalidateAudio,
    onError: (e) => captureException(e, { action: 'AudioLibraryPage.attachOnceVariant' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (asset: AudioAssetData) => deleteAudioAssetFn({ data: { id: asset.id } }),
    onSuccess: (_data, asset) => {
      setSelectedIds((prev) => prev.filter((id) => id !== asset.id));
      invalidateAudio();
      // Deleting an asset is not only an AUDIO mutation: `deleteAudioAsset`
      // (Task 20) also prunes every package item that referenced it, and every
      // mood state that referenced those items. Invalidating `audio.all` alone
      // left every cached `packages.*` query describing a package that no
      // longer exists in that shape — and the editor route seeds its local
      // draft from that cache exactly once, so an editor tab opened before the
      // delete would `$set` the pruned item and its mood states straight back,
      // pointing at an `assetId` Mongo no longer has. No race needed: the
      // stale tab only has to still be open. The prune's own comment calls
      // this tombstone accumulation "a slow leak"; refilling it by hand is
      // worse than never pruning, because the row it recreates cannot be
      // cleaned up by deleting the asset again.
      invalidatePackages();
    },
    onError: (e) => captureException(e, { action: 'AudioLibraryPage.deleteAsset' }),
  });

  // Orphan cleanup is a deliberate, explicit action, not part of the 4s poll:
  // it costs a HeadObject per candidate key, and nothing about it changes on
  // its own between clicks.
  const scanOrphans = useMutation({
    mutationFn: () => scanOrphanAudioFn({ data: {} }),
    onSuccess: (data) => {
      setLastOrphanDelete(null);
      setOrphanScan(data);
    },
    onError: (e) => captureException(e, { action: 'AudioLibraryPage.scanOrphanAudio' }),
  });

  const deleteOrphans = useMutation({
    mutationFn: (keys: string[]) => deleteOrphanAudioFn({ data: { keys } }),
    onSuccess: (res) => {
      setLastOrphanDelete({ deleted: res.deleted.length, failed: res.failed.length });
      // Drop the stale list rather than leaving deleted rows on screen; the
      // user re-scans to see what is left.
      setOrphanScan((prev) => (prev ? { ...prev, orphans: [] } : prev));
    },
    onError: (e) => captureException(e, { action: 'AudioLibraryPage.deleteOrphanAudio' }),
  });

  const { pendingDelete, deleteError, requestDelete, cancelDelete, confirmDelete } =
    useDeleteConfirm<AudioAssetData>(
      (asset) => deleteMutation.mutateAsync(asset),
      'Failed to delete audio asset. Please try again.'
    );

  // `useDeleteConfirm` hands back a fresh `requestDelete` closure on every
  // render (it isn't itself useCallback-wrapped). AudioAssetRow is
  // React.memo'd and only bails out when it's handed referentially stable
  // callbacks (see that component's doc comment) — up to ~400 SVG <rect>s
  // per row's waveform means an unstable onDelete would silently reintroduce
  // a full-list re-render on every checkbox click. Routing through a ref
  // keeps the callback we hand to the row stable (empty deps below) while
  // always invoking the LATEST requestDelete implementation.
  const requestDeleteRef = useRef(requestDelete);
  requestDeleteRef.current = requestDelete;

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handlePlay = useCallback((asset: AudioAssetData) => {
    if (pickPlaybackSources(asset).length === 0) return;
    setNowPlaying(asset);
  }, []);

  const handleEdit = useCallback((asset: AudioAssetData) => {
    // No explicit update.reset() needed here: every non-success dismissal
    // path (Cancel/X/Escape/backdrop) already routes through onClose below,
    // which resets the mutation — so a stale error from a previous edit
    // can't survive to the next time this modal opens.
    setEditingAssetId(asset.id);
  }, []);

  const handleDelete = useCallback((asset: AudioAssetData) => {
    requestDeleteRef.current(asset);
  }, []);

  // Same stable-reference discipline as handleDelete above — AudioAssetRow is
  // React.memo'd and only bails out when every callback it receives is
  // referentially stable.
  const retryRef = useRef(retry.mutate);
  retryRef.current = retry.mutate;
  const handleRetry = useCallback((asset: AudioAssetData) => {
    retryRef.current(asset);
  }, []);

  const { fetchNextPage } = query;
  const handleLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const handleClearSelection = useCallback(() => setSelectedIds([]), []);

  const playbackSources = nowPlaying ? pickPlaybackSources(nowPlaying) : [];

  return (
    <div className="min-h-screen bg-[#0D1117] text-slate-200">
      {/* Matches dashboard.tsx: without it /audio has no nav chrome at all —
          reachable only by typing the URL and escapable only via browser back. */}
      <Topbar />
      <main className="px-4 py-6">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 font-sans text-sm font-bold uppercase tracking-widest text-blue-400">
            Audio library
          </h1>

          <AudioUploadDropzone onUploaded={invalidateAudio} />

          <AudioQuotaBar
            usageBytes={usageQuery.data?.bytes ?? null}
            assetCount={usageQuery.data?.assetCount ?? 0}
            limitBytes={usageQuery.data?.limitBytes ?? null}
            error={
              usageQuery.error
                ? errorMessage(usageQuery.error, 'Failed to load storage usage.')
                : null
            }
          />

          {nowPlaying && playbackSources.length > 0 && (
            <div className="mt-4 flex items-center gap-3 rounded border border-white/[0.07] bg-white/[0.02] p-3">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
                Now playing: {nowPlaying.title}
              </span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- this
                is an ambience/music/one-shot SFX preview, not spoken
                dialogue; there's no caption track to attach. */}
              <audio
                key={nowPlaying.id}
                controls
                autoPlay
                className="h-8 max-w-xs"
                onEnded={() => setNowPlaying(null)}
              >
                {playbackSources.map((s) => (
                  <source key={s.type} src={s.src} type={s.type} />
                ))}
              </audio>
              <button
                type="button"
                onClick={() => setNowPlaying(null)}
                aria-label="Stop preview"
                className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="mt-4 rounded border border-white/[0.07]">
            <AudioLibraryBrowser
              assets={assets}
              loading={query.isLoading}
              filters={filters}
              onFiltersChange={setFilters}
              selectable
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onPlay={handlePlay}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRetry={handleRetry}
              hasMore={query.hasNextPage}
              loadingMore={query.isFetchingNextPage}
              onLoadMore={handleLoadMore}
              actionsSlot={
                <div>
                  <AudioBulkTagBar
                    selectedCount={selectedIds.length}
                    onApply={(p) => bulk.mutate(p)}
                    onClear={handleClearSelection}
                  />
                  {bulk.isPending && (
                    <p className="px-3 pb-2 font-sans text-xs text-slate-400">
                      Applying to {selectedIds.length} asset{selectedIds.length === 1 ? '' : 's'}…
                    </p>
                  )}
                  {bulk.error && (
                    <p role="alert" className="px-3 pb-2 font-sans text-xs text-red-400">
                      {errorMessage(bulk.error, 'Failed to apply tags. Please try again.')}
                    </p>
                  )}
                </div>
              }
            />
          </div>

          <AudioOrphanCleanup
            result={orphanScan}
            scanning={scanOrphans.isPending}
            deleting={deleteOrphans.isPending}
            error={
              scanOrphans.error
                ? errorMessage(scanOrphans.error, 'Failed to scan for orphaned files.')
                : deleteOrphans.error
                  ? errorMessage(deleteOrphans.error, 'Failed to delete orphaned files.')
                  : null
            }
            lastDelete={lastOrphanDelete}
            onScan={() => scanOrphans.mutate()}
            onDelete={(keys) => deleteOrphans.mutate(keys)}
          />

          {editingAsset && (
            <AudioAssetDetail
              asset={editingAsset}
              onSave={(payload: AudioAssetDetailPayload) =>
                update.mutate({ id: editingAsset.id, ...payload })
              }
              onClose={() => {
                update.reset();
                attachOnceVariant.reset();
                setEditingAssetId(null);
              }}
              saving={update.isPending}
              error={update.error ? errorMessage(update.error, 'Failed to save changes.') : null}
              onAttachOnceVariant={(file) =>
                attachOnceVariant.mutate({ assetId: editingAsset.id, file })
              }
              attachingOnceVariant={attachOnceVariant.isPending}
              onceVariantError={
                attachOnceVariant.error
                  ? errorMessage(
                      attachOnceVariant.error,
                      'Failed to attach once-variant. Please try again.'
                    )
                  : null
              }
            />
          )}

          {pendingDelete && (
            <ConfirmDialog
              title="Delete audio asset"
              message={`Delete "${pendingDelete.title}"? This removes the file from storage and cannot be undone.`}
              confirmLabel="Delete"
              danger
              isLoading={deleteMutation.isPending}
              error={deleteError}
              onConfirm={confirmDelete}
              onCancel={cancelDelete}
            />
          )}

          {retry.error && (
            <p role="alert" className="mt-3 font-sans text-xs text-red-400">
              {errorMessage(retry.error, 'Failed to retry processing. Please try again.')}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
