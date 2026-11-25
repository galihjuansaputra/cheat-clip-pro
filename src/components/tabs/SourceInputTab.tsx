import React from 'react';
import { AlertTriangle, Upload, ExternalLink, X, RefreshCw, Sparkles } from 'lucide-react';
import { HackerApiKeyInput } from '../HackerApiKeyInput';
import { useLanguage } from '../../locales';

export interface SourceInputTabProps {
  isActive: boolean;
  onSubmit: (e?: React.FormEvent) => void;
  onAnalyze: (e?: React.FormEvent) => void;
  // Source modes & values
  sourceMode: 'youtube' | 'twitch' | 'gdrive' | 'upload';
  setSourceMode: (mode: 'youtube' | 'twitch' | 'gdrive' | 'upload') => void;
  url: string;
  setUrl: (url: string) => void;
  twitchUrl: string;
  setTwitchUrl: (url: string) => void;
  gdriveUrl: string;
  setGdriveUrl: (url: string) => void;
  uploadedVideoFile: File | null;
  setUploadedVideoFile: (file: File | null) => void;
  uploadedVideoInfo: {
    videoId: string;
    filename: string;
    savedName: string;
    duration: number;
    videoUrl: string;
    filePath: string;
    width: number;
    height: number;
  } | null;
  setUploadedVideoInfo: (info: any) => void;
  isUploadingVideo: boolean;
  isDragOverVideo: boolean;
  setIsDragOverVideo: (val: boolean) => void;
  videoFileInputRef: React.RefObject<HTMLInputElement | null>;
  // AI Config
  apiProvider: 'gemini' | 'openrouter';
  setApiProvider: (provider: 'gemini' | 'openrouter') => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  availableModels: string[];
  loadingModels: boolean;
  openRouterKey: string;
  setOpenRouterKey: (key: string) => void;
  openRouterModel: string;
  setOpenRouterModel: (model: string) => void;
  openRouterModels: Array<{ id: string; name: string; description?: string; context_length?: number; recommended?: boolean }>;
  loadingOpenRouterModels: boolean;
  customOpenRouterModel: string;
  setCustomOpenRouterModel: (model: string) => void;
  isCustomOpenRouterModel: boolean;
  setIsCustomOpenRouterModel: (val: boolean) => void;
  // Clip Parameters
  durationPref: '15s' | '30s' | '60s' | 'auto';
  setDurationPref: (pref: '15s' | '30s' | '60s' | 'auto') => void;
  customPrompt: string;
  setCustomPrompt: (prompt: string) => void;
  targetClipCount: number;
  setTargetClipCount: (count: number) => void;
  clipCountMode: 'auto' | 'custom';
  setClipCountMode: (mode: 'auto' | 'custom') => void;
  // Subtitles
  subtitlesSource: 'youtube' | 'manual';
  setSubtitlesSource: (src: 'youtube' | 'manual') => void;
  manualSubtitlesFileName: string;
  setManualSubtitlesFileName: (name: string) => void;
  manualSubtitlesContent: string;
  setManualSubtitlesContent: (content: string) => void;
  transcriptLanguage: 'id' | 'en';
  setTranscriptLanguage: (lang: 'id' | 'en') => void;
  // Range
  rangeType: 'entire' | 'custom';
  setRangeType: (type: 'entire' | 'custom') => void;
  customRangeStart: string;
  setCustomRangeStart: (val: string) => void;
  customRangeEnd: string;
  setCustomRangeEnd: (val: string) => void;
  // Execution & Progress
  loading: boolean;
  // Toast & Error
  setToastMessage: (msg: string | null) => void;
  error: string | null;
  setError: (err: string | null) => void;
}

export const SourceInputTab: React.FC<SourceInputTabProps> = ({
  isActive,
  onSubmit,
  onAnalyze,
  sourceMode,
  setSourceMode,
  url,
  setUrl,
  twitchUrl,
  setTwitchUrl,
  gdriveUrl,
  setGdriveUrl,
  uploadedVideoFile,
  setUploadedVideoFile,
  uploadedVideoInfo,
  setUploadedVideoInfo,
  isUploadingVideo,
  isDragOverVideo,
  setIsDragOverVideo,
  videoFileInputRef,
  apiProvider,
  setApiProvider,
  apiKey,
  setApiKey,
  selectedModel,
  setSelectedModel,
  availableModels,
  loadingModels,
  openRouterKey,
  setOpenRouterKey,
  openRouterModel,
  setOpenRouterModel,
  openRouterModels,
  loadingOpenRouterModels,
  customOpenRouterModel,
  setCustomOpenRouterModel,
  isCustomOpenRouterModel,
  setIsCustomOpenRouterModel,
  durationPref,
  setDurationPref,
  customPrompt,
  setCustomPrompt,
  targetClipCount,
  setTargetClipCount,
  clipCountMode,
  setClipCountMode,
  subtitlesSource,
  setSubtitlesSource,
  manualSubtitlesFileName,
  setManualSubtitlesFileName,
  setManualSubtitlesContent,
  transcriptLanguage,
  setTranscriptLanguage,
  rangeType,
  setRangeType,
  customRangeStart,
  setCustomRangeStart,
  customRangeEnd,
  setCustomRangeEnd,
  loading,
  setToastMessage,
  error,
  setError,
}) => {
  const { t } = useLanguage();

  return (
    <>
        <section className="glass-panel" style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', gap: '1.5rem' }}>

          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Source Selector Tabs: YouTube vs Google Drive vs Upload Video File */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
              {/* YouTube Tab */}
              <button
                type="button"
                id="source-mode-youtube"
                className={`source-tab-btn ${sourceMode === 'youtube' ? 'active' : ''}`}
                onClick={() => {
                  setSourceMode('youtube');
                  setError(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1.1rem',
                  borderRadius: 0,
                  border: sourceMode === 'youtube' ? '1px solid #ff1e27' : '1px solid #201e2c',
                  background: sourceMode === 'youtube' ? 'rgba(255, 30, 39, 0.15)' : '#08080c',
                  color: sourceMode === 'youtube' ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  transition: 'all 0.2s ease',
                  boxShadow: sourceMode === 'youtube' ? '0 0 15px rgba(255, 30, 39, 0.45)' : 'none'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#ff1e27' }}>
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
                {t.form.tabYoutube}
              </button>

              {/* Twitch Tab */}
              <button
                type="button"
                id="source-mode-twitch"
                className={`source-tab-btn ${sourceMode === 'twitch' ? 'active' : ''}`}
                onClick={() => {
                  setSourceMode('twitch');
                  setError(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1.1rem',
                  borderRadius: 0,
                  border: sourceMode === 'twitch' ? '1px solid #9146ff' : '1px solid #201e2c',
                  background: sourceMode === 'twitch' ? 'rgba(145, 70, 255, 0.15)' : '#08080c',
                  color: sourceMode === 'twitch' ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  transition: 'all 0.2s ease',
                  boxShadow: sourceMode === 'twitch' ? '0 0 15px rgba(145, 70, 255, 0.45)' : 'none'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#9146ff' }}>
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                </svg>
                {t.form.tabTwitch}
              </button>


              {/* Google Drive Tab */}
              <button
                type="button"
                id="source-mode-gdrive"
                className={`source-tab-btn ${sourceMode === 'gdrive' ? 'active' : ''}`}
                onClick={() => {
                  setSourceMode('gdrive');
                  setError(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1.1rem',
                  borderRadius: 0,
                  border: sourceMode === 'gdrive' ? '1px solid #00ff66' : '1px solid #201e2c',
                  background: sourceMode === 'gdrive' ? 'rgba(0, 255, 102, 0.15)' : '#08080c',
                  color: sourceMode === 'gdrive' ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  transition: 'all 0.2s ease',
                  boxShadow: sourceMode === 'gdrive' ? '0 0 15px rgba(0, 255, 102, 0.45)' : 'none'
                }}
              >
                <svg width="17" height="17" viewBox="0 0 87.3 78" fill="none">
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
                  <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47" />
                  <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.1z" fill="#ea4335" />
                  <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
                  <path d="m59.8 53h27.5c0-1.55-.4-3.1-1.2-4.5l-25.4-44c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8z" fill="#ffba00" />
                  <path d="m73.55 76.8c1.35 0 2.9-.4 4.25-1.2l-14.1-22.6H27.5l13.75 23.8h32.3z" fill="#2684fc" />
                </svg>
                {t.form.tabGdrive}
              </button>

              {/* Upload Video File Tab */}
              <button
                type="button"
                id="source-mode-upload"
                className={`source-tab-btn ${sourceMode === 'upload' ? 'active' : ''}`}
                onClick={() => {
                  setSourceMode('upload');
                  setError(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1.1rem',
                  borderRadius: 0,
                  border: sourceMode === 'upload' ? '1px solid #00e5ff' : '1px solid #201e2c',
                  background: sourceMode === 'upload' ? 'rgba(0, 229, 255, 0.15)' : '#08080c',
                  color: sourceMode === 'upload' ? '#ffffff' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  transition: 'all 0.2s ease',
                  boxShadow: sourceMode === 'upload' ? '0 0 15px rgba(0, 229, 255, 0.45)' : 'none'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#00e5ff' }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                {t.form.tabUpload}
              </button>
            </div>

            {/* YouTube input mode */}
            {sourceMode === 'youtube' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', width: '100%' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t.form.urlLabel}</label>
                <div className="form-main-input-row">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'stretch',
                      position: 'relative',
                      flex: 1,
                      height: '48px',
                      background: '#060608',
                      border: '1px solid rgba(255, 0, 255, 0.35)',
                      boxShadow: '0 0 8px rgba(255, 0, 255, 0.15)',
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    }}
                    className="hacker-api-key-container"
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 0.85rem',
                        background: 'rgba(255, 0, 255, 0.08)',
                        borderRight: '1px solid rgba(255, 0, 255, 0.25)',
                        color: '#ff00ff',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      LINK &gt;
                    </div>
                    <input
                      id="youtube-url-input"
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      disabled={loading}
                      placeholder={t.form.urlPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      required={sourceMode === 'youtube'}
                      style={{
                        flex: 1,
                        height: '100%',
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        padding: '0 0.85rem',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: '0.88rem',
                        fontWeight: 400,
                        color: '#ffffff',
                        caretColor: '#ff00ff',
                      }}
                    />
                    {url && !loading && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 0.35rem',
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setUrl('')}
                          title="Clear URL"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.4)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0.3rem 0.5rem',
                            transition: 'color 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff1e27')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)')}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    id="analyze-btn"
                    type="submit"
                    className="glowing-btn"
                    disabled={loading || !url.trim()}
                    style={{ height: '48px', padding: '0 2.5rem', flexShrink: 0 }}
                  >
                    {loading ? (
                      <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                        </svg>
                        {t.form.processing}
                      </>
                    ) : (
                      <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        {t.form.hackClips}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Twitch input mode */}
            {sourceMode === 'twitch' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', width: '100%' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t.form.twitchUrlLabel}</label>
                <div className="form-main-input-row">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'stretch',
                      position: 'relative',
                      flex: 1,
                      height: '48px',
                      background: '#060608',
                      border: '1px solid rgba(145, 70, 255, 0.45)',
                      boxShadow: '0 0 10px rgba(145, 70, 255, 0.2)',
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    }}
                    className="hacker-api-key-container"
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 0.85rem',
                        background: 'rgba(145, 70, 255, 0.12)',
                        borderRight: '1px solid rgba(145, 70, 255, 0.3)',
                        color: '#9146ff',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      TWITCH &gt;
                    </div>
                    <input
                      id="twitch-url-input"
                      type="text"
                      value={twitchUrl || url}
                      onChange={(e) => {
                        setTwitchUrl(e.target.value);
                        setUrl(e.target.value);
                      }}
                      disabled={loading}
                      placeholder={t.form.twitchUrlPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      required={sourceMode === 'twitch'}
                      style={{
                        flex: 1,
                        height: '100%',
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        padding: '0 0.85rem',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: '0.88rem',
                        fontWeight: 400,
                        color: '#ffffff',
                        caretColor: '#9146ff',
                      }}
                    />
                    {(twitchUrl || url) && !loading && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 0.35rem',
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => { setTwitchUrl(''); setUrl(''); }}
                          title="Clear URL"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.4)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0.3rem 0.5rem',
                            transition: 'color 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff1e27')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)')}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading || !(twitchUrl.trim() || url.trim())}
                    style={{
                      height: '48px',
                      padding: '0 1.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      whiteSpace: 'nowrap',
                      borderRadius: 0,
                      background: 'rgba(145, 70, 255, 0.2)',
                      border: '1px solid #9146ff',
                      color: '#ffffff',
                      boxShadow: '0 0 10px rgba(145, 70, 255, 0.3)'
                    }}
                  >
                    {loading ? (
                      <>
                        <div className="spinner" />
                        <span>{t.form.processing}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} color="#9146ff" />
                        <span>{t.form.hackClips}</span>
                      </>
                    )}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {t.form.twitchNotice}
                </p>
              </div>
            )}

            {/* Google Drive input mode */}
            {sourceMode === 'gdrive' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t.form.gdriveUrlLabel}</label>
                <div className="form-main-input-row">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'stretch',
                      position: 'relative',
                      flex: 1,
                      height: '48px',
                      background: '#060608',
                      border: '1px solid rgba(255, 0, 255, 0.35)',
                      boxShadow: '0 0 8px rgba(255, 0, 255, 0.15)',
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    }}
                    className="hacker-api-key-container"
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 0.85rem',
                        background: 'rgba(255, 0, 255, 0.08)',
                        borderRight: '1px solid rgba(255, 0, 255, 0.25)',
                        color: '#ff00ff',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      LINK &gt;
                    </div>
                    <input
                      id="gdrive-url-input"
                      type="text"
                      value={gdriveUrl}
                      onChange={(e) => setGdriveUrl(e.target.value)}
                      disabled={loading}
                      placeholder={t.form.gdriveUrlPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      required={sourceMode === 'gdrive'}
                      style={{
                        flex: 1,
                        height: '100%',
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        padding: '0 0.85rem',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: '0.88rem',
                        fontWeight: 400,
                        color: '#ffffff',
                        caretColor: '#ff00ff',
                      }}
                    />
                    {gdriveUrl && !loading && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 0.35rem',
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setGdriveUrl('')}
                          title="Clear URL"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.4)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0.3rem 0.5rem',
                            transition: 'color 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff1e27')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)')}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    id="analyze-gdrive-btn"
                    type="submit"
                    className="glowing-btn"
                    disabled={loading || !gdriveUrl.trim()}
                    style={{ height: '48px', padding: '0 2.5rem', flexShrink: 0 }}
                  >
                    {loading ? (
                      <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                        </svg>
                        {t.form.processing}
                      </>
                    ) : (
                      <>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        {t.form.hackClips}
                      </>
                    )}
                  </button>
                </div>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.3, fontWeight: 400, display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px', opacity: 0.7 }}><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.5h1.5v4h-1.5v-4z"/></svg>
                  <span>{t.form.gdriveNotice}</span>
                </span>
              </div>
            )}

            {/* Upload Local Video mode */}
            {sourceMode === 'upload' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="file"
                  ref={videoFileInputRef}
                  accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadedVideoFile(file);
                      setUploadedVideoInfo(null);
                      setError(null);
                    }
                  }}
                />

                {!uploadedVideoFile && !uploadedVideoInfo ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOverVideo(true);
                    }}
                    onDragLeave={() => setIsDragOverVideo(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOverVideo(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        setUploadedVideoFile(file);
                        setUploadedVideoInfo(null);
                        setError(null);
                      }
                    }}
                    onClick={() => videoFileInputRef.current?.click()}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.85rem',
                      padding: '2.5rem 1.5rem',
                      borderRadius: 0,
                      border: isDragOverVideo ? '2px dashed #00e5ff' : '1px dashed rgba(0, 229, 255, 0.45)',
                      background: isDragOverVideo ? 'rgba(0, 229, 255, 0.15)' : 'rgba(0, 229, 255, 0.04)',
                      boxShadow: isDragOverVideo ? '0 0 20px rgba(0, 229, 255, 0.35)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: 0,
                      background: 'rgba(0, 229, 255, 0.12)',
                      border: '1px solid #00e5ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#00e5ff',
                      boxShadow: '0 0 12px rgba(0, 229, 255, 0.35)'
                    }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7"></polygon>
                        <rect x="1" y="5" width="15" height="14" rx="0" ry="0"></rect>
                      </svg>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.25rem' }}>
                        {t.form.dropVideoTitle}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {t.form.dropVideoSubtitle}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="action-link-btn"
                      style={{
                        marginTop: '0.25rem',
                        padding: '0.45rem 1.2rem',
                        borderRadius: 0,
                        background: 'rgba(0, 229, 255, 0.15)',
                        border: '1px solid #00e5ff',
                        color: '#00e5ff',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        boxShadow: '0 0 10px rgba(0, 229, 255, 0.3)'
                      }}
                    >
                      {t.form.chooseVideoFile}
                    </button>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1.25rem 1.5rem',
                    borderRadius: 0,
                    background: 'rgba(0, 229, 255, 0.08)',
                    border: '1px solid #00e5ff',
                    boxShadow: '0 0 12px rgba(0, 229, 255, 0.2)',
                    flexWrap: 'wrap',
                    gap: '1rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                      <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: 0,
                        background: 'rgba(59, 130, 246, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#60a5fa',
                        flexShrink: 0
                      }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7"></polygon>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: '0.95rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {uploadedVideoFile?.name || uploadedVideoInfo?.filename}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', alignItems: 'center' }}>
                          {uploadedVideoFile && (
                            <span>[PKG] {(uploadedVideoFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                          )}
                          {uploadedVideoInfo && uploadedVideoInfo.duration > 0 && (
                            <span> {Math.round(uploadedVideoInfo.duration)}s</span>
                          )}
                          <span>•</span>
                          <span style={{ color: '#10b981', fontWeight: 600 }}>* Whisper AI Auto-Transcribe</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedVideoFile(null);
                          setUploadedVideoInfo(null);
                          if (videoFileInputRef.current) videoFileInputRef.current.value = '';
                        }}
                        disabled={loading}
                        style={{
                          padding: '0.5rem 1rem',
                          borderRadius: 0,
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: 'var(--text-secondary)',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {t.form.changeVideo}
                      </button>
                      <button
                        id="analyze-uploaded-btn"
                        type="submit"
                        className="glowing-btn"
                        disabled={loading || isUploadingVideo}
                        style={{ height: '42px', padding: '0 2rem' }}
                      >
                        {isUploadingVideo ? (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                            </svg>
                            {t.form.uploadingVideo}
                          </>
                        ) : loading ? (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                            </svg>
                            {t.form.processing}
                          </>
                        ) : (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            {t.form.hackClips}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="form-settings-grid">
              {/* Card 1: AI Engine Configuration */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.25rem', borderRadius: 0, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '0.9rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
                    [AI] {t.form.aiSettingsTitle}
                  </h3>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                    {apiProvider === 'gemini' ? 'ENGINE: GOOGLE_GEMINI' : 'ENGINE: OPENROUTER_MULTILLM'}
                  </span>
                </div>

                {/* Provider Selection Tabs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: '#0a0a0f', padding: '3px', border: '1px solid rgba(255, 0, 255, 0.2)' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setApiProvider('gemini');
                      localStorage.setItem('cheat_clip_api_provider', 'gemini');
                      setError(null);
                    }}
                    style={{
                      padding: '0.55rem 0.75rem',
                      background: apiProvider === 'gemini' ? '#ff00ff' : 'transparent',
                      color: apiProvider === 'gemini' ? '#000000' : 'rgba(255, 255, 255, 0.7)',
                      border: 'none',
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      letterSpacing: '0.04em',
                      transition: 'all 0.15s ease',
                      boxShadow: apiProvider === 'gemini' ? '0 0 10px rgba(255, 0, 255, 0.4)' : 'none',
                    }}
                  >
                    {t.form.providerGemini}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setApiProvider('openrouter');
                      localStorage.setItem('cheat_clip_api_provider', 'openrouter');
                      setError(null);
                    }}
                    style={{
                      padding: '0.55rem 0.75rem',
                      background: apiProvider === 'openrouter' ? '#ff00ff' : 'transparent',
                      color: apiProvider === 'openrouter' ? '#000000' : 'rgba(255, 255, 255, 0.7)',
                      border: 'none',
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      letterSpacing: '0.04em',
                      transition: 'all 0.15s ease',
                      boxShadow: apiProvider === 'openrouter' ? '0 0 10px rgba(255, 0, 255, 0.4)' : 'none',
                    }}
                  >
                    {t.form.providerOpenRouter}
                  </button>
                </div>

                {/* Provider Content: GEMINI */}
                {apiProvider === 'gemini' ? (
                  <>
                    {/* Gemini API Key input */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {t.form.apiKeyLabel}
                          <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', fontWeight: 800, color: '#ff1e27', background: 'rgba(255, 30, 39, 0.15)', border: '1px solid #ff1e27', borderRadius: 0, padding: '0.1rem 0.45rem', letterSpacing: '0.05em', boxShadow: '0 0 8px rgba(255, 30, 39, 0.3)' }}>{t.form.apiKeyRequired}</span>
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <a
                            href="https://aistudio.google.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 600, transition: 'var(--transition-smooth)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            className="action-link-btn"
                          >
                            <ExternalLink size={12} /> {t.form.getFreeKey}
                          </a>
                        </div>
                      </label>
                      <HackerApiKeyInput
                        id="gemini-key-input"
                        value={apiKey}
                        onChange={(val) => {
                          setApiKey(val);
                          localStorage.setItem('cheat_clip_gemini_api_key', val);
                          if (val.trim()) setError(null);
                        }}
                        disabled={loading}
                        placeholder={t.form.apiKeyPlaceholder}
                        error={!apiKey.trim()}
                        revealLabel={t.form.revealKey}
                        maskLabel={t.form.maskKey}
                      />
                      {!apiKey.trim() && (
                        <span style={{ fontSize: '0.75rem', color: '#ff1e27', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}>
                          <AlertTriangle size={13} color="#ff1e27" />
                          {t.form.apiKeyErrorHint}
                        </span>
                      )}
                    </div>

                    {/* Gemini AI Model Selection */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span>{t.form.aiModelLabel}</span>
                        {loadingModels && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--primary)', animation: 'pulse 1.5s infinite ease-in-out' }}>
                            ⏳ {t.form.fetchingModels}
                          </span>
                        )}
                      </label>
                      <select
                        className="form-input"
                        value={selectedModel}
                        onChange={(e) => {
                          setSelectedModel(e.target.value);
                          localStorage.setItem('cheat_clip_selected_model', e.target.value);
                        }}
                        disabled={loading}
                        style={{ padding: '0.6rem 1rem', fontSize: '0.875rem', height: '42px', cursor: 'pointer', appearance: 'auto', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 0 }}
                      >
                        {availableModels.length > 0 ? (
                          availableModels.map((m) => (
                            <option key={m} value={m} style={{ background: '#0a0a0f', color: '#fff' }}>
                              {m}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="gemini-2.0-flash" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.0-flash (Fast & recommended - Free tier friendly)</option>
                            <option value="gemini-2.0-flash-lite" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.0-flash-lite (Ultra-fast & lightweight)</option>
                            <option value="gemini-2.0-flash" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.0-flash (Fast & responsive)</option>
                            <option value="gemini-2.0-flash-lite" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.0-flash-lite (Lightweight flash)</option>
                            <option value="gemini-1.5-flash" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-1.5-flash (Fallback flash)</option>
                            <option value="gemini-2.5-pro" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.5-pro (Creative & complex - High quota)</option>
                          </>
                        )}
                      </select>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '0.2rem' }}>
                        NOTE: <strong>{t.form.resilienceTip}</strong> {t.form.resilienceDesc}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    {/* OpenRouter API Key input */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {t.form.openrouterKeyLabel}
                          <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', fontWeight: 800, color: '#ff1e27', background: 'rgba(255, 30, 39, 0.15)', border: '1px solid #ff1e27', borderRadius: 0, padding: '0.1rem 0.45rem', letterSpacing: '0.05em', boxShadow: '0 0 8px rgba(255, 30, 39, 0.3)' }}>{t.form.apiKeyRequired}</span>
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <a
                            href="https://openrouter.ai/settings/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--primary)', textDecoration: 'none', fontSize: '0.75rem', fontWeight: 600, transition: 'var(--transition-smooth)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            className="action-link-btn"
                          >
                            <ExternalLink size={12} /> {t.form.openrouterGetFreeKey}
                          </a>
                        </div>
                      </label>
                      <HackerApiKeyInput
                        id="openrouter-key-input"
                        value={openRouterKey}
                        onChange={(val) => {
                          setOpenRouterKey(val);
                          localStorage.setItem('cheat_clip_openrouter_key', val);
                          if (val.trim()) setError(null);
                        }}
                        disabled={loading}
                        placeholder={t.form.openrouterKeyPlaceholder}
                        error={!openRouterKey.trim()}
                        revealLabel={t.form.revealKey}
                        maskLabel={t.form.maskKey}
                      />
                      {!openRouterKey.trim() && (
                        <span style={{ fontSize: '0.75rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /></svg>
                          {t.form.apiKeyErrorHint}
                        </span>
                      )}
                    </div>

                    {/* OpenRouter Model Selection */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {t.form.openrouterModelLabel}
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {loadingOpenRouterModels && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--primary)', animation: 'pulse 1.5s infinite ease-in-out' }}>
                              ⏳ {t.form.fetchingModels}
                            </span>
                          )}
                          <span
                            onClick={() => setIsCustomOpenRouterModel(!isCustomOpenRouterModel)}
                            style={{
                              cursor: 'pointer',
                              color: isCustomOpenRouterModel ? 'var(--primary)' : 'var(--text-muted)',
                              fontSize: '0.72rem',
                              fontFamily: "'JetBrains Mono', monospace",
                              textDecoration: 'underline'
                            }}
                          >
                            {isCustomOpenRouterModel ? '[SELECT PRESET]' : '[CUSTOM ID]'}
                          </span>
                        </div>
                      </div>

                      {isCustomOpenRouterModel ? (
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. qwen/qwen-2.5-72b-instruct or deepseek/deepseek-r1"
                          value={customOpenRouterModel || openRouterModel}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            setCustomOpenRouterModel(val);
                            setOpenRouterModel(val);
                            localStorage.setItem('cheat_clip_openrouter_model', val);
                          }}
                          disabled={loading}
                          style={{ height: '42px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem' }}
                        />
                      ) : (
                        <select
                          className="form-input"
                          value={openRouterModel}
                          onChange={(e) => {
                            setOpenRouterModel(e.target.value);
                            localStorage.setItem('cheat_clip_openrouter_model', e.target.value);
                          }}
                          disabled={loading}
                          style={{ padding: '0.6rem 1rem', fontSize: '0.875rem', height: '42px', cursor: 'pointer', appearance: 'auto', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 0 }}
                        >
                          {openRouterModels.length > 0 ? (
                            openRouterModels.map((m) => (
                              <option key={m.id} value={m.id} style={{ background: '#0a0a0f', color: '#fff' }}>
                                {m.name || m.id} {m.recommended ? '[RECOMMENDED]' : ''}
                              </option>
                            ))
                          ) : (
                            <>
                              <option value="google/gemini-2.5-flash" style={{ background: '#0a0a0f', color: '#fff' }}>Google: Gemini 2.5 Flash [RECOMMENDED]</option>
                              <option value="google/gemini-2.0-flash-001" style={{ background: '#0a0a0f', color: '#fff' }}>Google: Gemini 2.0 Flash</option>
                              <option value="anthropic/claude-3.5-sonnet" style={{ background: '#0a0a0f', color: '#fff' }}>Anthropic: Claude 3.5 Sonnet [RECOMMENDED]</option>
                              <option value="anthropic/claude-3.5-haiku" style={{ background: '#0a0a0f', color: '#fff' }}>Anthropic: Claude 3.5 Haiku</option>
                              <option value="deepseek/deepseek-chat" style={{ background: '#0a0a0f', color: '#fff' }}>DeepSeek: DeepSeek V3 [RECOMMENDED]</option>
                              <option value="meta-llama/llama-3.3-70b-instruct" style={{ background: '#0a0a0f', color: '#fff' }}>Meta: Llama 3.3 70B Instruct</option>
                              <option value="openai/gpt-4o-mini" style={{ background: '#0a0a0f', color: '#fff' }}>OpenAI: GPT-4o Mini</option>
                              <option value="openai/gpt-4o" style={{ background: '#0a0a0f', color: '#fff' }}>OpenAI: GPT-4o</option>
                              <option value="qwen/qwen-2.5-72b-instruct" style={{ background: '#0a0a0f', color: '#fff' }}>Qwen: Qwen 2.5 72B Instruct</option>
                              <option value="mistralai/mistral-large-2411" style={{ background: '#0a0a0f', color: '#fff' }}>Mistral: Mistral Large 2</option>
                              <option value="google/gemini-2.5-pro" style={{ background: '#0a0a0f', color: '#fff' }}>Google: Gemini 2.5 Pro</option>
                            </>
                          )}
                        </select>
                      )}
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '0.2rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px', opacity: 0.7 }}><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.5h1.5v4h-1.5v-4z"/></svg>
                        <span><strong>Same-Family Fallback:</strong> {t.form.openrouterResilienceDesc}</span>
                      </span>
                    </div>
                  </>
                )}

              </div>

              {/* Card 2: Clip Parameters & Focus */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.25rem', borderRadius: 0, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                  * {t.form.clipCustomizationTitle}
                </h3>

                {/* Preferred Duration Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t.form.targetDuration}</label>
                  <div className="duration-selector" id="duration-selector-group">
                    <button
                      type="button"
                      className={`duration-btn ${durationPref === '15s' ? 'active' : ''}`}
                      onClick={() => {
                        setDurationPref('15s');
                        localStorage.setItem('cheat_clip_duration_pref', '15s');
                      }}
                      disabled={loading}
                    >
                      {t.form.dur15s}
                    </button>
                    <button
                      type="button"
                      className={`duration-btn ${durationPref === '30s' ? 'active' : ''}`}
                      onClick={() => {
                        setDurationPref('30s');
                        localStorage.setItem('cheat_clip_duration_pref', '30s');
                      }}
                      disabled={loading}
                    >
                      {t.form.dur30s}
                    </button>
                    <button
                      type="button"
                      className={`duration-btn ${durationPref === '60s' ? 'active' : ''}`}
                      onClick={() => {
                        setDurationPref('60s');
                        localStorage.setItem('cheat_clip_duration_pref', '60s');
                      }}
                      disabled={loading}
                    >
                      {t.form.dur60s}
                    </button>
                    <button
                      type="button"
                      className={`duration-btn ${durationPref === 'auto' ? 'active' : ''}`}
                      onClick={() => {
                        setDurationPref('auto');
                        localStorage.setItem('cheat_clip_duration_pref', 'auto');
                      }}
                      disabled={loading}
                    >
                      {t.form.durAuto}
                    </button>
                  </div>
                  {durationPref === 'auto' && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.3, marginTop: '0.1rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px', opacity: 0.7 }}><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.5h1.5v4h-1.5v-4z"/></svg>
                      <span>{t.form.durAutoTip}</span>
                    </span>
                  )}
                </div>

                {/* Focus Prompt Search Keyword */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {t.form.findSpecificMoments} <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 400 }}>{t.form.optional}</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t.form.promptPlaceholder}
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    disabled={loading}
                    style={{ height: '42px' }}
                  />
                </div>

                {/* Target Clip Count Selector & Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {t.form.targetClipCount}
                    </label>
                    <span style={{
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: 'var(--secondary)',
                      background: 'rgba(255, 94, 58, 0.12)',
                      border: '1px solid rgba(255, 94, 58, 0.3)',
                      borderRadius: 0,
                      padding: '0.1rem 0.5rem'
                    }}>
                      {clipCountMode === 'auto' ? t.form.clipCountAutoBadge : t.form.approxClips(targetClipCount)}
                    </span>
                  </div>

                  {/* Auto vs Custom Count Option Buttons */}
                  <div className="duration-selector" id="clip-count-mode-group">
                    <button
                      type="button"
                      className={`duration-btn ${clipCountMode === 'auto' ? 'active' : ''}`}
                      onClick={() => {
                        setClipCountMode('auto');
                        localStorage.setItem('cheat_clip_clip_count_mode', 'auto');
                      }}
                      disabled={loading}
                    >
                      {t.form.clipCountAuto}
                    </button>
                    <button
                      type="button"
                      className={`duration-btn ${clipCountMode === 'custom' ? 'active' : ''}`}
                      onClick={() => {
                        setClipCountMode('custom');
                        localStorage.setItem('cheat_clip_clip_count_mode', 'custom');
                      }}
                      disabled={loading}
                    >
                      {t.form.clipCountCustom}
                    </button>
                  </div>

                  {clipCountMode === 'custom' ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '10px' }}>1</span>
                        <input
                          type="range"
                          min="1"
                          max="50"
                          value={targetClipCount}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setTargetClipCount(val);
                            localStorage.setItem('cheat_clip_target_clip_count', String(val));
                          }}
                          disabled={loading}
                          style={{
                            flex: 1,
                            '--slider-progress': `${Math.max(0, Math.min(100, ((targetClipCount - 1) / (50 - 1)) * 100))}%`
                          } as React.CSSProperties}
                        />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '20px', textAlign: 'right' }}>50</span>
                      </div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.3, display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px', opacity: 0.7 }}><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.5h1.5v4h-1.5v-4z"/></svg>
                        <span>{t.form.clipCountTip(targetClipCount, targetClipCount <= 5 ? `${Math.max(1, targetClipCount - 1)}-${targetClipCount + 2}` : targetClipCount <= 10 ? `${Math.max(1, targetClipCount - 2)}-${targetClipCount + 3}` : `${targetClipCount - 5}-${targetClipCount + 5}`)}</span>
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.3, marginTop: '0.1rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px', opacity: 0.7 }}><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.5h1.5v4h-1.5v-4z"/></svg>
                      <span>{t.form.clipCountAutoTip}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Subtitles Source Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t.form.subtitlesSource}</label>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="subtitlesSource"
                    checked={subtitlesSource === 'youtube'}
                    onChange={() => setSubtitlesSource('youtube')}
                    style={{ accentColor: 'var(--primary)' }}
                    disabled={loading}
                  />
                  {sourceMode === 'youtube' ? t.form.autoFetchYoutube : t.form.autoTranscript}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="subtitlesSource"
                    checked={subtitlesSource === 'manual'}
                    onChange={() => setSubtitlesSource('manual')}
                    style={{ accentColor: 'var(--primary)' }}
                    disabled={loading}
                  />
                  {t.form.uploadCustomSubtitles}
                </label>

                {subtitlesSource === 'manual' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input
                      type="file"
                      accept=".srt,.txt"
                      id="manual-subtitle-file"
                      style={{ display: 'none' }}
                      disabled={loading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setManualSubtitlesFileName(file.name);
                        const reader = new FileReader();
                        reader.onload = (evt) => {
                          const text = evt.target?.result as string;
                          setManualSubtitlesContent(text);
                          setToastMessage(t.form.subtitlesLoaded(file.name));
                          setTimeout(() => setToastMessage(null), 3000);
                        };
                        reader.readAsText(file);
                      }}
                    />
                    <label
                      htmlFor="manual-subtitle-file"
                      className="form-input"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 1rem',
                        cursor: 'pointer',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 0,
                        fontSize: '0.85rem',
                        width: 'auto',
                        color: 'var(--text-primary)',
                        transition: 'var(--transition-smooth)'
                      }}
                    >
                      {t.form.chooseSrtTxt}
                    </label>
                    {manualSubtitlesFileName && (
                      <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.85 }}><path d="M4.5 3h-1A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 12.5 3h-1v.5a.5.5 0 0 1-1 0V3h-4v.5a.5.5 0 0 1-1 0V3zm3 0V1.5a.5.5 0 0 0-1 0V3h1zm2 0h-1V1.5a.5.5 0 0 1 1 0V3zM5 3V1.5a.5.5 0 0 0-1 0V3h1z"/></svg>
                        {manualSubtitlesFileName}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {subtitlesSource === 'youtube' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.25rem', padding: '0.75rem 0.9rem', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', borderRadius: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.75 }}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                      <span>{t.form.transcriptLanguage}</span>
                    </label>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {t.form.transcriptLanguageHint}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', width: '100%', maxWidth: '440px' }}>
                    <button
                      type="button"
                      className={`duration-btn ${transcriptLanguage === 'en' ? 'active' : ''}`}
                      onClick={() => {
                        setTranscriptLanguage('en');
                        localStorage.setItem('cheat_clip_transcript_language', 'en');
                      }}
                      disabled={loading}
                      style={{
                        flex: '1 1 140px',
                        padding: '0.6rem 0.9rem',
                        fontSize: '0.82rem',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        textAlign: 'center',
                        borderRadius: 0
                      }}
                    >
                      {t.form.langEnglish}
                    </button>
                    <button
                      type="button"
                      className={`duration-btn ${transcriptLanguage === 'id' ? 'active' : ''}`}
                      onClick={() => {
                        setTranscriptLanguage('id');
                        localStorage.setItem('cheat_clip_transcript_language', 'id');
                      }}
                      disabled={loading}
                      style={{
                        flex: '1 1 160px',
                        padding: '0.6rem 0.9rem',
                        fontSize: '0.82rem',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        textAlign: 'center',
                        borderRadius: 0
                      }}
                    >
                      {t.form.langIndonesian}
                    </button>
                  </div>
                </div>
              )}

              {subtitlesSource === 'youtube' && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', opacity: 0.8, display: 'flex', alignItems: 'flex-start', gap: '0.4rem', marginTop: '0.15rem', lineHeight: '1.4' }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '2px', opacity: 0.7 }}><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.5h1.5v4h-1.5v-4z"/></svg>
                  <span><strong>{t.form.subtitlesTipTitle}</strong> {t.form.subtitlesTipDesc} <a href="https://downsub.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--secondary)', textDecoration: 'underline', fontWeight: '500' }}>downsub.com</a> {t.form.andUploadOption}</span>
                </span>
              )}
            </div>

            {/* Custom Search Range Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t.form.analysisRange}</label>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="rangeType"
                    checked={rangeType === 'entire'}
                    onChange={() => setRangeType('entire')}
                    style={{ accentColor: 'var(--primary)' }}
                    disabled={loading}
                  />
                  {t.form.entireVideo}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="rangeType"
                    checked={rangeType === 'custom'}
                    onChange={() => setRangeType('custom')}
                    style={{ accentColor: 'var(--primary)' }}
                    disabled={loading}
                  />
                  {t.form.customRange}
                </label>

                {rangeType === 'custom' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder={t.form.startPlaceholder}
                      value={customRangeStart}
                      onChange={(e) => setCustomRangeStart(e.target.value)}
                      style={{ width: '150px', padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
                      disabled={loading}
                    />
                    <span style={{ color: 'var(--text-muted)' }}>{t.form.to}</span>
                    <input
                      type="text"
                      className="form-input"
                      placeholder={t.form.endPlaceholder}
                      value={customRangeEnd}
                      onChange={(e) => setCustomRangeEnd(e.target.value)}
                      style={{ width: '150px', padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
                      disabled={loading}
                    />
                  </div>
                )}
              </div>
              {rangeType === 'custom' && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t.form.rangeFormatHint}
                </span>
              )}
            </div>
          </form>
        </section>



        {/* Error state */}
        {error && (
          <section className="glass-panel" style={{ borderColor: '#ff1e27', background: 'rgba(255, 30, 39, 0.08)', boxShadow: '0 0 15px rgba(255, 30, 39, 0.25)' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <span style={{ display: 'flex', color: '#ff1e27', lineHeight: 1, marginTop: '2px', filter: 'drop-shadow(0 0 6px rgba(255, 30, 39, 0.6))' }}>
                <AlertTriangle size={24} />
              </span>
              <div style={{ flex: 1 }}>
                <h4 style={{ color: '#ff1e27', margin: 0, fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.02em' }}>{t.errors.analysisFailed}</h4>
                {/* Subtitle failure actions */}
                {(error.toLowerCase().includes("subtitle") || error.toLowerCase().includes("transcript")) ? (
                  <>
                    <div style={{
                      fontSize: '0.825rem',
                      color: '#fca5a5',
                      marginTop: '0.5rem',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                      background: 'rgba(0, 0, 0, 0.45)',
                      padding: '0.75rem 1rem',
                      borderRadius: 0,
                      border: '1px solid rgba(255, 30, 39, 0.3)',
                      fontFamily: 'monospace',
                      maxHeight: '260px',
                      overflowY: 'auto'
                    }}>
                      {error}
                    </div>
                    <div style={{ marginTop: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="glowing-btn"
                        onClick={() => onAnalyze()}
                        disabled={loading}
                        style={{
                          padding: '0.45rem 1.15rem',
                          fontSize: '0.85rem',
                          borderRadius: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          cursor: 'pointer'
                        }}
                      >
                        <RefreshCw size={14} className={loading ? "spinner-icon" : ""} />
                        {t.errors.tryAgain || "Try Again"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSubtitlesSource('manual');
                          const fileInput = document.getElementById('manual-subtitle-file');
                          if (fileInput) fileInput.click();
                        }}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: 'var(--text-primary)',
                          borderRadius: 0,
                          padding: '0.45rem 0.85rem',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.45rem'
                        }}
                      >
                        <Upload size={14} />
                        {t.form.uploadCustomSubtitles}
                      </button>
                    </div>
                    <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.85rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 0, borderLeft: '3px solid #f59e0b', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      <strong>Tip:</strong> {t.errors.noSubtitlesTip}
                    </div>
                  </>
                ) : (
                  /* Non-subtitle errors (e.g. Gemini API Key, quota, general errors) */
                  <>
                    <p style={{ fontSize: '0.875rem', color: '#fca5a5', marginTop: '0.35rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{error}</p>
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="glowing-btn"
                        onClick={() => onAnalyze()}
                        disabled={loading}
                        style={{
                          padding: '0.4rem 1.05rem',
                          fontSize: '0.8rem',
                          borderRadius: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          cursor: 'pointer'
                        }}
                      >
                        <RefreshCw size={13} className={loading ? "spinner-icon" : ""} />
                        {t.errors.tryAgain || "Try Again"}
                      </button>
                      {(error.toLowerCase().includes("api key") || error.toLowerCase().includes("quota") || error.toLowerCase().includes("flash model") || error.toLowerCase().includes("aistudio") || error.toLowerCase().includes("rate limit") || error.toLowerCase().includes("504") || error.toLowerCase().includes("deadline")) && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              const keyInput = document.getElementById('gemini-key-input') as HTMLInputElement | null;
                              if (keyInput) {
                                keyInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                keyInput.focus();
                                keyInput.select();
                              }
                            }}
                            style={{
                              background: 'rgba(255, 30, 39, 0.2)',
                              border: '1px solid #ff1e27',
                              color: '#fff',
                              borderRadius: 0,
                              padding: '0.4rem 0.85rem',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              transition: 'all 0.2s ease',
                              boxShadow: '0 0 10px rgba(255, 30, 39, 0.3)'
                            }}
                          >
                            <ExternalLink size={13} />
                            {t.errors.changeApiKeyAction}
                          </button>
                          <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: 'var(--primary)',
                              fontSize: '0.8rem',
                              textDecoration: 'underline',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            <ExternalLink size={12} />
                            {t.errors.getNewKeyLink}
                          </a>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        )}
    </>
  );
};
