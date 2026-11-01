import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { HeatmapTimeline } from './components/HeatmapTimeline';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { ClipStudioSection } from './components/ClipStudioSection';
import { CookiesModal } from './components/CookiesModal';
import { CookieWarningModal } from './components/CookieWarningModal';
import { ClipTrimmerModal } from './components/ClipTrimmerModal';
import { AppUpdateModal } from './components/AppUpdateModal';
import { resilientFetch } from './utils/api';
import { getStoredCookies, hasStoredCookies } from './utils/cookieUtils';
import { extractAudioFromVideoClient } from './utils/audioExtractor';
import { renderClipClientSide, triggerBrowserDownload } from './services/clientRenderer';
import { renderClipWebCodecs, isWebCodecsGpuSupported } from './services/webcodecsRenderer';
import { isMobileDevice, requestWakeLock, releaseWakeLock } from './utils/deviceUtils';
import { LayoutMetricsSync } from './utils/layoutMetricsSync';
import { useLanguage } from './locales';
import { HackerApiKeyInput } from './components/HackerApiKeyInput';
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
  Upload,
  CheckCircle2,
  Clock,
  ExternalLink,
  X,
  Trash2,
  Heart,
  RefreshCw,
  Layers,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FileVideo,
  Film,
  Scissors,
  Sparkles
} from 'lucide-react';
import type { AnalyzeResponse, ViralClip, RenderSettings, BatchRenderProgress } from './types';

// Declare YT global variables for TypeScript
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

export default function App() {
  const { t } = useLanguage();
  const [url, setUrl] = useState('');
  const [gdriveUrl, setGdriveUrl] = useState('');
  const [twitchUrl, setTwitchUrl] = useState('');
  const [sourceMode, setSourceMode] = useState<'youtube' | 'twitch' | 'gdrive' | 'upload'>('youtube');
  const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null);
  const [uploadedVideoInfo, setUploadedVideoInfo] = useState<{
    videoId: string;
    filename: string;
    savedName: string;
    duration: number;
    videoUrl: string;
    filePath: string;
    width: number;
    height: number;
  } | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isDragOverVideo, setIsDragOverVideo] = useState(false);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [durationPref, setDurationPref] = useState<'15s' | '30s' | '60s' | 'auto'>(() => {
    const saved = localStorage.getItem('cheat_clip_duration_pref');
    if (saved === '15s' || saved === '30s' || saved === '60s' || saved === 'auto') return saved;
    return '30s';
  });
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('cheat_clip_gemini_api_key') || '');
  const [apiProvider, setApiProvider] = useState<'gemini' | 'openrouter'>(() => {
    const saved = localStorage.getItem('cheat_clip_api_provider');
    return (saved === 'openrouter' || saved === 'gemini') ? saved : 'gemini';
  });
  const [openRouterKey, setOpenRouterKey] = useState<string>(() => localStorage.getItem('cheat_clip_openrouter_key') || '');
  const [openRouterModel, setOpenRouterModel] = useState<string>(() => {
    const saved = localStorage.getItem('cheat_clip_openrouter_model');
    return saved || 'google/gemini-2.5-flash';
  });
  const [openRouterModels, setOpenRouterModels] = useState<Array<{ id: string; name: string; description?: string; context_length?: number; recommended?: boolean }>>([]);
  const [loadingOpenRouterModels, setLoadingOpenRouterModels] = useState(false);
  const [customOpenRouterModel, setCustomOpenRouterModel] = useState<string>('');
  const [isCustomOpenRouterModel, setIsCustomOpenRouterModel] = useState<boolean>(false);
  const [isCookiesModalOpen, setIsCookiesModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [allowAppUpdates, setAllowAppUpdates] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      return host === 'localhost' || host === '127.0.0.1';
    }
    return false;
  });
  const [hasCookies, setHasCookies] = useState<boolean>(() => hasStoredCookies());
  const [cookieWarningState, setCookieWarningState] = useState<{
    isOpen: boolean;
    actionType: 'render' | 'download';
    onProceed: () => void;
  }>({
    isOpen: false,
    actionType: 'render',
    onProceed: () => { },
  });
  const [isDownloadingRaw, setIsDownloadingRaw] = useState(false);
  const [rawDownloadProgress, setRawDownloadProgress] = useState<{
    jobId: string;
    status: string;
    percent: number;
    downloaded: string;
    total: string;
    speed: string;
    eta: string;
    downloadUrl?: string;
    filename?: string;
    error?: string;
  } | null>(null);
  const [clipDownloadStates, setClipDownloadStates] = useState<Record<string, {
    status: 'idle' | 'downloading' | 'ready' | 'error';
    error?: string;
  }>>({});
  const [trimmerClip, setTrimmerClip] = useState<ViralClip | null>(null);

  // AI model selection and custom focus prompt states
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const saved = localStorage.getItem('cheat_clip_selected_model');
    // Auto-migrate outdated 1.0 models to gemini-2.5-flash
    if (saved && (saved.includes('1.0') || saved.includes('vision'))) {
      localStorage.setItem('cheat_clip_selected_model', 'gemini-2.5-flash');
      return 'gemini-2.5-flash';
    }
    return saved || 'gemini-2.5-flash';
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [targetClipCount, setTargetClipCount] = useState<number>(() => {
    const val = localStorage.getItem('cheat_clip_target_clip_count');
    return val ? Number(val) : 10;
  });
  const [clipCountMode, setClipCountMode] = useState<'auto' | 'custom'>(() => {
    const saved = localStorage.getItem('cheat_clip_clip_count_mode');
    return (saved === 'auto' || saved === 'custom') ? saved : 'auto';
  });

  // Custom range selection states
  const [rangeType, setRangeType] = useState<'entire' | 'custom'>('entire');
  const [customRangeStart, setCustomRangeStart] = useState<string>('');
  const [customRangeEnd, setCustomRangeEnd] = useState<string>('');

  // Manual subtitles states
  const [subtitlesSource, setSubtitlesSource] = useState<'youtube' | 'manual'>('youtube');
  const [manualSubtitlesContent, setManualSubtitlesContent] = useState<string>('');
  const [manualSubtitlesFileName, setManualSubtitlesFileName] = useState<string>('');
  const [transcriptLanguage, setTranscriptLanguage] = useState<'id' | 'en'>(() => {
    const saved = localStorage.getItem('cheat_clip_transcript_language');
    if (saved === 'id' || saved === 'en') return saved;
    return 'en';
  });
  const [workflowTab, setWorkflowTab] = useState<'source' | 'clips' | 'clipper'>('source');
  const [showLanguageConfirmModal, setShowLanguageConfirmModal] = useState<boolean>(false);
  const [skipLanguageConfirm, setSkipLanguageConfirm] = useState<boolean>(false);

  const parseTimeToSeconds = (val: string): number | null => {
    const clean = val.trim();
    if (!clean) return null;

    // Check if it's just raw number of seconds
    if (/^\d+(\.\d+)?$/.test(clean)) {
      return parseFloat(clean);
    }

    const parts = clean.split(':').map(Number);
    if (parts.some(isNaN)) return null;

    if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  };

  // Loading & process states
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  // Real-time progress and cognitive stage tracking
  const [stepProgress, setStepProgress] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [aiStage, setAiStage] = useState<string>('');
  const [aiDetail, setAiDetail] = useState<string>('');
  const [activeProcessingModel, setActiveProcessingModel] = useState<string>('');
  const [loadingElapsedTime, setLoadingElapsedTime] = useState<number>(0);

  // Active timer during loading so the user always sees live activity
  useEffect(() => {
    let interval: number | null = null;
    let tooLongTimer: number | null = null;
    if (loading) {
      setLoadingElapsedTime(0);
      setLoadingTooLong(false);
      interval = window.setInterval(() => {
        setLoadingElapsedTime(prev => prev + 1);
      }, 1000);
      // Show "taking too long" warning after 35 seconds
      tooLongTimer = window.setTimeout(() => {
        setLoadingTooLong(true);
      }, 35000);
    } else {
      setLoadingElapsedTime(0);
      setLoadingTooLong(false);
    }
    return () => {
      if (interval !== null) clearInterval(interval);
      if (tooLongTimer !== null) clearTimeout(tooLongTimer);
    };
  }, [loading]);

  // Check YouTube cookies configuration in browser localStorage
  useEffect(() => {
    const checkCookies = () => {
      setHasCookies(hasStoredCookies());
    };

    checkCookies();

    // Recheck on window focus, cross-tab storage changes, or in-app cookie updates
    window.addEventListener('focus', checkCookies);
    window.addEventListener('storage', checkCookies);
    window.addEventListener('cheatclip_cookies_updated', checkCookies);

    return () => {
      window.removeEventListener('focus', checkCookies);
      window.removeEventListener('storage', checkCookies);
      window.removeEventListener('cheatclip_cookies_updated', checkCookies);
    };
  }, []);

  // Query server update permissions (disabled on remote VPS/Docker for security)
  useEffect(() => {
    fetch('/api/system/version')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.allow_update === 'boolean') {
          setAllowAppUpdates(data.allow_update);
        } else if (data && data.is_server) {
          setAllowAppUpdates(false);
        }
      })
      .catch(() => {
        const host = window.location.hostname;
        setAllowAppUpdates(host === 'localhost' || host === '127.0.0.1');
      });
  }, []);

  // Results
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [activeClip, setActiveClip] = useState<ViralClip | null>(null);
  const [expandedClipIndex, setExpandedClipIndex] = useState<number | null>(null);

  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [leftPanelHeight, setLeftPanelHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!result) return;
    const updateHeight = () => {
      if (leftPanelRef.current) {
        setLeftPanelHeight(leftPanelRef.current.clientHeight);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);

    const observer = new ResizeObserver(updateHeight);
    if (leftPanelRef.current) {
      observer.observe(leftPanelRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      observer.disconnect();
    };
  }, [result, activeClip, expandedClipIndex]);

  // Search & Filtering States
  const [searchQuery, setSearchQuery] = useState('');
  const [viralityFilter, setViralityFilter] = useState<'all' | 'high' | 'medium' | 'marked'>('all');
  const [sortBy, setSortBy] = useState<'virality' | 'time' | 'duration' | 'marked'>('virality');

  // Assistance feature: Checklist for marked clips
  const [markedClips, setMarkedClips] = useState<Record<string, boolean>>({});
  const [loadingDetails, setLoadingDetails] = useState('');

  // Clip Studio & Auto-Clipper states
  const [batchProgress, setBatchProgress] = useState<BatchRenderProgress | null>(null);
  const [isLaunchingRender, setIsLaunchingRender] = useState(false);
  const batchEventSourceRef = useRef<EventSource | null>(null);

  const listenToBatchProgress = useCallback((batchId: string) => {
    if (batchEventSourceRef.current) {
      batchEventSourceRef.current.close();
      batchEventSourceRef.current = null;
    }
    const eventSource = new EventSource(`/api/render-progress/${batchId}`);
    batchEventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const progressData: BatchRenderProgress = JSON.parse(event.data);
        setBatchProgress(progressData);
        if (progressData.overall_status === 'completed' || progressData.overall_status === 'error') {
          eventSource.close();
          if (batchEventSourceRef.current === eventSource) {
            batchEventSourceRef.current = null;
          }
        }
      } catch (err) {
        console.error('Failed to parse progress SSE:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      eventSource.close();
      if (batchEventSourceRef.current === eventSource) {
        batchEventSourceRef.current = null;
      }
    };
  }, []);

  // Close SSE connection on unmount and handle mobile tab visibility reconnection
  const activeBatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (batchProgress?.overall_status === 'running') {
      activeBatchIdRef.current = batchProgress.batch_id;
      requestWakeLock();
    } else {
      activeBatchIdRef.current = null;
      if (!loading) {
        releaseWakeLock();
      }
    }
  }, [batchProgress?.overall_status, batchProgress?.batch_id, loading]);

  useEffect(() => {
    if (loading) {
      requestWakeLock();
    } else if (batchProgress?.overall_status !== 'running') {
      releaseWakeLock();
    }
  }, [loading, batchProgress?.overall_status]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const runningBatchId = activeBatchIdRef.current;
        if (runningBatchId && !runningBatchId.startsWith('client_')) {
          listenToBatchProgress(runningBatchId);
        }
        if (loading || activeBatchIdRef.current) {
          requestWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (batchEventSourceRef.current) {
        batchEventSourceRef.current.close();
        batchEventSourceRef.current = null;
      }
      releaseWakeLock();
    };
  }, [listenToBatchProgress, loading]);

  const markedClipsList = useMemo(() => {
    if (!result?.clips) return [];
    return result.clips.filter(c => !!markedClips[`${c.start_time}_${c.end_time}`]);
  }, [result?.clips, markedClips]);

  const isCurrentVideoYouTube = useCallback(() => {
    if (sourceMode === 'upload' || sourceMode === 'gdrive' || sourceMode === 'twitch') return false;
    if (result?.source_type === 'upload' || result?.source_type === 'gdrive' || result?.source_type === 'twitch') return false;
    if (result?.video_id?.startsWith('upload_') || result?.video_id?.startsWith('gdrive_') || result?.video_id?.startsWith('twitch_')) return false;
    if (result?.video_url?.includes('/api/video/') || result?.video_url?.includes('twitch.tv')) return false;
    return true;
  }, [sourceMode, result?.source_type, result?.video_id, result?.video_url]);

  const handleStartBatchRender = async (settings: RenderSettings, forceProceed = false) => {
    if (!result) return;

    if (!forceProceed && isCurrentVideoYouTube() && !hasStoredCookies()) {
      const skipped = sessionStorage.getItem('cheatclip_skip_cookie_warning') === 'true';
      if (!skipped) {
        setCookieWarningState({
          isOpen: true,
          actionType: 'render',
          onProceed: () => {
            setCookieWarningState(prev => ({ ...prev, isOpen: false }));
            handleStartBatchRender(settings, true);
          }
        });
        return;
      }
    }

    setIsLaunchingRender(true);

    const isClientMode = !isMobileDevice() && (settings.hardwareAccel === 'browser_wasm' || settings.renderEngine === 'client' || (sourceMode === 'upload' && Boolean(uploadedVideoFile)));

    if (isClientMode) {
      try {
        const batchId = `client_${Date.now()}`;
        const selectedClips = settings.selectedClips;

        setBatchProgress({
          batch_id: batchId,
          total_clips: selectedClips.length,
          current_clip_index: 0,
          overall_status: 'running',
          clips: selectedClips.map((c, i) => {
            const base = (c.title_suggestion || c.title || `Clip #${i + 1}`).trim();
            const pfx = settings.titlePrefix || '';
            const sfx = settings.titleSuffix || '';
            const fullTitle = (pfx || sfx) ? `${pfx}${base}${sfx}`.trim() : base;
            return {
              clip_index: i,
              title: fullTitle,
              base_title: base,
              status: i === 0 ? 'rendering' : 'pending',
              progress_percent: 0,
            };
          })
        });

        setIsLaunchingRender(false);

        for (let i = 0; i < selectedClips.length; i++) {
          const clip = selectedClips[i];
          const base = (clip.title_suggestion || clip.title || `Clip #${i + 1}`).trim();
          const pfx = (settings.fileNamePrefix || '').replace(/[\\/*?:"<>|]/g, '');
          const sfx = (settings.fileNameSuffix || '').replace(/[\\/*?:"<>|]/g, '');
          const cleanBase = base.replace(/[\\/*?:"<>|]/g, '').trim();
          const filename = `${pfx}${cleanBase}${sfx}`.trim() || `clip_${i + 1}`;

          setBatchProgress(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              current_clip_index: i,
              clips: prev.clips.map((c, idx) => idx === i ? { ...c, status: 'downloading', progress_percent: 5 } : c)
            };
          });

          // Step 1: Acquire raw video stream (0% server load, stream proxy / local blob)
          let rawSourceUrl = '';
          if (sourceMode === 'upload' && uploadedVideoFile) {
            rawSourceUrl = URL.createObjectURL(uploadedVideoFile);
          } else if (result.source_type === 'upload' || result.video_id?.startsWith('upload_') || result.video_id?.startsWith('gdrive_')) {
            rawSourceUrl = `/api/video/${result.video_id}`;
          } else {
            const userCookies = getStoredCookies();
            const targetUrl = result.video_url || (url.trim() ? url.trim() : `https://www.youtube.com/watch?v=${result.video_id}`);
            const rawReq = await fetch('/api/download-raw-clip', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                video_url: targetUrl,
                video_id: result.video_id,
                start_time: clip.start_time,
                end_time: clip.end_time,
                title: clip.title,
                cookies: userCookies || undefined,
              })
            });
            if (!rawReq.ok) {
              const err = await rawReq.json().catch(() => ({}));
              throw new Error(err.detail || 'Failed to request raw clip stream');
            }
            const rawData = await rawReq.json();
            const jobId = rawData.job_id;

            rawSourceUrl = await new Promise<string>((resolve, reject) => {
              const pollInterval = setInterval(async () => {
                try {
                  const statusRes = await fetch(`/api/download-raw-clip-status/${jobId}`);
                  if (!statusRes.ok) {
                    clearInterval(pollInterval);
                    reject(new Error('Failed to retrieve raw stream status'));
                    return;
                  }
                  const statusData = await statusRes.json();
                  if (statusData.status === 'ready' && statusData.download_url) {
                    clearInterval(pollInterval);
                    resolve(statusData.download_url);
                  } else if (statusData.status === 'failed') {
                    clearInterval(pollInterval);
                    reject(new Error(statusData.error || 'Failed to acquire raw clip segment'));
                  }
                } catch (e) {
                  clearInterval(pollInterval);
                  reject(e);
                }
              }, 600);
            });
          }

          // Step 2: Render in client browser via GPU Hardware Encoder (WebCodecs) or WASM
          let blob: Blob;
          const useWebCodecsGpu = (settings.hardwareAccel === 'client_gpu' || (!settings.hardwareAccel && isWebCodecsGpuSupported())) && isWebCodecsGpuSupported();

          if (useWebCodecsGpu) {
            try {
              blob = await renderClipWebCodecs({
                videoSourceUrl: rawSourceUrl,
                startTime: (sourceMode === 'upload' && uploadedVideoFile) ? clip.start_time : undefined,
                endTime: (sourceMode === 'upload' && uploadedVideoFile) ? clip.end_time : undefined,
                aspectRatio: settings.aspectRatio as any,
                backgroundStyle: settings.backgroundStyle as any,
                titleText: settings.titleText,
                fileName: `${filename}.mp4`,
                onProgress: (pct, stage) => {
                  setBatchProgress(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      clips: prev.clips.map((c, idx) => idx === i ? {
                        ...c,
                        status: 'rendering',
                        progress_percent: pct,
                        error_message: stage
                      } : c)
                    };
                  });
                }
              });
            } catch (gpuErr) {
              console.warn('[Client GPU] WebCodecs hardware render failed, fallback to WASM engine:', gpuErr);
              // Graceful fallback to WASM engine
              blob = await renderClipClientSide({
                videoSourceUrl: rawSourceUrl,
                startTime: (sourceMode === 'upload' && uploadedVideoFile) ? clip.start_time : undefined,
                endTime: (sourceMode === 'upload' && uploadedVideoFile) ? clip.end_time : undefined,
                aspectRatio: settings.aspectRatio as any,
                backgroundStyle: settings.backgroundStyle as any,
                titleText: settings.titleText,
                fileName: `${filename}.mp4`,
                onProgress: (pct, stage) => {
                  setBatchProgress(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      clips: prev.clips.map((c, idx) => idx === i ? {
                        ...c,
                        status: 'rendering',
                        progress_percent: pct,
                        error_message: stage
                      } : c)
                    };
                  });
                }
              });
            }
          } else {
            blob = await renderClipClientSide({
              videoSourceUrl: rawSourceUrl,
              startTime: (sourceMode === 'upload' && uploadedVideoFile) ? clip.start_time : undefined,
              endTime: (sourceMode === 'upload' && uploadedVideoFile) ? clip.end_time : undefined,
              aspectRatio: settings.aspectRatio as any,
              backgroundStyle: settings.backgroundStyle as any,
              titleText: settings.titleText,
              fileName: `${filename}.mp4`,
              onProgress: (pct, stage) => {
                setBatchProgress(prev => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    clips: prev.clips.map((c, idx) => idx === i ? {
                      ...c,
                      status: 'rendering',
                      progress_percent: pct,
                      error_message: stage
                    } : c)
                  };
                });
              }
            });
          }

          // Step 3: Trigger automatic download and update status
          const downloadBlobUrl = URL.createObjectURL(blob);
          triggerBrowserDownload(blob, `${filename}.mp4`);

          setBatchProgress(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              clips: prev.clips.map((c, idx) => idx === i ? {
                ...c,
                status: 'completed',
                progress_percent: 100,
                download_url: downloadBlobUrl
              } : c)
            };
          });
        }

        setBatchProgress(prev => prev ? { ...prev, overall_status: 'completed' } : null);
        return;
      } catch (clientErr: any) {
        console.error('Client rendering failed:', clientErr);
        setBatchProgress(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            overall_status: 'error',
            error_message: clientErr.message || 'Client-side rendering error'
          };
        });
        return;
      } finally {
        setIsLaunchingRender(false);
      }
    }

    try {
      const userCookies = getStoredCookies();
      const resp = await fetch('/api/render-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: (result.video_url && !result.video_url.startsWith('blob:'))
            ? result.video_url
            : (result.video_id?.startsWith('upload_') || result.video_id?.startsWith('gdrive_'))
              ? `/api/video/${result.video_id}`
              : url || `https://www.youtube.com/watch?v=${result.video_id}`,
          video_id: result.video_id,
          clips: settings.selectedClips,
          cookies: userCookies || undefined,
          settings: {
            aspect_ratio: settings.aspectRatio,
            background_style: settings.backgroundStyle,
            enable_face_tracking: settings.enableFaceTracking,
            streamer_preset: settings.streamerPreset,
            facecam_position: settings.facecamPosition || 'auto',
            title_text: settings.titleText,
            title_prefix: settings.titlePrefix || '',
            title_suffix: settings.titleSuffix || '',
            file_name_prefix: settings.fileNamePrefix || '',
            file_name_suffix: settings.fileNameSuffix || '',
            title_position: settings.titlePosition,
            title_duration: settings.titleDuration || 'entire',
            subtitles_enabled: settings.captionStyle !== 'none',
            caption_style: settings.captionStyle,
            caption_font: settings.captionFont,
            title_font: settings.titleFont || settings.captionFont || 'Outfit',
            font_size: settings.fontSize,
            title_font_size: settings.titleFontSize || settings.fontSize || 'medium',
            font_size_px: settings.fontSizePx,
            title_font_size_px: settings.titleFontSizePx,
            text_case: settings.textCase,
            title_text_case: settings.titleTextCase || settings.textCase,
            title_y_percent: settings.titleYPercent,
            subtitle_y_percent: settings.subtitleYPercent,
            subtitle_position_mode: settings.subtitlePositionMode || 'bottom',
            subtitle_center_y_percent: settings.subtitleCenterYPercent !== undefined ? settings.subtitleCenterYPercent : 50.0,
            // Background Music
            bgm_enabled: settings.bgmEnabled || false,
            bgm_file_path: settings.bgmFilePath || null,
            bgm_volume: settings.bgmVolume !== undefined ? settings.bgmVolume : 25.0,
            bgm_start_offset: settings.bgmStartOffset || 0.0,
            // Hook SFX
            hook_sfx_enabled: settings.hookSfxEnabled || false,
            hook_sfx_file_path: settings.hookSfxFilePath || null,
            hook_sfx_volume: settings.hookSfxVolume !== undefined ? settings.hookSfxVolume : 100.0,
            // Raw Voice Audio Boost
            original_audio_volume: settings.originalAudioVolume !== undefined ? settings.originalAudioVolume : 100.0,
            // Watermark
            watermark_enabled: settings.watermarkEnabled || false,
            watermark_type: settings.watermarkType || 'image',
            watermark_file_path: settings.watermarkFilePath || null,
            watermark_text: settings.watermarkText || null,
            watermark_size: settings.watermarkSize !== undefined ? settings.watermarkSize : 20.0,
            watermark_opacity: settings.watermarkOpacity !== undefined ? settings.watermarkOpacity : 80.0,
            watermark_x: settings.watermarkX !== undefined ? settings.watermarkX : 90.0,
            watermark_y: settings.watermarkY !== undefined ? settings.watermarkY : 8.0,
            // Hardware Acceleration / Encoder
            hardware_accel: settings.hardwareAccel || 'auto',
            // Multi-Segment Merged Highlight Video
            render_mode: settings.renderMode || 'separate',
            compilation_title: settings.compilationTitle || null,
          },
          transcript: result.transcript,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to start batch render job');
      }

      const data = await resp.json();
      const batchId = data.batch_id;

      // Initialize inline batch progress on the side under live preview (no modal)
      const isMerged = settings.renderMode === 'merged';
      setBatchProgress({
        batch_id: batchId,
        total_clips: isMerged ? 1 : settings.selectedClips.length,
        current_clip_index: 0,
        overall_status: 'running',
        clips: isMerged ? [{
          clip_index: 0,
          title: settings.compilationTitle || (settings.selectedClips[0]?.title_suggestion || settings.selectedClips[0]?.title || 'Highlight Compilation') + ` (${settings.selectedClips.length} Segments)`,
          status: 'pending',
          progress_percent: 0,
        }] : settings.selectedClips.map((c, i) => {
          const base = (c.title_suggestion || c.title || `Clip #${i + 1}`).trim();
          const pfx = settings.titlePrefix || '';
          const sfx = settings.titleSuffix || '';
          const fullTitle = (pfx || sfx) ? `${pfx}${base}${sfx}`.trim() : base;
          return {
            clip_index: i,
            title: fullTitle,
            status: 'pending',
            progress_percent: 0,
          };
        })
      });

      // Listen to SSE progress
      listenToBatchProgress(batchId);
    } catch (err: any) {
      alert(err.message || 'Error launching batch render');
    } finally {
      setIsLaunchingRender(false);
    }
  };

  const handleRetryBatchClip = async (clipIndex?: number) => {
    if (!batchProgress?.batch_id) return;
    const batchId = batchProgress.batch_id;
    try {
      // Optimistically update the UI to show 'pending' / retrying state for selected clip(s)
      setBatchProgress(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          overall_status: 'running',
          clips: prev.clips.map(c => {
            if (clipIndex === undefined || c.clip_index === clipIndex) {
              if (c.status === 'error' || c.status === 'pending') {
                return { ...c, status: 'pending', progress_percent: 0, error: undefined };
              }
            }
            return c;
          })
        };
      });

      const userCookies = getStoredCookies();
      const resp = await fetch(`/api/render-batch/${batchId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clip_indices: clipIndex !== undefined ? [clipIndex] : undefined,
          cookies: userCookies || undefined,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to retry rendering');
      }

      // Reconnect SSE to track retry progress
      listenToBatchProgress(batchId);
    } catch (err: any) {
      alert(err.message || 'Error retrying clip rendering');
    }
  };

  // History feature: previously analyzed videos from localStorage
  interface HistoryEntry {
    video_id: string;
    title: string;
    duration_pref: string;
    clip_count: number;
    analyzed_at: string;
    thumbnail: string;
    url: string;
    source_type?: 'youtube' | 'upload' | 'gdrive' | 'twitch';
    video_url?: string;
    range_suffix?: string;
    summary?: string;
    clip_titles?: string[];
    key_quotes?: string[];
  }
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Audio/video playback state tracking
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef<any>(null);
  const directVideoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const twitchPlayerRef = useRef<any>(null);
  const trackingInterval = useRef<number | null>(null);
  const clipEndIntervalRef = useRef<number | null>(null);
  const loadingSectionRef = useRef<HTMLElement | null>(null);
  const [toastMessage, setToastMessageState] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const setToastMessage = useCallback((msg: string | null, durationMs = 4000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    setToastMessageState(msg);
    if (msg && durationMs > 0) {
      toastTimeoutRef.current = window.setTimeout(() => {
        setToastMessageState(null);
        toastTimeoutRef.current = null;
      }, durationMs);
    }
  }, []);
  const [isClearingGlobalTemp, setIsClearingGlobalTemp] = useState<boolean>(false);
  const [showGlobalClearModal, setShowGlobalClearModal] = useState<boolean>(false);

  const executeGlobalClearTemp = async () => {
    if (isClearingGlobalTemp) return;
    setIsClearingGlobalTemp(true);
    try {
      const resp = await fetch('/api/clear-temp', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        setToastMessage(data.message || t.header.clearedTempSuccess);
        setTimeout(() => setToastMessage(null), 3500);
      } else {
        setToastMessage(t.header.clearedTempFailed);
        setTimeout(() => setToastMessage(null), 3000);
      }
    } catch (e) {
      console.error('Failed to clear temp folder:', e);
      setToastMessage(t.header.clearedTempError);
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsClearingGlobalTemp(false);
      setShowGlobalClearModal(false);
    }
  };
  const [copyTimestampMenuTarget, setCopyTimestampMenuTarget] = useState<'toolbar' | 'overview' | null>(null);
  const [copyTimestampScope, setCopyTimestampScope] = useState<'all' | 'marked'>('all');

  // Close timestamp format menu on click outside or escape
  useEffect(() => {
    if (!copyTimestampMenuTarget) return;
    const handleClickOutside = () => setCopyTimestampMenuTarget(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCopyTimestampMenuTarget(null);
    };
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [copyTimestampMenuTarget]);

  // Automatically scroll down to the loading progress section when analysis starts
  useEffect(() => {
    if (loading) {
      const scrollTimer = setTimeout(() => {
        if (loadingSectionRef.current) {
          loadingSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          const el = document.getElementById('loading-progress-section');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
      return () => clearTimeout(scrollTimer);
    }
  }, [loading]);

  // Initialize YouTube IFrame API
  useEffect(() => {
    // Check if script is already injected
    const existingScript = document.getElementById('youtube-iframe-api-script');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    // Set global callback
    window.onYouTubeIframeAPIReady = () => {
      // Re-trigger player init if a result is already loaded
      if (result) {
        initPlayer(result.video_id);
      }
    };

    return () => {
      stopTracking();
      if (clipEndIntervalRef.current !== null) {
        clearInterval(clipEndIntervalRef.current);
      }
    };
  }, [result]);

  // Fetch available AI models when API key is detected/entered
  useEffect(() => {
    const fetchModels = async () => {
      const cleanKey = apiKey.trim();
      if (!cleanKey || cleanKey.length < 20 || cleanKey.toLowerCase() === 'mock') {
        setAvailableModels([]);
        return;
      }
      setLoadingModels(true);
      try {
        const res = await resilientFetch('/api/models', {
          headers: {
            'X-Gemini-API-Key': cleanKey,
          },
          maxRetries: 3,
          retryDelay: 800,
          silent: true
        });
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            setAvailableModels(data.models);
            if (!data.models.includes(selectedModel) || selectedModel.includes('1.5') || selectedModel.includes('1.0')) {
              const fallback = data.models.find((m: string) => m.includes('flash')) || data.models[0] || 'gemini-2.5-flash';
              setSelectedModel(fallback);
              localStorage.setItem('cheat_clip_selected_model', fallback);
            }
          }
        }
      } catch (err) {
        console.error('Failed to retrieve available models:', err);
      } finally {
        setLoadingModels(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      fetchModels();
    }, 600);

    return () => clearTimeout(delayDebounce);
  }, [apiKey]);

  // OpenRouter models retrieval
  useEffect(() => {
    let isCancelled = false;
    const fetchOpenRouterModels = async () => {
      setLoadingOpenRouterModels(true);
      try {
        const cleanKey = openRouterKey.trim();
        const res = await resilientFetch('/api/openrouter-models', {
          headers: cleanKey ? {
            'X-OpenRouter-API-Key': cleanKey,
            'Authorization': `Bearer ${cleanKey}`
          } : undefined,
          maxRetries: 2,
          retryDelay: 800,
          silent: true
        });
        if (res.ok && !isCancelled) {
          const data = await res.json();
          if (data.models && Array.isArray(data.models) && data.models.length > 0) {
            setOpenRouterModels(data.models);
          }
        }
      } catch (err) {
        console.error('Failed to retrieve OpenRouter models:', err);
      } finally {
        if (!isCancelled) setLoadingOpenRouterModels(false);
      }
    };

    fetchOpenRouterModels();
    return () => {
      isCancelled = true;
    };
  }, [openRouterKey]);

  // Sync marked clips with local storage based on active video ID
  useEffect(() => {
    if (result?.video_id) {
      const saved = localStorage.getItem(`marked_clips_${result.video_id}`);
      if (saved) {
        try {
          setMarkedClips(JSON.parse(saved));
        } catch (_) {
          setMarkedClips({});
        }
      } else {
        setMarkedClips({});
      }
    } else {
      setMarkedClips({});
    }
  }, [result]);

  // Clear expanded clip index when filters or sorting change
  useEffect(() => {
    setExpandedClipIndex(null);
  }, [sortBy, viralityFilter, searchQuery]);

  const toggleMarkedClip = (clipId: string) => {
    if (!result?.video_id) return;
    const updated = {
      ...markedClips,
      [clipId]: !markedClips[clipId]
    };
    setMarkedClips(updated);
    localStorage.setItem(`marked_clips_${result.video_id}`, JSON.stringify(updated));
  };

  const toggleAllMarkedClips = (forceSelect?: boolean) => {
    if (!result?.video_id || !result.clips || result.clips.length === 0) return;
    const allCurrentlyMarked = result.clips.every(c => !!markedClips[`${c.start_time}_${c.end_time}`]);
    const shouldSelect = forceSelect !== undefined ? forceSelect : !allCurrentlyMarked;

    const updated: Record<string, boolean> = { ...markedClips };
    if (shouldSelect) {
      result.clips.forEach(clip => {
        updated[`${clip.start_time}_${clip.end_time}`] = true;
      });
    } else {
      result.clips.forEach(clip => {
        delete updated[`${clip.start_time}_${clip.end_time}`];
      });
    }
    setMarkedClips(updated);
    localStorage.setItem(`marked_clips_${result.video_id}`, JSON.stringify(updated));
  };

  // Scan localStorage and build the history list from cache keys
  const refreshHistory = () => {
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cheat_clip_cache_')) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const data: AnalyzeResponse = JSON.parse(raw);

          if (!data || !data.video_id) continue;

          const video_id = data.video_id;
          const rest = key.substring('cheat_clip_cache_'.length);
          const suffix = rest.substring(video_id.length + 1); // skip video_id and trailing '_'
          const duration_pref = suffix.split('_')[0];
          const range_suffix = suffix.substring(duration_pref.length);

          // Try reading cached timestamp stored separately
          const tsKey = `cheat_clip_ts_${video_id}_${duration_pref}${range_suffix}`;
          const analyzed_at = localStorage.getItem(tsKey) || new Date().toISOString();
          const clip_titles = (data.clips || []).map((c: any) => c.title || '').filter(Boolean);
          const key_quotes = (data.clips || []).flatMap((c: any) => c.key_quotes || []).filter(Boolean);

          const isGDrive = data.source_type === 'gdrive' || video_id.startsWith('gdrive_');
          const isUpload = data.source_type === 'upload' || video_id.startsWith('upload_');
          const isTwitch = data.source_type === 'twitch' || video_id.startsWith('twitch_');
          const sourceType: 'youtube' | 'upload' | 'gdrive' | 'twitch' = isTwitch ? 'twitch' : (isGDrive ? 'gdrive' : (isUpload ? 'upload' : 'youtube'));

          // Determine appropriate link and thumbnail
          let itemUrl = `https://www.youtube.com/watch?v=${video_id}`;
          if (isTwitch) {
            itemUrl = data.video_url || (video_id.startsWith('twitch_clip_') ? `https://clips.twitch.tv/${video_id.replace('twitch_clip_', '')}` : `https://www.twitch.tv/videos/${video_id.replace('twitch_', '')}`);
          } else if (isGDrive) {
            const gdriveIdMatch = video_id.match(/gdrive_([a-zA-Z0-9_-]+)/);
            const gdriveId = gdriveIdMatch ? gdriveIdMatch[1] : '';
            itemUrl = gdriveId ? `https://drive.google.com/file/d/${gdriveId}/view` : (data.video_url || '');
          } else if (isUpload) {
            itemUrl = data.video_url || `/api/video/${video_id}`;
          }

          const thumb = (isGDrive || isUpload || isTwitch)
            ? `/api/frame/${encodeURIComponent(video_id)}?t=2`
            : `https://img.youtube.com/vi/${video_id}/mqdefault.jpg`;

          entries.push({
            video_id,
            title: data.title,
            duration_pref,
            clip_count: data.clips?.length || 0,
            analyzed_at,
            thumbnail: thumb,
            url: itemUrl,
            source_type: sourceType,
            video_url: data.video_url,
            range_suffix,
            summary: data.summary || '',
            clip_titles,
            key_quotes
          });
        } catch (_) {
          // Skip malformed entries
        }
      }
    }
    // Sort by most recent first
    entries.sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime());
    setHistory(entries);
  };

  // Load history on mount
  useEffect(() => {
    refreshHistory();
  }, []);

  const loadFromHistory = (entry: HistoryEntry) => {
    const rangeSuffix = entry.range_suffix || '';
    const cacheKey = `cheat_clip_cache_${entry.video_id}_${entry.duration_pref}${rangeSuffix}`;
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return;
    try {
      const data: AnalyzeResponse = JSON.parse(raw);

      const isGDrive = data.source_type === 'gdrive' || entry.source_type === 'gdrive' || entry.video_id.startsWith('gdrive_');
      const isUpload = data.source_type === 'upload' || entry.source_type === 'upload' || entry.video_id.startsWith('upload_');
      const isTwitch = data.source_type === 'twitch' || entry.source_type === 'twitch' || entry.video_id.startsWith('twitch_');

      if (isTwitch) {
        setSourceMode('twitch');
        setUrl(entry.url);
        setTwitchUrl(entry.url);
        setGdriveUrl('');
        setUploadedVideoInfo(null);
        setUploadedVideoFile(null);
      } else if (isGDrive) {
        setSourceMode('gdrive');
        setUrl('');
        const gdriveIdMatch = entry.video_id.match(/gdrive_([a-zA-Z0-9_-]+)/);
        const gdriveId = gdriveIdMatch ? gdriveIdMatch[1] : '';
        const targetGDriveUrl = (entry.url && entry.url.includes('drive.google.com'))
          ? entry.url
          : (gdriveId ? `https://drive.google.com/file/d/${gdriveId}/view` : entry.video_id);
        setGdriveUrl(targetGDriveUrl);
        setUploadedVideoInfo(null);
        setUploadedVideoFile(null);
      } else if (isUpload) {
        setSourceMode('upload');
        setUrl('');
        setGdriveUrl('');
        setUploadedVideoInfo({
          videoId: data.video_id,
          filename: data.title || data.video_id,
          savedName: data.video_url?.replace('/api/video/', '') || data.video_id,
          duration: data.duration,
          videoUrl: data.video_url || `/api/video/${data.video_id}`,
          filePath: '',
          width: 1080,
          height: 1920
        });
        setUploadedVideoFile(null);
      } else {
        setSourceMode('youtube');
        setUrl(entry.url || `https://www.youtube.com/watch?v=${entry.video_id}`);
        setGdriveUrl('');
        setUploadedVideoInfo(null);
        setUploadedVideoFile(null);
      }

      setDurationPref((entry.duration_pref as '15s' | '30s' | '60s' | 'auto') || '30s');

      // Restore clip count mode
      if (entry.range_suffix?.includes('_clips_auto')) {
        setClipCountMode('auto');
      } else {
        const clipMatch = entry.range_suffix?.match(/_clips_(\d+)/);
        if (clipMatch) {
          setClipCountMode('custom');
          setTargetClipCount(Number(clipMatch[1]));
        }
      }

      // Restore subtitle source state
      if (entry.range_suffix?.includes('_manual')) {
        setSubtitlesSource('manual');
      } else {
        setSubtitlesSource('youtube');
      }

      // Restore transcript language if available in range_suffix
      if (entry.range_suffix?.includes('_lang_en')) {
        setTranscriptLanguage('en');
      } else if (entry.range_suffix?.includes('_lang_id')) {
        setTranscriptLanguage('id');
      }

      // Restore range inputs if they were custom
      if (entry.range_suffix) {
        const cleanRangeSuffix = entry.range_suffix.replace('_manual', '');
        const rangeMatch = cleanRangeSuffix.match(/_range_([^_]+)_([^_]+)/);
        if (rangeMatch) {
          setRangeType('custom');
          const startVal = rangeMatch[1];
          const endVal = rangeMatch[2];

          setCustomRangeStart(startVal !== '0' ? formatSeconds(Number(startVal)) : '');
          setCustomRangeEnd(endVal !== 'end' ? formatSeconds(Number(endVal)) : '');
        } else {
          setRangeType('entire');
          setCustomRangeStart('');
          setCustomRangeEnd('');
        }
      } else {
        setRangeType('entire');
        setCustomRangeStart('');
        setCustomRangeEnd('');
      }

      // Destroy any existing player immediately before state resets
      destroyPlayer();
      setLoading(true);
      setError(null);
      setResult(null);
      setActiveClip(null);
      setCurrentStep(1);
      setStepProgress({ 1: 100, 2: 0, 3: 0, 4: 0 });
      setOverallProgress(25);
      setLoadingDetails(t.loading.loadingFromHistory);
      setTimeout(() => {
        setCurrentStep(4);
        setStepProgress({ 1: 100, 2: 100, 3: 100, 4: 85 });
        setOverallProgress(90);
        setAiStage(t.loading.restoringHotspots);
        setAiDetail(t.loading.reconstructingTimestamps);
        setLoadingDetails(t.loading.reconstructingTimestamps);
        setTimeout(() => {
          setStepProgress({ 1: 100, 2: 100, 3: 100, 4: 100 });
          setOverallProgress(100);
          setResult(data);
          setWorkflowTab('clips');
          setLoading(false);
          setShowHistory(false);
          if (data.clips?.length > 0) setActiveClip(data.clips[0]);
          // Force recreate the player since we destroyed it
          setTimeout(() => initPlayer(data.video_id, true), 150);
        }, 500);
      }, 600);
    } catch (_) {
      setToastMessage(t.form.historyLoadFailed);
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  const deleteHistoryEntry = (entry: HistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const rangeSuffix = entry.range_suffix || '';
    const cacheKey = `cheat_clip_cache_${entry.video_id}_${entry.duration_pref}${rangeSuffix}`;
    const tsKey = `cheat_clip_ts_${entry.video_id}_${entry.duration_pref}${rangeSuffix}`;
    localStorage.removeItem(cacheKey);
    localStorage.removeItem(tsKey);
    refreshHistory();
    setToastMessage(t.form.removedFromHistory(entry.title));
    setTimeout(() => setToastMessage(null), 3000);
  };

  const clearAllHistory = () => {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cheat_clip_cache_') || key.startsWith('cheat_clip_ts_'))) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    setHistory([]);
    setToastMessage(t.form.allHistoryCleared);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDeselectActiveVideo = () => {
    destroyPlayer();
    setResult(null);
    setActiveClip(null);
    setUrl('');
    setGdriveUrl('');
    setUploadedVideoFile(null);
    setUploadedVideoInfo(null);
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
    setMarkedClips({});
    setError(null);
    if (workflowTab === 'clipper') {
      setWorkflowTab('source');
    }
    setToastMessage('Active video ditutup (deselected)');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const formatRelativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t.relativeTime.justNow;
    if (mins < 60) return t.relativeTime.minsAgo(mins);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t.relativeTime.hrsAgo(hrs);
    const days = Math.floor(hrs / 24);
    return t.relativeTime.daysAgo(days);
  };


  const destroyPlayer = () => {
    stopTracking();
    if (twitchPlayerRef.current) {
      twitchPlayerRef.current = null;
      const twContainer = document.getElementById('twitch-player-container');
      if (twContainer) {
        twContainer.innerHTML = '<div id="twitch-player"></div>';
      }
    }
    if (playerRef.current) {
      try {
        if (typeof playerRef.current.destroy === 'function') {
          playerRef.current.destroy();
        }
      } catch (e) {
        console.warn('Error destroying player:', e);
      }
      playerRef.current = null;
    }
    const container = document.getElementById('youtube-player-container');
    if (container) {
      container.innerHTML = '<div id="youtube-player"></div>';
    }
  };

  const initTwitchPlayer = (videoId: string, forceRecreate = false) => {
    const isClip = videoId.startsWith('twitch_clip_');
    const rawId = isClip ? videoId.replace('twitch_clip_', '') : videoId.replace('twitch_', '');
    const container = document.getElementById('twitch-player-container');
    if (!container) {
      setTimeout(() => initTwitchPlayer(videoId, forceRecreate), 100);
      return;
    }

    if (twitchPlayerRef.current) {
      twitchPlayerRef.current = null;
      try {
        container.innerHTML = '<div id="twitch-player"></div>';
      } catch (_) {}
    }

    if ((window as any).Twitch && (window as any).Twitch.Player) {
      if (!document.getElementById('twitch-player')) {
        container.innerHTML = '<div id="twitch-player"></div>';
      }
      try {
        const opts: any = {
          width: '100%',
          height: '100%',
          autoplay: false,
          parent: [window.location.hostname || 'localhost', 'localhost', '127.0.0.1']
        };
        if (isClip) {
          opts.clip = rawId;
        } else {
          opts.video = rawId;
        }
        const player = new (window as any).Twitch.Player('twitch-player', opts);
        twitchPlayerRef.current = player;
        player.addEventListener((window as any).Twitch.Player.PLAY, () => {
          startTracking();
        });
        player.addEventListener((window as any).Twitch.Player.PAUSE, () => {
          stopTracking();
          if (player.getCurrentTime) {
            setCurrentTime(player.getCurrentTime());
          }
        });
        player.addEventListener((window as any).Twitch.Player.READY, () => {
          console.log('Twitch Player Ready');
        });
      } catch (err) {
        console.error('Error instantiating Twitch Player:', err);
      }
    } else {
      setTimeout(() => initTwitchPlayer(videoId, forceRecreate), 200);
    }
  };

  const initPlayer = (videoId: string, forceRecreate = false) => {
    if (!videoId || videoId.startsWith('upload_') || videoId.startsWith('gdrive_')) {
      return;
    }
    if (videoId.startsWith('twitch_')) {
      initTwitchPlayer(videoId, forceRecreate);
      return;
    }
    // If player already exists and we're not forcing recreate, try to load new video
    if (!forceRecreate && playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
      try {
        playerRef.current.loadVideoById(videoId);
        return;
      } catch (e) {
        console.error('Failed to load video on existing player, will recreate...', e);
      }
    }

    // Ensure target container is rendered in the DOM before instantiating the player.
    // If React hasn't completed mounting the dashboard yet, wait and retry.
    const container = document.getElementById('youtube-player-container');
    if (!container) {
      setTimeout(() => initPlayer(videoId, forceRecreate), 100);
      return;
    }

    // Destroy any stale player first
    if (playerRef.current) {
      destroyPlayer();
    }

    // Create player if YT API is loaded
    if (window.YT && window.YT.Player) {
      if (!document.getElementById('youtube-player')) {
        container.innerHTML = '<div id="youtube-player"></div>';
      }
      try {
        playerRef.current = new window.YT.Player('youtube-player', {
          videoId: videoId,
          playerVars: {
            autoplay: 0,
            modestbranding: 1,
            rel: 0,
            controls: 1,
            fs: 1,
          },
          events: {
            onReady: () => {
              console.log('YouTube Player Ready');
            },
            onStateChange: (event: any) => {
              // YT.PlayerState.PLAYING = 1
              if (event.data === 1) {
                startTracking();
              } else {
                stopTracking();
                // Update currentTime on pause/stop to sync cursor
                if (playerRef.current && playerRef.current.getCurrentTime) {
                  setCurrentTime(playerRef.current.getCurrentTime());
                }
              }
            },
          },
        });
      } catch (err) {
        console.error('Error instantiating YouTube Player:', err);
        // Fallback retry in case of transient iframe injection issues
        setTimeout(() => initPlayer(videoId, forceRecreate), 300);
      }
    } else {
      // Try again in 200ms if global window.YT is not ready yet
      setTimeout(() => initPlayer(videoId, forceRecreate), 200);
    }
  };

  const startTracking = () => {
    stopTracking();
    trackingInterval.current = window.setInterval(() => {
      if (twitchPlayerRef.current && typeof twitchPlayerRef.current.getCurrentTime === 'function') {
        setCurrentTime(twitchPlayerRef.current.getCurrentTime());
      } else if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        setCurrentTime(playerRef.current.getCurrentTime());
      }
    }, 200);
  };

  const stopTracking = () => {
    if (trackingInterval.current !== null) {
      clearInterval(trackingInterval.current);
      trackingInterval.current = null;
    }
  };

  const handleSeek = (seconds: number) => {
    if (directVideoPlayerRef.current) {
      const vid = directVideoPlayerRef.current;
      setCurrentTime(seconds);
      if (vid.readyState >= 1) {
        vid.currentTime = seconds;
        vid.play().catch(() => { });
      } else {
        const onLoaded = () => {
          vid.currentTime = seconds;
          vid.play().catch(() => { });
          vid.removeEventListener('loadedmetadata', onLoaded);
        };
        vid.addEventListener('loadedmetadata', onLoaded);
        vid.load();
      }
      return;
    }
    if (twitchPlayerRef.current && typeof twitchPlayerRef.current.seek === 'function') {
      twitchPlayerRef.current.seek(seconds);
      setCurrentTime(seconds);
      try {
        twitchPlayerRef.current.play();
      } catch (_) {}
      return;
    }
    if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
      playerRef.current.seekTo(seconds, true);
      setCurrentTime(seconds);
      // If paused, play it
      if (playerRef.current.getPlayerState() !== 1) {
        playerRef.current.playVideo();
      }
    }
  };

  const playClip = (clip: ViralClip) => {
    setActiveClip(clip);
    handleSeek(clip.start_time);

    if (clipEndIntervalRef.current !== null) {
      clearInterval(clipEndIntervalRef.current);
    }

    // Automatically stop video at end time (optional user experience feature)
    // We can monitor playback and pause if it goes past end_time
    const intervalId = window.setInterval(() => {
      let curr = 0;
      if (directVideoPlayerRef.current) {
        curr = directVideoPlayerRef.current.currentTime;
        if (curr >= clip.end_time) {
          directVideoPlayerRef.current.pause();
          clearInterval(intervalId);
          if (clipEndIntervalRef.current === intervalId) {
            clipEndIntervalRef.current = null;
          }
        }
      } else if (twitchPlayerRef.current && typeof twitchPlayerRef.current.getCurrentTime === 'function') {
        curr = twitchPlayerRef.current.getCurrentTime();
        if (curr >= clip.end_time) {
          twitchPlayerRef.current.pause();
          clearInterval(intervalId);
          if (clipEndIntervalRef.current === intervalId) {
            clipEndIntervalRef.current = null;
          }
        }
      } else if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        curr = playerRef.current.getCurrentTime();
        if (curr >= clip.end_time) {
          playerRef.current.pauseVideo();
          clearInterval(intervalId);
          if (clipEndIntervalRef.current === intervalId) {
            clipEndIntervalRef.current = null;
          }
        }
      } else {
        clearInterval(intervalId);
        if (clipEndIntervalRef.current === intervalId) {
          clipEndIntervalRef.current = null;
        }
      }
    }, 300);

    clipEndIntervalRef.current = intervalId;
  };

  const isGoogleDriveUrl = (urlStr: string): boolean => {
    if (!urlStr) return false;
    return /(?:drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com)/i.test(urlStr.trim());
  };

  const extractGoogleDriveId = (urlStr: string): string | null => {
    if (!urlStr) return null;
    const trimmed = urlStr.trim();
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
      /[?&]id=([a-zA-Z0-9_-]{20,})/,
      /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]{20,})/,
      /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]{20,})/,
    ];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) return match[1];
    }
    if (/^[a-zA-Z0-9_-]{25,45}$/.test(trimmed)) {
      return trimmed;
    }
    return null;
  };

  const isTwitchUrl = (urlStr: string): boolean => {
    if (!urlStr) return false;
    const trimmed = urlStr.trim();
    return (
      trimmed.includes('twitch.tv') ||
      trimmed.startsWith('twitch_') ||
      /(?:twitch\.tv\/videos\/|clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/)/.test(trimmed)
    );
  };

  const extractTwitchId = (urlStr: string): { type: 'vod' | 'clip'; id: string } | null => {
    if (!urlStr) return null;
    const trimmed = urlStr.trim();
    const mVod = trimmed.match(/(?:twitch\.tv\/videos\/|twitch\.tv\/[a-zA-Z0-9_]+\/v\/|twitch_vod_|twitch_)(\d+)/);
    if (mVod && mVod[1]) {
      return { type: 'vod', id: mVod[1] };
    }
    const mClip = trimmed.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/|twitch_clip_)([a-zA-Z0-9_-]+)/);
    if (mClip && mClip[1]) {
      return { type: 'clip', id: mClip[1] };
    }
    return null;
  };

  const extractVideoId = (urlStr: string): string | null => {
    if (!urlStr) return null;
    const trimmed = urlStr.trim();
    if (isGoogleDriveUrl(trimmed)) {
      const gId = extractGoogleDriveId(trimmed);
      return gId ? `gdrive_${gId}` : null;
    }
    if (isTwitchUrl(trimmed)) {
      const tw = extractTwitchId(trimmed);
      if (tw) {
        return tw.type === 'vod' ? `twitch_${tw.id}` : `twitch_clip_${tw.id}`;
      }
    }
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /(?:youtu\.be\/|(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:embed|v|shorts|live)\/)([a-zA-Z0-9_-]{11})/,
      /(?:v=|\/v\/|embed\/|shorts\/|live\/|youtu\.be\/|\/embed\/|\/watch\?v=|\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  };

  const handleFormSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (sourceMode === 'youtube' && subtitlesSource === 'youtube' && !skipLanguageConfirm) {
      setShowLanguageConfirmModal(true);
      return;
    }
    handleAnalyze(e);
  };

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (sourceMode === 'upload') {
      if (!uploadedVideoFile && !uploadedVideoInfo) {
        setError(t.errors.chooseVideoFilePrompt);
        return;
      }
    } else if (sourceMode === 'gdrive') {
      if (!gdriveUrl.trim()) return;
      if (!isGoogleDriveUrl(gdriveUrl)) {
        setError('Please enter a valid Google Drive video sharing link (e.g. https://drive.google.com/file/d/...)');
        return;
      }
    } else {
      if (!url.trim()) return;
    }

    // Require an API key before making any request
    if (apiProvider === 'gemini') {
      if (!apiKey.trim()) {
        setError(t.errors.apiKeyRequired);
        return;
      }
    } else {
      if (!openRouterKey.trim()) {
        setError('OpenRouter API Key is required. Please paste your key in AI Engine Settings.');
        return;
      }
    }

    let rangeStartSecs: number | undefined = undefined;
    let rangeEndSecs: number | undefined = undefined;

    if (rangeType === 'custom') {
      const parsedStart = parseTimeToSeconds(customRangeStart);
      const parsedEnd = parseTimeToSeconds(customRangeEnd);

      if (customRangeStart.trim() && parsedStart === null) {
        setError(t.errors.invalidStart);
        return;
      }
      if (customRangeEnd.trim() && parsedEnd === null) {
        setError(t.errors.invalidEnd);
        return;
      }

      if (parsedStart !== null) rangeStartSecs = parsedStart;
      if (parsedEnd !== null) rangeEndSecs = parsedEnd;

      if (rangeStartSecs !== undefined && rangeEndSecs !== undefined && rangeStartSecs >= rangeEndSecs) {
        setError(t.errors.startLessThanEnd);
        return;
      }
    }

    if (subtitlesSource === 'manual' && !manualSubtitlesContent.trim()) {
      setError(t.errors.chooseSubtitleFile);
      return;
    }

    const rangeSuffix = (rangeStartSecs !== undefined || rangeEndSecs !== undefined)
      ? `_range_${rangeStartSecs ?? 0}_${rangeEndSecs ?? 'end'}`
      : '';
    const manualSuffix = subtitlesSource === 'manual' ? '_manual' : '';

    // Determine target video identifier
    let targetAnalyzeUrl = sourceMode === 'gdrive' ? gdriveUrl.trim() : (sourceMode === 'twitch' ? (twitchUrl.trim() || url.trim()) : url.trim());
    let videoId = extractVideoId(targetAnalyzeUrl);
    let currentVideoInfo = uploadedVideoInfo;

    if (sourceMode === 'upload') {
      setLoading(true);
      setWorkflowTab('clips');
      setError(null);
      setResult(null);
      setActiveClip(null);
      setCurrentStep(1);
      setStepProgress({ 1: 20, 2: 0, 3: 0, 4: 0 });
      setOverallProgress(5);
      setActiveProcessingModel(selectedModel);

      if (!currentVideoInfo && uploadedVideoFile) {
        setIsUploadingVideo(true);
        setLoadingDetails(t.form.uploadingVideo);
        setAiStage('Extracting Audio for AI');
        setAiDetail(`Extracting lightweight audio track in browser from ${uploadedVideoFile.name}...`);

        try {
          const { audioFile, metadata } = await extractAudioFromVideoClient(uploadedVideoFile, (stage) => {
            setAiDetail(stage);
          });

          setAiStage('Uploading AI Audio');
          setAiDetail(`Uploading compressed audio track (${(audioFile.size / (1024 * 1024)).toFixed(1)} MB)...`);

          // Upload lightweight audio file (.wav) to /api/upload-video
          const upData = await new Promise<any>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload-video');
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable && event.total > 0) {
                const pct = Math.round((event.loaded / event.total) * 100);
                const loadedMb = (event.loaded / (1024 * 1024)).toFixed(1);
                const totalMb = (event.total / (1024 * 1024)).toFixed(1);
                setAiDetail(`Uploading audio track (${pct}% - ${loadedMb}/${totalMb} MB)...`);
                setStepProgress(prev => ({ ...prev, 1: Math.min(95, pct) }));
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  resolve(JSON.parse(xhr.responseText));
                } catch {
                  reject(new Error('Invalid JSON response from upload server'));
                }
              } else {
                try {
                  const errJson = JSON.parse(xhr.responseText);
                  reject(new Error(errJson.detail || 'Failed to upload audio file'));
                } catch {
                  reject(new Error(`Upload failed with status code ${xhr.status}`));
                }
              }
            };
            xhr.onerror = () => reject(new Error('Network error during audio upload'));
            xhr.onabort = () => reject(new Error('Audio upload cancelled'));

            const formData = new FormData();
            formData.append('file', audioFile);
            formData.append('client_duration', String(metadata.duration || 0));
            formData.append('client_width', String(metadata.width || 1920));
            formData.append('client_height', String(metadata.height || 1080));
            formData.append('original_filename', uploadedVideoFile.name);
            xhr.send(formData);
          });

          currentVideoInfo = {
            videoId: upData.video_id,
            filename: uploadedVideoFile.name,
            savedName: upData.saved_name,
            duration: upData.duration || metadata.duration,
            videoUrl: metadata.objectUrl, // Direct local Blob URL for in-browser video playback!
            filePath: upData.file_path,
            width: metadata.width || upData.width || 1920,
            height: metadata.height || upData.height || 1080,
          };
          setUploadedVideoInfo(currentVideoInfo);
          setIsUploadingVideo(false);
        } catch (uploadErr: any) {
          setIsUploadingVideo(false);
          setLoading(false);
          setError(uploadErr.message || 'Failed to extract or upload audio');
          return;
        }
      }

      if (currentVideoInfo) {
        targetAnalyzeUrl = currentVideoInfo.savedName || currentVideoInfo.videoId;
        videoId = currentVideoInfo.videoId;
      }
    }

    // Check localStorage cache first to avoid redundant API/Gemini processing (for YouTube URLs)
    if (sourceMode === 'youtube' && videoId) {
      const promptSuffix = customPrompt.trim() ? `_prompt_${customPrompt.trim().replace(/[^a-zA-Z0-9]/g, '_')}` : '';
      const modelSuffix = `_model_${selectedModel}`;
      const clipsSuffix = clipCountMode === 'auto' ? '_clips_auto' : `_clips_${targetClipCount}`;
      const langSuffix = subtitlesSource === 'youtube' ? `_lang_${transcriptLanguage}` : '';
      const cacheKey = `cheat_clip_cache_${videoId}_${durationPref}${modelSuffix}${clipsSuffix}${promptSuffix}${rangeSuffix}${manualSuffix}${langSuffix}`;

      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        try {
          const parsedData: AnalyzeResponse = JSON.parse(cachedData);

          setLoading(true);
          setError(null);
          setResult(null);
          setActiveClip(null);
          setCurrentStep(1);
          setStepProgress({ 1: 100, 2: 0, 3: 0, 4: 0 });
          setOverallProgress(25);
          setLoadingDetails('Checking cache... Found matching clip analysis in memory!');

          await new Promise(r => setTimeout(r, 300));
          setCurrentStep(2);
          setStepProgress({ 1: 100, 2: 100, 3: 0, 4: 0 });
          setOverallProgress(50);
          setLoadingDetails('Loading cached audience interest heatmap points...');
          await new Promise(r => setTimeout(r, 300));
          setCurrentStep(3);
          setStepProgress({ 1: 100, 2: 100, 3: 100, 4: 0 });
          setOverallProgress(75);
          setLoadingDetails(subtitlesSource === 'manual' ? 'Loading manual subtitles and transcript...' : 'Loading native subtitles and transcript...');
          await new Promise(r => setTimeout(r, 300));
          setCurrentStep(4);
          setStepProgress({ 1: 100, 2: 100, 3: 100, 4: 100 });
          setOverallProgress(100);
          setAiStage('Restoring Cached Highlights');
          setAiDetail('Reconstructing engagement timestamps, viral hooks, and social metadata from memory...');
          setLoadingDetails('Reconstructing viral hotspots...');
          await new Promise(r => setTimeout(r, 250));

          setResult(parsedData);
          setWorkflowTab('clips');
          setLoading(false);

          if (parsedData.clips && parsedData.clips.length > 0) {
            setActiveClip(parsedData.clips[0]);
          }

          setTimeout(() => {
            initPlayer(parsedData.video_id);
          }, 100);

          return;
        } catch (e) {
          console.warn('Failed to parse cached clip data, requesting fresh analysis:', e);
        }
      }
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setActiveClip(null);
    setCurrentStep(1);
    setStepProgress({ 1: 20, 2: 0, 3: 0, 4: 0 });
    setOverallProgress(5);
    setWorkflowTab('clips');
    const isGDrive = isGoogleDriveUrl(targetAnalyzeUrl);
    setAiStage(isGDrive ? 'Connecting to Google Drive' : 'Initializing Analysis Pipeline');
    setAiDetail(sourceMode === 'upload' ? 'Inspecting local video container & audio track...' : isGDrive ? 'Connecting to Google Drive and resolving video...' : 'Connecting to YouTube and resolving media stream metadata...');
    const effectiveModel = apiProvider === 'openrouter' ? openRouterModel : selectedModel;
    setActiveProcessingModel(effectiveModel);
    setLoadingDetails(sourceMode === 'upload' ? 'Inspecting local video file...' : isGDrive ? 'Connecting to Google Drive...' : 'Connecting to YouTube...');

    // Create AbortController for cancellation support
    const abortCtrl = new AbortController();
    analyzeAbortRef.current = abortCtrl;

    let resultData: AnalyzeResponse | null = null;

    try {
      const userCookies = getStoredCookies();
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          url: targetAnalyzeUrl,
          duration: durationPref,
          api_key: apiProvider === 'gemini' ? (apiKey.trim() || undefined) : undefined,
          model: apiProvider === 'gemini' ? selectedModel : undefined,
          api_provider: apiProvider,
          openrouter_key: apiProvider === 'openrouter' ? (openRouterKey.trim() || undefined) : undefined,
          openrouter_model: apiProvider === 'openrouter' ? openRouterModel : undefined,
          custom_prompt: customPrompt.trim() || undefined,
          range_start: rangeStartSecs,
          range_end: rangeEndSecs,
          subtitles: subtitlesSource === 'manual' ? manualSubtitlesContent : undefined,
          subtitles_filename: subtitlesSource === 'manual' ? manualSubtitlesFileName : undefined,
          transcript_language: subtitlesSource === 'youtube' ? transcriptLanguage : undefined,
          target_clip_count: clipCountMode === 'auto' ? 'auto' : targetClipCount,
          cookies: userCookies || undefined,
        }),
      });

      if (!response.body) throw new Error('No response stream from server.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let event: any;
            try { event = JSON.parse(line.slice(6)); } catch { continue; }

            if (event.error) {
              throw new Error(event.error);
            } else if (event.done) {
              resultData = event.result as AnalyzeResponse;
              setStepProgress({ 1: 100, 2: 100, 3: 100, 4: 100 });
              setOverallProgress(100);
              streamDone = true;
              break;
            } else {
              if (event.step !== undefined) {
                const s = Number(event.step);
                setCurrentStep(s);
                setStepProgress(prev => {
                  const updated = { ...prev };
                  for (let prevStep = 1; prevStep < s; prevStep++) {
                    updated[prevStep] = 100;
                  }
                  if (event.step_progress !== undefined) {
                    updated[s] = Math.max(updated[s] || 0, Number(event.step_progress));
                  }
                  return updated;
                });
              }
              if (event.overall_progress !== undefined) {
                setOverallProgress(Number(event.overall_progress));
              }
              if (event.stage) {
                setAiStage(event.stage);
              }
              if (event.detail) {
                setAiDetail(event.detail);
              }
              if (event.model) {
                setActiveProcessingModel(event.model);
              }
              if (event.message) {
                setLoadingDetails(event.message);
              }
            }
          }
          if (streamDone) break;
        }
      }

      // Flush remaining data in decoder and parse trailing buffer
      buffer += decoder.decode();
      if (!resultData && buffer.trim()) {
        const parts = buffer.split('\n\n');
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.error) throw new Error(event.error);
              if (event.done && event.result) {
                resultData = event.result as AnalyzeResponse;
                setStepProgress({ 1: 100, 2: 100, 3: 100, 4: 100 });
                setOverallProgress(100);
                break;
              }
            } catch (err: any) {
              if (err.message && !err.message.includes('JSON')) throw err;
            }
          }
          if (resultData) break;
        }
      }

      if (!resultData) {
        throw new Error('Connection to the server was closed before analysis completed. On mobile devices, ensure your browser screen stays awake and network is stable, then try again.');
      }

      // Cache the successful response safely (handling mobile Safari quota limits)
      if (resultData.video_id) {
        try {
          const promptSuffix = customPrompt.trim() ? `_prompt_${customPrompt.trim().replace(/[^a-zA-Z0-9]/g, '_')}` : '';
          const modelSuffix = `_model_${selectedModel}`;
          const clipsSuffix = clipCountMode === 'auto' ? '_clips_auto' : `_clips_${targetClipCount}`;
          const langSuffix = subtitlesSource === 'youtube' ? `_lang_${transcriptLanguage}` : '';
          const targetCacheKey = `cheat_clip_cache_${resultData.video_id}_${durationPref}${modelSuffix}${clipsSuffix}${promptSuffix}${rangeSuffix}${manualSuffix}${langSuffix}`;
          const tsKey = `cheat_clip_ts_${resultData.video_id}_${durationPref}${modelSuffix}${clipsSuffix}${promptSuffix}${rangeSuffix}${manualSuffix}${langSuffix}`;

          // Ensure persisted cache stores durable server URL, not temporary blob URL
          const persistData = {
            ...resultData,
            video_url: resultData.video_url?.startsWith('blob:')
              ? (currentVideoInfo?.savedName ? `/api/video/${currentVideoInfo.savedName}` : `/api/video/${resultData.video_id}`)
              : resultData.video_url
          };
          localStorage.setItem(targetCacheKey, JSON.stringify(persistData));
          localStorage.setItem(tsKey, new Date().toISOString());
          refreshHistory();
        } catch (storageErr) {
          console.warn('Could not cache analysis to localStorage (likely quota limit on mobile device):', storageErr);
        }
      }

      // For direct video preview on local upload, preserve the fast in-memory objectUrl
      if (sourceMode === 'upload' && currentVideoInfo) {
        if (currentVideoInfo.videoUrl) {
          resultData.video_url = currentVideoInfo.videoUrl;
        } else if (!resultData.video_url || resultData.video_url.endsWith('.wav')) {
          resultData.video_url = currentVideoInfo.savedName ? `/api/video/${currentVideoInfo.savedName}` : `/api/video/${currentVideoInfo.videoId}`;
        }
      }

      setResult(resultData);
      setWorkflowTab('clips');
      setLoading(false);

      if (resultData.clips?.length > 0) setActiveClip(resultData.clips[0]);
      setTimeout(() => initPlayer(resultData!.video_id), 100);

      // Scroll smoothly to the dashboard so results are immediately visible
      setTimeout(() => {
        const dashboard = document.querySelector('.dashboard-grid');
        if (dashboard) {
          dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 250);

    } catch (err: any) {
      // If user manually cancelled, reset silently
      if (err?.name === 'AbortError') {
        setLoading(false);
        setCurrentStep(1);
        setStepProgress({ 1: 0, 2: 0, 3: 0, 4: 0 });
        setOverallProgress(0);
        return;
      }
      const msg = String(err?.message || '');
      if (
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('503') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('server on port 8000') ||
        msg.includes('not running')
      ) {
        setError(
          '[CONN] Backend API Server is unreachable (Port 8000).\n' +
          'Please ensure the full app is running in your terminal (`npm run dev`).\n' +
          'If Python dependencies were not installed yet, run: `pip install -r requirements.txt`'
        );
      } else {
        setError(msg || 'An unexpected error occurred during analysis.');
      }
      setLoading(false);
    }
  };

  const handleCancelAnalyze = () => {
    if (analyzeAbortRef.current) {
      analyzeAbortRef.current.abort();
      analyzeAbortRef.current = null;
    }
    setLoading(false);
    setCurrentStep(1);
    setStepProgress({ 1: 0, 2: 0, 3: 0, 4: 0 });
    setOverallProgress(0);
    setLoadingTooLong(false);
  };

  const formatSeconds = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const extractHashtagsAndText = (summary: string) => {
    if (!summary) return { text: '', hashtags: [] as string[] };
    const hashtagRegex = /#\w+/g;
    const hashtags = (summary.match(hashtagRegex) || []).map(tag => tag.toLowerCase());
    const text = summary.replace(hashtagRegex, '').replace(/\s+/g, ' ').trim();
    return { text, hashtags };
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setToastMessage(t.results.copiedGeneralToast(label));
      setTimeout(() => {
        setToastMessage(null);
      }, 3000);
    });
  };

  const handleRefreshPlayer = () => {
    if (!result) return;
    const isDirect = Boolean(
      result.video_url ||
      result.source_type === 'upload' ||
      result.source_type === 'gdrive' ||
      result.video_id?.startsWith('upload_') ||
      result.video_id?.startsWith('gdrive_')
    );
    if (isDirect) {
      if (directVideoPlayerRef.current) {
        directVideoPlayerRef.current.load();
        directVideoPlayerRef.current.currentTime = currentTime;
        directVideoPlayerRef.current.play().catch(() => { });
      }
    } else {
      initPlayer(result.video_id, true);
    }
  };

  const handleDownloadRawVideo = async (forceProceed?: boolean | React.MouseEvent) => {
    if (!result || !result.video_id) return;

    // For local upload with uploaded video file, trigger immediate direct browser download
    if (sourceMode === 'upload' && uploadedVideoFile) {
      triggerBrowserDownload(uploadedVideoFile, uploadedVideoFile.name);
      setToastMessage(`${t.rawDownload.completedToast} (${uploadedVideoFile.name})`);
      return;
    }

    const isForced = forceProceed === true;

    if (!isForced && isCurrentVideoYouTube() && !hasStoredCookies()) {
      const skipped = sessionStorage.getItem('cheatclip_skip_cookie_warning') === 'true';
      if (!skipped) {
        setCookieWarningState({
          isOpen: true,
          actionType: 'download',
          onProceed: () => {
            setCookieWarningState(prev => ({ ...prev, isOpen: false }));
            handleDownloadRawVideo(true);
          }
        });
        return;
      }
    }

    const targetUrl = (result.video_url && !result.video_url.startsWith('blob:'))
      ? result.video_url
      : (result.video_id?.startsWith('gdrive_') || result.video_id?.startsWith('upload_'))
        ? `/api/video/${result.video_id}`
        : (url.trim() ? url.trim() : `https://www.youtube.com/watch?v=${result.video_id}`);
    setIsDownloadingRaw(true);
    setRawDownloadProgress({
      jobId: '',
      status: 'starting',
      percent: 0,
      downloaded: '',
      total: '',
      speed: '',
      eta: ''
    });
    setToastMessage(t.rawDownload.initiatingToast);

    try {
      const userCookies = getStoredCookies();
      const res = await fetch("/api/download-raw-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: targetUrl,
          video_id: result.video_id,
          title: result.title,
          cookies: userCookies || undefined,
        })
      });
      const startData = await res.json();
      if (!res.ok || !startData.job_id) {
        throw new Error(startData.detail || t.rawDownload.failedToast);
      }

      const jobId = startData.job_id;
      setRawDownloadProgress({
        jobId,
        status: 'downloading',
        percent: 0,
        downloaded: '',
        total: '',
        speed: '',
        eta: ''
      });

      // Poll download progress every 750ms
      await new Promise<void>((resolve, reject) => {
        const intervalId = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/download-raw-status/${jobId}`);
            if (!statusRes.ok) {
              clearInterval(intervalId);
              reject(new Error(t.rawDownload.failedToast));
              return;
            }
            const statusData = await statusRes.json();
            setRawDownloadProgress({
              jobId,
              status: statusData.status,
              percent: statusData.progress_percent || 0,
              downloaded: statusData.downloaded || '',
              total: statusData.total || '',
              speed: statusData.speed || '',
              eta: statusData.eta || '',
              downloadUrl: statusData.download_url,
              filename: statusData.filename,
              error: statusData.error
            });

            if (statusData.status === 'ready') {
              clearInterval(intervalId);
              setToastMessage(t.rawDownload.completedToast);
              const a = document.createElement("a");
              a.href = statusData.download_url || `/api/download-rendered/${statusData.filename}`;
              a.download = statusData.filename || `${result.title || result.video_id} (Full Video).mp4`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => {
                setIsDownloadingRaw(false);
                setRawDownloadProgress(null);
              }, 4000);
              resolve();
            } else if (statusData.status === 'failed') {
              clearInterval(intervalId);
              setIsDownloadingRaw(false);
              reject(new Error(statusData.error || t.rawDownload.failedToast));
            }
          } catch (pollErr) {
            clearInterval(intervalId);
            setIsDownloadingRaw(false);
            reject(pollErr);
          }
        }, 750);
      });
    } catch (err: any) {
      setError(err.message || t.rawDownload.failedToast);
      setIsDownloadingRaw(false);
      setRawDownloadProgress(null);
    }
  };

  const handleApplyAdjustedClipToResults = (adjustedClip: ViralClip) => {
    if (result && result.clips && trimmerClip) {
      const oldKey = `${trimmerClip.start_time}_${trimmerClip.end_time}`;
      const newKey = `${adjustedClip.start_time}_${adjustedClip.end_time}`;

      // Clip selection is keyed by its timestamps. Preserve the selected state
      // when changing either boundary so the adjusted clip is still rendered.
      setMarkedClips(prev => {
        if (!prev[oldKey] || oldKey === newKey) return prev;
        const next = { ...prev };
        delete next[oldKey];
        next[newKey] = true;
        return next;
      });

      setResult(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          clips: prev.clips.map(c =>
            (c.start_time === trimmerClip.start_time && c.end_time === trimmerClip.end_time)
              ? adjustedClip
              : c
          )
        };
      });
    }
  };

  const handleDownloadRawClip = async (clip: ViralClip, e?: React.MouseEvent, forceProceed = false) => {
    if (e) e.stopPropagation();
    if (!result || !result.video_id) return;

    // For local upload with uploaded video file, slice and download directly in browser via WASM
    if (sourceMode === 'upload' && uploadedVideoFile) {
      const clipKey = `${clip.start_time}_${clip.end_time}`;
      if (clipDownloadStates[clipKey]?.status === 'downloading') return;

      setClipDownloadStates(prev => ({
        ...prev,
        [clipKey]: { status: 'downloading' }
      }));
      setToastMessage(`${t.results.downloadingRawClip} "${clip.title}"`);

      try {
        const rawSourceUrl = URL.createObjectURL(uploadedVideoFile);
        const blob = await renderClipClientSide({
          videoSourceUrl: rawSourceUrl,
          startTime: clip.start_time,
          endTime: clip.end_time,
          aspectRatio: '16:9',
          backgroundStyle: 'crop',
          titleText: undefined,
          fileName: `${clip.title}.mp4`,
        });
        triggerBrowserDownload(blob, `${clip.title} (raw).mp4`);
        URL.revokeObjectURL(rawSourceUrl);
        setClipDownloadStates(prev => ({
          ...prev,
          [clipKey]: { status: 'ready' }
        }));
        setToastMessage(`[OK] ${clip.title} (raw)`);
        setTimeout(() => {
          setClipDownloadStates(prev => ({
            ...prev,
            [clipKey]: { status: 'idle' }
          }));
        }, 4000);
      } catch (err: any) {
        setClipDownloadStates(prev => ({
          ...prev,
          [clipKey]: { status: 'idle' }
        }));
        setToastMessage(`Failed to export raw clip: ${err?.message || err}`);
      }
      return;
    }

    if (!forceProceed && isCurrentVideoYouTube() && !hasStoredCookies()) {
      const skipped = sessionStorage.getItem('cheatclip_skip_cookie_warning') === 'true';
      if (!skipped) {
        setCookieWarningState({
          isOpen: true,
          actionType: 'download',
          onProceed: () => {
            setCookieWarningState(prev => ({ ...prev, isOpen: false }));
            handleDownloadRawClip(clip, undefined, true);
          }
        });
        return;
      }
    }

    const clipKey = `${clip.start_time}_${clip.end_time}`;
    if (clipDownloadStates[clipKey]?.status === 'downloading') return;

    setClipDownloadStates(prev => ({
      ...prev,
      [clipKey]: { status: 'downloading' }
    }));
    setToastMessage(`${t.results.downloadingRawClip} "${clip.title}"`);

    const targetUrl = (result.video_url && !result.video_url.startsWith('blob:'))
      ? result.video_url
      : (result.video_id?.startsWith('gdrive_') || result.video_id?.startsWith('upload_'))
        ? `/api/video/${result.video_id}`
        : (url.trim() ? url.trim() : `https://www.youtube.com/watch?v=${result.video_id}`);

    try {
      const userCookies = getStoredCookies();
      const res = await fetch("/api/download-raw-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: targetUrl,
          video_id: result.video_id,
          start_time: clip.start_time,
          end_time: clip.end_time,
          title: clip.title,
          cookies: userCookies || undefined,
        })
      });

      const startData = await res.json();
      if (!res.ok || !startData.job_id) {
        throw new Error(startData.detail || "Failed to start clip download");
      }

      const jobId = startData.job_id;

      await new Promise<void>((resolve, reject) => {
        const intervalId = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/download-raw-clip-status/${jobId}`);
            if (!statusRes.ok) {
              clearInterval(intervalId);
              reject(new Error("Failed to get clip download status"));
              return;
            }
            const statusData = await statusRes.json();
            if (statusData.status === 'ready') {
              clearInterval(intervalId);
              setClipDownloadStates(prev => ({
                ...prev,
                [clipKey]: { status: 'ready' }
              }));
              setToastMessage(`[OK] ${clip.title} (raw)`);
              const a = document.createElement("a");
              a.href = statusData.download_url;
              a.download = statusData.filename || `${clip.title} (raw).mp4`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => {
                setClipDownloadStates(prev => ({
                  ...prev,
                  [clipKey]: { status: 'idle' }
                }));
              }, 4000);
              resolve();
            } else if (statusData.status === 'failed') {
              clearInterval(intervalId);
              setClipDownloadStates(prev => ({
                ...prev,
                [clipKey]: { status: 'error', error: statusData.error }
              }));
              reject(new Error(statusData.error || "Clip download failed"));
            }
          } catch (pollErr) {
            clearInterval(intervalId);
            reject(pollErr);
          }
        }, 750);
      });
    } catch (err: any) {
      setClipDownloadStates(prev => ({
        ...prev,
        [clipKey]: { status: 'error', error: err.message }
      }));
      setError(err.message || "Failed to download clip");
    }
  };

  const handleCopyClip = (clip: ViralClip, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card trigger
    let copyText = `CLIP: ${clip.title}
Timestamp: ${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)}
Virality Score: ${clip.virality_score}%

Transcript:
"${clip.transcript}"`;

    if (clip.key_quotes && clip.key_quotes.length > 0) {
      copyText += `\n\nKey Quotes:\n` + clip.key_quotes.map(q => `"${q}"`).join('\n');
    }
    if (clip.title_suggestion) {
      copyText += `\n\nTitle Suggestion: ${clip.title_suggestion}`;
    }
    if (clip.caption_suggestion) {
      const captionText = (() => {
        const lowercaseHashtags = (clip.hashtag_suggestion || '').toLowerCase();
        if (!lowercaseHashtags) return clip.caption_suggestion;
        if (clip.caption_suggestion.toLowerCase().includes(lowercaseHashtags)) return clip.caption_suggestion;
        return `${clip.caption_suggestion} ${lowercaseHashtags}`;
      })();
      copyText += `\n\nCaption Suggestion: ${captionText}`;
    }

    navigator.clipboard.writeText(copyText).then(() => {
      setToastMessage(t.results.copiedDetailsToast(clip.title));
      setTimeout(() => {
        setToastMessage(null);
      }, 3000);
    });
  };

  const handleCopyTimestamp = (clip: ViralClip, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const ts = `${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)}`;
    navigator.clipboard.writeText(ts).then(() => {
      setToastMessage(t.results.copiedTimestampToast(ts));
      setTimeout(() => setToastMessage(null), 3000);
    });
  };

  const handleCopyTimestampsFormat = (format: 'only' | 'with_title' | 'youtube', scope: 'all' | 'marked' = copyTimestampScope, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCopyTimestampMenuTarget(null);
    if (!result || !result.clips || result.clips.length === 0) return;

    const targetClips = scope === 'marked'
      ? result.clips.filter(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`])
      : result.clips;

    if (targetClips.length === 0) {
      if (scope === 'marked') {
        setToastMessage(t.results.noMarkedClipsToCopyToast);
      }
      return;
    }

    let text = '';
    if (format === 'only') {
      text = targetClips
        .map(clip => `${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)}`)
        .join('\n');
      if (scope === 'marked') {
        setToastMessage(t.results.copiedMarkedTimestampsOnlyToast(targetClips.length));
      } else {
        setToastMessage(t.results.copiedTimestampsOnlyToast(targetClips.length));
      }
    } else if (format === 'with_title') {
      text = targetClips
        .map(clip => `${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)} | ${clip.title}`)
        .join('\n');
      if (scope === 'marked') {
        setToastMessage(t.results.copiedMarkedTimestampsWithTitlesToast(targetClips.length));
      } else {
        setToastMessage(t.results.copiedTimestampsWithTitlesToast(targetClips.length));
      }
    } else if (format === 'youtube') {
      text = targetClips
        .map(clip => `${formatSeconds(clip.start_time)} ${clip.title}`)
        .join('\n');
      if (scope === 'marked') {
        setToastMessage(t.results.copiedMarkedTimestampsYoutubeToast(targetClips.length));
      } else {
        setToastMessage(t.results.copiedTimestampsYoutubeToast(targetClips.length));
      }
    }

    navigator.clipboard.writeText(text).then(() => {
      setTimeout(() => setToastMessage(null), 3000);
    });
  };

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
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {t.results.copyFormatWithTitles}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {t.results.copyFormatWithTitlesDesc}
          </span>
        </button>

        <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.07)', margin: '0.15rem 0' }} />

        <button
          type="button"
          className="timestamp-menu-item"
          onClick={(e) => handleCopyTimestampsFormat('youtube', copyTimestampScope, e)}
          disabled={copyTimestampScope === 'marked' && markedCount === 0}
          style={copyTimestampScope === 'marked' && markedCount === 0 ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {t.results.copyFormatYoutube}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {t.results.copyFormatYoutubeDesc}
          </span>
        </button>
      </div>
    );
  };

  const handleExportJSON = () => {
    if (!result) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.clips, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `cheat_clip_pro_${result.video_id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setToastMessage(t.results.downloadedJsonToast);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleExportSRT = () => {
    if (!result || !result.transcript) {
      setToastMessage(t.results.noTranscriptToExport);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const formatSRTTime = (secs: number): string => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    };

    let srtText = '';
    result.transcript.forEach((line, index) => {
      srtText += `${index + 1}\n`;
      srtText += `${formatSRTTime(line.start)} --> ${formatSRTTime(line.end)}\n`;
      srtText += `${line.text}\n\n`;
    });

    const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(srtText);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `cheat_clip_pro_${result.video_id}.srt`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setToastMessage(t.results.downloadedSrtToast);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCopyAllMarkdown = () => {
    if (!result) return;
    let md = `# Viral Clips from "${result.title}"\n\n`;
    md += `**Overall Summary**: ${result.summary}\n\n`;
    result.clips.forEach((clip, index) => {
      md += `## ${index + 1}. ${clip.title} (${clip.virality_score}% Virality)\n`;
      md += `- **Timestamp**: ${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)} (Duration: ${formatSeconds(clip.end_time - clip.start_time)})\n`;
      if (clip.key_quotes && clip.key_quotes.length > 0) {
        md += `- **Key Quotes**:\n`;
        clip.key_quotes.forEach(q => md += `  - *"${q}"*\n`);
      }
      if (clip.title_suggestion) {
        md += `- **Title Suggestion**: ${clip.title_suggestion}\n`;
      }
      if (clip.caption_suggestion) {
        const captionText = (() => {
          const lowercaseHashtags = (clip.hashtag_suggestion || '').toLowerCase();
          if (!lowercaseHashtags) return clip.caption_suggestion;
          if (clip.caption_suggestion.toLowerCase().includes(lowercaseHashtags)) return clip.caption_suggestion;
          return `${clip.caption_suggestion} ${lowercaseHashtags}`;
        })();
        md += `- **Caption Suggestion**: ${captionText}\n`;
      }
      md += `- **Transcript**:\n  > ${clip.transcript.replace(/\n/g, '\n  > ')}\n\n`;
    });

    navigator.clipboard.writeText(md).then(() => {
      setToastMessage(t.results.copiedMarkdownToast);
      setTimeout(() => setToastMessage(null), 3000);
    });
  };

  // Filter clips based on query and virality filters
  const filteredClips = useMemo(() => {
    if (!result?.clips) return [];
    return result.clips.filter(clip => {
      const matchesSearch = searchQuery.trim() === '' ||
        clip.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        clip.transcript.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesVirality = viralityFilter === 'all' ||
        (viralityFilter === 'high' && clip.virality_score >= 90) ||
        (viralityFilter === 'medium' && clip.virality_score < 90) ||
        (viralityFilter === 'marked' && !!markedClips[`${clip.start_time}_${clip.end_time}`]);

      return matchesSearch && matchesVirality;
    });
  }, [result?.clips, searchQuery, viralityFilter, markedClips]);

  // Sort the filtered clips based on selected sortBy
  const sortedClips = useMemo(() => {
    return [...filteredClips].sort((a, b) => {
      if (sortBy === 'virality') {
        return b.virality_score - a.virality_score;
      } else if (sortBy === 'time') {
        return a.start_time - b.start_time;
      } else if (sortBy === 'duration') {
        return (b.end_time - b.start_time) - (a.end_time - a.start_time);
      } else if (sortBy === 'marked') {
        const aMarked = !!markedClips[`${a.start_time}_${a.end_time}`];
        const bMarked = !!markedClips[`${b.start_time}_${b.end_time}`];
        if (aMarked && !bMarked) return -1;
        if (!aMarked && bMarked) return 1;
        return b.virality_score - a.virality_score;
      }
      return 0;
    });
  }, [filteredClips, sortBy, markedClips]);

  // Filter history entries based on query (matches video title, url, id, summary, clip titles, and quotes)
  const filteredHistory = useMemo(() => {
    if (!historySearchQuery.trim()) return history;
    const q = historySearchQuery.trim().toLowerCase();
    return history.filter(entry => {
      const matchesVideoTitle = (entry.title || '').toLowerCase().includes(q);
      const matchesUrl = (entry.url || '').toLowerCase().includes(q) || (entry.video_id || '').toLowerCase().includes(q);
      const matchesDuration = (entry.duration_pref || '').toLowerCase().includes(q);
      const matchesSummary = (entry.summary || '').toLowerCase().includes(q);
      const matchesClips = (entry.clip_titles || []).some(t => t.toLowerCase().includes(q));
      const matchesQuotes = (entry.key_quotes || []).some(k => k.toLowerCase().includes(q));

      return matchesVideoTitle || matchesUrl || matchesDuration || matchesSummary || matchesClips || matchesQuotes;
    });
  }, [history, historySearchQuery]);

  // Smooth scroll active clip card into view in the sidebar list ONLY when activeClip changes
  const prevActiveClipKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeClip) return;
    const clipKey = `${activeClip.start_time}_${activeClip.end_time}`;
    if (prevActiveClipKeyRef.current === clipKey) return;
    prevActiveClipKeyRef.current = clipKey;

    if (sortedClips) {
      const index = sortedClips.findIndex(
        c => c.start_time === activeClip.start_time && c.end_time === activeClip.end_time
      );
      if (index !== -1) {
        const element = document.getElementById(`clip-card-${index}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }, [activeClip]);

  // Find current subtitle line with slight gap tolerance to prevent jitter
  const currentSubtitle = result?.transcript?.find(
    line => currentTime >= (line.start - 0.05) && currentTime <= (line.end + 0.25)
  );

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-msg" role="status" aria-live="polite">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span className="toast-text">{toastMessage}</span>
          <button
            type="button"
            className="toast-close-btn"
            onClick={() => setToastMessage(null)}
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Full-Width Cyber Header Bar (johansa.com style - Edge-to-Edge Solid Dark) */}
      <div className="app-header-wrapper">
        <div className="app-header-inner">
          <header className="app-header">
            <div className="header-logo">
              <div>
                <div className="logo-title-row">
                  <span className="prompt-marker">
                    &gt;_
                  </span>
                  <h1 className="logo-title">
                    CHEAT CLIP PRO
                  </h1>
                  <span className="status-dot" title="Online"></span>
                </div>
                <p className="header-subtitle">
                  &gt; {t.header.subtitle}
                </p>
              </div>
            </div>
            <div className="header-nav">
              <button
                type="button"
                className={`header-nav-btn${hasCookies ? ' cookies-active' : ''}`}
                onClick={() => setIsCookiesModalOpen(true)}
                title={hasCookies ? t.header.cookiesTooltipActive : t.header.cookiesTooltipSetup}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Bookmark size={13} /> {t.header.cookiesBtn}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  {hasCookies ? (
                    <>
                      <Check size={12} style={{ color: '#00ff66' }} />
                      <span style={{ color: '#00ff66' }}>{t.header.cookiesStatusActive}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-muted)', display: 'inline-block' }} />
                      <span>{t.header.cookiesStatusSetup}</span>
                    </>
                  )}
                </span>
              </button>
              {allowAppUpdates && (
                <button
                  type="button"
                  className="header-nav-btn"
                  onClick={() => setShowGlobalClearModal(true)}
                  disabled={isClearingGlobalTemp}
                  title={t.header.clearTempTooltip}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Trash2 size={13} /> {isClearingGlobalTemp ? t.header.clearingTempBtn : t.header.clearTempBtn}
                  </span>
                </button>
              )}
              {allowAppUpdates && (
                <button
                  type="button"
                  className="header-nav-btn"
                  onClick={() => setIsUpdateModalOpen(true)}
                  title={t.header.updateBtnTooltip}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <RefreshCw size={13} /> {t.header.updateBtn}
                  </span>
                </button>
              )}
              <LanguageSwitcher />
              <a
                href="https://tako.id/johansa"
                target="_blank"
                rel="noopener noreferrer"
                className="header-nav-btn support-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Heart size={13} /> {t.header.supportProject}
              </a>
            </div>
          </header>
        </div>
      </div>

      <div className="app-container">
        {/* Workflow Navigation Tabs Pipeline (01 SOURCE -> 02 RECOMMENDED CLIPS -> 03 AUTO CLIPPER) */}
        <nav className="workflow-tab-bar" aria-label="Workflow Navigation">
          <button
            type="button"
            id="tab-step-source"
            className={`workflow-tab-btn ${workflowTab === 'source' ? 'active' : ''} ${result ? 'step-done' : ''}`}
            onClick={() => setWorkflowTab('source')}
          >
            <span className="workflow-step-num">
              {result ? <Check size={11} strokeWidth={3} /> : '01'}
            </span>
            <FileVideo size={15} className="workflow-step-icon" />
            <span className="workflow-step-title">SOURCE</span>
          </button>

          <div className={`workflow-process-connector ${result ? 'completed' : ''}`} aria-hidden="true">
            <span className="connector-line" />
            <span className="connector-arrow-box">
              <ChevronRight size={13} strokeWidth={2.5} />
            </span>
            <span className="connector-line" />
          </div>

          <button
            type="button"
            id="tab-step-clips"
            className={`workflow-tab-btn ${workflowTab === 'clips' ? 'active' : ''} ${loading ? 'is-analyzing' : ''} ${result?.clips && result.clips.length > 0 ? 'step-has-content' : ''}`}
            onClick={() => {
              setWorkflowTab('clips');
            }}
            disabled={!loading && !result && history.length === 0}
            title={
              loading
                ? 'Sedang menganalisa video...'
                : result
                  ? 'Lihat hasil rekomendasi klip'
                  : history.length > 0
                    ? 'Buka riwayat klip tersimpan'
                    : 'Selesaikan analisis video terlebih dahulu'
            }
          >
            <span className="workflow-step-num">02</span>
            {loading ? (
              <RefreshCw size={15} className="spinner-icon workflow-step-icon" />
            ) : (
              <Film size={15} className="workflow-step-icon" />
            )}
            <span className="workflow-step-title">
              {loading ? (
                'ANALYZING...'
              ) : result ? (
                'RECOMMENDED CLIPS'
              ) : (
                'HISTORY CLIPS'
              )}
            </span>
            {loading ? (
              <span className="workflow-tab-count analyzing-badge">
                {overallProgress}%
              </span>
            ) : result?.clips ? (
              <span className="workflow-tab-count">[{result.clips.length}]</span>
            ) : history.length > 0 ? (
              <span className="workflow-tab-count">[{history.length}]</span>
            ) : null}
          </button>

          <div className={`workflow-process-connector ${markedClipsList.length > 0 ? 'completed' : ''}`} aria-hidden="true">
            <span className="connector-line" />
            <span className="connector-arrow-box">
              <ChevronRight size={13} strokeWidth={2.5} />
            </span>
            <span className="connector-line" />
          </div>

          <button
            type="button"
            id="tab-step-clipper"
            className={`workflow-tab-btn ${workflowTab === 'clipper' ? 'active' : ''} ${markedClipsList.length > 0 ? 'step-has-content' : ''}`}
            onClick={() => {
              if (result) setWorkflowTab('clipper');
            }}
            disabled={!result}
            title={!result ? 'Selesaikan analisis video terlebih dahulu' : 'Buka Auto Clipper Studio'}
          >
            <span className="workflow-step-num">03</span>
            <Scissors size={15} className="workflow-step-icon" />
            <span className="workflow-step-title">AUTO CLIPPER</span>
            {markedClipsList.length > 0 && (
              <span className="workflow-tab-count">
                [{markedClipsList.length} READY]
              </span>
            )}
          </button>
        </nav>

        {/* Active Video Status Banner (Flow level - placed directly below workflow tabs for all steps) */}
        {result && (
          <div className="active-video-banner">
            <div className="active-video-info">
              <span className="studio-tab-preview-title">&gt;_ ACTIVE VIDEO:</span>
              <span className="studio-tab-preview-name">{result.title}</span>
              <span className="studio-tab-preview-count">[{result.clips?.length || 0} klip tersedia]</span>
            </div>
            <div className="active-video-actions">
              {/* If on Tab 01 (Source): Show 02 -> and 03 -> */}
              {workflowTab === 'source' && (
                <>
                  <button
                    type="button"
                    className="glowing-btn"
                    onClick={() => setWorkflowTab('clips')}
                    style={{
                      padding: '0.4rem 0.95rem',
                      fontSize: '0.78rem',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <span>[ 02 LIHAT CLIPS</span>
                    <ArrowRight size={13} />
                    <span>]</span>
                  </button>
                  <button
                    type="button"
                    className="glowing-btn"
                    onClick={() => setWorkflowTab('clipper')}
                    style={{
                      padding: '0.4rem 0.95rem',
                      fontSize: '0.78rem',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <span>[ 03 AUTO CLIPPER</span>
                    <ArrowRight size={13} />
                    <span>]</span>
                  </button>
                </>
              )}

              {/* If on Tab 02 (Clips): Show <- 01 and 03 -> */}
              {workflowTab === 'clips' && (
                <>
                  <button
                    type="button"
                    className="glowing-btn"
                    onClick={() => setWorkflowTab('source')}
                    style={{
                      padding: '0.4rem 0.95rem',
                      fontSize: '0.78rem',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <span>[</span>
                    <ArrowLeft size={13} />
                    <span>01 SOURCE ]</span>
                  </button>
                  <button
                    type="button"
                    className="glowing-btn"
                    onClick={() => setWorkflowTab('clipper')}
                    style={{
                      padding: '0.4rem 0.95rem',
                      fontSize: '0.78rem',
                      background: 'var(--primary)',
                      color: '#000000',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <span>[ 03 AUTO CLIPPER</span>
                    <ArrowRight size={13} />
                    <span>]</span>
                  </button>
                </>
              )}

              {/* If on Tab 03 (Auto Clipper): Show <- 01 and <- 02 */}
              {workflowTab === 'clipper' && (
                <>
                  <button
                    type="button"
                    className="glowing-btn"
                    onClick={() => setWorkflowTab('source')}
                    style={{
                      padding: '0.4rem 0.95rem',
                      fontSize: '0.78rem',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <span>[</span>
                    <ArrowLeft size={13} />
                    <span>01 SOURCE ]</span>
                  </button>
                  <button
                    type="button"
                    className="glowing-btn"
                    onClick={() => setWorkflowTab('clips')}
                    style={{
                      padding: '0.4rem 0.95rem',
                      fontSize: '0.78rem',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <span>[</span>
                    <ArrowLeft size={13} />
                    <span>02 LIHAT CLIPS ]</span>
                  </button>
                </>
              )}

              <button
                type="button"
                className="active-video-close-btn"
                onClick={handleDeselectActiveVideo}
                title="Tutup & Nonaktifkan Active Video (Deselect)"
                aria-label="Close active video"
              >
                [ ✕ ]
              </button>
            </div>
          </div>
        )}

        {/* Main Form controls panel */}
        <section className="glass-panel" style={{ display: workflowTab === 'source' ? 'flex' : 'none', flexDirection: 'column', gap: '1.5rem' }}>

          <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
                            <option value="gemini-2.5-flash" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.5-flash (Fast & recommended - Free tier friendly)</option>
                            <option value="gemini-2.5-flash-lite" style={{ background: '#0a0a0f', color: '#fff' }}>gemini-2.5-flash-lite (Ultra-fast & lightweight)</option>
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
                        onClick={() => handleAnalyze()}
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
                    {(error.toLowerCase().includes("api key") || error.toLowerCase().includes("quota") || error.toLowerCase().includes("flash model") || error.toLowerCase().includes("aistudio") || error.toLowerCase().includes("rate limit")) && (
                      <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
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
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Tab 02: CLIPS / HISTORY SECTION */}
        {workflowTab === 'clips' && (
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
                                  <span> {formatRelativeTime(entry.analyzed_at)}</span>
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
                            cursor: isDownloadingRaw ? 'not-allowed' : 'pointer',
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
                              {t.results.downloadingRawVideo}
                            </>
                          ) : (
                            <>
                              <Download size={13} />
                              {t.results.downloadRawVideo}
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
                                <span style={{ color: '#4ade80' }}>[OK] {t.rawDownload.readyBadge}</span>
                              ) : (
                                <>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon">
                                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                                  </svg>
                                  <span>{t.rawDownload.downloadingTitle(rawDownloadProgress.percent.toFixed(1))}</span>
                                </>
                              )}
                            </span>
                            {rawDownloadProgress.eta && rawDownloadProgress.status !== 'ready' && (
                              <span className="progress-card-eta">{t.rawDownload.eta(rawDownloadProgress.eta)}</span>
                            )}
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
                                      className={`clip-dl-btn ${isReady ? 'state-ready' : 'state-downloading'}`}
                                      disabled={isDl}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTrimmerClip(clip);
                                      }}
                                      title={t.results.downloadRawClipTooltip}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                                    >
                                      {isDl ? (
                                        <>
                                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                                            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                                          </svg>
                                          <span>{t.results.downloadingRawClip}</span>
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

                              {/* Row 2: Secondary Utilities (Copy Timestamp, Copy Details, Show Transcript) */}
                              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.45rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
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
        )}



        {/* Global CSS spinner keyframe animation injection */}
        <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        .spinner-icon {
          animation: spin 1s linear infinite;
        }
        .pulsing-text {
          animation: pulse 2s infinite ease-in-out;
        }
        .nav-link:hover {
          color: var(--primary) !important;
        }
      `}</style>
        {/* Embedded Clip Studio Section with side inline batch progress */}
        {result && (
          <div style={{ display: workflowTab === 'clipper' ? 'block' : 'none' }}>
            <ClipStudioSection
              videoUrl={result.video_url || url}
              videoId={result.video_id}
              allClips={result.clips}
              transcript={result.transcript || []}
              markedClips={markedClipsList}
              activeClip={activeClip}
              onStartRender={handleStartBatchRender}
              isRendering={isLaunchingRender}
              onToggleMarkClip={(clip) => toggleMarkedClip(`${clip.start_time}_${clip.end_time}`)}
              onToggleAllClips={toggleAllMarkedClips}
              batchProgress={batchProgress}
              onDismissProgress={() => {
                if (batchEventSourceRef.current) {
                  batchEventSourceRef.current.close();
                  batchEventSourceRef.current = null;
                }
                setBatchProgress(null);
              }}
              onRetryClip={handleRetryBatchClip}
              allowAppUpdates={allowAppUpdates}
              onOpenCookiesModal={() => setIsCookiesModalOpen(true)}
              onBackToClips={() => setWorkflowTab('clips')}
            />
          </div>
        )}

        {/* Viewport and Hardware Metrics Sync Pipeline */}
        <LayoutMetricsSync />

        {/* Transcript Language Confirmation Notice Modal before Hack Clips */}
        {showLanguageConfirmModal && (
          <div className="custom-confirm-modal-overlay" style={{ zIndex: 10000 }}>
            <div className="custom-confirm-modal-card" style={{ maxWidth: '520px', textAlign: 'left', alignItems: 'stretch', background: '#0a0910', border: '1.5px solid #ff00ff', boxShadow: '0 0 35px rgba(255, 0, 255, 0.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #272238', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: '#ff1e27', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1rem' }}>&gt;_</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.86rem', color: '#fff', letterSpacing: '0.04em' }}>
                    SYS // KONFIRMASI BAHASA AUDIO VIDEO
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLanguageConfirmModal(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}
                  aria-label="Tutup"
                >
                  ✕
                </button>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '1.25rem' }}>
                Cheat Clip Pro akan mengambil subtitle/transkrip otomatis dari YouTube sesuai bahasa yang Anda pilih.
                Pastikan audio video ini sesuai agar deteksi momen viral AI tidak meleset:
              </p>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                  &gt; PILIHAN TARGET BAHASA TRANSKRIP:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setTranscriptLanguage('en');
                      localStorage.setItem('cheat_clip_transcript_language', 'en');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      padding: '0.85rem',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      background: transcriptLanguage === 'en' ? 'rgba(255, 0, 255, 0.12)' : '#0d0d14',
                      border: transcriptLanguage === 'en' ? '2px solid #ff00ff' : '1px solid #272238',
                      color: transcriptLanguage === 'en' ? '#ff00ff' : 'var(--text-muted)',
                      boxShadow: transcriptLanguage === 'en' ? '0 0 15px rgba(255, 0, 255, 0.3)' : 'none'
                    }}
                  >
                    <span>[EN]</span>
                    <span>ENGLISH</span>
                    {transcriptLanguage === 'en' && <span style={{ color: '#ff00ff', marginLeft: '0.25rem' }}>✓</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTranscriptLanguage('id');
                      localStorage.setItem('cheat_clip_transcript_language', 'id');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      padding: '0.85rem',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      background: transcriptLanguage === 'id' ? 'rgba(255, 0, 255, 0.12)' : '#0d0d14',
                      border: transcriptLanguage === 'id' ? '2px solid #ff00ff' : '1px solid #272238',
                      color: transcriptLanguage === 'id' ? '#ff00ff' : 'var(--text-muted)',
                      boxShadow: transcriptLanguage === 'id' ? '0 0 15px rgba(255, 0, 255, 0.3)' : 'none'
                    }}
                  >
                    <span>[ID]</span>
                    <span>INDONESIA</span>
                    {transcriptLanguage === 'id' && <span style={{ color: '#ff00ff', marginLeft: '0.25rem' }}>✓</span>}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '1.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  id="skip-lang-check"
                  checked={skipLanguageConfirm}
                  onChange={(e) => setSkipLanguageConfirm(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ff00ff', cursor: 'pointer' }}
                />
                <label htmlFor="skip-lang-check" style={{ cursor: 'pointer' }}>
                  Jangan tampilkan konfirmasi ini lagi (ingat untuk sesi ini)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-confirm-cancel"
                  onClick={() => setShowLanguageConfirmModal(false)}
                  style={{ padding: '0.65rem 1.25rem', fontFamily: 'var(--font-mono)' }}
                >
                  [ BATAL ]
                </button>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={() => {
                    setShowLanguageConfirmModal(false);
                    handleAnalyze();
                  }}
                  style={{ padding: '0.65rem 1.75rem' }}
                >
                  [ LANJUTKAN HACK CLIPS → ]
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cookie Pre-check Warning Modal */}
        <CookieWarningModal
          isOpen={cookieWarningState.isOpen}
          actionType={cookieWarningState.actionType}
          onClose={() => setCookieWarningState(prev => ({ ...prev, isOpen: false }))}
          onProceedAnyway={cookieWarningState.onProceed}
          onOpenCookiesModal={() => {
            setCookieWarningState(prev => ({ ...prev, isOpen: false }));
            setIsCookiesModalOpen(true);
          }}
        />

        {/* YouTube Cookies Modal */}
        <CookiesModal
          isOpen={isCookiesModalOpen}
          onClose={() => {
            setIsCookiesModalOpen(false);
            setHasCookies(hasStoredCookies());
          }}
          onCookieStatusChange={setHasCookies}
        />

        {/* App Update & Restart Modal */}
        <AppUpdateModal
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
        />

        {/* Clip Trimmer & Context Editor Modal */}
        <ClipTrimmerModal
          isOpen={Boolean(trimmerClip)}
          clip={trimmerClip}
          videoId={result?.video_id || ''}
          videoUrl={result?.video_url}
          sourceType={result?.source_type}
          videoTitle={result?.title}
          videoDuration={result?.duration || 0}
          transcript={result?.transcript}
          onClose={() => setTrimmerClip(null)}
          onApply={handleApplyAdjustedClipToResults}
          onDownload={async (adjustedClip) => {
            handleApplyAdjustedClipToResults(adjustedClip);
            await handleDownloadRawClip(adjustedClip);
          }}
        />

        {/* Global Fancy Clear Temp Confirmation Modal */}
        {showGlobalClearModal && (
          <div className="custom-confirm-modal-overlay">
            <div className="custom-confirm-modal-card">
              <div className="confirm-modal-icon-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={24} color="#ff1e27" />
              </div>
              <h3 className="confirm-modal-title">{t.studio.confirmModalTitle}</h3>
              <p className="confirm-modal-desc" style={{ marginBottom: '1rem' }}>
                {t.studio.confirmModalDesc}
              </p>
              <div style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                margin: '0 0 1.5rem 0',
                padding: '0.85rem 1rem',
                borderRadius: 0,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                textAlign: 'left',
                fontSize: '0.78rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#4ade80' }}>
                  <span>✓</span>
                  <strong>{t.studio.confirmModalNotice}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#38bdf8' }}>
                  <span>[SEC]</span>
                  <strong>{t.header.confirmModalCookieNotice}</strong>
                </div>
              </div>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="btn-confirm-cancel"
                  onClick={() => setShowGlobalClearModal(false)}
                  disabled={isClearingGlobalTemp}
                >
                  {t.studio.cancelBtn}
                </button>
                <button
                  type="button"
                  className="btn-confirm-purge"
                  onClick={executeGlobalClearTemp}
                  disabled={isClearingGlobalTemp}
                >
                  {isClearingGlobalTemp ? t.studio.purgingBtn : t.studio.purgeBtn}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

