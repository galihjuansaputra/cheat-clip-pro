import React from 'react';
import {
  Play,
  Download,
  RotateCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Bot,
  Bookmark,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Trash2,
  Scissors,
  Layers
} from 'lucide-react';
import { HeatmapTimeline } from '../HeatmapTimeline';
import { useLanguage } from '../../locales';
import type { HistoryEntry, AnalyzeResponse, ViralClip } from '../../types';
import { formatSeconds, extractHashtagsAndText } from '../../utils/formatUtils';

export interface RecommendedClipsTabProps {
  isActive: boolean;
  history: HistoryEntry[];
  showHistory: boolean;
  setShowHistory: (val: boolean | ((prev: boolean) => boolean)) => void;
  historySearchQuery: string;
  setHistorySearchQuery: (q: string) => void;
  filteredHistory: HistoryEntry[];
  confirmClearAll: boolean;
  setConfirmClearAll: (val: boolean) => void;
  clearAllHistory: () => void;
  deleteHistoryEntry: (entry: HistoryEntry, e: React.MouseEvent) => void;
  loadFromHistory: (entry: HistoryEntry) => void;
  formatRelTime: (iso: string) => string;
  // Analysis & Loading
  loading: boolean;
  currentStep: number;
  overallProgress: number;
  stepProgress: Record<number, number>;
  aiStage: string;
  aiDetail: string;
  loadingDetails: string;
  loadingTooLong: boolean;
  activeProcessingModel: string;
  loadingElapsedTime: number;
  handleCancelAnalyze: () => void;
  loadingSectionRef: React.RefObject<HTMLElement | null>;
  // Active Video & Player
  result: AnalyzeResponse | null;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  directVideoPlayerRef: React.RefObject<HTMLVideoElement | null>;
  activeClip: ViralClip | null;
  setActiveClip: (clip: ViralClip | null) => void;
  handleSeek: (seconds: number) => void;
  handleRefreshPlayer: () => void;
  handleDownloadRawVideo: (forceProceed?: boolean | React.MouseEvent) => void;
  handleCancelRawDownload: (jobId: string) => void;
  isDownloadingRaw: boolean;
  rawDownloadProgress: any;
  currentSubtitle?: { text: string };
  startTracking: () => void;
  stopTracking: () => void;
  playClip: (clip: ViralClip) => void;
  subtitlesSource: 'youtube' | 'manual';
  selectedModel: string;
  // Search & Filters
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  viralityFilter: 'all' | 'high' | 'medium' | 'marked';
  setViralityFilter: (f: 'all' | 'high' | 'medium' | 'marked') => void;
  sortBy: 'virality' | 'time' | 'duration' | 'marked';
  setSortBy: (s: 'virality' | 'time' | 'duration' | 'marked') => void;
  // Clips list & actions
  sortedClips: ViralClip[];
  markedClips: Record<string, boolean>;
  toggleMarkedClip: (clipId: string) => void;
  toggleAllMarkedClips: (forceSelect?: boolean) => void;
  expandedClipIndex: number | null;
  setExpandedClipIndex: (idx: number | null | ((prev: number | null) => number | null)) => void;
  clipDownloadStates: Record<string, any>;
  setTrimmerClip: (clip: ViralClip | null) => void;
  handleCopyTimestamp: (clip: ViralClip, e?: React.MouseEvent) => void;
  handleCopyClip: (clip: ViralClip, e?: React.MouseEvent) => void;
  handleCopyText: (text: string, label: string) => void;
  handleDownloadRawClip: (clip: ViralClip, e?: React.MouseEvent) => void;
  handleCancelRawClipDownload: (jobId: string, clipKey: string) => void;
  handleCopyAllMarkdown: () => void;
  handleExportJSON: () => void;
  handleExportSRT: () => void;
  copyTimestampMenuTarget: 'toolbar' | 'overview' | null;
  setCopyTimestampMenuTarget: (target: 'toolbar' | 'overview' | null | ((prev: 'toolbar' | 'overview' | null) => 'toolbar' | 'overview' | null)) => void;
  copyTimestampScope: 'all' | 'marked';
  setCopyTimestampScope: (scope: 'all' | 'marked') => void;
  handleCopyTimestampsFormat: (format: 'only' | 'with_title' | 'youtube', scope?: 'all' | 'marked', e?: React.MouseEvent) => void;
  // Panel resizing
  leftPanelHeight: number | null;
  leftPanelRef: React.RefObject<HTMLDivElement | null>;
  // Navigation
  setWorkflowTab: (tab: 'source' | 'clips' | 'clipper') => void;
}

export const RecommendedClipsTab: React.FC<RecommendedClipsTabProps> = ({
  isActive,
  history,
  showHistory,
  setShowHistory,
  historySearchQuery,
  setHistorySearchQuery,
  filteredHistory,
  confirmClearAll,
  setConfirmClearAll,
  clearAllHistory,
  deleteHistoryEntry,
  loadFromHistory,
  formatRelTime,
  loading,
  currentStep,
  overallProgress,
  stepProgress,
  aiStage,
  aiDetail,
  loadingDetails,
  loadingTooLong,
  activeProcessingModel,
  loadingElapsedTime,
  handleCancelAnalyze,
  loadingSectionRef,
  result,
  currentTime,
  setCurrentTime,
  directVideoPlayerRef,
  activeClip,
  setActiveClip,
  handleSeek,
  handleRefreshPlayer,
  handleDownloadRawVideo,
  handleCancelRawDownload,
  isDownloadingRaw,
  rawDownloadProgress,
  currentSubtitle,
  startTracking,
  stopTracking,
  playClip,
  subtitlesSource,
  selectedModel,
  searchQuery,
  setSearchQuery,
  viralityFilter,
  setViralityFilter,
  sortBy,
  setSortBy,
  sortedClips,
  markedClips,
  toggleMarkedClip,
  toggleAllMarkedClips,
  expandedClipIndex,
  setExpandedClipIndex,
  clipDownloadStates,
  setTrimmerClip,
  handleCopyTimestamp,
  handleCopyClip,
  handleCopyText,
  handleDownloadRawClip,
  handleCancelRawClipDownload,
  handleCopyAllMarkdown,
  handleExportJSON,
  handleExportSRT,
  copyTimestampMenuTarget,
  setCopyTimestampMenuTarget,
  copyTimestampScope,
  setCopyTimestampScope,
  handleCopyTimestampsFormat,
  leftPanelHeight,
  leftPanelRef,
  setWorkflowTab,
}) => {
  const { t } = useLanguage();

  const toggleTimestampMenu = (target: 'toolbar' | 'overview', e: React.MouseEvent) => {
    e.stopPropagation();
    setCopyTimestampMenuTarget(prev => prev === target ? null : target);
  };

  const renderTimestampFormatMenu = (align: 'left' | 'right' = 'right') => {
    const totalCount = result?.clips?.length || 0;
    const markedCount = (result?.clips || []).filter(
      clip => !!markedClips[`${clip.start_time}_${clip.end_time}`]
    ).length;
    const currentScopeCount = copyTimestampScope === 'marked' ? markedCount : totalCount;

    return (
      <div
        className="timestamp-dropdown-menu"
        onClick={(e) => e.stopPropagation()}
        style={{ [align]: 0 }}
      >
        {/* Scope Picker: All Clips vs Marked Only */}
        <div className="timestamp-scope-selector">
          <button
            type="button"
            className={`timestamp-scope-btn ${copyTimestampScope === 'all' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setCopyTimestampScope('all');
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Layers size={13} /> {t.results.copyScopeAll}
            </span>
            <span className="timestamp-scope-count">{totalCount}</span>
          </button>
          <button
            type="button"
            className={`timestamp-scope-btn scope-marked ${copyTimestampScope === 'marked' ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setCopyTimestampScope('marked');
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Bookmark size={13} /> {t.results.copyScopeMarked}
            </span>
            <span className="timestamp-scope-count">{markedCount}</span>
          </button>
        </div>

        {/* Empty notice if marked is selected but no clips are marked */}
        {copyTimestampScope === 'marked' && markedCount === 0 && (
          <div className="timestamp-menu-empty-notice" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#ff1e27' }}>
            <AlertTriangle size={14} color="#ff1e27" /> {t.results.noMarkedClipsNotice}
          </div>
        )}

        <div style={{ padding: '0.2rem 0.6rem 0.15rem', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {t.results.copyScopeHeader(copyTimestampScope, currentScopeCount)}
        </div>

        <button
          type="button"
          className="timestamp-menu-item"
          onClick={(e) => handleCopyTimestampsFormat('only', copyTimestampScope, e)}
          disabled={copyTimestampScope === 'marked' && markedCount === 0}
          style={copyTimestampScope === 'marked' && markedCount === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {t.results.copyFormatOnlyTimestamps}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {t.results.copyFormatOnlyTimestampsDesc}
          </span>
        </button>

        <button
          type="button"
          className="timestamp-menu-item"
          onClick={(e) => handleCopyTimestampsFormat('with_title', copyTimestampScope, e)}
          disabled={copyTimestampScope === 'marked' && markedCount === 0}
          style={copyTimestampScope === 'marked' && markedCount === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {t.results.copyFormatWithTitles}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {t.results.copyFormatWithTitlesDesc}
          </span>
        </button>

        <button
          type="button"
          className="timestamp-menu-item"
          onClick={(e) => handleCopyTimestampsFormat('youtube', copyTimestampScope, e)}
          disabled={copyTimestampScope === 'marked' && markedCount === 0}
          style={copyTimestampScope === 'marked' && markedCount === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {t.results.copyFormatYoutube}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {t.results.copyFormatYoutubeDesc}
          </span>
        </button>
      </div>
    );
  };

  if (!isActive) return null;

  return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>

            {/* Top-level Previously Analyzed Videos (History) Panel */}
            {history.length > 0 && (
              <section
                className="history-highlight-panel"
                aria-label="Previously analyzed clips"
                style={{ marginTop: 0, marginBottom: 0, borderRadius: 0, border: '1px solid #201e2c', borderLeft: '3px solid #ff00ff', background: '#0a0a0f' }}
              >
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setShowHistory(h => !h)}
                  >
                    <span style={{ fontSize: '1.4rem', color: '#ff00ff', textShadow: '0 0 10px rgba(255, 0, 255, 0.7)', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>&gt;_</span>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {t.form.previouslyAnalyzed}
                        </h3>
                        <span style={{
                          background: 'rgba(255, 0, 255, 0.15)',
                          color: '#ff00ff',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.65rem',
                          borderRadius: 0,
                          border: '1px solid #ff00ff',
                          boxShadow: '0 0 8px rgba(255, 0, 255, 0.35)'
                        }}>
                          {history.length}
                        </span>
                      </div>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        {t.form.historySubtitle}
                      </p>
                    </div>
                  </div>

                  {/* Actions: Search bar, Clear All, Collapse Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {/* Search Bar */}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <span style={{ position: 'absolute', left: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)', pointerEvents: 'none' }}>
                        &gt;
                      </span>
                      <input
                        type="text"
                        className="history-search-input"
                        placeholder={t.form.searchHistoryPlaceholder}
                        value={historySearchQuery}
                        onChange={(e) => setHistorySearchQuery(e.target.value)}
                        style={{ paddingRight: historySearchQuery ? '2rem' : '0.85rem', borderRadius: 0, background: '#08080c', border: '1px solid #201e2c', fontWeight: 400 }}
                      />
                      {historySearchQuery && (
                        <button
                          type="button"
                          onClick={() => setHistorySearchQuery('')}
                          style={{
                            position: 'absolute',
                            right: '0.6rem',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            padding: 0
                          }}
                          title={t.form.clearSearch}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Clear all with confirmation */}
                    {confirmClearAll ? (
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        background: 'rgba(255, 30, 39, 0.12)',
                        padding: '0.25rem 0.55rem',
                        borderRadius: 0,
                        border: '1px solid #ff1e27',
                        animation: 'fadeIn 0.2s ease',
                        boxShadow: '0 0 10px rgba(255, 30, 39, 0.25)'
                      }}>
                        <span style={{ fontSize: '0.74rem', color: '#ff1e27', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <AlertTriangle size={13} color="#ff1e27" />
                          {t.form.areYouSure}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            clearAllHistory();
                            setConfirmClearAll(false);
                          }}
                          style={{
                            fontSize: '0.74rem',
                            color: '#fff',
                            background: '#ff1e27',
                            border: '1px solid #ff1e27',
                            borderRadius: 0,
                            padding: '0.25rem 0.55rem',
                            cursor: 'pointer',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            boxShadow: '0 2px 8px rgba(255, 30, 39, 0.4)'
                          }}
                        >
                          <Check size={12} /> {t.form.confirmClear}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearAll(false)}
                          style={{
                            fontSize: '0.74rem',
                            color: 'var(--text-secondary)',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: 0,
                            padding: '0.25rem 0.45rem',
                            cursor: 'pointer',
                            fontWeight: 500,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                        >
                          <X size={12} /> {t.form.cancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(true)}
                        style={{
                          fontSize: '0.75rem',
                          color: '#ff1e27',
                          background: 'rgba(255, 30, 39, 0.12)',
                          border: '1px solid #ff1e27',
                          borderRadius: 0,
                          padding: '0.45rem 0.75rem',
                          cursor: 'pointer',
                          fontWeight: 700,
                          transition: 'all 0.2s ease',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem'
                        }}
                      >
                        <Trash2 size={13} />
                        {t.form.clearAll}
                      </button>
                    )}

                    {/* Toggle button */}
                    <button
                      type="button"
                      onClick={() => setShowHistory(h => !h)}
                      style={{
                        background: '#08080c',
                        border: '1px solid #201e2c',
                        color: 'var(--text-secondary)',
                        borderRadius: 0,
                        padding: '0.45rem 0.7rem',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title={showHistory ? "Minimize" : "Expand"}
                    >
                      {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {showHistory && (
                  <div style={{ marginTop: '1.25rem' }}>
                    {historySearchQuery.trim() && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{t.form.showingHistoryCount(filteredHistory.length, history.length)}</span>
                        <button
                          type="button"
                          onClick={() => setHistorySearchQuery('')}
                          style={{ background: 'none', border: 'none', color: '#ff00ff', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
                        >
                          {t.form.clearSearch}
                        </button>
                      </div>
                    )}

                    {filteredHistory.length === 0 ? (
                      <div style={{
                        padding: '2rem 1rem',
                        textAlign: 'center',
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderRadius: 0,
                        border: '1px dashed rgba(255, 255, 255, 0.1)'
                      }}>
                        <span style={{ fontSize: '1.75rem', display: 'block', marginBottom: '0.5rem', color: '#ff00ff' }}>&gt;_</span>
                        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          {t.form.noHistoryMatch}
                        </p>
                        {historySearchQuery && (
                          <button
                            type="button"
                            onClick={() => setHistorySearchQuery('')}
                            style={{
                              marginTop: '0.75rem',
                              fontSize: '0.78rem',
                              background: 'rgba(255, 0, 255, 0.15)',
                              border: '1px solid #ff00ff',
                              color: '#ff00ff',
                              borderRadius: 0,
                              padding: '0.35rem 0.8rem',
                              cursor: 'pointer'
                            }}
                          >
                            {t.form.clearSearch}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '420px', overflowY: 'auto', paddingRight: '0.35rem' }}>
                        {filteredHistory.map((entry) => {
                          const q = historySearchQuery.trim().toLowerCase();
                          const matchedClip = q ? entry.clip_titles?.find(t => t.toLowerCase().includes(q)) : null;
                          const matchedQuote = (!matchedClip && q) ? entry.key_quotes?.find(k => k.toLowerCase().includes(q)) : null;

                          return (
                            <div
                              key={`${entry.video_id}_${entry.duration_pref}_${entry.range_suffix || ''}`}
                              className="history-entry-card"
                              onClick={() => loadFromHistory(entry)}
                              style={{ borderRadius: 0, background: '#08080c', border: '1px solid #201e2c' }}
                            >
                              {/* Thumbnail with overlay duration badge */}
                              <div style={{ position: 'relative', flexShrink: 0 }}>
                                <img
                                  src={entry.thumbnail}
                                  alt=""
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="84" height="48" viewBox="0 0 84 48"><rect width="84" height="48" fill="%2308080c"/><polygon points="36,18 52,24 36,30" fill="%23ff00ff"/></svg>';
                                  }}
                                  style={{ width: '84px', height: '48px', objectFit: 'cover', borderRadius: 0, background: '#111', display: 'block' }}
                                />
                                <span style={{
                                  position: 'absolute',
                                  bottom: '3px',
                                  right: '3px',
                                  background: 'rgba(0, 0, 0, 0.85)',
                                  color: '#fff',
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  padding: '0.1rem 0.3rem',
                                  borderRadius: 0,
                                  lineHeight: 1
                                }}>
                                  {entry.duration_pref === 'auto' ? 'Auto' : entry.duration_pref}
                                </span>
                              </div>

                              {/* Title and details */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: '0.88rem',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}>
                                  {entry.title}
                                </div>
                                <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.25rem', fontSize: '0.74rem', color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{ color: '#00ff66', fontWeight: 600 }}>{t.form.clipsCountMeta(entry.clip_count)}</span>
                                  <span>•</span>
                                  <span> {entry.duration_pref === 'auto' ? 'Auto' : entry.duration_pref}</span>
                                  <span>•</span>
                                  <span> {formatRelTime(entry.analyzed_at)}</span>
                                  <span>•</span>
                                  {entry.source_type === 'gdrive' ? (
                                    <a
                                      href={entry.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ color: '#00ff66', textDecoration: 'none', opacity: 0.9, fontWeight: 600 }}
                                    >
                                      -&gt; Google Drive
                                    </a>
                                  ) : entry.source_type === 'upload' ? (
                                    <span style={{ color: '#00e5ff', opacity: 0.9, fontWeight: 600 }}>
                                      [+] Local Video
                                    </span>
                                  ) : (
                                    <a
                                      href={entry.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ color: '#ff1e27', textDecoration: 'none', opacity: 0.9, fontWeight: 600 }}
                                    >
                                      -&gt; YouTube
                                    </a>
                                  )}
                                </div>

                                {/* Matched clip/quote search preview */}
                                {matchedClip && (
                                  <div style={{ fontSize: '0.72rem', color: '#ff00ff', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ fontWeight: 600 }}>* {t.form.matchedClipLabel}:</span>
                                    <span style={{ fontStyle: 'italic', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>"{matchedClip}"</span>
                                  </div>
                                )}
                                {matchedQuote && (
                                  <div style={{ fontSize: '0.72rem', color: '#00e5ff', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ fontWeight: 600 }}>// {t.form.matchedQuoteLabel}:</span>
                                    <span style={{ fontStyle: 'italic', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>"{matchedQuote}"</span>
                                  </div>
                                )}
                              </div>

                              {/* Action buttons */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); loadFromHistory(entry); }}
                                  style={{
                                    background: 'rgba(0, 229, 255, 0.15)',
                                    border: '1px solid #00e5ff',
                                    color: '#00e5ff',
                                    borderRadius: 0,
                                    padding: '0.35rem 0.75rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem'
                                  }}
                                >
                                  <Play size={12} fill="#00e5ff" />
                                  {t.form.loadVideo}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => deleteHistoryEntry(entry, e)}
                                  style={{
                                    background: 'rgba(255, 30, 39, 0.12)',
                                    border: '1px solid rgba(255, 30, 39, 0.35)',
                                    color: '#ff1e27',
                                    borderRadius: 0,
                                    padding: '0.35rem 0.55rem',
                                    cursor: 'pointer',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                  title={t.form.removeFromHistory}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Decoding Video / Analyzing Progress Section (strictly rendered in Process #2 under History) */}
            {loading && (
              <section
                ref={loadingSectionRef}
                id="loading-progress-section"
                className="glass-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1.5rem',
                  alignItems: 'center',
                  padding: '2rem 1.75rem',
                  scrollMarginTop: '2.5rem'
                }}
              >
                <div style={{ width: '100%', maxWidth: '620px' }}>
                  <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                    <h3 style={{ marginBottom: '0.4rem', fontSize: '1.4rem' }} className="text-gradient">
                      {t.loading.decodingEngagement}
                    </h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                      {t.loading.decodingSubtitle}
                    </p>
                  </div>

                  {/* Master Progress Bar */}
                  <div style={{ marginBottom: '2rem', padding: '0.85rem 1rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 0, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {t.loading.pipelineCompletion}
                      </span>
                      <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {overallProgress}%
                      </span>
                    </div>
                    <div style={{ height: '7px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 0, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          background: 'linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%)',
                          width: `${overallProgress}%`,
                          transition: 'width 0.4s ease'
                        }}
                      />
                    </div>
                  </div>

                  {/* Stepper with Individual Progress Bars */}
                  <div className="stepper-container">
                    {/* Step 1 */}
                    <div className={`step-item ${currentStep === 1 ? 'active' : currentStep > 1 ? 'completed' : ''}`}>
                      <div className="step-circle">{currentStep > 1 ? '✓' : '1'}</div>
                      <div className="step-content">
                        <div className="step-header-row">
                          <span className="step-label">{t.loading.step1Label}</span>
                          <span className="step-percentage">
                            {currentStep > 1 ? '100%' : `${stepProgress[1] || 0}%`}
                          </span>
                        </div>
                        <div className="step-mini-bar-track">
                          <div
                            className="step-mini-bar-fill"
                            style={{ width: `${currentStep > 1 ? 100 : (stepProgress[1] || 0)}%` }}
                          />
                        </div>
                        {currentStep === 1 && (
                          <span className="step-subtext">{t.loading.step1Subtext}</span>
                        )}
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className={`step-item ${currentStep === 2 ? 'active' : currentStep > 2 ? 'completed' : ''}`}>
                      <div className="step-circle">{currentStep > 2 ? '✓' : '2'}</div>
                      <div className="step-content">
                        <div className="step-header-row">
                          <span className="step-label">{t.loading.step2Label}</span>
                          <span className="step-percentage">
                            {currentStep > 2 ? '100%' : currentStep === 2 ? `${stepProgress[2] || 0}%` : '0%'}
                          </span>
                        </div>
                        <div className="step-mini-bar-track">
                          <div
                            className="step-mini-bar-fill"
                            style={{ width: `${currentStep > 2 ? 100 : currentStep === 2 ? (stepProgress[2] || 0) : 0}%` }}
                          />
                        </div>
                        {currentStep === 2 && (
                          <span className="step-subtext">{t.loading.step2Subtext}</span>
                        )}
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className={`step-item ${currentStep === 3 ? 'active' : currentStep > 3 ? 'completed' : ''}`}>
                      <div className="step-circle">{currentStep > 3 ? '✓' : '3'}</div>
                      <div className="step-content">
                        <div className="step-header-row">
                          <span className="step-label">{t.loading.step3Label}</span>
                          <span className="step-percentage">
                            {currentStep > 3 ? '100%' : currentStep === 3 ? `${stepProgress[3] || 0}%` : '0%'}
                          </span>
                        </div>
                        <div className="step-mini-bar-track">
                          <div
                            className="step-mini-bar-fill"
                            style={{ width: `${currentStep > 3 ? 100 : currentStep === 3 ? (stepProgress[3] || 0) : 0}%` }}
                          />
                        </div>
                        {currentStep === 3 && (
                          <div style={{ marginTop: '0.45rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              padding: '0.2rem 0.6rem',
                              background: 'rgba(59, 130, 246, 0.12)',
                              border: '1px solid rgba(59, 130, 246, 0.25)',
                              borderRadius: 0,
                              fontSize: '0.75rem',
                              color: '#60a5fa',
                              fontWeight: 600,
                              width: 'fit-content'
                            }}>
                              <span className="spinner-icon" style={{ fontSize: '0.75rem' }}>[~]</span>
                              <span>{aiStage || t.loading.step3Label}</span>
                            </div>
                            <span className="step-subtext" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                              {aiDetail || loadingDetails || t.loading.step3Subtext}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className={`step-item ${currentStep === 4 ? 'active' : ''}`}>
                      <div className="step-circle">{currentStep > 4 ? '✓' : '4'}</div>
                      <div className="step-content">
                        <div className="step-header-row">
                          <span className="step-label">{t.loading.step4Label}</span>
                          <span className="step-percentage">
                            {currentStep === 4 ? `${stepProgress[4] || 0}%` : '0%'}
                          </span>
                        </div>
                        <div className="step-mini-bar-track">
                          <div
                            className="step-mini-bar-fill"
                            style={{ width: `${currentStep === 4 ? (stepProgress[4] || 0) : 0}%` }}
                          />
                        </div>

                        {currentStep === 4 && (
                          <div className="ai-activity-card">
                            <div className="ai-activity-topbar">
                              <div className="ai-engine-badge">
                                <span style={{ fontSize: '0.85rem' }}>*</span>
                                <span>{t.loading.aiEngineBadge}</span>
                                {activeProcessingModel && (
                                  <span style={{ opacity: 0.85, fontWeight: 500 }}>({activeProcessingModel})</span>
                                )}
                              </div>
                              <div className="ai-timer-badge">
                                <span>{t.loading.timeElapsed(loadingElapsedTime)}</span>
                              </div>
                            </div>

                            <div>
                              <div className="ai-stage-title">
                                <span style={{ animation: 'spin 2.5s linear infinite', display: 'inline-block' }}>[AI]</span>
                                <span>{aiStage || t.loading.synthesizingHighlights}</span>
                              </div>
                            </div>

                            <div className="ai-stage-detail">
                              {aiDetail || loadingDetails || t.loading.evaluatingGradients}
                            </div>

                            {/* 4 Micro-phase progress pills */}
                            <div className="ai-subphases-row">
                              <div className={`ai-subphase-pill ${(stepProgress[4] || 0) >= 25 ? 'completed' : (stepProgress[4] || 0) >= 5 ? 'active' : ''}`}>
                                {t.loading.subphase1}
                              </div>
                              <div className={`ai-subphase-pill ${(stepProgress[4] || 0) >= 55 ? 'completed' : (stepProgress[4] || 0) >= 25 ? 'active' : ''}`}>
                                {t.loading.subphase2}
                              </div>
                              <div className={`ai-subphase-pill ${(stepProgress[4] || 0) >= 80 ? 'completed' : (stepProgress[4] || 0) >= 55 ? 'active' : ''}`}>
                                {t.loading.subphase3}
                              </div>
                              <div className={`ai-subphase-pill ${(stepProgress[4] || 0) >= 95 ? 'completed' : (stepProgress[4] || 0) >= 80 ? 'active' : ''}`}>
                                {t.loading.subphase4}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '1.75rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <span className="pulsing-text">[SYS] {loadingDetails}</span>
                  </div>

                  {/* Cancel button & Yellow Warning row */}
                  <div style={{
                    marginTop: '1.5rem',
                    paddingTop: '1.25rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.85rem',
                    width: '100%'
                  }}>
                    <button
                      type="button"
                      onClick={handleCancelAnalyze}
                      style={{
                        background: 'rgba(255, 30, 39, 0.08)',
                        border: '1px solid rgba(255, 30, 39, 0.4)',
                        color: '#ff6b6b',
                        borderRadius: 0,
                        padding: '0.45rem 1.25rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 0 10px rgba(255, 30, 39, 0.15)'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,30,39,0.2)'; e.currentTarget.style.borderColor = '#ff1e27'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,30,39,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,30,39,0.4)'; }}
                    >
                      <X size={14} />
                      <span>{t.studio?.cancelBtn || 'Cancel Analysis'}</span>
                    </button>

                    {/* Yellow Warning when process is taking longer than usual */}
                    {loadingTooLong && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        padding: '0.65rem 0.95rem',
                        background: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                        color: '#facc15',
                        fontSize: '0.76rem',
                        lineHeight: '1.5',
                        textAlign: 'left',
                        maxWidth: '540px'
                      }}>
                        <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '2px', color: '#f59e0b' }} />
                        <span>
                          <strong>Proses analisis memakan waktu lebih lama dari biasanya.</strong> Jika Anda menggunakan free-tier AI model (seperti Gemini Flash / OpenRouter Free), antrean model sering kali mengalami delay atau rate limit. Anda dapat tetap menunggu atau batalkan proses ini dan coba ulangi.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Dashboard Grid for Active Video */}
            {result && (
              <>
                <main className="dashboard-grid">
                  {/* Left panel: Player + Heatmap */}
                  <div className="sticky-player-panel" ref={leftPanelRef}>
                    <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <h2 style={{ fontSize: '1.25rem', lineHeight: 1.3 }}>{result.title}</h2>

                      <div className="video-wrapper" style={{ position: 'relative' }}>
                        {(result.video_url || result.source_type === 'upload' || result.source_type === 'gdrive' || result.video_id?.startsWith('upload_') || result.video_id?.startsWith('gdrive_')) ? (
                          <video
                            key={`direct-player-${result.video_id}`}
                            ref={directVideoPlayerRef}
                            src={result.video_url ? encodeURI(result.video_url) : `/api/video/${encodeURIComponent(result.video_id)}`}
                            controls
                            playsInline
                            preload="auto"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              borderRadius: 0,
                              objectFit: 'contain',
                              background: '#000',
                              zIndex: 2
                            }}
                            onTimeUpdate={(e) => {
                              setCurrentTime(e.currentTarget.currentTime);
                            }}
                            onPlay={() => startTracking()}
                            onPause={() => stopTracking()}
                            onError={(e) => {
                              const vid = e.currentTarget;
                              const fallback = `/api/video/${encodeURIComponent(result.video_id)}`;
                              if (vid.src !== fallback && !vid.src.endsWith(fallback)) {
                                console.warn('[Player] Direct video failed, attempting fallback to server stream:', fallback);
                                vid.src = fallback;
                                vid.load();
                              }
                            }}
                          />
                        ) : (result.source_type === 'twitch' || result.video_id?.startsWith('twitch_')) ? (
                          <div id="twitch-player-container" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
                            <div id="twitch-player"></div>
                          </div>
                        ) : (
                          <div id="youtube-player-container" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
                            <div id="youtube-player"></div>
                          </div>
                        )}
                        {subtitlesSource === 'manual' && currentSubtitle && (
                          <div className="video-subtitle-overlay">
                            <span>{currentSubtitle.text}</span>
                          </div>
                        )}
                      </div>

                      {/* Refresh Player control */}
                      {/* Player control buttons: Refresh Player & Download Raw Video */}
                      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                        <button
                          type="button"
                          className="form-input"
                          onClick={handleRefreshPlayer}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.45rem',
                            fontSize: '0.78rem',
                            padding: '0.55rem 1rem',
                            borderRadius: 0,
                            cursor: 'pointer',
                            background: '#0a0a0f',
                            border: '1px solid #201e2c',
                            color: 'var(--text-primary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            fontWeight: 600
                          }}
                        >
                          <RotateCw size={13} />
                          {t.results.refreshPlayer}
                        </button>

                        <button
                          type="button"
                          className="form-input glowing-btn"
                          onClick={handleDownloadRawVideo}
                          disabled={isDownloadingRaw}
                          title="Download full original YouTube video at highest 1080p resolution"
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.45rem',
                            fontSize: '0.78rem',
                            padding: '0.55rem 1rem',
                            borderRadius: 0,
                            cursor: isDownloadingRaw ? 'wait' : 'pointer',
                            background: 'rgba(0, 229, 255, 0.15)',
                            border: '1px solid #00e5ff',
                            color: '#00e5ff',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            fontWeight: 700
                          }}
                        >
                          {isDownloadingRaw ? (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                              </svg>
                              <span>{t.results.downloadingRawVideo} ({(rawDownloadProgress?.percent || 0).toFixed(0)}%)</span>
                            </>
                          ) : (
                            <>
                              <Download size={13} />
                              <span>{t.results.downloadRawVideo}</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Raw Video Download Real-time Progress Bar */}
                      {rawDownloadProgress && (
                        <div className="raw-download-progress-card">
                          <div className="progress-card-header">
                            <span className="progress-card-title">
                              {rawDownloadProgress.status === 'ready' ? (
                                <span style={{ color: '#4ade80' }}>✓ {t.rawDownload.readyBadge}</span>
                              ) : (
                                <>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon">
                                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                                  </svg>
                                  <span>{t.rawDownload.downloadingTitle(rawDownloadProgress.percent.toFixed(1))}</span>
                                </>
                              )}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              {rawDownloadProgress.eta && rawDownloadProgress.status !== 'ready' && (
                                <span className="progress-card-eta">{t.rawDownload.eta(rawDownloadProgress.eta)}</span>
                              )}
                              {rawDownloadProgress.status === 'downloading' && rawDownloadProgress.jobId && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelRawDownload(rawDownloadProgress.jobId)}
                                  title="Batalkan unduhan"
                                  style={{
                                    background: 'transparent',
                                    border: '1px solid rgba(255, 30, 39, 0.4)',
                                    color: '#ff4d4d',
                                    padding: '0.15rem 0.45rem',
                                    fontSize: '0.7rem',
                                    cursor: 'pointer',
                                    borderRadius: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.2rem'
                                  }}
                                >
                                  <X size={11} />
                                  <span>Batal</span>
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-fill-bar"
                              style={{
                                width: `${Math.min(100, Math.max(0, rawDownloadProgress.percent))}%`,
                                background: rawDownloadProgress.status === 'ready' ? 'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)' : undefined
                              }}
                            />
                          </div>
                          <div className="progress-card-meta">
                            <span>
                              {rawDownloadProgress.downloaded || t.rawDownload.connecting} {rawDownloadProgress.total ? `/ ${rawDownloadProgress.total}` : ''}
                            </span>
                            <span>{rawDownloadProgress.speed || ''}</span>
                          </div>
                        </div>
                      )}

                      {/* Heatmap Timeline component */}
                      <HeatmapTimeline
                        duration={result.duration}
                        heatmap={result.heatmap}
                        currentTime={currentTime}
                        onSeek={handleSeek}
                        activeClip={activeClip}
                      />
                    </div>

                    {/* AI Summary card */}
                    <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', color: 'var(--primary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.results.videoSummary}</h3>
                        {(() => {
                          const { text, hashtags } = extractHashtagsAndText(result.summary);
                          return (
                            <>
                              {hashtags.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                                  {hashtags.map((tag, idx) => (
                                    <span
                                      key={idx}
                                      className="summary-hashtag-highlight"
                                      style={{
                                        color: 'var(--accent)',
                                        fontWeight: '600',
                                        background: 'rgba(16, 185, 129, 0.1)',
                                        padding: '2px 6px',
                                        borderRadius: 0,
                                        border: '1px solid rgba(16, 185, 129, 0.2)',
                                        fontSize: '0.75rem',
                                        display: 'inline-block'
                                      }}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</p>
                            </>
                          );
                        })()}
                      </div>

                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <h3 style={{ fontSize: '1.05rem', color: 'var(--secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {t.results.generatedClipsOverview(result.clips.length)}
                          </h3>
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              type="button"
                              onClick={(e) => toggleTimestampMenu('overview', e)}
                              title={t.results.copyAllTimestampsTooltip}
                              style={{
                                fontSize: '0.72rem',
                                padding: '0.2rem 0.55rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                borderRadius: 0,
                                background: copyTimestampMenuTarget === 'overview' ? 'rgba(255, 94, 58, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                border: `1px solid ${copyTimestampMenuTarget === 'overview' ? 'rgba(255, 94, 58, 0.5)' : 'var(--border-color)'}`,
                                color: copyTimestampMenuTarget === 'overview' ? 'var(--secondary)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                transition: 'var(--transition-smooth)'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 94, 58, 0.12)';
                                e.currentTarget.style.borderColor = 'rgba(255, 94, 58, 0.4)';
                                e.currentTarget.style.color = 'var(--secondary)';
                              }}
                              onMouseLeave={(e) => {
                                if (copyTimestampMenuTarget !== 'overview') {
                                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                  e.currentTarget.style.borderColor = 'var(--border-color)';
                                  e.currentTarget.style.color = 'var(--text-secondary)';
                                }
                              }}
                            >
                              {t.results.copyAllTimestamps} ▼
                            </button>
                            {copyTimestampMenuTarget === 'overview' && renderTimestampFormatMenu('right')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                          {result.clips.map((clip, idx) => {
                            const isSelected = activeClip?.start_time === clip.start_time && activeClip?.end_time === clip.end_time;
                            const clipKey = `${clip.start_time}_${clip.end_time}`;
                            const isMarked = !!markedClips[clipKey];
                            return (
                              <div
                                key={idx}
                                onClick={() => setActiveClip(clip)}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: '0.8rem',
                                  padding: '0.5rem',
                                  borderRadius: 0,
                                  background: isSelected
                                    ? 'rgba(255, 94, 58, 0.1)'
                                    : 'rgba(255, 255, 255, 0.02)',
                                  border: isSelected
                                    ? '1px solid var(--secondary)'
                                    : '1px solid transparent',
                                  cursor: 'pointer',
                                  transition: 'var(--transition-smooth)',
                                  opacity: 1
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, overflow: 'hidden' }}>
                                  <input
                                    type="checkbox"
                                    checked={isMarked}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleMarkedClip(clipKey);
                                    }}
                                    style={{
                                      width: '14px',
                                      height: '14px',
                                      cursor: 'pointer',
                                      accentColor: 'var(--secondary)'
                                    }}
                                  />
                                  <span style={{
                                    fontWeight: 500,
                                    color: isMarked
                                      ? 'var(--secondary)'
                                      : (isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'),
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}>
                                    {idx + 1}. {clip.title}
                                  </span>
                                </div>
                                <div className="sidebar-clip-item-right">
                                  <span className={`virality-mini-badge ${clip.virality_score >= 85 ? 'score-high' : clip.virality_score >= 70 ? 'score-mid' : 'score-low'}`}>
                                    {clip.virality_score}%
                                  </span>
                                  <span
                                    onClick={(e) => handleCopyTimestamp(clip, e)}
                                    title={t.results.copyTimestampTooltip}
                                    className="virality-mini-ts"
                                  >
                                    {formatSeconds(clip.start_time)} - {formatSeconds(clip.end_time)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right panel: Suggested Clips scrollable list */}
                  <div
                    className="glass-panel"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1.25rem',
                      maxHeight: leftPanelHeight ? `${leftPanelHeight}px` : '80vh',
                      background: '#0a0a0f',
                      border: '1px solid #201e2c',
                      borderRadius: 0,
                      padding: '1.25rem',
                      overflowY: 'auto'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ fontSize: '1.35rem', fontWeight: 600 }}>{t.results.recommendedClips}</h2>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{t.results.sortLabel(sortBy.toUpperCase())}</span>
                      </div>

                      {/* Analysis Metadata Info Bar */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        padding: '0.6rem 1rem',
                        borderRadius: 0,
                        background: '#0e0e14',
                        border: '1px solid #201e2c',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        flexWrap: 'wrap'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Bot size={15} color="var(--primary)" />
                          <span>{t.results.aiModelBadge}</span>
                          <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>
                            {result.model || selectedModel}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <FileText size={14} />
                          <span>{t.results.generatedClipsBadge}</span>
                          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {result.clips.length}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Bookmark size={14} color="var(--secondary)" />
                          <span>{t.results.markedClipsBadge}</span>
                          <strong style={{ color: 'var(--secondary)', fontWeight: 600 }}>
                            {result.clips.filter(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`]).length}
                          </strong>
                        </div>
                      </div>

                      {/* Search & Filter Controls */}
                      <div className="filter-controls-bar">
                        <input
                          type="text"
                          className="form-input search-filter-input"
                          placeholder={t.results.searchPlaceholder}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          style={{ padding: '0.6rem 1rem', fontSize: '0.875rem' }}
                        />

                        <select
                          className="form-input virality-filter-select"
                          value={viralityFilter}
                          onChange={(e) => setViralityFilter(e.target.value as any)}
                          style={{ width: 'auto', padding: '0.6rem 2rem 0.6rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}
                        >
                          <option value="all">{t.results.filterAllScores}</option>
                          <option value="high">{t.results.filterHigh}</option>
                          <option value="medium">{t.results.filterMidLow}</option>
                          <option value="marked">{t.results.filterMarkedOnly}</option>
                        </select>

                        <select
                          className="form-input virality-filter-select"
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value as any)}
                          style={{ width: 'auto', padding: '0.6rem 2rem 0.6rem 1rem', fontSize: '0.875rem', cursor: 'pointer' }}
                        >
                          <option value="virality">{t.results.sortVirality}</option>
                          <option value="time">{t.results.sortTime}</option>
                          <option value="duration">{t.results.sortDuration}</option>
                          <option value="marked">{t.results.sortMarked}</option>
                        </select>
                      </div>

                      {/* Stats and Exports */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span>{t.results.showingClipsCount(sortedClips.length, result.clips.length)}</span>
                          {result.clips && result.clips.length > 0 && (
                            <button
                              type="button"
                              className="action-link-btn mark-all-clips-btn"
                              onClick={() => toggleAllMarkedClips()}
                              title={result.clips.every(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`]) ? t.results.unmarkAllClips : t.results.markAllClips}
                              style={{
                                background: result.clips.every(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`]) ? 'rgba(255, 51, 102, 0.12)' : 'rgba(176, 38, 255, 0.12)',
                                border: result.clips.every(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`]) ? '1.5px solid #ff3366' : '1.5px solid #b026ff',
                                color: result.clips.every(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`]) ? '#ff3366' : '#c084fc',
                                borderRadius: 0,
                                padding: '0.28rem 0.65rem',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                fontFamily: 'var(--font-mono)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                                transition: 'var(--transition-smooth)',
                                boxShadow: result.clips.every(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`]) ? '0 0 8px rgba(255, 51, 102, 0.25)' : '0 0 8px rgba(176, 38, 255, 0.25)'
                              }}
                            >
                              {result.clips.every(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`])
                                ? t.results.unmarkAllClips
                                : t.results.markAllClips}
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              type="button"
                              className="toolbar-action-btn toolbar-btn-timestamps"
                              onClick={(e) => toggleTimestampMenu('toolbar', e)}
                              title={t.results.copyAllTimestampsTooltip}
                            >
                              {t.results.copyAllTimestamps} ▼
                            </button>
                            {copyTimestampMenuTarget === 'toolbar' && renderTimestampFormatMenu('left')}
                          </div>
                          <button
                            type="button"
                            className="toolbar-action-btn toolbar-btn-copy-md"
                            onClick={handleCopyAllMarkdown}
                          >
                            {t.results.copyAllMd}
                          </button>
                          <button
                            type="button"
                            className="toolbar-action-btn toolbar-btn-json"
                            onClick={handleExportJSON}
                          >
                            {t.results.downloadJson}
                          </button>
                          {result.transcript && (
                            <button
                              type="button"
                              className="toolbar-action-btn toolbar-btn-srt"
                              onClick={handleExportSRT}
                            >
                              {t.results.downloadSrt}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="clips-list" style={{ maxHeight: 'none', flex: 1 }}>
                      {sortedClips.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                          {t.results.noClipsMatch}
                        </div>
                      ) : (
                        sortedClips.map((clip, index) => {
                          const isActive = activeClip?.start_time === clip.start_time && activeClip?.end_time === clip.end_time;
                          const isExpanded = expandedClipIndex === index;

                          return (
                            <div
                              key={index}
                              id={`clip-card-${index}`}
                              className={`clip-card ${isActive ? 'active' : ''}`}
                              onClick={() => {
                                setActiveClip(clip);
                                setExpandedClipIndex(isExpanded ? null : index);
                              }}
                            >
                              {/* Header */}
                              <div className="clip-header">
                                <div style={{ display: 'flex', alignItems: 'center', marginTop: '0.25rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={!!markedClips[`${clip.start_time}_${clip.end_time}`]}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleMarkedClip(`${clip.start_time}_${clip.end_time}`);
                                    }}
                                    style={{
                                      width: '18px',
                                      height: '18px',
                                      cursor: 'pointer',
                                      accentColor: 'var(--primary)'
                                    }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <span className="clip-title" style={{ color: !!markedClips[`${clip.start_time}_${clip.end_time}`] ? 'var(--secondary)' : 'var(--text-primary)', opacity: 1 }}>
                                      {clip.title}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopyText(clip.title, 'Title');
                                      }}
                                      className="copy-title-btn"
                                      title={t.results.copyTitleTooltip}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                                    >
                                      <Copy size={12} /> {t.results.copyMini}
                                    </button>
                                  </div>
                                  <div className="score-meta">
                                    <span
                                      className="timestamp-pill"
                                      onClick={(e) => handleCopyTimestamp(clip, e)}
                                      title={t.results.copyTimestampTooltip}
                                    >
                                      {formatSeconds(clip.start_time)} - {formatSeconds(clip.end_time)}
                                    </span>
                                    <span>{t.results.durationLabel(formatSeconds(clip.end_time - clip.start_time))}</span>
                                    {clip.hook_time !== undefined && (
                                      <span
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSeek(clip.hook_time!);
                                        }}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '2px',
                                          fontSize: '0.72rem',
                                          fontWeight: 600,
                                          color: 'var(--accent)',
                                          background: 'rgba(16, 185, 129, 0.12)',
                                          border: '1px solid rgba(16, 185, 129, 0.35)',
                                          borderRadius: 0,
                                          padding: '0.05rem 0.35rem',
                                          cursor: 'pointer',
                                          whiteSpace: 'nowrap'
                                        }}
                                        title={t.results.hookClickHint}
                                      >
                                        {t.results.hookLabel(formatSeconds(clip.hook_time))}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                                  <div className={`score-badge ${clip.virality_score >= 85 ? 'score-high' : clip.virality_score >= 70 ? 'score-medium' : 'score-low'}`}>
                                    <span>{t.results.viralityBadge(clip.virality_score)}</span>
                                  </div>
                                  {!!markedClips[`${clip.start_time}_${clip.end_time}`] && (
                                    <div style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '0.65rem',
                                      fontWeight: 700,
                                      fontFamily: 'var(--font-mono)',
                                      color: '#ff00ff',
                                      background: 'rgba(255, 0, 255, 0.12)',
                                      padding: '0.15rem 0.4rem',
                                      borderRadius: 0,
                                      border: '1px solid #ff00ff',
                                      boxShadow: '0 0 6px rgba(255, 0, 255, 0.3)'
                                    }}>
                                      {t.results.markedBadge}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Key spoken quotes */}
                              {clip.key_quotes && clip.key_quotes.length > 0 && (
                                <div className="clip-quotes">
                                  {clip.key_quotes.map((quote, qIdx) => (
                                    <div key={qIdx} className="quote-item">"{quote}"</div>
                                  ))}
                                </div>
                              )}

                              {/* Suggestions: Title, Caption */}
                              {(clip.title_suggestion || clip.caption_suggestion) && (
                                <div className="clip-suggestions">
                                  {clip.title_suggestion && (
                                    <div className="suggestion-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                      <div style={{ flex: 1 }}>
                                        <span className="suggestion-label">{t.results.titlePrefix}</span>{' '}
                                        <span className="suggestion-value">{clip.title_suggestion}</span>
                                      </div>
                                      <button
                                        type="button"
                                        className="copy-mini-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCopyText(clip.title_suggestion!, 'Title');
                                        }}
                                        title={t.results.copyTitleTooltip}
                                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                      >
                                        <Copy size={12} />
                                      </button>
                                    </div>
                                  )}
                                  {clip.caption_suggestion && (
                                    <div className="suggestion-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                      <div style={{ flex: 1 }}>
                                        <span className="suggestion-label">{t.results.captionPrefix}</span>{' '}
                                        <span className="suggestion-value">
                                          {(() => {
                                            const lowercaseHashtags = (clip.hashtag_suggestion || '').toLowerCase();
                                            if (!lowercaseHashtags) return clip.caption_suggestion;
                                            if (clip.caption_suggestion.toLowerCase().includes(lowercaseHashtags)) return clip.caption_suggestion;
                                            return `${clip.caption_suggestion} ${lowercaseHashtags}`;
                                          })()}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        className="copy-mini-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const captionText = (() => {
                                            const caption = clip.caption_suggestion || '';
                                            const lowercaseHashtags = (clip.hashtag_suggestion || '').toLowerCase();
                                            if (!lowercaseHashtags) return caption;
                                            if (caption.toLowerCase().includes(lowercaseHashtags)) return caption;
                                            return `${caption} ${lowercaseHashtags}`;
                                          })();
                                          handleCopyText(captionText, 'Caption');
                                        }}
                                        title={t.results.copyCaptionTooltip}
                                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                      >
                                        <Copy size={12} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Row 1: Primary Actions (Preview Clip on Left, Download Clip on Right) */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '0.75rem', gap: '0.5rem' }}>
                                <button
                                  type="button"
                                  className="glowing-btn"
                                  style={{
                                    padding: '0.45rem 1rem',
                                    fontSize: '0.78rem',
                                    borderRadius: 0,
                                    boxShadow: 'none',
                                    whiteSpace: 'nowrap',
                                    background: '#ff00ff',
                                    color: '#000000',
                                    fontWeight: 700,
                                    border: '1px solid #ff00ff',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem'
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    playClip(clip);
                                  }}
                                >
                                  <Play size={13} fill="#000" />
                                  {t.results.previewClip}
                                </button>

                                {(() => {
                                  const clipKey = `${clip.start_time}_${clip.end_time}`;
                                  const clipDlState = clipDownloadStates[clipKey];
                                  const isDl = clipDlState?.status === 'downloading';
                                  const isReady = clipDlState?.status === 'ready';

                                  return (
                                    <button
                                      type="button"
                                      className={`clip-dl-btn ${isReady ? 'state-ready' : isDl ? 'state-downloading' : 'state-idle'}`}
                                      disabled={isDl}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownloadRawClip(clip, e);
                                      }}
                                      title={t.results.downloadRawClipTooltip}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: isDl ? 'wait' : 'pointer' }}
                                    >
                                      {isDl ? (
                                        <>
                                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                                            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                                          </svg>
                                          <span>{t.results.downloadingRawClip} ({(clipDlState?.percent || 0).toFixed(0)}%)</span>
                                        </>
                                      ) : isReady ? (
                                        <>
                                          <CheckCircle2 size={13} />
                                          <span>{t.results.downloadedRawClip}</span>
                                        </>
                                      ) : (
                                        <>
                                          <Download size={13} />
                                          <span>{t.results.downloadRawClip}</span>
                                        </>
                                      )}
                                    </button>
                                  );
                                })()}
                              </div>

                              {/* Row 2: Secondary Utilities (Adjust Duration, Copy Timestamp, Copy Details, Show Transcript) */}
                              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.45rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  className="form-input"
                                  style={{ padding: '0.35rem 0.65rem', fontSize: '0.76rem', width: 'auto', borderRadius: 0, cursor: 'pointer', background: '#0a0a0f', border: '1px solid #201e2c', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTrimmerClip(clip);
                                  }}
                                  title={t.results.adjustDurationTooltip}
                                >
                                  <Scissors size={12} />
                                  {t.results.adjustDuration}
                                </button>
                                <button
                                  type="button"
                                  className="form-input"
                                  style={{ padding: '0.35rem 0.65rem', fontSize: '0.76rem', width: 'auto', borderRadius: 0, cursor: 'pointer', background: '#0a0a0f', border: '1px solid #201e2c', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                  onClick={(e) => handleCopyTimestamp(clip, e)}
                                  title={t.results.copyTimestampTooltip}
                                >
                                  <Clock size={12} />
                                  {t.results.copyTimestamp}
                                </button>
                                <button
                                  type="button"
                                  className="form-input"
                                  style={{ padding: '0.35rem 0.65rem', fontSize: '0.76rem', width: 'auto', borderRadius: 0, cursor: 'pointer', background: '#0a0a0f', border: '1px solid #201e2c', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                  onClick={(e) => handleCopyClip(clip, e)}
                                >
                                  <Copy size={12} />
                                  {t.results.copyDetails}
                                </button>
                                <span
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.74rem', color: 'var(--primary)', fontWeight: 500, cursor: 'pointer', userSelect: 'none', marginLeft: '0.15rem' }}
                                >
                                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                  {isExpanded ? t.results.hideTranscript : t.results.showTranscript}
                                </span>
                              </div>

                              {/* Real-time Clip Download Progress Preview */}
                              {(() => {
                                const clipKey = `${clip.start_time}_${clip.end_time}`;
                                const clipDlState = clipDownloadStates[clipKey];
                                if (!clipDlState || clipDlState.status !== 'downloading') return null;

                                return (
                                  <div className="clip-download-progress-card">
                                    <div className="progress-card-header">
                                      <div className="progress-card-title">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                                          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                                        </svg>
                                        <span>{clipDlState.stage || t.results.downloadingRawClip} ({(clipDlState.percent || 0).toFixed(0)}%)</span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                        {clipDlState.eta && (
                                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>ETA {clipDlState.eta}</span>
                                        )}
                                        {clipDlState.jobId && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleCancelRawClipDownload(clipDlState.jobId!, clipKey);
                                            }}
                                            title="Batalkan unduhan klip"
                                            style={{
                                              background: 'transparent',
                                              border: '1px solid rgba(255, 30, 39, 0.4)',
                                              color: '#ff4d4d',
                                              padding: '0.15rem 0.45rem',
                                              fontSize: '0.7rem',
                                              cursor: 'pointer',
                                              borderRadius: 0,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '0.2rem'
                                            }}
                                          >
                                            <X size={11} />
                                            <span>Batal</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="progress-track">
                                      <div
                                        className="progress-fill-bar"
                                        style={{
                                          width: `${Math.min(100, Math.max(0, clipDlState.percent || 0))}%`
                                        }}
                                      />
                                    </div>
                                    {(clipDlState.downloaded || clipDlState.speed) && (
                                      <div className="progress-card-meta">
                                        <span>{clipDlState.downloaded} {clipDlState.total ? `/ ${clipDlState.total}` : ''}</span>
                                        <span>{clipDlState.speed}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Expandable transcript text block */}
                              {isExpanded && (
                                <div
                                  className="transcript-box"
                                  onClick={(e) => e.stopPropagation()} /* Prevents collapse */
                                  style={{ borderRadius: 0, background: '#08080c', border: '1px solid #201e2c' }}
                                >
                                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.25rem', textTransform: 'uppercase' }}>{t.results.transcriptTitle}</div>
                                  {clip.transcript}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </main>
              </>
            )}

            {/* If no video selected and no history in Tab 02 */}
            {!result && history.length === 0 && (
              <div className="glass-panel" style={{ padding: '3.5rem 2rem', textAlign: 'center', borderRadius: 0, background: '#0a0a0f', border: '1px solid #201e2c' }}>
                <span style={{ fontSize: '2rem', color: '#ff00ff', display: 'block', marginBottom: '1rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>&gt;_</span>
                <h3 style={{ fontSize: '1.1rem', color: '#fff', marginBottom: '0.5rem', fontWeight: 600 }}>Belum Ada Klip yang Dianalisis</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Silakan masukkan URL YouTube, link Google Drive, atau unggah video di Tab 01 // SOURCE.</p>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={() => setWorkflowTab('source')}
                  style={{ padding: '0.65rem 1.6rem', borderRadius: 0, background: '#ff00ff', color: '#000', fontWeight: 700 }}
                >
                  [ 01 // KE TAB SUMBER ]
                </button>
              </div>
            )}
          </div>
  );
};
