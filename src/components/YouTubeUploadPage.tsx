import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  LoaderCircle,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { AnalyzeResponse, BatchRenderProgress, RenderClipStatus, ViralClip } from '../types';
import { buildClipsMarkdown, findMarkdownEntry, parseClipsMarkdown } from '../utils/clipMarkdown';
import { YouTubeUploadQueue, type YouTubeUploadItem } from './YouTubeUploadQueue';

export interface YouTubeUploadMetadata {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: 'private' | 'unlisted' | 'public';
  publishAt?: string;
  playlistId?: string;
  thumbnail?: File | null;
  madeForKids?: boolean;
}

interface YouTubeConnectionStatus {
  connected: boolean;
  configured: boolean;
  channel_title?: string;
}

interface YouTubeUploadPageProps {
  result: AnalyzeResponse;
  batchProgress: BatchRenderProgress | null;
  youtubeStatus: YouTubeConnectionStatus;
  playlists: Array<{ id: string; title: string }>;
  uploads: YouTubeUploadItem[];
  onDisconnect: () => void;
  onUpload: (
    clip: RenderClipStatus,
    sourceClip: ViralClip | undefined,
    metadata: YouTubeUploadMetadata,
  ) => Promise<void>;
  onBackToClipper: () => void;
}

interface UploadDraft {
  title: string;
  description: string;
  tags: string;
}

const cleanTag = (tag: string) => tag.replace(/^#/, '').trim();

export function YouTubeUploadPage({
  result,
  batchProgress,
  youtubeStatus,
  playlists,
  uploads,
  onDisconnect,
  onUpload,
  onBackToClipper,
}: YouTubeUploadPageProps) {
  const [drafts, setDrafts] = useState<Record<string, UploadDraft>>({});
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [publishAt, setPublishAt] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [madeForKids, setMadeForKids] = useState(false);
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});
  const [busyAll, setBusyAll] = useState(false);
  const [copyState, setCopyState] = useState('');
  const [uploadSettingsHydrated, setUploadSettingsHydrated] = useState(false);
  const savedDraftsRef = useRef<Record<string, Record<string, UploadDraft>>>({});

  const markdown = useMemo(() => buildClipsMarkdown(result), [result]);
  const entries = useMemo(() => parseClipsMarkdown(markdown), [markdown]);
  const completedClips = useMemo(
    () => (batchProgress?.clips || []).filter(clip => clip.status === 'completed' && Boolean(clip.download_url)),
    [batchProgress],
  );

  const getSourceIndex = (clip: RenderClipStatus) => clip.source_index ?? clip.clip_index;

  const getSourceClip = (clip: RenderClipStatus): ViralClip | undefined => {
    const sourceIndex = getSourceIndex(clip);
    return result.clips[sourceIndex] || result.clips[clip.clip_index];
  };

  const signature = useMemo(
    () => completedClips.map(clip => `${clip.clip_index}:${getSourceIndex(clip)}:${clip.title}`).join('|'),
    [completedClips],
  );

  // Restore upload drafts and defaults saved by this installation so typed
  // metadata is not lost when the user switches browsers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/app-settings');
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const settings = payload?.settings;
        if (!settings || typeof settings !== 'object' || cancelled) return;

        const savedDrafts = settings.youtube_upload_drafts;
        if (savedDrafts && typeof savedDrafts === 'object') {
          savedDraftsRef.current = savedDrafts as Record<string, Record<string, UploadDraft>>;
        }

        const defaults = settings.youtube_upload_defaults;
        if (defaults && typeof defaults === 'object') {
          if (defaults.privacy === 'private' || defaults.privacy === 'unlisted' || defaults.privacy === 'public') {
            setPrivacy(defaults.privacy);
          }
          if (typeof defaults.playlistId === 'string') setPlaylistId(defaults.playlistId);
          if (typeof defaults.madeForKids === 'boolean') setMadeForKids(defaults.madeForKids);
        }
      } catch {
        // Generated metadata remains available without saved drafts.
      } finally {
        if (!cancelled) setUploadSettingsHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const next: Record<string, UploadDraft> = {};
    const savedForVideo = savedDraftsRef.current[result.video_id] || {};
    completedClips.forEach(clip => {
      const sourceIndex = getSourceIndex(clip);
      const sourceClip = getSourceClip(clip);
      const entry = findMarkdownEntry(entries, sourceIndex) || entries[clip.clip_index];
      const fallbackTitle = clip.is_merged
        ? clip.title
        : (sourceClip?.title_suggestion || clip.title || entry?.headingTitle || 'Clip');
      const hashtags = [
        ...(entry?.hashtags || []),
        ...(sourceClip?.hashtag_suggestion || '').split(/[\s,]+/),
      ].map(cleanTag).filter(Boolean);
      const uniqueTags = Array.from(new Set(hashtags));
      const descriptionParts = [
        clip.is_merged ? '' : (entry?.caption || sourceClip?.caption_suggestion || ''),
        result.summary || '',
      ].filter(part => part.trim());
      const generated: UploadDraft = {
        title: fallbackTitle.slice(0, 100),
        description: descriptionParts.join('\n\n').slice(0, 5000),
        tags: uniqueTags.join(' '),
      };
      // Drafts are keyed by clip source + rendered title so a re-analysis with
      // new metadata is not overwritten by stale saved text.
      const saved = savedForVideo[`${sourceIndex}_${clip.title}`];
      next[String(clip.clip_index)] = saved ? { ...generated, ...saved } : generated;
    });
    setDrafts(next);
    // Rebuild when the rendered clip set, video, or saved drafts hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, result.video_id, uploadSettingsHydrated]);

  // Persist the per-video drafts and channel defaults on the server.
  useEffect(() => {
    if (!uploadSettingsHydrated || Object.keys(drafts).length === 0) return;
    const keyed: Record<string, UploadDraft> = {};
    completedClips.forEach(clip => {
      const draft = drafts[String(clip.clip_index)];
      if (draft) keyed[`${getSourceIndex(clip)}_${clip.title}`] = draft;
    });
    savedDraftsRef.current[result.video_id] = {
      ...(savedDraftsRef.current[result.video_id] || {}),
      ...keyed,
    };
    const timer = window.setTimeout(() => {
      fetch('/api/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { youtube_upload_drafts: savedDraftsRef.current } }),
      }).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, result.video_id, uploadSettingsHydrated]);

  useEffect(() => {
    if (!uploadSettingsHydrated) return;
    const timer = window.setTimeout(() => {
      fetch('/api/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { youtube_upload_defaults: { privacy, playlistId, madeForKids } },
        }),
      }).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [privacy, playlistId, madeForKids, uploadSettingsHydrated]);

  const updateDraft = (key: string, patch: Partial<UploadDraft>) => {
    setDrafts(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState('MD copied');
      window.setTimeout(() => setCopyState(''), 2500);
    } catch {
      setCopyState('Copy failed');
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cheat_clip_metadata_${result.video_id || 'clips'}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const buildMetadata = (clip: RenderClipStatus): YouTubeUploadMetadata => {
    const draft = drafts[String(clip.clip_index)] || { title: clip.title, description: '', tags: '' };
    const tags = draft.tags
      .split(/[\s,]+/)
      .map(cleanTag)
      .filter(Boolean);
    return {
      title: (draft.title.trim() || clip.title || 'YouTube clip').slice(0, 100),
      description: draft.description.slice(0, 5000),
      tags,
      privacyStatus: privacy,
      publishAt: publishAt ? new Date(publishAt).toISOString() : undefined,
      playlistId: playlistId || undefined,
      thumbnail,
      madeForKids,
    };
  };

  const uploadOne = async (clip: RenderClipStatus) => {
    const key = String(clip.clip_index);
    setBusyKeys(prev => ({ ...prev, [key]: true }));
    try {
      await onUpload(clip, getSourceClip(clip), buildMetadata(clip));
    } finally {
      setBusyKeys(prev => ({ ...prev, [key]: false }));
    }
  };

  const uploadAll = async () => {
    setBusyAll(true);
    try {
      for (const clip of completedClips) {
        await uploadOne(clip);
      }
    } finally {
      setBusyAll(false);
    }
  };

  const fileLabel = (clip: RenderClipStatus) => {
    const raw = (clip.download_url || '').split('?')[0].split('/').pop() || 'rendered clip';
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  return (
    <section className="glass-panel youtube-upload-page">
      <header className="youtube-page-header">
        <div>
          <div className="youtube-page-eyebrow">04 // PUBLISH</div>
          <h2>YouTube Upload</h2>
          <p>Gunakan metadata MD yang sudah dibuat, lalu unggah klip hasil render.</p>
        </div>
        <button type="button" className="toolbar-action-btn" onClick={onBackToClipper}>
          ← Auto Clipper
        </button>
      </header>

      <div className={`youtube-connect-card ${youtubeStatus.connected ? 'connected' : ''}`}>
        <div className="youtube-connect-info">
          <span className="youtube-connect-dot" />
          <div>
            <strong>
              {youtubeStatus.connected
                ? `Terhubung: ${youtubeStatus.channel_title || 'YouTube Channel'}`
                : youtubeStatus.configured
                  ? 'Channel YouTube belum terhubung'
                  : 'OAuth YouTube belum dikonfigurasi'}
            </strong>
            <span>
              {youtubeStatus.connected
                ? 'Upload akan dikirim ke channel ini.'
                : 'Hubungkan channel untuk mengaktifkan upload, playlist, dan scheduling.'}
            </span>
          </div>
        </div>
        <div className="youtube-connect-actions">
          {youtubeStatus.connected ? (
            <button type="button" className="toolbar-action-btn" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="glowing-btn"
              disabled={!youtubeStatus.configured}
              onClick={() => { window.location.href = '/api/youtube/oauth/start'; }}
            >
              Connect YouTube
            </button>
          )}
        </div>
      </div>

      <div className="youtube-md-bar">
        <div className="youtube-md-label">
          <FileText size={15} />
          <span>
            Metadata MD · {entries.length} klip · {completedClips.length} file siap upload
          </span>
        </div>
        <div className="youtube-md-actions">
          <button type="button" className="toolbar-action-btn" onClick={copyMarkdown}>
            <Copy size={13} /> {copyState || 'Copy MD'}
          </button>
          <button type="button" className="toolbar-action-btn" onClick={downloadMarkdown}>
            Download .md
          </button>
        </div>
      </div>

      <div className="youtube-defaults">
        <label>
          Privacy
          <select value={privacy} onChange={event => setPrivacy(event.target.value as typeof privacy)}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label>
          Publish at
          <input type="datetime-local" value={publishAt} onChange={event => setPublishAt(event.target.value)} />
        </label>
        <label>
          Playlist
          <select value={playlistId} onChange={event => setPlaylistId(event.target.value)}>
            <option value="">No playlist</option>
            {playlists.map(item => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </label>
        <label>
          Thumbnail
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={event => setThumbnail(event.target.files?.[0] || null)}
          />
        </label>
        <label className="youtube-checkbox">
          <input type="checkbox" checked={madeForKids} onChange={event => setMadeForKids(event.target.checked)} />
          Made for kids
        </label>
      </div>

      {publishAt && (
        <p className="youtube-page-hint">
          <AlertTriangle size={13} /> Scheduling memaksa privacy menjadi Private sampai waktu publish tiba.
        </p>
      )}
      <p className="youtube-page-hint">
        <AlertTriangle size={13} /> Riwayat render dan file tersimpan di server. File hanya dibersihkan jika kuota penyimpanan penuh.
      </p>
      {thumbnail && <p className="youtube-page-hint">Thumbnail: {thumbnail.name}</p>}

      {completedClips.length === 0 ? (
        <div className="youtube-empty-state">
          <Upload size={28} />
          <h3>Belum ada klip yang selesai dirender</h3>
          <p>Kembali ke Auto Clipper, pilih klip, lalu jalankan render. Setelah selesai, file akan muncul di sini.</p>
          <button type="button" className="glowing-btn" onClick={onBackToClipper}>
            Buka Auto Clipper
          </button>
        </div>
      ) : (
        <>
          <div className="youtube-list-header">
            <span>{completedClips.length} klip siap upload</span>
            <button
              type="button"
              className="glowing-btn"
              disabled={!youtubeStatus.connected || busyAll}
              onClick={uploadAll}
            >
              {busyAll ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}
              {busyAll ? 'Mengunggah...' : 'Upload Semua'}
            </button>
          </div>

          <div className="youtube-clip-list">
            {completedClips.map(clip => {
              const key = String(clip.clip_index);
              const sourceIndex = getSourceIndex(clip);
              const sourceClip = getSourceClip(clip);
              const entry = findMarkdownEntry(entries, sourceIndex) || entries[clip.clip_index];
              const draft = drafts[key] || { title: clip.title, description: '', tags: '' };
              const isBusy = Boolean(busyKeys[key]);
              const latestUpload = uploads.find(item => item.title === draft.title.trim());

              return (
                <article className="youtube-clip-card" key={key}>
                  <header>
                    <div>
                      <span className="youtube-clip-index">#{sourceIndex + 1}</span>
                      <strong>{clip.title}</strong>
                      {typeof sourceClip?.virality_score === 'number' && (
                        <span className="youtube-clip-score">{sourceClip.virality_score}%</span>
                      )}
                    </div>
                    <span className="youtube-file-name" title={fileLabel(clip)}>
                      {fileLabel(clip)}
                    </span>
                  </header>

                  <div className="youtube-clip-fields">
                    <label>
                      Title
                      <input
                        value={draft.title}
                        maxLength={100}
                        onChange={event => updateDraft(key, { title: event.target.value })}
                      />
                    </label>
                    <label>
                      Description
                      <textarea
                        rows={5}
                        value={draft.description}
                        onChange={event => updateDraft(key, { description: event.target.value })}
                      />
                    </label>
                    <label>
                      Tags
                      <input
                        value={draft.tags}
                        onChange={event => updateDraft(key, { tags: event.target.value })}
                      />
                    </label>
                  </div>

                  <div className="youtube-clip-footer">
                    <span>
                      {entry ? 'Metadata dari MD' : 'Metadata dari klip'}
                      {sourceClip?.title_suggestion ? ` · ${sourceClip.title_suggestion}` : ''}
                    </span>
                    <div>
                      <button
                        type="button"
                        className="toolbar-action-btn"
                        onClick={() => {
                          const source = getSourceClip(clip);
                          const entryData = findMarkdownEntry(entries, sourceIndex);
                          updateDraft(key, {
                            title: (clip.is_merged
                              ? clip.title
                              : (entryData?.title || source?.title_suggestion || clip.title)).slice(0, 100),
                            description: [
                              clip.is_merged ? '' : (entryData?.caption || source?.caption_suggestion || ''),
                              result.summary || '',
                            ]
                              .filter(Boolean)
                              .join('\n\n')
                              .slice(0, 5000),
                            tags: Array.from(new Set([
                              ...(entryData?.hashtags || []),
                              ...((source?.hashtag_suggestion || '').split(/[\s,]+/)),
                            ].map(cleanTag).filter(Boolean))).join(' '),
                          });
                        }}
                      >
                        <RefreshCw size={12} /> Reset dari MD
                      </button>
                      <button
                        type="button"
                        className="glowing-btn"
                        disabled={!youtubeStatus.connected || isBusy}
                        onClick={() => uploadOne(clip)}
                      >
                        {isBusy ? <LoaderCircle size={13} className="spin" /> : <Upload size={13} />}
                        {isBusy ? 'Upload...' : 'Upload'}
                      </button>
                    </div>
                  </div>

                  {latestUpload && (
                    <div className={`youtube-inline-status status-${latestUpload.status}`}>
                      {latestUpload.status === 'completed' ? <CheckCircle2 size={13} /> : <LoaderCircle size={13} />}
                      <span>{latestUpload.status} · {latestUpload.progress || 0}%</span>
                      {latestUpload.url && (
                        <a href={latestUpload.url} target="_blank" rel="noreferrer">
                          Open video <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      <YouTubeUploadQueue items={uploads} />
    </section>
  );
}
