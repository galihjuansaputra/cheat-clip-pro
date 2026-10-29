import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  AlertTriangle, 
  RefreshCw, 
  Copy, 
  Check, 
  RotateCcw, 
  Trash2, 
  ArrowLeft, 
  ArrowRight, 
  X,
  Music,
  FileCode,
  Play,
  Pause
} from 'lucide-react';
import { useLanguage } from '../locales';
import { resilientFetch } from '../utils/api';
import { getStoredCookies, hasStoredCookies } from '../utils/cookieUtils';
import { detectFaceClientSide } from '../utils/clientFaceDetector';
import { isMobileDevice } from '../utils/deviceUtils';
import { isWebCodecsGpuSupported, getClientGpuName } from '../services/webcodecsRenderer';
import type {
  ViralClip,
  RenderSettings,
  AspectRatioOption,
  BackgroundStyle,
  CaptionStyle,
  CaptionFont,
  TitlePosition,
  StreamerPreset,
  FacecamPosition,
  FontSizeOption,
  TextCaseOption,
  TitleDurationOption,
  SubtitlePositionMode,
  BatchRenderProgress,
  HardwareAccelOption,
  HardwareAccelInfo,
  FontItem,
  TranscriptLine,
} from '../types';

interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

interface CaptionChunk {
  words: CaptionWord[];
  start: number;
  end: number;
}

function cleanCaptionText(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\[.*?\]|\(.*?\)|[*].*?[*]/g, ' ')
    .replace(/\b(laughter|applause|music|cheering|snickering|giggle|cough)\b/gi, ' ')
    .replace(/^\s*[\.,…:;]+\s*/, '')
    .replace(/\s*[\.,…:;]+\s*$/, '')
    .replace(/[^\w\s.,%&$?]|_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CAPTION_STYLE_CONFIG: Record<CaptionStyle, { highlight: string; sample: [string, string] }> = {
  viral_pop: { highlight: '#FFE600', sample: ['VIRAL', 'POP'] },
  beast_punch: { highlight: '#00FF66', sample: ['UNREAL', 'HACK'] },
  cyber_violet: { highlight: '#D946EF', sample: ['CYBER', 'PUNCH'] },
  fire_red: { highlight: '#FF2E2E', sample: ['HOT', 'FIRE'] },
  electric_cyan: { highlight: '#00F0FF', sample: ['ELECTRIC', 'CYAN'] },
  golden_aura: { highlight: '#FFB800', sample: ['GOLDEN', 'MOMENT'] },
  clean_minimal: { highlight: '#38BDF8', sample: ['CLEAN', 'SUBTITLE'] },
  none: { highlight: '#FFFFFF', sample: ['', ''] },
};

interface ClipStudioSectionProps {
  videoUrl: string;
  videoId: string;
  allClips: ViralClip[];
  markedClips: ViralClip[];
  activeClip: ViralClip | null;
  onStartRender: (settings: RenderSettings) => void;
  isRendering: boolean;
  onToggleMarkClip?: (clip: ViralClip) => void;
  onToggleAllClips?: (forceSelect?: boolean) => void;
  batchProgress?: BatchRenderProgress | null;
  onDismissProgress?: () => void;
  onRetryClip?: (clipIndex?: number) => void;
  allowAppUpdates?: boolean;
  onOpenCookiesModal?: () => void;
  onBackToClips?: () => void;
  transcript?: TranscriptLine[];
}

function getFriendlyErrorMessage(rawMsg: string): string {
  if (!rawMsg) return 'Rendering failed unexpectedly.';
  const lower = rawMsg.toLowerCase();
  if (lower.includes("moov atom not found")) {
    return 'Download interrupted by internet lag ("moov atom not found"). The video stream was cut off before finishing. Click "[~] Retry" to re-download.';
  }
  if (lower.includes("bot verification") || lower.includes("sign in") || lower.includes("confirm you're not a bot")) {
    return 'YouTube requires cookies verification. Click the [*] Cookies Manager button in the top navbar to save your YouTube cookies.';
  }
  if (lower.includes("rendering timed out") || (lower.includes("timed out") && lower.includes("rendering"))) {
    return 'Video rendering timed out due to duration/complexity. Click "[~] Retry" or switch to Universal CPU encoder in Studio Settings.';
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return 'Video download timed out due to slow/laggy internet connection. Click "[~] Retry" to try downloading again.';
  }
  if (lower.includes("hardware encoder") || (lower.includes("ffmpeg") && (lower.includes("nvenc") || lower.includes("amf") || lower.includes("qsv")))) {
    return 'GPU hardware encoder failed. Please switch Video Encoder to "Universal CPU (libx264)" in Studio Settings.';
  }
  if (lower.includes("no space left") || lower.includes("disk full") || lower.includes("out of disk")) {
    return 'Disk storage is full. Please click "[x] Clear Temp" to free up storage space.';
  }
  if (lower.includes("whisper") || lower.includes("transcribe")) {
    return 'Word transcription failed. Check your audio track or switch subtitle style to none.';
  }
  if (lower.includes("ffmpeg") || lower.includes("filter_complex")) {
    return 'FFmpeg video rendering failed during composition. Check error details below.';
  }
  return rawMsg.length > 140 ? rawMsg.slice(0, 140) + '...' : rawMsg;
}

const ClipRenderErrorBox: React.FC<{ errorMessage: string; t: any; onRetry?: () => void }> = ({ errorMessage, t, onRetry }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(errorMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const friendly = getFriendlyErrorMessage(errorMessage);

  return (
    <div
      style={{
        marginTop: '0.4rem',
        padding: '0.55rem 0.75rem',
        background: 'rgba(255, 30, 39, 0.12)',
        border: '1px solid #ff1e27',
        borderRadius: 0,
        fontSize: '0.72rem',
        color: '#fca5a5',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        lineHeight: 1.4,
        wordBreak: 'break-word',
        boxShadow: '0 0 10px rgba(255, 30, 39, 0.25)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
          <AlertTriangle size={15} color="#ff1e27" style={{ flexShrink: 0, marginTop: '1px' }} />
          <span style={{ fontWeight: 700, color: '#fff' }}>{friendly}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
          {onRetry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                border: '1px solid rgba(245, 158, 11, 0.6)',
                borderRadius: 0,
                color: '#ffffff',
                fontSize: '0.65rem',
                padding: '2px 8px',
                cursor: 'pointer',
                fontWeight: 700,
                transition: 'all 0.2s ease',
                boxShadow: '0 0 8px rgba(245, 158, 11, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
              title="Retry rendering this clip"
            >
              <RefreshCw size={11} />
              {t.studio.retryClipBtn || 'Retry'}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            style={{
              background: copied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
              border: `1px solid ${copied ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.15)'}`,
              borderRadius: 0,
              color: copied ? '#34d399' : '#e2e8f0',
              fontSize: '0.65rem',
              padding: '2px 7px',
              cursor: 'pointer',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}
            title="Copy full error details"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? (t.studio.copiedErrorBtn || 'Copied!') : (t.studio.copyErrorBtn || 'Copy')}
          </button>
        </div>
      </div>

      <details style={{ fontSize: '0.67rem', color: '#94a3b8', marginTop: '0.15rem' }}>
        <summary style={{ cursor: 'pointer', color: '#cbd5e1', userSelect: 'none', fontWeight: 500 }}>
          {t.studio.errorDetails || 'Technical Log Details'}
        </summary>
        <pre
          style={{
            margin: '0.35rem 0 0 0',
            padding: '0.4rem 0.55rem',
            background: 'rgba(0, 0, 0, 0.55)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '4px',
            color: '#f87171',
            fontSize: '0.65rem',
            fontFamily: 'Consolas, Monaco, monospace',
            whiteSpace: 'pre-wrap',
            maxHeight: '130px',
            overflowY: 'auto',
          }}
        >
          {errorMessage}
        </pre>
      </details>
    </div>
  );
};

export const STUDIO_PREFS_KEY = 'cheat_clip_studio_preferences';

export interface StudioPreferences {
  aspectRatio?: AspectRatioOption;
  backgroundStyle?: BackgroundStyle;
  enableFaceTracking?: boolean;
  manualCropX?: number;
  isManualCropX?: boolean;
  streamerPreset?: StreamerPreset;
  facecamPosition?: FacecamPosition;
  titlePosition?: TitlePosition;
  captionStyle?: CaptionStyle;
  captionFont?: CaptionFont;
  titleFont?: CaptionFont;
  fontSize?: FontSizeOption;
  fontSizePx?: number;
  titleFontSize?: FontSizeOption;
  titleFontSizePx?: number;
  textCase?: TextCaseOption;
  titleTextCase?: TextCaseOption;
  subtitlePositionMode?: SubtitlePositionMode;
  titleDuration?: TitleDurationOption;
  originalAudioVolume?: number;
  hardwareAccel?: HardwareAccelOption;
  titleYPercent?: number;
  titleXPercent?: number;
  subtitleYPercent?: number;
  subtitleOffsetSeconds?: number;
  subtitleCenterYPercent?: number;
  isCustomTitleY?: boolean;
  bgmVolume?: number;
  hookSfxVolume?: number;
  renderMode?: 'separate' | 'merged';
  fileNamePrefix?: string;
  fileNameSuffix?: string;
  titlePrefix?: string;
  titleSuffix?: string;
}

export const DEFAULT_STUDIO_PREFS: Required<StudioPreferences> = {
  aspectRatio: '9:16',
  backgroundStyle: 'black',
  enableFaceTracking: true,
  manualCropX: 50,
  isManualCropX: false,
  streamerPreset: 'none',
  facecamPosition: 'auto',
  titlePosition: 'auto',
  captionStyle: 'viral_pop',
  captionFont: 'Outfit',
  titleFont: 'Outfit',
  fontSize: 'medium',
  fontSizePx: 75,
  titleFontSize: 'medium',
  titleFontSizePx: 75,
  textCase: 'uppercase',
  titleTextCase: 'uppercase',
  subtitlePositionMode: 'bottom',
  titleDuration: 'entire',
  originalAudioVolume: 100,
  hardwareAccel: 'browser_wasm',
  titleYPercent: 17,
  titleXPercent: 50,
  subtitleYPercent: 21,
  subtitleOffsetSeconds: 0.0,
  subtitleCenterYPercent: 50,
  isCustomTitleY: false,
  bgmVolume: 25,
  hookSfxVolume: 100,
  renderMode: 'separate',
  fileNamePrefix: '',
  fileNameSuffix: '',
  titlePrefix: '',
  titleSuffix: '',
};

function getSavedStudioPreferences(): Partial<StudioPreferences> {
  try {
    const raw = localStorage.getItem(STUDIO_PREFS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<StudioPreferences>;
  } catch (e) {
    console.warn('Failed to parse studio preferences from localStorage:', e);
    return {};
  }
}

export const ClipStudioSection: React.FC<ClipStudioSectionProps> = ({
  videoUrl,
  videoId,
  allClips,
  markedClips,
  activeClip,
  onStartRender,
  isRendering,
  onToggleMarkClip,
  onToggleAllClips,
  batchProgress,
  onDismissProgress,
  onRetryClip,
  allowAppUpdates = false,
  onOpenCookiesModal,
  onBackToClips,
  transcript = [],
}) => {
  const { t } = useLanguage();
  const isYouTube = !videoId?.startsWith('upload_') && !videoId?.startsWith('gdrive_') && !videoId?.startsWith('twitch_') && !videoUrl?.includes('/api/video') && !videoUrl?.includes('twitch.tv');
  const isTwitch = Boolean(videoId?.startsWith('twitch_') || videoUrl?.includes('twitch.tv'));
  const [hasCookies, setHasCookies] = useState<boolean>(() => hasStoredCookies());

  useEffect(() => {
    const handleCookieChange = () => setHasCookies(hasStoredCookies());
    window.addEventListener('storage', handleCookieChange);
    window.addEventListener('cheatclip_cookies_updated', handleCookieChange);
    return () => {
      window.removeEventListener('storage', handleCookieChange);
      window.removeEventListener('cheatclip_cookies_updated', handleCookieChange);
    };
  }, []);

  // Directly reflect marked clips (supports selecting 0 clips)
  const [selectedClips, setSelectedClips] = useState<ViralClip[]>(markedClips);
  const [previewClipIndex, setPreviewClipIndex] = useState<number>(0);

  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>(() => getSavedStudioPreferences().aspectRatio ?? DEFAULT_STUDIO_PREFS.aspectRatio);
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>(() => getSavedStudioPreferences().backgroundStyle ?? DEFAULT_STUDIO_PREFS.backgroundStyle);
  const [enableFaceTracking, setEnableFaceTracking] = useState<boolean>(() => getSavedStudioPreferences().enableFaceTracking ?? DEFAULT_STUDIO_PREFS.enableFaceTracking);
  const [manualCropX, setManualCropX] = useState<number>(() => getSavedStudioPreferences().manualCropX ?? DEFAULT_STUDIO_PREFS.manualCropX);
  const [isManualCropX, setIsManualCropX] = useState<boolean>(() => getSavedStudioPreferences().isManualCropX ?? DEFAULT_STUDIO_PREFS.isManualCropX);
  const [streamerPreset, setStreamerPreset] = useState<StreamerPreset>(() => getSavedStudioPreferences().streamerPreset ?? DEFAULT_STUDIO_PREFS.streamerPreset);
  const [facecamPosition, setFacecamPosition] = useState<FacecamPosition>(() => getSavedStudioPreferences().facecamPosition ?? DEFAULT_STUDIO_PREFS.facecamPosition);
  const [titlePrefix, setTitlePrefix] = useState<string>(() => getSavedStudioPreferences().titlePrefix ?? DEFAULT_STUDIO_PREFS.titlePrefix);
  const [titleSuffix, setTitleSuffix] = useState<string>(() => getSavedStudioPreferences().titleSuffix ?? DEFAULT_STUDIO_PREFS.titleSuffix);
  const [customClipTitles, setCustomClipTitles] = useState<Record<string, string>>({});
  const [titlePosition, setTitlePosition] = useState<TitlePosition>(() => getSavedStudioPreferences().titlePosition ?? DEFAULT_STUDIO_PREFS.titlePosition);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(() => getSavedStudioPreferences().captionStyle ?? DEFAULT_STUDIO_PREFS.captionStyle);
  const [lastActiveCaptionStyle, setLastActiveCaptionStyle] = useState<CaptionStyle>(() => {
    const cap = getSavedStudioPreferences().captionStyle ?? DEFAULT_STUDIO_PREFS.captionStyle;
    return cap !== 'none' ? cap : 'viral_pop';
  });
  const [captionFont, setCaptionFont] = useState<CaptionFont>(() => getSavedStudioPreferences().captionFont ?? DEFAULT_STUDIO_PREFS.captionFont);
  const [titleFont, setTitleFont] = useState<CaptionFont>(() => getSavedStudioPreferences().titleFont ?? DEFAULT_STUDIO_PREFS.titleFont);
  const [fontSize, setFontSize] = useState<FontSizeOption>(() => getSavedStudioPreferences().fontSize ?? DEFAULT_STUDIO_PREFS.fontSize);
  const [fontSizePx, setFontSizePx] = useState<number>(() => getSavedStudioPreferences().fontSizePx ?? DEFAULT_STUDIO_PREFS.fontSizePx);
  const [titleFontSize, setTitleFontSize] = useState<FontSizeOption>(() => getSavedStudioPreferences().titleFontSize ?? DEFAULT_STUDIO_PREFS.titleFontSize);
  const [titleFontSizePx, setTitleFontSizePx] = useState<number>(() => getSavedStudioPreferences().titleFontSizePx ?? DEFAULT_STUDIO_PREFS.titleFontSizePx);
  const [textCase, setTextCase] = useState<TextCaseOption>(() => getSavedStudioPreferences().textCase ?? DEFAULT_STUDIO_PREFS.textCase);
  const [titleTextCase, setTitleTextCase] = useState<TextCaseOption>(() => getSavedStudioPreferences().titleTextCase ?? DEFAULT_STUDIO_PREFS.titleTextCase);

  // Multi-Segment Merged Render Mode
  const [renderMode, setRenderMode] = useState<'separate' | 'merged'>(() => getSavedStudioPreferences().renderMode ?? DEFAULT_STUDIO_PREFS.renderMode);
  const [compilationTitle, setCompilationTitle] = useState<string>('');

  // Custom Font Library State
  const [availableFonts, setAvailableFonts] = useState<FontItem[]>([
    { name: 'Outfit', is_custom: false },
    { name: 'Montserrat', is_custom: false },
    { name: 'Inter', is_custom: false },
    { name: 'Impact', is_custom: false },
    { name: 'Bebas Neue', is_custom: false },
    { name: 'Anton', is_custom: false },
    { name: 'Poppins', is_custom: false },
    { name: 'Arial Black', is_custom: false },
  ]);
  const [isUploadingFont, setIsUploadingFont] = useState<boolean>(false);
  const [isTitleFontDragging, setIsTitleFontDragging] = useState<boolean>(false);
  const [isSubFontDragging, setIsSubFontDragging] = useState<boolean>(false);
  const titleFontInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleFontInputRef = useRef<HTMLInputElement | null>(null);
  const [fileNamePrefix, setFileNamePrefix] = useState<string>(() => getSavedStudioPreferences().fileNamePrefix ?? DEFAULT_STUDIO_PREFS.fileNamePrefix);
  const [fileNameSuffix, setFileNameSuffix] = useState<string>(() => getSavedStudioPreferences().fileNameSuffix ?? DEFAULT_STUDIO_PREFS.fileNameSuffix);

  // Manual Up/Down positioning for All Formats
  const [titleYPercent, setTitleYPercent] = useState<number>(() => getSavedStudioPreferences().titleYPercent ?? DEFAULT_STUDIO_PREFS.titleYPercent);
  const [titleXPercent, setTitleXPercent] = useState<number>(() => getSavedStudioPreferences().titleXPercent ?? DEFAULT_STUDIO_PREFS.titleXPercent);
  const [subtitleYPercent, setSubtitleYPercent] = useState<number>(() => getSavedStudioPreferences().subtitleYPercent ?? DEFAULT_STUDIO_PREFS.subtitleYPercent);
  const [subtitleOffsetSeconds, setSubtitleOffsetSeconds] = useState<number>(() => getSavedStudioPreferences().subtitleOffsetSeconds ?? DEFAULT_STUDIO_PREFS.subtitleOffsetSeconds);
  const [subtitlePositionMode, setSubtitlePositionMode] = useState<SubtitlePositionMode>(() => getSavedStudioPreferences().subtitlePositionMode ?? DEFAULT_STUDIO_PREFS.subtitlePositionMode);
  const [subtitleCenterYPercent, setSubtitleCenterYPercent] = useState<number>(() => getSavedStudioPreferences().subtitleCenterYPercent ?? DEFAULT_STUDIO_PREFS.subtitleCenterYPercent);
  const [isCustomTitleY, setIsCustomTitleY] = useState<boolean>(() => getSavedStudioPreferences().isCustomTitleY ?? DEFAULT_STUDIO_PREFS.isCustomTitleY);
  const [titleDuration, setTitleDuration] = useState<TitleDurationOption>(() => getSavedStudioPreferences().titleDuration ?? DEFAULT_STUDIO_PREFS.titleDuration);
  const [isClearingTemp, setIsClearingTemp] = useState<boolean>(false);
  const [tempClearMsg, setTempClearMsg] = useState<string>('');
  const [showClearConfirmModal, setShowClearConfirmModal] = useState<boolean>(false);

  // Original Voice Audio Boost (0% - 200%, default 100%)
  const [originalAudioVolume, setOriginalAudioVolume] = useState<number>(() => getSavedStudioPreferences().originalAudioVolume ?? DEFAULT_STUDIO_PREFS.originalAudioVolume);

  // Background Music (BGM) state
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(false);
  const [bgmFileName, setBgmFileName] = useState<string>('');
  const [bgmFilePath, setBgmFilePath] = useState<string>('');
  const [bgmAudioUrl, setBgmAudioUrl] = useState<string>('');
  const [bgmVolume, setBgmVolume] = useState<number>(() => getSavedStudioPreferences().bgmVolume ?? DEFAULT_STUDIO_PREFS.bgmVolume);
  const [bgmDuration, setBgmDuration] = useState<number>(0);
  const [bgmStartOffset, setBgmStartOffset] = useState<number>(0);
  const [isBgmPlaying, setIsBgmPlaying] = useState<boolean>(false);
  const [isUploadingBgm, setIsUploadingBgm] = useState<boolean>(false);
  const [isBgmDragging, setIsBgmDragging] = useState<boolean>(false);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);

  // Hook Sound Effect (SFX) state
  const [hookSfxFileName, setHookSfxFileName] = useState<string>('');
  const [hookSfxFilePath, setHookSfxFilePath] = useState<string>('');
  const [hookSfxAudioUrl, setHookSfxAudioUrl] = useState<string>('');
  const [hookSfxVolume, setHookSfxVolume] = useState<number>(() => getSavedStudioPreferences().hookSfxVolume ?? DEFAULT_STUDIO_PREFS.hookSfxVolume);
  const [isHookSfxPlaying, setIsHookSfxPlaying] = useState<boolean>(false);
  const [isUploadingHookSfx, setIsUploadingHookSfx] = useState<boolean>(false);
  const [isHookSfxDragging, setIsHookSfxDragging] = useState<boolean>(false);
  const hookSfxAudioRef = useRef<HTMLAudioElement | null>(null);

  // Watermark state & default configs
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(false);
  const [watermarkType, setWatermarkType] = useState<'image' | 'text'>('image');
  const [watermarkImageFileName, setWatermarkImageFileName] = useState<string>('');
  const [watermarkImageFilePath, setWatermarkImageFilePath] = useState<string>('');
  const [watermarkImageUrl, setWatermarkImageUrl] = useState<string>('');
  const [watermarkText, setWatermarkText] = useState<string>('');
  const [watermarkSize, setWatermarkSize] = useState<number>(20);
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(80);
  const [watermarkX, setWatermarkX] = useState<number>(88);
  const [watermarkY, setWatermarkY] = useState<number>(8);
  const [isUploadingWatermark, setIsUploadingWatermark] = useState<boolean>(false);
  const [isWatermarkDragging, setIsWatermarkDragging] = useState<boolean>(false);
  const phoneContainerRef = useRef<HTMLDivElement | null>(null);

  const [isLocalhost] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hostname;
      return h === 'localhost' || h === '127.0.0.1';
    }
    return false;
  });

  const [clientGpuName, setClientGpuName] = useState<string>(() => getClientGpuName());
  const [hasWebCodecs] = useState<boolean>(() => isWebCodecsGpuSupported());

  // Hardware acceleration / Video Encoder state:
  // - On Mobile: default to 'auto' (Server Render) to avoid mobile OOM / tab crashes.
  // - On Desktop (deployed): default to 'client_gpu' / 'browser_wasm' to use user's local GPU/CPU and avoid burdening the server.
  // - On Desktop (localhost): default to 'auto'.
  const [hardwareAccel, setHardwareAccel] = useState<HardwareAccelOption>(() => {
    if (isMobileDevice()) {
      return 'auto';
    }
    const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if (!isLocal) {
      return isWebCodecsGpuSupported() ? 'client_gpu' : 'browser_wasm';
    }
    const saved = getSavedStudioPreferences().hardwareAccel;
    return (saved && saved !== 'browser_wasm') ? saved : 'auto';
  });
  const [hardwareInfo, setHardwareInfo] = useState<HardwareAccelInfo | null>(null);
  const [hwDropdownOpen, setHwDropdownOpen] = useState<boolean>(false);

  useEffect(() => {
    const fetchHardwareSupport = async () => {
      try {
        const res = await resilientFetch('/api/hardware-accel', { maxRetries: 4, retryDelay: 1000, silent: true });
        if (res.ok) {
          const data: HardwareAccelInfo = await res.json();
          setHardwareInfo(data);
          if (data.gpu_name) {
            setClientGpuName(data.gpu_name);
          }
        }
      } catch {
        // Backend offline or loading
      }
    };

    if (isMobileDevice()) {
      // Mobile devices always use Server Engine (FFmpeg) to prevent mobile browser crash / OOM
      setHardwareAccel('auto');
      fetchHardwareSupport();
      return;
    }

    if (!isLocalhost) {
      // On deployed domain for desktop users, use client engine (prefer client_gpu) to spare server
      setHardwareAccel(isWebCodecsGpuSupported() ? 'client_gpu' : 'browser_wasm');
      return;
    }
    fetchHardwareSupport();
  }, []);

  const loadCustomFontFace = (name: string, url: string) => {
    try {
      // Isolate custom font face name or specify descriptors so it does not overwrite global UI font definitions (e.g. 'Inter' 400)
      const isSystemUiFont = ['inter', 'outfit', 'jetbrains mono', 'roboto', 'segoe ui'].includes(name.trim().toLowerCase());
      const familyName = isSystemUiFont ? `Preview-${name}` : name;
      const font = new FontFace(familyName, `url(${url})`);
      font.load().then(loaded => {
        (document.fonts as Set<FontFace>).add(loaded);
      }).catch(err => console.warn(`Font '${name}' load error:`, err));
    } catch (e) {
      console.warn('FontFace API error:', e);
    }
  };

  useEffect(() => {
    const fetchAvailableFonts = async () => {
      try {
        const res = await resilientFetch('/api/fonts', { maxRetries: 3, retryDelay: 1000, silent: true });
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.fonts)) {
            setAvailableFonts(data.fonts);
            data.fonts.forEach((f: FontItem) => {
              if (f.url) loadCustomFontFace(f.name, f.url);
            });
          }
        }
      } catch {
        // Fallback to built-in fonts
      }
    };
    fetchAvailableFonts();
  }, []);

  const handleUploadFont = async (file: File, target: 'title' | 'subtitle') => {
    if (!file) return;
    setIsUploadingFont(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await resilientFetch('/api/upload-font', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.font_name) {
        if (data.url) loadCustomFontFace(data.font_name, data.url);
        setAvailableFonts(prev => {
          if (!prev.some(f => f.name.toLowerCase() === data.font_name.toLowerCase())) {
            return [...prev, { name: data.font_name, is_custom: true, filename: data.filename, url: data.url }];
          }
          return prev;
        });
        if (target === 'title') {
          setTitleFont(data.font_name);
        } else {
          setCaptionFont(data.font_name);
        }
      }
    } catch (err) {
      console.error('Failed to upload custom font:', err);
    } finally {
      setIsUploadingFont(false);
    }
  };

  // Playable video player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [playerReady, setPlayerReady] = useState<boolean>(false);

  // Face & object detection tracking state
  const [faceBox, setFaceBox] = useState<{ cx: number; cy: number; w: number; h: number; found: boolean; type?: string }>({
    cx: 0.5,
    cy: 0.35,
    w: 0.25,
    h: 0.25,
    found: false,
  });

  const previewPlayerRef = useRef<any>(null);
  const directVideoRef = useRef<HTMLVideoElement | null>(null);
  const ambientVideoRef = useRef<HTMLVideoElement | null>(null);
  const trackingTimerRef = useRef<number | null>(null);

  // Keep selectedClips in sync if markedClips updates from outside (including 0 clips)
  useEffect(() => {
    setSelectedClips(markedClips);
  }, [markedClips]);

  // Sync active clip from external selection into preview
  useEffect(() => {
    if (activeClip) {
      const idx = allClips.findIndex(
        c => c.start_time === activeClip.start_time && c.end_time === activeClip.end_time
      );
      if (idx !== -1) {
        setPreviewClipIndex(idx);
      }
    }
  }, [activeClip, allClips]);

  const currentPreviewClip = allClips[previewClipIndex] || allClips[0] || null;
  const clipStart = currentPreviewClip ? currentPreviewClip.start_time : 0;
  const clipEnd = currentPreviewClip ? currentPreviewClip.end_time : 60;
  const clipDuration = Math.max(1, clipEnd - clipStart);

  // Precompute and partition caption words/chunks for currentPreviewClip
  const captionChunks = useMemo<CaptionChunk[]>(() => {
    if (!currentPreviewClip) return [];
    const clipStart = currentPreviewClip.start_time;
    const clipEnd = currentPreviewClip.end_time;

    const allWords: CaptionWord[] = [];

    // 1. Primary: Extract from timestamped transcript lines
    if (transcript && transcript.length > 0) {
      const relevantLines = transcript.filter(line => {
        const lStart = line.start;
        const lEnd = (typeof line.end === 'number' && line.end > lStart) ? line.end : (lStart + ((line as any).duration || 2.0));
        return lEnd >= clipStart - 0.5 && lStart <= clipEnd + 0.5;
      });

      for (const line of relevantLines) {
        const cleaned = cleanCaptionText(line.text || '');
        if (!cleaned) continue;
        const lStart = line.start;
        const lEnd = (typeof line.end === 'number' && line.end > lStart) ? line.end : (lStart + ((line as any).duration || 2.0));
        const tokens = cleaned.split(/\s+/).filter(Boolean);
        if (!tokens.length) continue;

        // Natural speech duration calibration:
        // Respect the actual sentence duration unless trailing silence is detected
        const rawLineDur = Math.max(0.4, lEnd - lStart);
        const maxPlausibleDur = tokens.length * 0.52 + 0.25;
        const spokenDuration = Math.min(rawLineDur, maxPlausibleDur);

        const tokenWeights = tokens.map(t => Math.max(2, t.replace(/[^a-zA-Z0-9]/g, '').length || t.length));
        const totalWeight = tokenWeights.reduce((a, b) => a + b, 0);

        let curTime = lStart;
        tokens.forEach((tok, idx) => {
          const ratio = tokenWeights[idx] / Math.max(1, totalWeight);
          const wDur = Math.max(0.14, Math.min(0.60, spokenDuration * ratio));
          const wStart = curTime;
          const wEnd = wStart + wDur;
          curTime = wEnd;

          allWords.push({
            text: tok,
            start: wStart,
            end: wEnd,
          });
        });
      }
    }

    // 2. Fallback: If no transcript lines found, use currentPreviewClip.transcript (string)
    if (allWords.length === 0 && currentPreviewClip.transcript) {
      const cleaned = cleanCaptionText(currentPreviewClip.transcript);
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const duration = Math.max(1, clipEnd - clipStart);
        const maxPlausibleDur = tokens.length * 0.52 + 0.25;
        const spokenDuration = Math.min(duration, maxPlausibleDur);
        const tokenWeights = tokens.map(t => Math.max(2, t.replace(/[^a-zA-Z0-9]/g, '').length || t.length));
        const totalWeight = tokenWeights.reduce((a, b) => a + b, 0);

        let curTime = clipStart;
        tokens.forEach((tok, idx) => {
          const ratio = tokenWeights[idx] / Math.max(1, totalWeight);
          const wDur = Math.max(0.14, Math.min(0.60, spokenDuration * ratio));
          const wStart = curTime;
          const wEnd = wStart + wDur;
          curTime = wEnd;

          allWords.push({
            text: tok,
            start: wStart,
            end: wEnd,
          });
        });
      }
    }

    if (allWords.length === 0) return [];

    // Group words into punchy chunks of 1 to 3 words (max 18 chars), splitting on punctuation or pauses >= 0.28s
    const chunks: CaptionChunk[] = [];
    let currentWords: CaptionWord[] = [];
    let currentChars = 0;

    for (const w of allWords) {
      const wLen = w.text.length;
      const hasPause = currentWords.length > 0 && (w.start - currentWords[currentWords.length - 1].end >= 0.28);
      const endsSentence = currentWords.length > 0 && /[.?!,]$/.test(currentWords[currentWords.length - 1].text);

      if (currentWords.length >= 3 || hasPause || endsSentence || (currentWords.length > 0 && currentChars + wLen > 18)) {
        chunks.push({
          words: currentWords,
          start: currentWords[0].start,
          end: currentWords[currentWords.length - 1].end,
        });
        currentWords = [w];
        currentChars = wLen;
      } else {
        currentWords.push(w);
        currentChars += wLen + 1;
      }
    }
    if (currentWords.length > 0) {
      chunks.push({
        words: currentWords,
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
      });
    }

    return chunks;
  }, [transcript, currentPreviewClip]);

  // Compute active chunk and word index for currentTime with user-adjustable sync offset
  const activeCaption = useMemo(() => {
    if (!captionChunks.length) return null;

    // Apply user-adjustable sync offset: positive means captions appear later; negative means earlier
    const playhead = currentTime - subtitleOffsetSeconds;

    const activeChunk = captionChunks.find(c => playhead >= (c.start - 0.06) && playhead <= (c.end + 0.25));
    if (activeChunk) {
      const activeIdx = activeChunk.words.findIndex(w => playhead >= w.start && playhead <= w.end);
      const wordIndex = activeIdx !== -1 ? activeIdx : (playhead > activeChunk.words[activeChunk.words.length - 1].end ? activeChunk.words.length - 1 : 0);
      return { chunk: activeChunk, activeWordIndex: wordIndex };
    }

    // When paused outside active speech, find closest chunk
    if (!isPlaying) {
      let closest: CaptionChunk | null = null;
      let minDiff = Infinity;
      for (const c of captionChunks) {
        const diff = Math.min(Math.abs(playhead - c.start), Math.abs(playhead - c.end));
        if (diff < minDiff) {
          minDiff = diff;
          closest = c;
        }
      }
      if (closest && minDiff < 2.0) {
        const wordIndex = playhead >= closest.end ? closest.words.length - 1 : 0;
        return { chunk: closest, activeWordIndex: wordIndex };
      }
    }

    return null;
  }, [captionChunks, currentTime, subtitleOffsetSeconds, isPlaying]);



  // Fetch face/object detection coordinates
  useEffect(() => {
    if (!videoId) return;
    let isMounted = true;
    const fetchFace = async () => {
      try {
        // For local uploaded files (blob: URL or upload_ ID), run client-side detection directly
        if (videoUrl?.startsWith('blob:') || videoId.startsWith('upload_')) {
          const clientBox = await detectFaceClientSide(directVideoRef.current, facecamPosition, streamerPreset);
          if (clientBox && isMounted) {
            setFaceBox(clientBox);
            return;
          }
        }

        const userCookies = getStoredCookies();
        const cookiesParam = userCookies ? `&cookies=${encodeURIComponent(userCookies)}` : '';
        const res = await fetch(`/api/detect-face?video_id=${encodeURIComponent(videoId)}&timestamp=${clipStart}&video_url=${encodeURIComponent(videoUrl || '')}&facecam_position=${encodeURIComponent(facecamPosition)}&streamer_preset=${encodeURIComponent(streamerPreset)}${cookiesParam}`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data && typeof data.cx === 'number') {
            setFaceBox(data);
          }
        }
      } catch (err) {
        console.warn('Face detection fetch failed:', err);
      }
    };
    fetchFace();
    return () => { isMounted = false; };
  }, [videoId, previewClipIndex, clipStart, videoUrl, facecamPosition, streamerPreset]);

  // Calculate horizontal crop percentage (0 = leftmost edge, 50 = center, 100 = rightmost edge)
  const previewCropPercent = useMemo(() => {
    if (isManualCropX) {
      return Math.max(0, Math.min(100, Math.round(manualCropX)));
    }
    if (!enableFaceTracking || streamerPreset !== 'none') {
      return 50;
    }
    if (facecamPosition === 'left') return 28;
    if (facecamPosition === 'right') return 72;
    if (facecamPosition === 'center') return 50;
    if (faceBox && faceBox.found && typeof faceBox.cx === 'number') {
      let safeCx = faceBox.cx;
      if (0.46 <= safeCx && safeCx <= 0.54) {
        safeCx = 0.50;
      }
      safeCx = Math.max(0.15, Math.min(0.85, safeCx));
      if (aspectRatio === '9:16') {
        const cropRatio = Math.max(0.0, Math.min(1.0, (safeCx - 0.158) / 0.684));
        return Math.round(cropRatio * 100);
      } else if (aspectRatio === '1:1') {
        const cropRatio = Math.max(0.0, Math.min(1.0, (safeCx - 0.281) / 0.438));
        return Math.round(cropRatio * 100);
      } else if (aspectRatio === '4:3') {
        const cropRatio = Math.max(0.0, Math.min(1.0, (safeCx - 0.375) / 0.25));
        return Math.round(cropRatio * 100);
      } else {
        return Math.round(safeCx * 100);
      }
    }
    return 50;
  }, [isManualCropX, manualCropX, enableFaceTracking, aspectRatio, streamerPreset, facecamPosition, faceBox]);

  // Helper duration formatter
  const formatDuration = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const remS = s % 60;
    return `${m}:${remS < 10 ? '0' : ''}${remS}`;
  };

  // Initialize YouTube player or HTML5 direct video
  const initPreviewPlayer = () => {
    if (!videoId && !videoUrl) return;

    const isDirect = Boolean(videoUrl && (videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.endsWith('.mov') || videoUrl.endsWith('.mkv') || videoUrl.includes('/api/video') || videoUrl.startsWith('blob:') || videoId?.startsWith('upload_') || videoId?.startsWith('gdrive_')));
    if (isDirect) {
      setPlayerReady(true);
      setCurrentTime(clipStart);
      return;
    }

    if (isTwitch) {
      if ((window as any).Twitch && (window as any).Twitch.Player) {
        const container = document.getElementById('studio-preview-twitch-container');
        if (!container) return;

        if (previewPlayerRef.current) {
          try {
            previewPlayerRef.current = null;
          } catch (e) {}
        }

        container.innerHTML = '<div id="studio-twitch-iframe-slot"></div>';

        const isClip = videoId?.startsWith('twitch_clip_');
        const rawId = isClip ? videoId.replace('twitch_clip_', '') : (videoId?.replace('twitch_', '') || '');

        try {
          const opts: any = {
            width: '100%',
            height: '100%',
            autoplay: false,
            parent: [window.location.hostname || 'localhost', 'localhost', '127.0.0.1']
          };
          if (isClip) opts.clip = rawId; else opts.video = rawId;
          const player = new (window as any).Twitch.Player('studio-twitch-iframe-slot', opts);
          previewPlayerRef.current = player;

          player.addEventListener((window as any).Twitch.Player.READY, () => {
            setPlayerReady(true);
            try {
              player.setMuted(true);
              setIsMuted(true);
              player.seek(clipStart);
              setCurrentTime(clipStart);
            } catch (e) {}
          });

          player.addEventListener((window as any).Twitch.Player.PLAY, () => {
            setIsPlaying(true);
            startTracking();
          });

          player.addEventListener((window as any).Twitch.Player.PAUSE, () => {
            setIsPlaying(false);
            stopTracking();
            if (isLooping && currentPreviewClip) {
              try {
                player.seek(clipStart);
                player.play();
              } catch (e) {}
            }
          });
        } catch (err) {
          console.error('Error instantiating Twitch studio player:', err);
        }
      } else {
        setTimeout(initPreviewPlayer, 250);
      }
      return;
    }

    if (window.YT && window.YT.Player) {
      const container = document.getElementById('studio-preview-yt-container');
      if (!container) return;

      if (previewPlayerRef.current) {
        try {
          previewPlayerRef.current.destroy();
        } catch (e) {}
        previewPlayerRef.current = null;
      }

      container.innerHTML = '<div id="studio-yt-iframe-slot"></div>';

      try {
        const startSec = Math.floor(clipStart);
        previewPlayerRef.current = new window.YT.Player('studio-yt-iframe-slot', {
          videoId: videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            enablejsapi: 1,
            iv_load_policy: 3,
            cc_load_policy: 0,
            autohide: 1,
            start: startSec,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              setPlayerReady(true);
              try {
                event.target.mute();
                setIsMuted(true);
                if (typeof event.target.unloadModule === 'function') {
                  event.target.unloadModule('captions');
                  event.target.unloadModule('cc');
                }
                event.target.seekTo(clipStart, true);
                setCurrentTime(clipStart);
              } catch (e) {}
            },
            onStateChange: (event: any) => {
              if (event.data === 1) {
                // PLAYING
                setIsPlaying(true);
                startTracking();
              } else {
                setIsPlaying(false);
                stopTracking();
                if (event.data === 0 && isLooping && currentPreviewClip) {
                  try {
                    previewPlayerRef.current.seekTo(clipStart, true);
                    previewPlayerRef.current.playVideo();
                  } catch (e) {}
                }
              }
            },
          },
        });
      } catch (err) {
        console.error('Error instantiating studio player:', err);
      }
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.body.appendChild(tag);
      }
      setTimeout(initPreviewPlayer, 300);
    }
  };

  const startTracking = () => {
    stopTracking();
    trackingTimerRef.current = window.setInterval(() => {
      try {
        if (previewPlayerRef.current && typeof previewPlayerRef.current.getCurrentTime === 'function') {
          const iframe = document.getElementById('studio-yt-iframe-slot');
          if (iframe && iframe.parentElement) {
            const t = previewPlayerRef.current.getCurrentTime();
            if (typeof t === 'number' && !isNaN(t)) {
              setCurrentTime(t);
              if (currentPreviewClip && t >= currentPreviewClip.end_time) {
                if (isLooping) {
                  if (typeof previewPlayerRef.current.seek === 'function') {
                    previewPlayerRef.current.seek(currentPreviewClip.start_time);
                  } else if (typeof previewPlayerRef.current.seekTo === 'function') {
                    previewPlayerRef.current.seekTo(currentPreviewClip.start_time, true);
                  }
                } else {
                  if (typeof previewPlayerRef.current.pause === 'function') {
                    previewPlayerRef.current.pause();
                  } else if (typeof previewPlayerRef.current.pauseVideo === 'function') {
                    previewPlayerRef.current.pauseVideo();
                  }
                }
              }
            }
          }
        } else if (directVideoRef.current) {
          const t = directVideoRef.current.currentTime;
          if (typeof t === 'number' && !isNaN(t)) {
            setCurrentTime(t);
            if (ambientVideoRef.current && Math.abs(ambientVideoRef.current.currentTime - t) > 0.3) {
              ambientVideoRef.current.currentTime = t;
            }
            if (currentPreviewClip && t >= currentPreviewClip.end_time) {
              if (isLooping) {
                directVideoRef.current.currentTime = currentPreviewClip.start_time;
                if (ambientVideoRef.current) ambientVideoRef.current.currentTime = currentPreviewClip.start_time;
              } else {
                directVideoRef.current.pause();
                if (ambientVideoRef.current) ambientVideoRef.current.pause();
                setIsPlaying(false);
              }
            }
          }
        }
      } catch (e) {}
    }, 75);
  };

  const stopTracking = () => {
    if (trackingTimerRef.current !== null) {
      clearInterval(trackingTimerRef.current);
      trackingTimerRef.current = null;
    }
  };

  useEffect(() => {
    initPreviewPlayer();
    return () => {
      stopTracking();
      if (previewPlayerRef.current) {
        try {
          previewPlayerRef.current.destroy();
        } catch (e) {}
        previewPlayerRef.current = null;
      }
    };
  }, [videoId, previewClipIndex]);

  // When previewClipIndex changes, seek player to new clip start
  useEffect(() => {
    setCurrentTime(clipStart);
    if (previewPlayerRef.current && typeof previewPlayerRef.current.seekTo === 'function') {
      try {
        previewPlayerRef.current.seekTo(clipStart, true);
      } catch (e) {}
    } else if (directVideoRef.current) {
      directVideoRef.current.currentTime = clipStart;
      if (ambientVideoRef.current) ambientVideoRef.current.currentTime = clipStart;
    }
  }, [previewClipIndex, clipStart]);

  const togglePlayPause = () => {
    if (previewPlayerRef.current) {
      try {
        if (typeof previewPlayerRef.current.play === 'function') {
          if (isPlaying) {
            previewPlayerRef.current.pause();
          } else {
            if (currentPreviewClip && (currentTime >= currentPreviewClip.end_time || currentTime < currentPreviewClip.start_time)) {
              previewPlayerRef.current.seek(currentPreviewClip.start_time);
            }
            previewPlayerRef.current.play();
          }
        } else if (isPlaying) {
          previewPlayerRef.current.pauseVideo();
        } else {
          if (currentPreviewClip && (currentTime >= currentPreviewClip.end_time || currentTime < currentPreviewClip.start_time)) {
            previewPlayerRef.current.seekTo(currentPreviewClip.start_time, true);
          }
          previewPlayerRef.current.playVideo();
        }
      } catch (e) {}
    } else if (directVideoRef.current) {
      if (isPlaying) {
        directVideoRef.current.pause();
        if (ambientVideoRef.current) ambientVideoRef.current.pause();
        setIsPlaying(false);
      } else {
        if (currentPreviewClip && (currentTime >= currentPreviewClip.end_time || currentTime < currentPreviewClip.start_time)) {
          directVideoRef.current.currentTime = currentPreviewClip.start_time;
          if (ambientVideoRef.current) ambientVideoRef.current.currentTime = currentPreviewClip.start_time;
        }
        directVideoRef.current.play();
        if (ambientVideoRef.current) ambientVideoRef.current.play().catch(() => {});
        setIsPlaying(true);
        startTracking();
      }
    }
  };

  const handleSeek = (newTime: number) => {
    setCurrentTime(newTime);
    if (previewPlayerRef.current) {
      try {
        if (typeof previewPlayerRef.current.seek === 'function') {
          previewPlayerRef.current.seek(newTime);
        } else if (typeof previewPlayerRef.current.seekTo === 'function') {
          previewPlayerRef.current.seekTo(newTime, true);
        }
      } catch (e) {}
    } else if (directVideoRef.current) {
      directVideoRef.current.currentTime = newTime;
      if (ambientVideoRef.current) ambientVideoRef.current.currentTime = newTime;
    }
  };

  const handleRestart = () => {
    setCurrentTime(clipStart);
    if (previewPlayerRef.current) {
      try {
        if (typeof previewPlayerRef.current.seek === 'function') {
          previewPlayerRef.current.seek(clipStart);
          previewPlayerRef.current.play();
        } else if (typeof previewPlayerRef.current.seekTo === 'function') {
          previewPlayerRef.current.seekTo(clipStart, true);
          previewPlayerRef.current.playVideo();
        }
      } catch (e) {}
    } else if (directVideoRef.current) {
      directVideoRef.current.currentTime = clipStart;
      directVideoRef.current.play();
      setIsPlaying(true);
      startTracking();
    }
  };

  const toggleMute = () => {
    if (previewPlayerRef.current) {
      try {
        if (typeof previewPlayerRef.current.setMuted === 'function') {
          previewPlayerRef.current.setMuted(!isMuted);
          setIsMuted(!isMuted);
        } else if (isMuted) {
          previewPlayerRef.current.unMute();
          setIsMuted(false);
        } else {
          previewPlayerRef.current.mute();
          setIsMuted(true);
        }
      } catch (e) {}
    } else if (directVideoRef.current) {
      directVideoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleClip = (clip: ViralClip) => {
    if (onToggleMarkClip) {
      onToggleMarkClip(clip);
    }
    const exists = selectedClips.some(
      c => c.start_time === clip.start_time && c.end_time === clip.end_time
    );
    if (exists) {
      setSelectedClips(
        selectedClips.filter(c => !(c.start_time === clip.start_time && c.end_time === clip.end_time))
      );
    } else {
      setSelectedClips([...selectedClips, clip]);
    }
  };

  const handleToggleAllClips = () => {
    const isAllSelected = allClips.length > 0 && selectedClips.length === allClips.length;
    if (onToggleAllClips) {
      onToggleAllClips(!isAllSelected);
    } else {
      if (isAllSelected) {
        setSelectedClips([]);
      } else {
        setSelectedClips([...allClips]);
      }
    }
  };

  const handleMoveClipUp = (index: number) => {
    if (index <= 0) return;
    setSelectedClips(prev => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleMoveClipDown = (index: number) => {
    if (index >= selectedClips.length - 1) return;
    setSelectedClips(prev => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const totalSelectedDuration = useMemo(() => {
    return Math.round(selectedClips.reduce((acc, c) => acc + (c.end_time - c.start_time), 0));
  }, [selectedClips]);

  const handleClearTempClick = () => {
    setShowClearConfirmModal(true);
  };

  const executeClearTemp = async () => {
    if (isClearingTemp) return;
    setIsClearingTemp(true);
    setTempClearMsg('');
    try {
      const resp = await fetch('/api/clear-temp', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        setTempClearMsg(`✓ ${data.message || 'Temp folder cleared!'}`);
        setTimeout(() => setTempClearMsg(''), 4500);
      } else {
        setTempClearMsg('Failed to clear temp cache');
      }
    } catch (e) {
      console.error('Error clearing temp cache:', e);
      setTempClearMsg('Error clearing temp cache');
    } finally {
      setIsClearingTemp(false);
      setShowClearConfirmModal(false);
    }
  };

  // Background Music handlers
  const uploadBgmFile = async (file: File) => {
    if (!file) return;
    setIsUploadingBgm(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-bgm', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to upload background music');
      }
      const data = await res.json();
      setBgmFileName(data.filename || file.name);
      setBgmFilePath(data.file_path);
      setBgmAudioUrl(data.url);
      setBgmEnabled(true);
    } catch (err) {
      console.error('BGM upload error:', err);
      alert('Failed to upload background music file. Please try an MP3, WAV, or M4A file.');
    } finally {
      setIsUploadingBgm(false);
    }
  };

  const handleBgmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadBgmFile(file);
    e.target.value = '';
  };

  const handleBgmLoadedMetadata = () => {
    if (bgmAudioRef.current) {
      const dur = bgmAudioRef.current.duration;
      if (dur && !isNaN(dur)) {
        setBgmDuration(dur);
      }
    }
  };

  const handleBgmStartOffsetChange = (newOffset: number) => {
    setBgmStartOffset(newOffset);
    if (bgmAudioRef.current) {
      bgmAudioRef.current.currentTime = newOffset;
    }
  };

  const handleRemoveBgm = () => {
    if (bgmAudioRef.current) {
      bgmAudioRef.current.pause();
    }
    setIsBgmPlaying(false);
    setBgmEnabled(false);
    setBgmFileName('');
    setBgmFilePath('');
    setBgmAudioUrl('');
    setBgmDuration(0);
    setBgmStartOffset(0);
  };

  const toggleBgmPlayback = () => {
    if (!bgmAudioRef.current) return;
    if (isBgmPlaying) {
      bgmAudioRef.current.pause();
      setIsBgmPlaying(false);
    } else {
      bgmAudioRef.current.currentTime = bgmStartOffset;
      bgmAudioRef.current.volume = Math.max(0, Math.min(1, bgmVolume / 100));
      bgmAudioRef.current.play().then(() => setIsBgmPlaying(true)).catch(console.error);
    }
  };

  useEffect(() => {
    if (bgmAudioRef.current) {
      bgmAudioRef.current.volume = Math.max(0, Math.min(1, bgmVolume / 100));
    }
  }, [bgmVolume]);

  // Hook SFX handlers
  const uploadHookSfxFile = async (file: File) => {
    if (!file) return;
    setIsUploadingHookSfx(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-sfx', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to upload hook sound effect');
      }
      const data = await res.json();
      setHookSfxFileName(data.filename || file.name);
      setHookSfxFilePath(data.file_path);
      setHookSfxAudioUrl(data.url);
    } catch (err) {
      console.error('SFX upload error:', err);
      alert('Failed to upload sound effect file. Please try an MP3, WAV, or M4A file.');
    } finally {
      setIsUploadingHookSfx(false);
    }
  };

  const handleHookSfxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadHookSfxFile(file);
    e.target.value = '';
  };

  const handleRemoveHookSfx = () => {
    if (hookSfxAudioRef.current) {
      hookSfxAudioRef.current.pause();
    }
    setIsHookSfxPlaying(false);
    setHookSfxFileName('');
    setHookSfxFilePath('');
    setHookSfxAudioUrl('');
  };

  const toggleHookSfxPlayback = () => {
    if (!hookSfxAudioRef.current) return;
    if (isHookSfxPlaying) {
      hookSfxAudioRef.current.pause();
      setIsHookSfxPlaying(false);
    } else {
      hookSfxAudioRef.current.currentTime = 0;
      hookSfxAudioRef.current.volume = Math.max(0, Math.min(1, hookSfxVolume / 100));
      hookSfxAudioRef.current.play().then(() => setIsHookSfxPlaying(true)).catch(console.error);
    }
  };

  useEffect(() => {
    if (hookSfxAudioRef.current) {
      hookSfxAudioRef.current.volume = Math.max(0, Math.min(1, hookSfxVolume / 100));
    }
  }, [hookSfxVolume]);

  // Watermark handlers
  const uploadWatermarkFile = async (file: File) => {
    if (!file) return;
    setIsUploadingWatermark(true);
    let localUrl = '';
    try {
      localUrl = URL.createObjectURL(file);
      setWatermarkImageUrl(localUrl);
      setWatermarkImageFileName(file.name);

      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload-watermark', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to upload watermark');
      }
      const data = await res.json();
      setWatermarkImageFilePath(data.file_path);
      setWatermarkImageFileName(data.filename || file.name);
      setWatermarkImageUrl(data.url || localUrl);
      setWatermarkEnabled(true);
    } catch (err) {
      console.error('Watermark upload error:', err);
      const msg = err instanceof Error ? err.message : 'Failed to upload watermark image.';
      alert(msg);
      if (localUrl) {
        try { URL.revokeObjectURL(localUrl); } catch { /* ignore */ }
      }
      setWatermarkImageFilePath('');
      setWatermarkImageUrl('');
      setWatermarkImageFileName('');
    } finally {
      setIsUploadingWatermark(false);
    }
  };

  const handleWatermarkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadWatermarkFile(file);
    e.target.value = '';
  };

  const handleRemoveWatermarkImage = () => {
    setWatermarkImageFileName('');
    setWatermarkImageFilePath('');
    setWatermarkImageUrl('');
  };

  const getDefaultWatermarkConfig = (type: 'image' | 'text') => {
    if (type === 'image') {
      return {
        size: 20,
        opacity: 80,
        x: 88,
        y: 8,
      };
    } else {
      return {
        size: 20,
        opacity: 80,
        x: 50,
        y: 92,
      };
    }
  };

  const handleSelectWatermarkType = (type: 'image' | 'text') => {
    setWatermarkType(type);
    const defaults = getDefaultWatermarkConfig(type);
    setWatermarkSize(defaults.size);
    setWatermarkOpacity(defaults.opacity);
    setWatermarkX(defaults.x);
    setWatermarkY(defaults.y);
    if (type === 'text' && !watermarkText.trim()) {
      setWatermarkText('@channel');
    }
  };

  const handleResetWatermark = () => {
    const defaults = getDefaultWatermarkConfig(watermarkType);
    setWatermarkSize(defaults.size);
    setWatermarkOpacity(defaults.opacity);
    setWatermarkX(defaults.x);
    setWatermarkY(defaults.y);
    if (watermarkType === 'text' && !watermarkText.trim()) {
      setWatermarkText('@channel');
    }
  };

  const applyWatermarkPreset = (preset: 'tl' | 'tc' | 'tr' | 'c' | 'bl' | 'bc' | 'br') => {
    const halfW = Math.round(watermarkSize / 2);
    const leftX = Math.max(4, Math.min(50, halfW + 2));
    const rightX = Math.min(96, Math.max(50, 100 - halfW - 2));
    const topY = 8;
    const bottomY = 92;

    switch (preset) {
      case 'tl':
        setWatermarkX(leftX);
        setWatermarkY(topY);
        break;
      case 'tc':
        setWatermarkX(50);
        setWatermarkY(topY);
        break;
      case 'tr':
        setWatermarkX(rightX);
        setWatermarkY(topY);
        break;
      case 'c':
        setWatermarkX(50);
        setWatermarkY(50);
        break;
      case 'bl':
        setWatermarkX(leftX);
        setWatermarkY(bottomY);
        break;
      case 'bc':
        setWatermarkX(50);
        setWatermarkY(bottomY);
        break;
      case 'br':
        setWatermarkX(rightX);
        setWatermarkY(bottomY);
        break;
    }
  };

  const applyLetterCase = (text: string, style: TextCaseOption): string => {
    if (style === 'uppercase') return text.toUpperCase();
    if (style === 'lowercase') return text.toLowerCase();
    return text.toLowerCase().replace(/(?:^|\s|\b)\w/g, c => c.toUpperCase());
  };

  /**
   * Intelligently wraps title across 1, 2, 3, or up to 4 balanced lines,
   * matching backend video_engine.wrap_title_smart logic.
   */
  const formatTitleSmart = (
    rawText: string,
    style: TextCaseOption,
    sizePreset: FontSizeOption = titleFontSize
  ): { formatted: string; lineCount: number } => {
    const raw = rawText.trim();
    if (!raw) return { formatted: '', lineCount: 1 };

    const cased = applyLetterCase(raw, style);

    // Preserve manual line breaks if user typed them
    if (cased.includes('\n')) {
      const manualLines = cased
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      return {
        formatted: manualLines.join('\n'),
        lineCount: Math.max(1, manualLines.length),
      };
    }

    const words = cased.split(/\s+/).filter(Boolean);
    const maxSingleLen = sizePreset === 'small' ? 24 : sizePreset === 'big' ? 13 : 19;
    if (words.length <= 1 || cased.length <= maxSingleLen) {
      return { formatted: cased, lineCount: 1 };
    }

    const totalLen = cased.length;
    const targetLines = Math.min(4, Math.max(2, Math.ceil(totalLen / maxSingleLen)));

    const targetPerLine = totalLen / targetLines;
    const lines: string[] = [];
    let currentLine: string[] = [];
    let currentLen = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const remainingWords = words.length - i;
      const remainingLines = targetLines - lines.length;

      if (
        remainingLines > 1 &&
        currentLine.length > 0 &&
        (currentLen + w.length > targetPerLine * 1.15 || remainingWords <= remainingLines - 1)
      ) {
        lines.push(currentLine.join(' '));
        currentLine = [w];
        currentLen = w.length;
      } else {
        currentLine.push(w);
        currentLen += w.length + 1;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine.join(' '));
    }

    return { formatted: lines.join('\n'), lineCount: Math.max(1, lines.length) };
  };

  /**
   * Safe defaults for each aspect ratio and line count:
   * Guarantees title & subtitle NEVER touch or overlap content boxes.
   */
  /**
   * Snug defaults for each aspect ratio, line count, and streamer preset:
   * Keeps title and subtitle CLOSE to the video content without touching.
   */
  const getDefaultPositions = (
    ratio: AspectRatioOption,
    lines: number,
    preset: StreamerPreset = streamerPreset
  ): { titleY: number; subtitleY: number; subCenterY: number } => {
    if (preset === 'split_top_cam') {
      return {
        titleY: lines >= 3 ? 3.5 : 4.5,
        subtitleY: ratio === '4:3' ? 10.0 : 18.0,
        subCenterY: 50,
      };
    }
    if (ratio === '16:9_landscape') {
      return {
        titleY: lines >= 3 ? 5.5 : lines === 2 ? 6.5 : 8.0,
        subtitleY: 10.0,
        subCenterY: 50,
      };
    }
    if (ratio === '1:1') {
      return {
        titleY: lines >= 3 ? 11.5 : lines === 2 ? 13.5 : 17.0,
        subtitleY: 20.0,
        subCenterY: 50,
      };
    }
    if (ratio === '4:3') {
      return {
        titleY: lines >= 3 ? 17.3 : lines === 2 ? 19.3 : 23.6,
        subtitleY: 25.0,
        subCenterY: 50,
      };
    }
    if (ratio === '16:9') {
      return {
        titleY: lines >= 3 ? 22.6 : lines === 2 ? 24.5 : 28.8,
        subtitleY: 30.0,
        subCenterY: 50,
      };
    }
    // 9:16 Fullscreen
    return {
      titleY: lines >= 3 ? 12.0 : lines === 2 ? 14.5 : 17.0,
      subtitleY: 21.0,
      subCenterY: 50,
    };
  };

  /**
   * Hard limits so slider adjustments cannot physically cross into content boxes.
   */
  const getMaxPositions = (
    ratio: AspectRatioOption,
    lines: number,
    preset: StreamerPreset = streamerPreset
  ) => {
    if (preset === 'split_top_cam') {
      return {
        maxTitleY: 35.0,
        maxSubY: 50.0,
      };
    }
    if (ratio === '16:9_landscape') {
      return {
        maxTitleY: 40.0,
        maxSubY: 50.0,
      };
    }
    if (ratio === '1:1') {
      return {
        maxTitleY: lines >= 4 ? 12.5 : lines === 3 ? 13.5 : lines === 2 ? 15.0 : 18.0,
        maxSubY: 50.0,
      };
    }
    if (ratio === '4:3') {
      return {
        maxTitleY: lines >= 4 ? 19.5 : lines === 3 ? 20.5 : lines === 2 ? 22.0 : 25.0,
        maxSubY: 50.0,
      };
    }
    if (ratio === '16:9') {
      return {
        maxTitleY: lines >= 4 ? 24.5 : lines === 3 ? 25.5 : lines === 2 ? 27.0 : 30.0,
        maxSubY: 50.0,
      };
    }
    return {
      maxTitleY: 45.0,
      maxSubY: 50.0,
    };
  };

  const getCenterBounds = (ratio: AspectRatioOption) => {
    if (ratio === '16:9_landscape') return { min: 20, max: 80 };
    if (ratio === '16:9') return { min: 38, max: 62 };
    if (ratio === '4:3') return { min: 34, max: 66 };
    if (ratio === '1:1') return { min: 28, max: 72 };
    return { min: 25, max: 75 };
  };

  // Preview framing dimensions (adapts dynamically for True Landscape vs Vertical)
  const isLandscape = aspectRatio === '16:9_landscape';
  const phoneWidth = 320;
  const phoneHeight = isLandscape ? 180 : 569;

  const currentClipKey = currentPreviewClip ? `${currentPreviewClip.start_time}_${currentPreviewClip.end_time}` : '';
  const currentCustomTitle = currentClipKey ? customClipTitles[currentClipKey] : undefined;

  const baseClipHookTitle = (
    currentCustomTitle !== undefined && currentCustomTitle.trim() !== ''
      ? currentCustomTitle
      : (currentPreviewClip?.title_suggestion || currentPreviewClip?.title || 'YOUR VIRAL HOOK TITLE')
  );

  const activeTitle = `${titlePrefix}${baseClipHookTitle}${titleSuffix}`;

  const sampleRawTitle = baseClipHookTitle;
  const sampleCleanTitle = sampleRawTitle.replace(/[\\/*?:"<>|]/g, '').trim() || 'Viral_Clip_1';

  const { formatted: formattedTitle, lineCount: titleLineCount } = formatTitleSmart(
    activeTitle,
    titleTextCase,
    titleFontSize
  );

  const { maxTitleY, maxSubY } = getMaxPositions(aspectRatio, titleLineCount, streamerPreset);
  const { min: minCenterY, max: maxCenterY } = getCenterBounds(aspectRatio);

  // Safe clamped values for preview rendering
  const safeTitleY = Math.min(titleYPercent, maxTitleY);
  const safeTitleX = Math.max(15, Math.min(85, titleXPercent));
  const safeSubtitleY = Math.min(subtitleYPercent, maxSubY);
  const safeSubCenterY = Math.max(minCenterY, Math.min(subtitleCenterYPercent, maxCenterY));

  // Determine if title is within duration limit (5s, 10s, or entire clip)
  const elapsedInClip = Math.max(0, currentTime - clipStart);
  const isTitleVisible = titlePosition !== 'none' && (
    titleDuration === 'entire' ||
    (titleDuration === '5s' && elapsedInClip <= 5.0) ||
    (titleDuration === '10s' && elapsedInClip <= 10.0)
  );

  const handleResetTitleHorizontal = () => {
    setTitleXPercent(50);
  };

  const handleResetCropX = () => {
    setManualCropX(50);
    setIsManualCropX(false);
  };

  // If user hasn't explicitly customized positions, auto-keep optimal default for ratio & lines
  useEffect(() => {
    if (!isCustomTitleY) {
      const defaults = getDefaultPositions(aspectRatio, titleLineCount, streamerPreset);
      setTitleYPercent(defaults.titleY);
    }
  }, [aspectRatio, titleLineCount, streamerPreset, isCustomTitleY]);

  const handleSelectAspectRatio = (newRatio: AspectRatioOption) => {
    setAspectRatio(newRatio);
    const defaults = getDefaultPositions(newRatio, titleLineCount, streamerPreset);
    setTitleYPercent(defaults.titleY);
    setSubtitleYPercent(defaults.subtitleY);
    setSubtitleCenterYPercent(defaults.subCenterY);
    setIsCustomTitleY(false);
  };

  const handleResetTitlePosition = () => {
    const defaults = getDefaultPositions(aspectRatio, titleLineCount, streamerPreset);
    setTitleYPercent(defaults.titleY);
    setIsCustomTitleY(false);
  };

  const handleResetSubtitlePosition = () => {
    const defaults = getDefaultPositions(aspectRatio, titleLineCount, streamerPreset);
    setSubtitleYPercent(defaults.subtitleY);
    setSubtitleCenterYPercent(defaults.subCenterY);
    setSubtitleOffsetSeconds(0.0);
  };

  // Automatically persist studio customization preferences to localStorage
  useEffect(() => {
    const prefs: StudioPreferences = {
      aspectRatio,
      backgroundStyle,
      enableFaceTracking,
      manualCropX,
      isManualCropX,
      streamerPreset,
      facecamPosition,
      titlePosition,
      captionStyle,
      captionFont,
      titleFont,
      fontSize,
      fontSizePx,
      titleFontSize,
      titleFontSizePx,
      textCase,
      titleTextCase,
      subtitlePositionMode,
      titleDuration,
      originalAudioVolume,
      hardwareAccel,
      titleYPercent,
      subtitleYPercent,
      subtitleOffsetSeconds,
      subtitleCenterYPercent,
      isCustomTitleY,
      bgmVolume,
      hookSfxVolume,
      renderMode,
      fileNamePrefix,
      fileNameSuffix,
      titlePrefix,
      titleSuffix,
    };
    try {
      localStorage.setItem(STUDIO_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.warn('Failed to persist studio preferences to localStorage:', e);
    }
  }, [
    aspectRatio,
    backgroundStyle,
    enableFaceTracking,
    streamerPreset,
    facecamPosition,
    titlePosition,
    captionStyle,
    captionFont,
    titleFont,
    fontSize,
    fontSizePx,
    titleFontSize,
    titleFontSizePx,
    textCase,
    titleTextCase,
    subtitlePositionMode,
    titleDuration,
    originalAudioVolume,
    hardwareAccel,
    titleYPercent,
    subtitleYPercent,
    subtitleOffsetSeconds,
    subtitleCenterYPercent,
    isCustomTitleY,
    bgmVolume,
    hookSfxVolume,
    renderMode,
    fileNamePrefix,
    fileNameSuffix,
    titlePrefix,
    titleSuffix,
  ]);

  const handleResetToDefaults = () => {
    setAspectRatio(DEFAULT_STUDIO_PREFS.aspectRatio);
    setBackgroundStyle(DEFAULT_STUDIO_PREFS.backgroundStyle);
    setEnableFaceTracking(DEFAULT_STUDIO_PREFS.enableFaceTracking);
    setStreamerPreset(DEFAULT_STUDIO_PREFS.streamerPreset);
    setFacecamPosition(DEFAULT_STUDIO_PREFS.facecamPosition);
    setTitlePosition(DEFAULT_STUDIO_PREFS.titlePosition);
    setCaptionStyle(DEFAULT_STUDIO_PREFS.captionStyle);
    setLastActiveCaptionStyle(DEFAULT_STUDIO_PREFS.captionStyle);
    setCaptionFont(DEFAULT_STUDIO_PREFS.captionFont);
    setTitleFont(DEFAULT_STUDIO_PREFS.titleFont);
    setFontSize(DEFAULT_STUDIO_PREFS.fontSize);
    setFontSizePx(DEFAULT_STUDIO_PREFS.fontSizePx);
    setTitleFontSize(DEFAULT_STUDIO_PREFS.titleFontSize);
    setTitleFontSizePx(DEFAULT_STUDIO_PREFS.titleFontSizePx);
    setTextCase(DEFAULT_STUDIO_PREFS.textCase);
    setTitleTextCase(DEFAULT_STUDIO_PREFS.titleTextCase);
    setSubtitlePositionMode(DEFAULT_STUDIO_PREFS.subtitlePositionMode);
    setTitleDuration(DEFAULT_STUDIO_PREFS.titleDuration);
    setOriginalAudioVolume(DEFAULT_STUDIO_PREFS.originalAudioVolume);
    setHardwareAccel(DEFAULT_STUDIO_PREFS.hardwareAccel);
    setTitleYPercent(DEFAULT_STUDIO_PREFS.titleYPercent);
    setTitleXPercent(DEFAULT_STUDIO_PREFS.titleXPercent);
    setManualCropX(DEFAULT_STUDIO_PREFS.manualCropX);
    setIsManualCropX(DEFAULT_STUDIO_PREFS.isManualCropX);
    setSubtitleYPercent(DEFAULT_STUDIO_PREFS.subtitleYPercent);
    setSubtitleCenterYPercent(DEFAULT_STUDIO_PREFS.subtitleCenterYPercent);
    setSubtitleOffsetSeconds(DEFAULT_STUDIO_PREFS.subtitleOffsetSeconds);
    setIsCustomTitleY(DEFAULT_STUDIO_PREFS.isCustomTitleY);
    setBgmVolume(DEFAULT_STUDIO_PREFS.bgmVolume);
    setHookSfxVolume(DEFAULT_STUDIO_PREFS.hookSfxVolume);
    setRenderMode(DEFAULT_STUDIO_PREFS.renderMode);
    setFileNamePrefix(DEFAULT_STUDIO_PREFS.fileNamePrefix);
    setFileNameSuffix(DEFAULT_STUDIO_PREFS.fileNameSuffix);
    setTitlePrefix(DEFAULT_STUDIO_PREFS.titlePrefix);
    setTitleSuffix(DEFAULT_STUDIO_PREFS.titleSuffix);
    handleResetTitlePosition();
    handleResetSubtitlePosition();
    try {
      localStorage.removeItem(STUDIO_PREFS_KEY);
    } catch (e) {
      console.warn('Failed to clear studio preferences from localStorage:', e);
    }
  };

  const handleLaunch = () => {
    const enrichedSelectedClips = selectedClips.map(c => {
      const key = `${c.start_time}_${c.end_time}`;
      const custom = customClipTitles[key];
      const effectiveTitle = (custom !== undefined && custom.trim()) ? custom.trim() : (c.title_suggestion || c.title);
      return {
        ...c,
        title: effectiveTitle,
        title_suggestion: effectiveTitle,
        custom_title: effectiveTitle,
      };
    });

    onStartRender({
      aspectRatio,
      backgroundStyle,
      enableFaceTracking,
      streamerPreset,
      facecamPosition,
      titleText: enrichedSelectedClips.length === 1 ? activeTitle : undefined,
      titlePrefix,
      titleSuffix,
      fileNamePrefix,
      fileNameSuffix,
      titlePosition,
      titleDuration,
      titleFont,
      titleFontSize,
      titleFontSizePx,
      titleTextCase,
      subtitlesEnabled: captionStyle !== 'none',
      captionStyle,
      captionFont,
      fontSize,
      fontSizePx,
      textCase,
      titleYPercent: safeTitleY,
      titleXPercent: safeTitleX,
      cropXPercent: isManualCropX ? manualCropX : undefined,
      subtitleYPercent: safeSubtitleY,
      subtitleOffsetSeconds,
      subtitlePositionMode,
      subtitleCenterYPercent: safeSubCenterY,
      selectedClips: enrichedSelectedClips,
      // Background Music
      bgmEnabled: !!bgmFilePath,
      bgmFilePath,
      bgmFileName,
      bgmVolume,
      bgmStartOffset,
      // Hook SFX
      hookSfxEnabled: !!hookSfxFilePath,
      hookSfxFilePath,
      hookSfxFileName,
      hookSfxVolume,
      // Watermark
      watermarkEnabled,
      watermarkType,
      watermarkFilePath: watermarkImageFilePath,
      watermarkUrl: watermarkImageUrl,
      watermarkText,
      watermarkSize,
      watermarkOpacity,
      watermarkX,
      watermarkY,
      // Original Voice Audio Boost
      originalAudioVolume,
      // Hardware Acceleration / Video Encoder
      hardwareAccel,
      renderEngine: isMobileDevice() ? 'server' : (hardwareAccel === 'browser_wasm' ? 'client' : 'server'),
      // Multi-Segment Merged Highlight Video
      renderMode,
      compilationTitle: compilationTitle.trim() || undefined,
    });
  };

  return (
    <section id="clip-studio-section" className="clip-studio-page-section glass-panel">
      {/* Fancy Glowing Section Header */}
      <div className="studio-section-header">
        <div className="studio-header-left">
          <div>
            <div className="studio-title-badge-row">
              <h2 className="studio-main-heading" style={{ fontSize: '1.4rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                <span style={{ color: '#ff00ff' }}>&gt;_</span> {t.studio.heading}
              </h2>
            </div>
            <p className="studio-subtext">
              {t.studio.subtext}
            </p>
          </div>
        </div>

        <div className="studio-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {onBackToClips && (
            <button
              type="button"
              onClick={onBackToClips}
              className="glowing-btn"
              style={{
                padding: '0.45rem 1rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                background: 'rgba(255, 0, 255, 0.12)',
                border: '1px solid #ff00ff',
                color: '#ff00ff',
                boxShadow: '0 0 10px rgba(255, 0, 255, 0.25)',
                cursor: 'pointer',
                borderRadius: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <ArrowLeft size={14} />
              <span>02 {(t.studio as any).backToClips || 'KEMBALI KE CLIPS'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleResetToDefaults}
            className="studio-reset-defaults-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.85rem',
              borderRadius: 0,
              fontSize: '0.78rem',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              background: '#0d0d14',
              border: '1px solid #272238',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#ff1e27';
              e.currentTarget.style.borderColor = '#ff1e27';
              e.currentTarget.style.background = 'rgba(255, 30, 39, 0.1)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = '#272238';
              e.currentTarget.style.background = '#0d0d14';
            }}
            title={t.studio.resetToDefaultsTooltip || 'Reset all settings to default values'}
          >
            <RotateCcw size={13} />
            <span>{t.studio.resetToDefaults || 'RESET TO DEFAULTS'}</span>
          </button>

          {/* Clip preview switcher */}
          {allClips.length > 1 && (
            <div className="preview-clip-picker-bar">
              <span className="preview-picker-label">{t.studio.previewClip}</span>
              <select
                className="preview-clip-select"
                value={previewClipIndex}
                onChange={e => setPreviewClipIndex(Number(e.target.value))}
              >
                {allClips.map((clip, idx) => {
                  const clipKey = `${clip.start_time}_${clip.end_time}`;
                  const custom = customClipTitles[clipKey];
                  const displayT = (custom !== undefined && custom.trim()) ? custom.trim() : (clip.title_suggestion || clip.title);
                  return (
                    <option key={idx} value={idx}>
                      #{idx + 1}: {displayT} ({Math.round(clip.end_time - clip.start_time)}s)
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Studio Grid: Controls (Left) + Real Image Live Preview (Right) */}
      <div className="studio-workspace-grid">
        {/* Left Column: Interactive Controls */}
        <div className="studio-controls-pane">
          {/* 1. Canvas & Inner Aspect Ratio */}
          <div className="studio-card-group group-canvas">
            <div className="group-header">
              <span className="group-title">{t.studio.canvasTitle}</span>
              <span className="group-badge">{t.studio.canvasBadge}</span>
            </div>

            <div className="aspect-options-grid">
              <button
                type="button"
                className={`aspect-card-btn ${aspectRatio === '9:16' ? 'active' : ''}`}
                onClick={() => handleSelectAspectRatio('9:16')}
              >
                <div className="aspect-icon-box ratio-916"></div>
                <span className="aspect-name">{t.studio.ratio916}</span>
                <span className="aspect-sub">{t.studio.ratio916Sub}</span>
              </button>

              <button
                type="button"
                className={`aspect-card-btn ${aspectRatio === '1:1' ? 'active' : ''}`}
                onClick={() => handleSelectAspectRatio('1:1')}
              >
                <div className="aspect-icon-box ratio-11"></div>
                <span className="aspect-name">{t.studio.ratio11}</span>
                <span className="aspect-sub">{t.studio.ratio11Sub}</span>
              </button>

              <button
                type="button"
                className={`aspect-card-btn ${aspectRatio === '4:3' ? 'active' : ''}`}
                onClick={() => handleSelectAspectRatio('4:3')}
              >
                <div className="aspect-icon-box ratio-43"></div>
                <span className="aspect-name">{t.studio.ratio43}</span>
                <span className="aspect-sub">{t.studio.ratio43Sub}</span>
              </button>

              <button
                type="button"
                className={`aspect-card-btn ${aspectRatio === '16:9' ? 'active' : ''}`}
                onClick={() => handleSelectAspectRatio('16:9')}
              >
                <div className="aspect-icon-box ratio-169"></div>
                <span className="aspect-name">{t.studio.ratio169}</span>
                <span className="aspect-sub">{t.studio.ratio169Sub}</span>
              </button>

              <button
                type="button"
                className={`aspect-card-btn ${aspectRatio === '16:9_landscape' ? 'active' : ''}`}
                onClick={() => handleSelectAspectRatio('16:9_landscape')}
              >
                <div className="aspect-icon-box ratio-169landscape"></div>
                <span className="aspect-name">{t.studio.ratio169Landscape || '16:9 Landscape'}</span>
                <span className="aspect-sub">{t.studio.ratio169LandscapeSub || 'True 1920×1080'}</span>
              </button>
            </div>

            {/* Background Style when bars are active */}
            {aspectRatio !== '9:16' && aspectRatio !== '16:9_landscape' && (
              <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                <span className="sub-toggle-label">{t.studio.marginBackdrop}</span>
                <div className="toggle-pill-group">
                  <button
                    type="button"
                    className={`pill-btn ${backgroundStyle === 'black' ? 'active' : ''}`}
                    onClick={() => setBackgroundStyle('black')}
                  >
                    {t.studio.blackBars}
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${backgroundStyle === 'blurred' ? 'active' : ''}`}
                    onClick={() => setBackgroundStyle('blurred')}
                  >
                    {t.studio.blurredVideo}
                  </button>
                </div>
              </div>
            )}

            {/* AI Active Speaker & Object Centering */}
            <div style={{ marginTop: '0.85rem' }}>
              <div className="studio-checkbox-row" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.78rem' }}>
                <input
                  type="checkbox"
                  id="faceTrackingSec"
                  checked={enableFaceTracking}
                  onChange={e => setEnableFaceTracking(e.target.checked)}
                  style={{ width: '14px', height: '14px', cursor: 'pointer', marginTop: '2px', accentColor: 'var(--primary)' }}
                />
                <label htmlFor="faceTrackingSec" style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.78rem', lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{t.studio.faceTracking}</span>{' '}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t.studio.faceTrackingDesc}</span>
                </label>
              </div>

              {/* Manual Camera Centering & Focal Point Controls */}
              {aspectRatio !== '16:9_landscape' && streamerPreset === 'none' && (
                <div className="manual-camera-framing-box" style={{ marginTop: '0.75rem', padding: '0.65rem 0.75rem', borderRadius: '6px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', flexWrap: 'wrap', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      // {t.studio.manualCameraCentering || "Manual Camera Centering (Horizontal Crop):"}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="badge" style={{ fontSize: '0.70rem', padding: '0.12rem 0.45rem', background: isManualCropX ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.08)', color: isManualCropX ? '#38bdf8' : 'var(--text-muted)' }}>
                        {isManualCropX ? `${manualCropX}% ${manualCropX === 50 ? '(Center)' : manualCropX < 50 ? '(Left)' : '(Right)'}` : (t.studio.aiAutoMode || "⚡ AI Auto Track")}
                      </span>
                      {isManualCropX && (
                        <button
                          type="button"
                          className="reset-btn"
                          onClick={handleResetCropX}
                          style={{ fontSize: '0.70rem', padding: '0.12rem 0.4rem', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          {t.studio.resetCrop || "↺ Auto AI"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="toggle-pill-group" style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.4rem' }}>
                    <button
                      type="button"
                      className={`pill-btn ${!isManualCropX ? 'active' : ''}`}
                      onClick={() => setIsManualCropX(false)}
                      style={{ fontSize: '0.74rem', padding: '0.25rem 0.55rem' }}
                    >
                      {t.studio.aiAutoMode || "⚡ AI Auto Track"}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${isManualCropX ? 'active' : ''}`}
                      onClick={() => setIsManualCropX(true)}
                      style={{ fontSize: '0.74rem', padding: '0.25rem 0.55rem' }}
                    >
                      {t.studio.manualCropMode || "🎯 Manual Crop"}
                    </button>
                  </div>

                  {isManualCropX && (
                    <div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={manualCropX}
                        onChange={(e) => {
                          setManualCropX(Number(e.target.value));
                          setIsManualCropX(true);
                        }}
                        className="position-slider"
                        style={{ '--slider-progress': `${manualCropX}%` } as React.CSSProperties}
                      />
                      <div className="quick-presets-row" style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                        {[
                          { label: 'Far Left 15%', val: 15 },
                          { label: 'Left 30%', val: 30 },
                          { label: 'Center 50%', val: 50 },
                          { label: 'Right 70%', val: 70 },
                          { label: 'Far Right 85%', val: 85 }
                        ].map(p => (
                          <button
                            key={p.val}
                            type="button"
                            className={`pill-btn ${manualCropX === p.val ? 'active' : ''}`}
                            onClick={() => {
                              setManualCropX(p.val);
                              setIsManualCropX(true);
                            }}
                            style={{ fontSize: '0.70rem', padding: '0.12rem 0.4rem' }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {enableFaceTracking && !isManualCropX && streamerPreset === 'none' && (
                <div className="horizontal-framing-selector" style={{ marginTop: '0.65rem', paddingLeft: '1.6rem' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span>{t.studio.horizontalFramingLabel || 'Horizontal Framing / Focal Point:'}</span>
                    {faceBox?.found && facecamPosition === 'auto' && (
                      <span style={{
                        fontSize: '0.7rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        background: faceBox.type === 'salient_object' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                        color: faceBox.type === 'salient_object' ? '#38bdf8' : '#4ade80',
                        border: `1px solid ${faceBox.type === 'salient_object' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
                        fontWeight: 600
                      }}>
                        {faceBox.type === 'salient_object' ? 'AI Object Focus' : 'AI Face Focus'}
                      </span>
                    )}
                  </div>
                  <div className="pill-group framing-pills" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {[
                      { id: 'auto', label: t.studio.framingAuto || 'AI Auto (Face & Object)' },
                      { id: 'center', label: t.studio.framingCenter || 'Center (50%)' },
                      { id: 'left', icon: <ArrowLeft size={13} />, label: t.studio.framingLeft || 'Left Focus (35%)' },
                      { id: 'right', icon: <ArrowRight size={13} />, label: t.studio.framingRight || 'Right Focus (65%)' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`pill-btn ${facecamPosition === opt.id ? 'active' : ''}`}
                        style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        onClick={() => setFacecamPosition(opt.id as FacecamPosition)}
                      >
                        {opt.icon}
                        <span>{opt.label.replace(/^[⬅️←<\->\s]+/, '')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Streamer Facecam Presets */}
          <div className="studio-card-group group-facecam">
            <div className="group-header">
              <span className="group-title">{t.studio.streamerTitle}</span>
            </div>
            <div className="streamer-presets-row">
              <button
                type="button"
                className={`streamer-btn ${streamerPreset === 'none' ? 'active' : ''}`}
                onClick={() => {
                  setStreamerPreset('none');
                  const defaults = getDefaultPositions(aspectRatio, titleLineCount, 'none');
                  setTitleYPercent(defaults.titleY);
                  setSubtitleYPercent(defaults.subtitleY);
                  setIsCustomTitleY(false);
                }}
              >
                {t.studio.streamerNone}
              </button>
              <button
                type="button"
                className={`streamer-btn ${streamerPreset === 'split_top_cam' ? 'active' : ''}`}
                onClick={() => {
                  setStreamerPreset('split_top_cam');
                  const defaults = getDefaultPositions(aspectRatio, titleLineCount, 'split_top_cam');
                  setTitleYPercent(defaults.titleY);
                  setSubtitleYPercent(defaults.subtitleY);
                  setIsCustomTitleY(false);
                }}
              >
                {t.studio.streamerSplit}
              </button>
              <button
                type="button"
                className={`streamer-btn ${streamerPreset === 'pip_corner' ? 'active' : ''}`}
                onClick={() => {
                  setStreamerPreset('pip_corner');
                  const defaults = getDefaultPositions(aspectRatio, titleLineCount, 'pip_corner');
                  setTitleYPercent(defaults.titleY);
                  setSubtitleYPercent(defaults.subtitleY);
                  setIsCustomTitleY(false);
                }}
              >
                {t.studio.streamerPip}
              </button>
            </div>

            {streamerPreset !== 'none' && (
              <div className="streamer-facecam-position-wrap" style={{ marginTop: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {t.studio.facecamPositionLabel || 'Facecam Position in Source:'}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                    {facecamPosition === 'auto' ? 'AI AUTO-DETECT' : facecamPosition.toUpperCase().replace('_', '-')}
                  </span>
                </div>
                <div className="toggle-pill-group" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {[
                    { id: 'auto', label: t.studio.facecamAuto || 'Auto (AI Detect)' },
                    { id: 'bottom_right', label: t.studio.facecamBottomRight || 'Bottom-Right' },
                    { id: 'top_right', label: t.studio.facecamTopRight || 'Top-Right' },
                    { id: 'bottom_left', label: t.studio.facecamBottomLeft || 'Bottom-Left' },
                    { id: 'top_left', label: t.studio.facecamTopLeft || 'Top-Left' },
                    { id: 'center', label: t.studio.facecamCenter || 'Center' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`pill-btn ${facecamPosition === opt.id ? 'active' : ''}`}
                      onClick={() => setFacecamPosition(opt.id as FacecamPosition)}
                      style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', marginTop: '0.35rem', margin: '0.35rem 0 0 0' }}>
                  {t.studio.facecamHint || 'Tip: Select your webcam corner if auto-detection misses dark rooms or VTuber avatars.'}
                </p>
              </div>
            )}
          </div>

          {/* 4. Title / Hook Banner */}
          <div className="studio-card-group group-title-banner">
            <div className="group-header">
              <span className="group-title">{t.studio.titleBannerTitle}</span>
              <span className="group-badge">
                {t.studio.customYBadge(safeTitleY)}
              </span>
            </div>

            {/* Visibility Selector */}
            <div className="title-inputs-row" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {t.studio.titleVisibilityLabel || "Title Display:"}
              </span>
              <select
                className="studio-select"
                value={titlePosition}
                onChange={e => setTitlePosition(e.target.value as TitlePosition)}
                style={{ minWidth: '130px' }}
              >
                <option value="auto">{t.studio.titleVisible}</option>
                <option value="none">{t.studio.titleDisabled}</option>
              </select>
            </div>

            {titlePosition === 'none' && (
              <div className="subtitles-disabled-notice-box" style={{ marginBottom: '0.75rem' }}>
                <span>[!] {t.studio.titleDisabledNotice || "Headline hook & title banner are disabled. Live preview and final export will have no hook banner."}</span>
              </div>
            )}

            {/* Prefix & Suffix Controls */}
            {titlePosition !== 'none' && (
              <>
                {/* Active Clip Title Customizer */}
                <div className="hook-clip-title-input-wrap" style={{ marginBottom: '0.75rem', width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <label className="hook-input-label" style={{ margin: 0, fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      // {t.studio.clipTitleEditLabel || "Hook Title (Active Clip):"}
                    </label>
                    {currentCustomTitle !== undefined && currentCustomTitle.trim() !== '' && currentCustomTitle !== (currentPreviewClip?.title_suggestion || currentPreviewClip?.title) && (
                      <button
                        type="button"
                        className="reset-title-link-btn"
                        onClick={() => {
                          setCustomClipTitles(prev => {
                            const next = { ...prev };
                            delete next[currentClipKey];
                            return next;
                          });
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--primary, #38bdf8)',
                          fontSize: '0.74rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline'
                        }}
                      >
                        ↺ {t.studio.resetToAiTitle || "Reset to AI Title"}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    className="studio-text-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    placeholder={currentPreviewClip?.title_suggestion || currentPreviewClip?.title || t.studio.titlePlaceholder}
                    value={currentCustomTitle !== undefined ? currentCustomTitle : (currentPreviewClip?.title_suggestion || currentPreviewClip?.title || '')}
                    onChange={e => {
                      const val = e.target.value;
                      setCustomClipTitles(prev => ({
                        ...prev,
                        [currentClipKey]: val
                      }));
                    }}
                  />
                </div>

                <div className="hook-prefix-suffix-grid">
                  <div className="hook-input-col">
                    <label className="hook-input-label">{t.studio.titlePrefixLabel}</label>
                    <input
                      type="text"
                      className="studio-text-input"
                      placeholder={t.studio.titlePrefixPlaceholder}
                      value={titlePrefix}
                      onChange={e => setTitlePrefix(e.target.value)}
                    />
                  </div>
                  <div className="hook-input-col">
                    <label className="hook-input-label">{t.studio.titleSuffixLabel}</label>
                    <input
                      type="text"
                      className="studio-text-input"
                      placeholder={t.studio.titleSuffixPlaceholder}
                      value={titleSuffix}
                      onChange={e => setTitleSuffix(e.target.value)}
                    />
                  </div>
                </div>

                {/* Combined Banner Preview Info */}
                <div className="hook-banner-preview-box">
                  <div className="hook-base-badge">
                    <span className="badge-tag">{t.studio.titleBaseHookBadge}:</span>
                    <span className="badge-text" title={baseClipHookTitle}>{baseClipHookTitle}</span>
                  </div>
                  <div className="hook-combined-result">
                    <span className="combined-label">{t.studio.titleFullPreview}</span>
                    <span className="combined-text">
                      {titlePrefix && <span className="pfx-highlight">{titlePrefix}</span>}
                      <span className="base-highlight">{baseClipHookTitle}</span>
                      {titleSuffix && <span className="sfx-highlight">{titleSuffix}</span>}
                    </span>
                  </div>
                </div>

                {/* Batch Helper Note */}
                <div style={{ marginTop: '0.5rem', fontSize: '0.74rem', color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
                  {t.studio.batchTitleNote}
                </div>

                {/* Title Duration Option */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                  <span className="sub-toggle-label">{t.studio.titleDurationLabel}</span>
                  <div className="toggle-pill-group">
                    <button
                      type="button"
                      className={`pill-btn ${titleDuration === 'entire' ? 'active' : ''}`}
                      onClick={() => setTitleDuration('entire')}
                    >
                      {t.studio.durationEntire}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${titleDuration === '5s' ? 'active' : ''}`}
                      onClick={() => setTitleDuration('5s')}
                    >
                      {t.studio.duration5s}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${titleDuration === '10s' ? 'active' : ''}`}
                      onClick={() => setTitleDuration('10s')}
                    >
                      {t.studio.duration10s}
                    </button>
                  </div>
                </div>

                {/* Title Font Family with Dedicated Dropzone */}
                <div className="studio-font-section">
                  <div className="font-section-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span className="sub-toggle-label" style={{ margin: 0, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        // {t.studio.titleFontFamily || "Title Font Family"}
                      </span>
                      <span className="badge" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', opacity: 0.85 }}>
                        {titleFont}
                      </span>
                    </div>
                  </div>

                  {/* Title Font Pills List */}
                  <div className="toggle-pill-group" style={{ flexWrap: 'wrap', width: '100%' }}>
                    {availableFonts.map(font => (
                      <button
                        key={`title-font-${font.name}`}
                        type="button"
                        className={`pill-btn ${titleFont === font.name ? 'active' : ''}`}
                        onClick={() => setTitleFont(font.name)}
                        style={{ fontFamily: font.name, fontSize: '0.78rem', fontWeight: titleFont === font.name ? 700 : 400 }}
                      >
                        {font.name}
                        {font.is_custom && <span style={{ marginLeft: '4px', fontSize: '0.62rem', opacity: 0.85, color: '#fbbf24' }}>[*]</span>}
                      </button>
                    ))}
                  </div>

                  {/* Title Font Drag & Drop Dropzone */}
                  <div
                    className={`font-dropzone ${isTitleFontDragging ? 'drag-over' : ''}`}
                    onClick={() => titleFontInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsTitleFontDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsTitleFontDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsTitleFontDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleUploadFont(file, 'title');
                    }}
                    title="Drag and drop or click to upload custom font file (.ttf, .otf, .woff, .woff2)"
                  >
                    <input
                      ref={titleFontInputRef}
                      type="file"
                      accept=".ttf,.otf,.woff,.woff2"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFont(file, 'title');
                        e.target.value = '';
                      }}
                      disabled={isUploadingFont}
                    />
                    <span className="font-dropzone-icon">
                      {isUploadingFont ? '[...]' : isTitleFontDragging ? 'v' : '[+]'}
                    </span>
                    <div className="font-dropzone-text">
                      <span className="font-dropzone-title">
                        {isUploadingFont ? (t.studio.uploadingFont || 'Uploading font...') : (t.studio.dropFontHint || 'Upload Custom Font (.ttf, .otf, .woff, .woff2)')}
                      </span>
                      <span className="font-dropzone-desc">
                        {t.studio.dropFontSub || 'Drag & drop font file here or click to browse'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Title Text Size Option with Uncapped Manual Pixel Input */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                  <span className="sub-toggle-label">{t.studio.titleFontSize || "Title Text Size:"}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <div className="toggle-pill-group">
                      <button
                        type="button"
                        className={`pill-btn ${titleFontSize === 'small' ? 'active' : ''}`}
                        onClick={() => {
                          setTitleFontSize('small');
                          setTitleFontSizePx(50);
                        }}
                      >
                        {t.studio.sizeSmall} (50px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${titleFontSize === 'medium' ? 'active' : ''}`}
                        onClick={() => {
                          setTitleFontSize('medium');
                          setTitleFontSizePx(75);
                        }}
                      >
                        {t.studio.sizeMedium} (75px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${titleFontSize === 'big' ? 'active' : ''}`}
                        onClick={() => {
                          setTitleFontSize('big');
                          setTitleFontSizePx(100);
                        }}
                      >
                        {t.studio.sizeBig} (100px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${titleFontSize === 'custom' ? 'active' : ''}`}
                        onClick={() => setTitleFontSize('custom')}
                      >
                        {t.studio.sizeCustom || 'Custom'}
                      </button>
                    </div>
                    {/* Manual Numeric PX Input (Unlimited, 1 - 1000px) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        step="1"
                        value={titleFontSizePx || ''}
                        placeholder="px"
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setTitleFontSizePx(0);
                            setTitleFontSize('custom');
                            return;
                          }
                          const num = parseInt(raw, 10);
                          const val = isNaN(num) ? 0 : Math.max(1, Math.min(1000, num));
                          setTitleFontSizePx(val);
                          setTitleFontSize('custom');
                        }}
                        className="studio-text-input"
                        style={{
                          width: '72px',
                          padding: '0.22rem 0.45rem',
                          fontSize: '0.78rem',
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: titleFontSize === 'custom' ? '1px solid var(--primary, #38bdf8)' : '1px solid rgba(255,255,255,0.15)',
                        }}
                        title="Enter custom title font size in pixels (px, 1 - 1000)"
                      />
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>px</span>
                    </div>
                  </div>
                </div>

                {/* Title Letter Style Option */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                  <span className="sub-toggle-label">{t.studio.titleLetterStyle || "Title Letter Style:"}</span>
                  <div className="toggle-pill-group">
                    <button
                      type="button"
                      className={`pill-btn ${titleTextCase === 'uppercase' ? 'active' : ''}`}
                      onClick={() => setTitleTextCase('uppercase')}
                    >
                      {t.studio.letterCaps}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${titleTextCase === 'capitalize' ? 'active' : ''}`}
                      onClick={() => setTitleTextCase('capitalize')}
                    >
                      {t.studio.letterTitle}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${titleTextCase === 'lowercase' ? 'active' : ''}`}
                      onClick={() => setTitleTextCase('lowercase')}
                    >
                      {t.studio.letterLower}
                    </button>
                  </div>
                </div>

                {/* Title Vertical Position Controls */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.85rem', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span className="sub-toggle-label" style={{ margin: 0 }}>
                      {t.studio.titleYLabel || "// Title Vertical Position:"}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="badge" style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}>
                        {t.studio.titleYVal(safeTitleY, titleLineCount >= 3)}
                      </span>
                      <button
                        type="button"
                        className="reset-btn"
                        onClick={handleResetTitlePosition}
                        title={t.studio.resetPositionTooltip}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        {t.studio.resetPosition}
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max={maxTitleY}
                    step="1"
                    value={safeTitleY}
                    onChange={(e) => {
                      setTitleYPercent(Number(e.target.value));
                      setIsCustomTitleY(true);
                    }}
                    className="position-slider"
                    style={{ '--slider-progress': `${Math.max(0, Math.min(100, ((safeTitleY - 3) / (maxTitleY - 3 || 1)) * 100))}%` } as React.CSSProperties}
                  />
                  <div className="quick-presets-row" style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`pill-btn ${safeTitleY === 8 ? 'active' : ''}`}
                      onClick={() => {
                        setTitleYPercent(8);
                        setIsCustomTitleY(true);
                      }}
                      style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                    >
                      {t.studio.quickHigh(8)}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${safeTitleY === getDefaultPositions(aspectRatio, titleLineCount, streamerPreset).titleY ? 'active' : ''}`}
                      onClick={handleResetTitlePosition}
                      style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                    >
                      {t.studio.quickDefault(`${getDefaultPositions(aspectRatio, titleLineCount, streamerPreset).titleY}%`)}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${safeTitleY === Math.min(22, maxTitleY) ? 'active' : ''}`}
                      onClick={() => {
                        setTitleYPercent(Math.min(22, maxTitleY));
                        setIsCustomTitleY(true);
                      }}
                      style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                    >
                      {t.studio.quickLower(Math.min(22, maxTitleY))}
                    </button>
                  </div>
                </div>

                {/* Title Horizontal Position Controls */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.85rem', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span className="sub-toggle-label" style={{ margin: 0 }}>
                      {t.studio.titleXLabel || "// Headline Horizontal Position:"}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="badge" style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}>
                        {safeTitleX}% {safeTitleX === 50 ? '(Center)' : safeTitleX < 50 ? '(Shift Left)' : '(Shift Right)'}
                      </span>
                      <button
                        type="button"
                        className="reset-btn"
                        onClick={handleResetTitleHorizontal}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        {t.studio.resetHorizontal || "↺ Reset Center"}
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="85"
                    step="1"
                    value={safeTitleX}
                    onChange={(e) => {
                      setTitleXPercent(Number(e.target.value));
                    }}
                    className="position-slider"
                    style={{ '--slider-progress': `${Math.max(0, Math.min(100, ((safeTitleX - 15) / 70) * 100))}%` } as React.CSSProperties}
                  />
                  <div className="quick-presets-row" style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`pill-btn ${safeTitleX === 30 ? 'active' : ''}`}
                      onClick={() => {
                        setTitleXPercent(30);
                        }}
                      style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                    >
                      Left (30%)
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${safeTitleX === 50 ? 'active' : ''}`}
                      onClick={handleResetTitleHorizontal}
                      style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                    >
                      Center (50%)
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${safeTitleX === 70 ? 'active' : ''}`}
                      onClick={() => {
                        setTitleXPercent(70);
                        }}
                      style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                    >
                      Right (70%)
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 5. Subtitle Style & Font */}
          <div className="studio-card-group group-subtitles">
            <div className="group-header">
              <span className="group-title">{t.studio.subtitlesTitle}</span>
              <span className="group-badge success-badge">{t.studio.strictlyOneLine}</span>
            </div>

            {/* Subtitle Visibility Selector */}
            <div className="title-inputs-row" style={{ alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {t.studio.subtitlesVisibilityLabel}
              </span>
              <select
                className="studio-select"
                value={captionStyle !== 'none' ? 'visible' : 'disabled'}
                onChange={e => {
                  const isVis = e.target.value === 'visible';
                  if (isVis) {
                    setCaptionStyle(lastActiveCaptionStyle !== 'none' ? lastActiveCaptionStyle : 'viral_pop');
                  } else {
                    if (captionStyle !== 'none') {
                      setLastActiveCaptionStyle(captionStyle);
                    }
                    setCaptionStyle('none');
                  }
                }}
                style={{ minWidth: '130px' }}
              >
                <option value="visible">{t.studio.subtitlesVisible}</option>
                <option value="disabled">{t.studio.subtitlesDisabled}</option>
              </select>
            </div>

            {captionStyle === 'none' && (
              <div className="subtitles-disabled-notice-box" style={{ marginBottom: '0.75rem' }}>
                <span>[!] {t.studio.subtitlesDisabledNotice}</span>
              </div>
            )}

            <div className={`caption-styles-grid ${captionStyle === 'none' ? 'subtitles-dimmed' : ''}`} style={{ fontFamily: captionFont }}>
              <button
                type="button"
                className={`caption-style-card viral-pop ${captionStyle === 'viral_pop' ? 'active' : ''}`}
                onClick={() => {
                  setCaptionStyle('viral_pop');
                  setLastActiveCaptionStyle('viral_pop');
                }}
              >
                <div className="caption-preview-text">
                  VIRAL <span className="pop-yellow">POP</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleViralPopSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card beast-punch ${captionStyle === 'beast_punch' ? 'active' : ''}`}
                onClick={() => {
                  setCaptionStyle('beast_punch');
                  setLastActiveCaptionStyle('beast_punch');
                }}
              >
                <div className="caption-preview-text">
                  BEAST <span className="pop-green">PUNCH</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleBeastPunchSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card cyber-violet ${captionStyle === 'cyber_violet' ? 'active' : ''}`}
                onClick={() => {
                  setCaptionStyle('cyber_violet');
                  setLastActiveCaptionStyle('cyber_violet');
                }}
              >
                <div className="caption-preview-text">
                  CYBER <span className="pop-violet">VIOLET</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleCyberVioletSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card fire-red ${captionStyle === 'fire_red' ? 'active' : ''}`}
                onClick={() => {
                  setCaptionStyle('fire_red');
                  setLastActiveCaptionStyle('fire_red');
                }}
              >
                <div className="caption-preview-text">
                  FIRE <span className="pop-red">CRIMSON</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleFireRedSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card electric-cyan ${captionStyle === 'electric_cyan' ? 'active' : ''}`}
                onClick={() => {
                  setCaptionStyle('electric_cyan');
                  setLastActiveCaptionStyle('electric_cyan');
                }}
              >
                <div className="caption-preview-text">
                  ELECTRIC <span className="pop-cyan">CYAN</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleElectricCyanSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card golden-aura ${captionStyle === 'golden_aura' ? 'active' : ''}`}
                onClick={() => {
                  setCaptionStyle('golden_aura');
                  setLastActiveCaptionStyle('golden_aura');
                }}
              >
                <div className="caption-preview-text">
                  GOLDEN <span className="pop-gold">AURA</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleGoldenAuraSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card clean-minimal ${captionStyle === 'clean_minimal' ? 'active' : ''}`}
                onClick={() => {
                  setCaptionStyle('clean_minimal');
                  setLastActiveCaptionStyle('clean_minimal');
                }}
              >
                <div className="caption-preview-text">
                  <span className="minimal-pill">{t.studio.styleCleanMinimal}</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleCleanMinimalSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card none ${captionStyle === 'none' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('none')}
              >
                <div className="caption-preview-text">{t.studio.styleNone}</div>
                <span className="caption-style-sub">{t.studio.styleNoneSub}</span>
              </button>
            </div>

            {captionStyle !== 'none' && (
              <>
                {/* Subtitle Font Family with Dedicated Dropzone */}
                <div className="studio-font-section">
                  <div className="font-section-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span className="sub-toggle-label" style={{ margin: 0, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        // {t.studio.fontFamily}
                      </span>
                      <span className="badge" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem', opacity: 0.85 }}>
                        {captionFont}
                      </span>
                    </div>
                  </div>

                  {/* Subtitle Font Pills List */}
                  <div className="toggle-pill-group" style={{ flexWrap: 'wrap', width: '100%' }}>
                    {availableFonts.map(font => (
                      <button
                        key={`sub-font-${font.name}`}
                        type="button"
                        className={`pill-btn ${captionFont === font.name ? 'active' : ''}`}
                        onClick={() => setCaptionFont(font.name)}
                        style={{ fontFamily: font.name, fontSize: '0.78rem', fontWeight: captionFont === font.name ? 700 : 400 }}
                      >
                        {font.name}
                        {font.is_custom && <span style={{ marginLeft: '4px', fontSize: '0.62rem', opacity: 0.85, color: '#fbbf24' }}>[*]</span>}
                      </button>
                    ))}
                  </div>

                  {/* Subtitle Font Drag & Drop Dropzone */}
                  <div
                    className={`font-dropzone ${isSubFontDragging ? 'drag-over' : ''}`}
                    onClick={() => subtitleFontInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsSubFontDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsSubFontDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsSubFontDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleUploadFont(file, 'subtitle');
                    }}
                    title="Drag and drop or click to upload custom font file (.ttf, .otf, .woff, .woff2)"
                  >
                    <input
                      ref={subtitleFontInputRef}
                      type="file"
                      accept=".ttf,.otf,.woff,.woff2"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFont(file, 'subtitle');
                        e.target.value = '';
                      }}
                      disabled={isUploadingFont}
                    />
                    <span className="font-dropzone-icon">
                      {isUploadingFont ? '[...]' : isSubFontDragging ? 'v' : '[+]'}
                    </span>
                    <div className="font-dropzone-text">
                      <span className="font-dropzone-title">
                        {isUploadingFont ? (t.studio.uploadingFont || 'Uploading font...') : (t.studio.dropFontHint || 'Upload Custom Font (.ttf, .otf, .woff, .woff2)')}
                      </span>
                      <span className="font-dropzone-desc">
                        {t.studio.dropFontSub || 'Drag & drop font file here or click to browse'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subtitle Font Size Presets & Uncapped Manual PX Input */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                  <span className="sub-toggle-label">{t.studio.fontSize}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <div className="toggle-pill-group">
                      <button
                        type="button"
                        className={`pill-btn ${fontSize === 'small' ? 'active' : ''}`}
                        onClick={() => {
                          setFontSize('small');
                          setFontSizePx(55);
                        }}
                      >
                        {t.studio.sizeSmall} (55px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${fontSize === 'medium' ? 'active' : ''}`}
                        onClick={() => {
                          setFontSize('medium');
                          setFontSizePx(75);
                        }}
                      >
                        {t.studio.sizeMedium} (75px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${fontSize === 'big' ? 'active' : ''}`}
                        onClick={() => {
                          setFontSize('big');
                          setFontSizePx(95);
                        }}
                      >
                        {t.studio.sizeBig} (95px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${fontSize === 'custom' ? 'active' : ''}`}
                        onClick={() => setFontSize('custom')}
                      >
                        {t.studio.sizeCustom || 'Custom'}
                      </button>
                    </div>
                    {/* Manual Numeric PX Input (Unlimited, 1 - 1000px) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        step="1"
                        value={fontSizePx || ''}
                        placeholder="px"
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setFontSizePx(0);
                            setFontSize('custom');
                            return;
                          }
                          const num = parseInt(raw, 10);
                          const val = isNaN(num) ? 0 : Math.max(1, Math.min(1000, num));
                          setFontSizePx(val);
                          setFontSize('custom');
                        }}
                        className="studio-text-input"
                        style={{
                          width: '72px',
                          padding: '0.22rem 0.45rem',
                          fontSize: '0.78rem',
                          textAlign: 'center',
                          borderRadius: '6px',
                          border: fontSize === 'custom' ? '1px solid var(--primary, #38bdf8)' : '1px solid rgba(255,255,255,0.15)',
                        }}
                        title="Enter custom subtitle font size in pixels (px, 1 - 1000)"
                      />
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>px</span>
                    </div>
                  </div>
                </div>

                {/* Text Letter Style Presets */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                  <span className="sub-toggle-label">{t.studio.letterStyle}</span>
                  <div className="toggle-pill-group">
                    <button
                      type="button"
                      className={`pill-btn ${textCase === 'uppercase' ? 'active' : ''}`}
                      onClick={() => setTextCase('uppercase')}
                    >
                      {t.studio.letterCaps}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${textCase === 'capitalize' ? 'active' : ''}`}
                      onClick={() => setTextCase('capitalize')}
                    >
                      {t.studio.letterTitle}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${textCase === 'lowercase' ? 'active' : ''}`}
                      onClick={() => setTextCase('lowercase')}
                    >
                      {t.studio.letterLower}
                    </button>
                  </div>
                </div>

                {/* Subtitle Placement & Vertical Position */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.85rem' }}>
                  <span className="sub-toggle-label">{t.studio.subPlacement}</span>
                  <div className="toggle-pill-group">
                    <button
                      type="button"
                      className={`pill-btn ${subtitlePositionMode === 'bottom' ? 'active' : ''}`}
                      onClick={() => setSubtitlePositionMode('bottom')}
                    >
                      {t.studio.subBottom}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${subtitlePositionMode === 'center' ? 'active' : ''}`}
                      onClick={() => setSubtitlePositionMode('center')}
                    >
                      {t.studio.subCenter}
                    </button>
                  </div>
                </div>

                {subtitlePositionMode === 'bottom' ? (
                  <div className="studio-sub-toggle" style={{ marginTop: '0.75rem', flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span className="sub-toggle-label" style={{ margin: 0 }}>
                        {t.studio.subYBottomLabel || "// Subtitle Bottom Position:"}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="badge" style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}>
                          {t.studio.subYBottomVal(safeSubtitleY)}
                        </span>
                        <button
                          type="button"
                          className="reset-btn"
                          onClick={handleResetSubtitlePosition}
                          title={t.studio.resetPositionTooltip}
                          style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          {t.studio.resetPosition}
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max={maxSubY}
                      step="1"
                      value={safeSubtitleY}
                      onChange={(e) => setSubtitleYPercent(Number(e.target.value))}
                      className="position-slider"
                      style={{ '--slider-progress': `${Math.max(0, Math.min(100, ((safeSubtitleY - 5) / (maxSubY - 5 || 1)) * 100))}%` } as React.CSSProperties}
                    />
                    <div className="quick-presets-row" style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`pill-btn ${safeSubtitleY === 12 ? 'active' : ''}`}
                        onClick={() => setSubtitleYPercent(12)}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      >
                        {t.studio.quickLow(12)}
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${safeSubtitleY === getDefaultPositions(aspectRatio, titleLineCount, streamerPreset).subtitleY ? 'active' : ''}`}
                        onClick={handleResetSubtitlePosition}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      >
                        {t.studio.quickSnugDefault(`${getDefaultPositions(aspectRatio, titleLineCount, streamerPreset).subtitleY}%`)}
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${safeSubtitleY === 32 ? 'active' : ''}`}
                        onClick={() => setSubtitleYPercent(32)}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      >
                        {t.studio.quickMid(32)}
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${safeSubtitleY === 42 ? 'active' : ''}`}
                        onClick={() => setSubtitleYPercent(42)}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      >
                        {t.studio.quickHigh ? t.studio.quickHigh(42) : `High (42%)`}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="studio-sub-toggle" style={{ marginTop: '0.75rem', flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span className="sub-toggle-label" style={{ margin: 0 }}>
                        {t.studio.subYCenterLabel || "> Subtitle Center Vertical Position:"}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="badge" style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem' }}>
                          {t.studio.subYCenterVal(
                            safeSubCenterY,
                            safeSubCenterY === 50
                              ? t.studio.posDeadCenter
                              : safeSubCenterY < 50
                              ? t.studio.posUpper
                              : t.studio.posLower
                          )}
                        </span>
                        <button
                          type="button"
                          className="reset-btn"
                          onClick={handleResetSubtitlePosition}
                          title={t.studio.resetPositionTooltip}
                          style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          {t.studio.resetPosition}
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={minCenterY}
                      max={maxCenterY}
                      step="1"
                      value={safeSubCenterY}
                      onChange={(e) => setSubtitleCenterYPercent(Number(e.target.value))}
                      className="position-slider"
                      style={{ '--slider-progress': `${Math.max(0, Math.min(100, ((safeSubCenterY - minCenterY) / (maxCenterY - minCenterY || 1)) * 100))}%` } as React.CSSProperties}
                    />
                    <div className="quick-presets-row" style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`pill-btn ${safeSubCenterY === Math.max(minCenterY, 40) ? 'active' : ''}`}
                        onClick={() => setSubtitleCenterYPercent(Math.max(minCenterY, 40))}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      >
                        {t.studio.quickUpper(Math.max(minCenterY, 40))}
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${safeSubCenterY === 50 ? 'active' : ''}`}
                        onClick={() => setSubtitleCenterYPercent(50)}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      >
                        {t.studio.quickDeadCenter(50)}
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${safeSubCenterY === Math.min(maxCenterY, 60) ? 'active' : ''}`}
                        onClick={() => setSubtitleCenterYPercent(Math.min(maxCenterY, 60))}
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.45rem' }}
                      >
                        {t.studio.quickLower(Math.min(maxCenterY, 60))}
                      </button>
                    </div>
                  </div>
                )}

                {/* Subtitle Audio Sync Offset (Nudge Earlier / Later) */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.85rem', flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.35rem' }}>
                    <span className="sub-toggle-label" style={{ margin: 0 }}>
                      {t.studio.subtitleSyncLabel || "// Subtitle Audio Sync Offset:"}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span className="badge" style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem', background: subtitleOffsetSeconds !== 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.08)', color: subtitleOffsetSeconds !== 0 ? '#38bdf8' : 'var(--text-muted)' }}>
                        {subtitleOffsetSeconds > 0 ? `+${subtitleOffsetSeconds.toFixed(2)}s (Later)` : subtitleOffsetSeconds < 0 ? `${subtitleOffsetSeconds.toFixed(2)}s (Earlier)` : 'Exact Sync (0.00s)'}
                      </span>
                      {subtitleOffsetSeconds !== 0 && (
                        <button
                          type="button"
                          className="reset-btn"
                          onClick={() => setSubtitleOffsetSeconds(0)}
                          title="Reset sync offset to 0.00s"
                          style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          {t.studio.resetSync || "↺ 0.00s"}
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="range"
                    min="-1.50"
                    max="1.50"
                    step="0.05"
                    value={subtitleOffsetSeconds}
                    onChange={(e) => setSubtitleOffsetSeconds(Number(e.target.value))}
                    className="position-slider"
                    style={{ '--slider-progress': `${Math.max(0, Math.min(100, ((subtitleOffsetSeconds - (-1.5)) / 3.0) * 100))}%` } as React.CSSProperties}
                  />
                  <div className="quick-presets-row" style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`pill-btn ${subtitleOffsetSeconds === -0.3 ? 'active' : ''}`}
                      onClick={() => setSubtitleOffsetSeconds(-0.3)}
                      style={{ fontSize: '0.70rem', padding: '0.15rem 0.45rem' }}
                      title="Nudge captions 0.3s earlier (fixes lagging behind)"
                    >
                      -0.30s (Earlier)
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${subtitleOffsetSeconds === -0.15 ? 'active' : ''}`}
                      onClick={() => setSubtitleOffsetSeconds(-0.15)}
                      style={{ fontSize: '0.70rem', padding: '0.15rem 0.45rem' }}
                    >
                      -0.15s
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${subtitleOffsetSeconds === 0 ? 'active' : ''}`}
                      onClick={() => setSubtitleOffsetSeconds(0)}
                      style={{ fontSize: '0.70rem', padding: '0.15rem 0.45rem' }}
                    >
                      0.00s (Default)
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${subtitleOffsetSeconds === 0.15 ? 'active' : ''}`}
                      onClick={() => setSubtitleOffsetSeconds(0.15)}
                      style={{ fontSize: '0.70rem', padding: '0.15rem 0.45rem' }}
                    >
                      +0.15s
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${subtitleOffsetSeconds === 0.3 ? 'active' : ''}`}
                      onClick={() => setSubtitleOffsetSeconds(0.3)}
                      style={{ fontSize: '0.70rem', padding: '0.15rem 0.45rem' }}
                      title="Nudge captions 0.3s later (fixes coming too early)"
                    >
                      +0.30s (Later)
                    </button>
                  </div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {subtitleOffsetSeconds < 0 ? (t.studio.syncEarlierHint || "◀ Nudged earlier: fixes captions lagging behind audio") : subtitleOffsetSeconds > 0 ? (t.studio.syncLaterHint || "▶ Nudged later: fixes captions appearing before speaker speaks") : (t.studio.syncDefaultHint || "Audio sync alignment. Nudge earlier if lagging, or later if rushing ahead.")}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 6. Background Music (BGM) */}
          <div className="studio-card-group group-bgm">
            <div className="group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span className="group-title">{t.studio.bgmTitle}</span>
                {bgmFilePath && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={bgmEnabled}
                      onChange={e => setBgmEnabled(e.target.checked)}
                      style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                  </label>
                )}
              </div>
              <span className="group-badge" style={{ color: bgmEnabled && bgmFilePath ? '#10b981' : 'var(--text-muted)' }}>
                {bgmEnabled && bgmFilePath ? t.studio.bgmActiveBadge : t.studio.bgmOptionalBadge}
              </span>
            </div>

            <div className="bgm-control-card">
              {!bgmFilePath ? (
                <label
                  className={`bgm-dropzone ${isBgmDragging ? 'drag-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsBgmDragging(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsBgmDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsBgmDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) uploadBgmFile(file);
                  }}
                >
                  <input
                    type="file"
                    accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*"
                    onChange={handleBgmUpload}
                    style={{ display: 'none' }}
                    disabled={isUploadingBgm}
                  />
                  <div className="dropzone-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isUploadingBgm ? <RefreshCw size={20} className="spinner-icon" /> : <Music size={20} color="var(--primary)" />}
                  </div>
                  <div className="dropzone-text">
                    <span className="dropzone-main-text">
                      {isUploadingBgm ? 'Uploading Audio...' : isBgmDragging ? t.studio.bgmDropActive : t.studio.bgmUploadMain}
                    </span>
                    <span className="dropzone-sub-text">{t.studio.bgmUploadSub}</span>
                  </div>
                </label>
              ) : (
                <div className="bgm-active-file-row">
                  <div className="bgm-info">
                    <span className="bgm-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Music size={16} color="var(--primary)" />
                    </span>
                    <div className="bgm-details">
                      <span className="bgm-filename" title={bgmFileName}>{bgmFileName}</span>
                      <span className="bgm-status-tag">{t.studio.bgmReadyTag}</span>
                    </div>
                  </div>
                  <div className="bgm-actions">
                    {bgmAudioUrl && (
                      <button
                        type="button"
                        className="bgm-preview-btn"
                        onClick={toggleBgmPlayback}
                        title={isBgmPlaying ? t.studio.bgmPause : t.studio.bgmPlay}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {isBgmPlaying ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="bgm-remove-btn"
                      onClick={handleRemoveBgm}
                      title={t.studio.bgmRemoveTooltip}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Volume Slider & Quick Presets */}
              {bgmFilePath && (
                <div className="slider-control-item" style={{ marginTop: '0.9rem' }}>
                  <div className="slider-label-row">
                    <span className="slider-label">{t.studio.bgmVolumeLabel}</span>
                    <div className="slider-input-badge-wrap">
                      <input
                        type="number"
                        className="slider-number-input"
                        min={0}
                        max={100}
                        value={bgmVolume}
                        onChange={e => setBgmVolume(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                      />
                      <span className="slider-input-unit">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    className="studio-slider"
                    min="0"
                    max="100"
                    step="1"
                    value={bgmVolume}
                    onChange={e => setBgmVolume(Number(e.target.value))}
                    style={{ '--slider-progress': `${Math.max(0, Math.min(100, bgmVolume))}%` } as React.CSSProperties}
                  />
                  <div className="slider-quick-buttons">
                    <button type="button" onClick={() => setBgmVolume(10)}>10%</button>
                    <button type="button" onClick={() => setBgmVolume(20)}>20% (Default)</button>
                    <button type="button" onClick={() => setBgmVolume(35)}>35%</button>
                    <button type="button" onClick={() => setBgmVolume(50)}>50%</button>
                    <button type="button" onClick={() => setBgmVolume(80)}>80%</button>
                  </div>
                  {/* BGM Start Offset Selector */}
                  <div className="slider-control-item" style={{ marginTop: '0.85rem' }}>
                    <div className="slider-label-row">
                      <span className="slider-label">{t.studio.bgmStartOffsetLabel}</span>
                      <span className="slider-val-badge">
                        {formatDuration(bgmStartOffset)} {bgmDuration > 0 ? `/ ${formatDuration(bgmDuration)}` : ''}
                      </span>
                    </div>
                    <input
                      type="range"
                      className="studio-slider"
                      min="0"
                      max={bgmDuration > 0 ? Math.floor(bgmDuration) : 180}
                      step="0.5"
                      value={bgmStartOffset}
                      onChange={e => handleBgmStartOffsetChange(Number(e.target.value))}
                      style={{ '--slider-progress': `${Math.max(0, Math.min(100, (bgmStartOffset / (bgmDuration > 0 ? Math.floor(bgmDuration) : 180)) * 100))}%` } as React.CSSProperties}
                    />
                    <div className="slider-quick-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem' }}>
                      <button type="button" onClick={() => handleBgmStartOffsetChange(0)}>{t.studio.bgmStartFromBeginning}</button>
                      {bgmDuration > 0 ? (
                        <>
                          {bgmDuration > 15 && <button type="button" onClick={() => handleBgmStartOffsetChange(15)}>0:15</button>}
                          {bgmDuration > 30 && <button type="button" onClick={() => handleBgmStartOffsetChange(30)}>0:30</button>}
                          {bgmDuration > 45 && <button type="button" onClick={() => handleBgmStartOffsetChange(45)}>0:45</button>}
                          {bgmDuration > 60 && <button type="button" onClick={() => handleBgmStartOffsetChange(60)}>1:00</button>}
                          {bgmDuration > 90 && <button type="button" onClick={() => handleBgmStartOffsetChange(90)}>1:30</button>}
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => handleBgmStartOffsetChange(15)}>0:15</button>
                          <button type="button" onClick={() => handleBgmStartOffsetChange(30)}>0:30</button>
                          <button type="button" onClick={() => handleBgmStartOffsetChange(60)}>1:00</button>
                        </>
                      )}
                    </div>
                    <p className="bgm-hint-text" style={{ marginTop: '0.35rem' }}>
                      {t.studio.bgmStartOffsetHint}
                    </p>
                  </div>

                  <p className="bgm-hint-text">{t.studio.bgmHint}</p>
                </div>
              )}
            </div>
          </div>

          {/* 6. Hook Sound Effect (SFX) */}
          <div className="studio-card-group group-sfx">
            <div className="group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="group-title">{t.studio.hookSfxTitle}</span>
              <span className="group-badge" style={{ color: hookSfxFilePath ? '#10b981' : 'var(--text-muted)', fontWeight: 500 }}>
                {hookSfxFilePath ? t.studio.hookSfxActiveBadge : t.studio.bgmOptionalBadge}
              </span>
            </div>

            <div className="group-content" style={{ marginTop: '0.6rem' }}>
              {!hookSfxFilePath ? (
                <label
                  className={`bgm-dropzone ${isHookSfxDragging ? 'drag-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsHookSfxDragging(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsHookSfxDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsHookSfxDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) uploadHookSfxFile(file);
                  }}
                >
                  <input
                    type="file"
                    accept="audio/mp3,audio/wav,audio/m4a,audio/aac,audio/ogg,audio/flac,audio/mpeg,audio/*"
                    onChange={handleHookSfxUpload}
                    style={{ display: 'none' }}
                    disabled={isUploadingHookSfx}
                  />
                  <div className="dropzone-icon">{isUploadingHookSfx ? '[...]' : isHookSfxDragging ? 'v' : '*'}</div>
                  <div className="dropzone-text">
                    <span className="dropzone-main-text">
                      {isUploadingHookSfx ? 'Uploading SFX...' : isHookSfxDragging ? t.studio.hookSfxDropActive : t.studio.hookSfxUploadMain}
                    </span>
                    <span className="dropzone-sub-text">{t.studio.hookSfxUploadSub}</span>
                  </div>
                </label>
              ) : (
                <div className="bgm-active-file-row">
                  <div className="bgm-info">
                    <span className="bgm-icon">*</span>
                    <div className="bgm-details">
                      <span className="bgm-filename" title={hookSfxFileName}>{hookSfxFileName}</span>
                      <span className="bgm-status-tag" style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#facc15', borderColor: 'rgba(234, 179, 8, 0.3)' }}>
                        {t.studio.hookSfxFirstFrameBadge}
                      </span>
                    </div>
                  </div>
                  <div className="bgm-actions">
                    {hookSfxAudioUrl && (
                      <button
                        type="button"
                        className="bgm-preview-btn"
                        onClick={toggleHookSfxPlayback}
                        title={isHookSfxPlaying ? t.studio.hookSfxPause : t.studio.hookSfxPlay}
                      >
                        {isHookSfxPlaying ? '⏸' : '▶'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="bgm-remove-btn"
                      onClick={handleRemoveHookSfx}
                      title={t.studio.hookSfxRemoveTooltip}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Volume Slider & Presets for SFX */}
              {hookSfxFilePath && (
                <div className="slider-control-item" style={{ marginTop: '0.9rem' }}>
                  <div className="slider-label-row">
                    <span className="slider-label">{t.studio.hookSfxVolumeLabel}</span>
                    <div className="slider-input-badge-wrap">
                      <input
                        type="number"
                        className="slider-number-input"
                        min={0}
                        max={150}
                        value={hookSfxVolume}
                        onChange={e => setHookSfxVolume(Math.max(0, Math.min(150, Number(e.target.value) || 0)))}
                      />
                      <span className="slider-input-unit">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    className="studio-slider"
                    min="0"
                    max="150"
                    step="5"
                    value={hookSfxVolume}
                    onChange={e => setHookSfxVolume(Number(e.target.value))}
                    style={{ '--slider-progress': `${Math.max(0, Math.min(100, (hookSfxVolume / 150) * 100))}%` } as React.CSSProperties}
                  />
                  <div className="slider-quick-buttons">
                    <button type="button" onClick={() => setHookSfxVolume(50)}>50%</button>
                    <button type="button" onClick={() => setHookSfxVolume(80)}>80%</button>
                    <button type="button" onClick={() => setHookSfxVolume(100)}>100% (Default)</button>
                    <button type="button" onClick={() => setHookSfxVolume(125)}>125% (Punchy)</button>
                  </div>
                  <p className="bgm-hint-text">{t.studio.hookSfxHint}</p>
                </div>
              )}
            </div>
          </div>

          {/* 7. Original Clip Voice Audio Boost */}
          <div className="studio-card-group group-audio-boost">
            <div className="group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span className="group-title">{t.studio.rawAudioTitle}</span>
                <span className={`status-pill ${originalAudioVolume > 100 ? 'pill-active' : ''}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                  {originalAudioVolume > 100 ? `* Boosted (${originalAudioVolume}%)` : `${originalAudioVolume}% Volume`}
                </span>
              </div>
            </div>

            <div className="group-content" style={{ marginTop: '0.6rem' }}>
              <div className="slider-control-item">
                <div className="slider-label-row">
                  <span className="slider-label">{t.studio.rawAudioVolumeLabel}</span>
                  <div className="slider-input-badge-wrap">
                    <input
                      type="number"
                      className="slider-number-input"
                      min={0}
                      max={200}
                      step={5}
                      value={originalAudioVolume}
                      onChange={e => setOriginalAudioVolume(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                    />
                    <span className="slider-input-unit">%</span>
                  </div>
                </div>
                <input
                  type="range"
                  className="studio-slider"
                  min="0"
                  max="200"
                  step="5"
                  value={originalAudioVolume}
                  onChange={e => setOriginalAudioVolume(Number(e.target.value))}
                  style={{ '--slider-progress': `${Math.max(0, Math.min(100, (originalAudioVolume / 200) * 100))}%` } as React.CSSProperties}
                />
                <div className="slider-quick-buttons">
                  <button type="button" onClick={() => setOriginalAudioVolume(50)}>50%</button>
                  <button type="button" onClick={() => setOriginalAudioVolume(80)}>80%</button>
                  <button type="button" onClick={() => setOriginalAudioVolume(100)}>100% (Normal)</button>
                  <button type="button" onClick={() => setOriginalAudioVolume(125)}>125%</button>
                  <button type="button" onClick={() => setOriginalAudioVolume(150)}>150% (Punchy)</button>
                  <button type="button" onClick={() => setOriginalAudioVolume(200)}>200% (Max Boost)</button>
                </div>
                <p className="bgm-hint-text">{t.studio.rawAudioVolumeHint}</p>
              </div>
            </div>
          </div>

          {/* 8. Video Watermark Branding */}
          <div className="studio-card-group group-watermark" style={!watermarkEnabled ? { padding: '1rem 1.4rem' } : undefined}>
            <div className="group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: watermarkEnabled ? '0.85rem' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span className="group-title" style={{ margin: 0 }}>{t.studio.watermarkTitle}</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={watermarkEnabled}
                    onChange={e => setWatermarkEnabled(e.target.checked)}
                    style={{ accentColor: 'var(--primary)', width: '15px', height: '15px', cursor: 'pointer', margin: 0 }}
                  />
                </label>
                <span className={`status-pill ${watermarkEnabled ? 'pill-active' : ''}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem', fontWeight: 500 }}>
                  {watermarkEnabled ? t.studio.watermarkBadgeEnabled : t.studio.watermarkBadgeDisabled}
                </span>
              </div>
            </div>

            {watermarkEnabled && (
              <div className="group-content" style={{ marginTop: '0.6rem' }}>
                {/* Type Selection */}
                <div className="watermark-type-toggle" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t.studio.watermarkTypeLabel}</span>
                  <div className="toggle-pill-group">
                    <button
                      type="button"
                      className={`pill-btn ${watermarkType === 'image' ? 'active' : ''}`}
                      onClick={() => handleSelectWatermarkType('image')}
                    >
                      {t.studio.watermarkTypeImage}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${watermarkType === 'text' ? 'active' : ''}`}
                      onClick={() => handleSelectWatermarkType('text')}
                    >
                      {t.studio.watermarkTypeText}
                    </button>
                  </div>
                </div>

                {watermarkType === 'image' ? (
                  <div className="watermark-upload-area">
                    {!watermarkImageUrl ? (
                      <label
                        className={`bgm-dropzone ${isWatermarkDragging ? 'drag-over' : ''}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsWatermarkDragging(true);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsWatermarkDragging(false);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsWatermarkDragging(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) uploadWatermarkFile(file);
                        }}
                      >
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
                          onChange={handleWatermarkUpload}
                          style={{ display: 'none' }}
                          disabled={isUploadingWatermark}
                        />
                        <div className="dropzone-icon">{isUploadingWatermark ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> : isWatermarkDragging ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>}</div>
                        <div className="dropzone-text">
                          <span className="dropzone-main-text">
                            {isUploadingWatermark ? 'Uploading Watermark...' : isWatermarkDragging ? t.studio.watermarkDropActive : t.studio.watermarkUploadMain}
                          </span>
                          <span className="dropzone-sub-text">{t.studio.watermarkUploadSub}</span>
                        </div>
                      </label>
                    ) : (
                      <div className="bgm-active-file-row">
                        <div className="bgm-info">
                          <img
                            src={watermarkImageUrl}
                            alt="Logo"
                            style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }}
                          />
                          <div className="bgm-details">
                            <span className="bgm-filename" title={watermarkImageFileName}>{watermarkImageFileName}</span>
                            <span className="bgm-status-tag">{t.studio.watermarkActiveTag}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="bgm-remove-btn"
                          onClick={handleRemoveWatermarkImage}
                          title={t.studio.watermarkRemoveTooltip}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="watermark-text-wrap" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <input
                      type="text"
                      className="studio-title-input"
                      placeholder={t.studio.watermarkTextPlaceholder}
                      value={watermarkText}
                      onChange={e => setWatermarkText(e.target.value)}
                      style={{ fontSize: '0.85rem', padding: '0.55rem 0.8rem' }}
                    />
                  </div>
                )}

                {/* Sliders: Size (up to 500%), Opacity, Horizontal X, Vertical Y */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.4rem' }}>
                  {/* Size (0% - 500%) */}
                  <div className="slider-control-item">
                    <div className="slider-label-row">
                      <span className="slider-label">{t.studio.watermarkSizeLabel}</span>
                      <div className="slider-input-badge-wrap">
                        <input
                          type="number"
                          className="slider-number-input"
                          min={0}
                          max={500}
                          value={watermarkSize}
                          onChange={e => setWatermarkSize(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                        />
                        <span className="slider-input-unit">%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      className="studio-slider"
                      min="0"
                      max="500"
                      step="1"
                      value={watermarkSize}
                      onChange={e => setWatermarkSize(Number(e.target.value))}
                      style={{ '--slider-progress': `${Math.max(0, Math.min(100, (watermarkSize / 500) * 100))}%` } as React.CSSProperties}
                    />
                    <div className="slider-quick-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem' }}>
                      {[10, 25, 50, 100, 200, 350, 500].map(sz => (
                        <button
                          key={sz}
                          type="button"
                          className={`quick-sz-btn ${watermarkSize === sz ? 'active' : ''}`}
                          style={{
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.72rem',
                            borderRadius: '4px',
                            background: watermarkSize === sz ? 'var(--primary)' : 'rgba(255,255,255,0.06)',
                            color: watermarkSize === sz ? '#fff' : 'var(--text-muted)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setWatermarkSize(sz)}
                        >
                          {sz}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Opacity */}
                  <div className="slider-control-item">
                    <div className="slider-label-row">
                      <span className="slider-label">{t.studio.watermarkOpacityLabel}</span>
                      <div className="slider-input-badge-wrap">
                        <input
                          type="number"
                          className="slider-number-input"
                          min={10}
                          max={100}
                          value={watermarkOpacity}
                          onChange={e => setWatermarkOpacity(Math.max(10, Math.min(100, Number(e.target.value) || 10)))}
                        />
                        <span className="slider-input-unit">%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      className="studio-slider"
                      min="10"
                      max="100"
                      step="5"
                      value={watermarkOpacity}
                      onChange={e => setWatermarkOpacity(Number(e.target.value))}
                      style={{ '--slider-progress': `${Math.max(0, Math.min(100, ((watermarkOpacity - 10) / (90)) * 100))}%` } as React.CSSProperties}
                    />
                  </div>

                  {/* Horizontal Position X */}
                  <div className="slider-control-item">
                    <div className="slider-label-row">
                      <span className="slider-label">{t.studio.watermarkXLabel}</span>
                      <div className="slider-input-badge-wrap">
                        <input
                          type="number"
                          className="slider-number-input"
                          min={0}
                          max={100}
                          value={watermarkX}
                          onChange={e => setWatermarkX(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                        />
                        <span className="slider-input-unit">%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      className="studio-slider"
                      min="0"
                      max="100"
                      step="1"
                      value={watermarkX}
                      onChange={e => setWatermarkX(Number(e.target.value))}
                      style={{ '--slider-progress': `${Math.max(0, Math.min(100, watermarkX))}%` } as React.CSSProperties}
                    />
                  </div>

                  {/* Vertical Position Y */}
                  <div className="slider-control-item">
                    <div className="slider-label-row">
                      <span className="slider-label">{t.studio.watermarkYLabel}</span>
                      <div className="slider-input-badge-wrap">
                        <input
                          type="number"
                          className="slider-number-input"
                          min={0}
                          max={100}
                          value={watermarkY}
                          onChange={e => setWatermarkY(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                        />
                        <span className="slider-input-unit">%</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      className="studio-slider"
                      min="0"
                      max="100"
                      step="1"
                      value={watermarkY}
                      onChange={e => setWatermarkY(Number(e.target.value))}
                      style={{ '--slider-progress': `${Math.max(0, Math.min(100, watermarkY))}%` } as React.CSSProperties}
                    />
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="slider-quick-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.35rem' }}>
                    <button type="button" onClick={() => applyWatermarkPreset('tl')}>{t.studio.watermarkPresetTopLeft}</button>
                    <button type="button" onClick={() => applyWatermarkPreset('tc')}>{t.studio.watermarkPresetTopCenter}</button>
                    <button type="button" onClick={() => applyWatermarkPreset('tr')}>{t.studio.watermarkPresetTopRight}</button>
                    <button type="button" onClick={() => applyWatermarkPreset('c')}>{t.studio.watermarkPresetCenter}</button>
                    <button type="button" onClick={() => applyWatermarkPreset('bl')}>{t.studio.watermarkPresetBottomLeft}</button>
                    <button type="button" onClick={() => applyWatermarkPreset('bc')}>{t.studio.watermarkPresetBottomCenter}</button>
                    <button type="button" onClick={() => applyWatermarkPreset('br')}>{t.studio.watermarkPresetBottomRight}</button>
                  </div>

                  {/* Reset Button */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                    <button
                      type="button"
                      onClick={handleResetWatermark}
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        fontSize: '0.72rem',
                        padding: '0.25rem 0.6rem',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {t.studio.watermarkResetBtn}
                    </button>
                  </div>

                  <p className="bgm-hint-text">{t.studio.watermarkDragHint}</p>
                </div>
              </div>
            )}
          </div>

          {/* Video File Name Option */}
          <div className="studio-card-group group-filename">
            <div className="group-header">
              <span className="group-title">{t.studio.fileNameTitle}</span>
              <span className="group-badge">{t.studio.fileNameBadge}</span>
            </div>

            <div className="hook-prefix-suffix-grid">
              <div className="hook-input-col">
                <label className="hook-input-label">{t.studio.fileNamePrefixLabel}</label>
                <input
                  type="text"
                  className="studio-text-input"
                  placeholder={t.studio.fileNamePrefixPlaceholder}
                  value={fileNamePrefix}
                  onChange={e => setFileNamePrefix(e.target.value)}
                />
              </div>
              <div className="hook-input-col">
                <label className="hook-input-label">{t.studio.fileNameSuffixLabel}</label>
                <input
                  type="text"
                  className="studio-text-input"
                  placeholder={t.studio.fileNameSuffixPlaceholder}
                  value={fileNameSuffix}
                  onChange={e => setFileNameSuffix(e.target.value)}
                />
              </div>
            </div>

            {/* Filename Output Example Preview Box */}
            <div className="filename-preview-box">
              <div className="filename-preview-header">
                <span className="filename-preview-label">{t.studio.fileNameExampleLabel}</span>
                <span className="filename-preview-tag">.mp4</span>
              </div>
              <div className="filename-preview-display">
                <span className="fn-icon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileCode size={14} color="var(--primary)" />
                </span>
                <span className="fn-text">
                  {fileNamePrefix && <span className="pfx-highlight">{fileNamePrefix.replace(/[\\/*?:"<>|]/g, '')}</span>}
                  <span className="base-highlight">{sampleCleanTitle}</span>
                  {fileNameSuffix && <span className="sfx-highlight">{fileNameSuffix.replace(/[\\/*?:"<>|]/g, '')}</span>}
                  <span className="ext-highlight">.mp4</span>
                </span>
              </div>
              <p className="filename-preview-tip">{t.studio.fileNameTip}</p>
            </div>
          </div>

          {/* Batch Clip Hook / Title Customizer for All Selected Clips */}
          <div className="studio-card-group group-batch-titles">
            <div className="group-header">
              <span className="group-title">{t.studio.batchClipTitlesTitle}</span>
              <span className="group-badge">
                {selectedClips.length} {selectedClips.length === 1 ? t.studio.clipSelectedSingle : t.studio.clipSelectedPlural}
              </span>
            </div>

            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 0.75rem 0', lineHeight: 1.45 }}>
              {t.studio.batchClipTitlesDesc}
            </p>

            {selectedClips.length === 0 ? (
              <div className="batch-titles-empty-box">
                <span>ℹ️</span>
                <span>{t.studio.batchClipTitlesEmpty}</span>
              </div>
            ) : (
              <div className="batch-titles-list">
                {selectedClips.map((clip, i) => {
                  const clipKey = `${clip.start_time}_${clip.end_time}`;
                  const custom = customClipTitles[clipKey];
                  const originalSuggestion = (clip.title_suggestion || clip.title || '').trim();
                  const baseTitle = (custom !== undefined && custom.trim() !== '') ? custom : originalSuggestion;
                  const hasCustomTitle = custom !== undefined && custom.trim() !== '' && custom.trim() !== originalSuggestion;
                  const isCurrentActivePreview = currentPreviewClip && currentPreviewClip.start_time === clip.start_time && currentPreviewClip.end_time === clip.end_time;
                  const originalIndex = allClips.findIndex(c => c.start_time === clip.start_time && c.end_time === clip.end_time);
                  const clipDisplayNum = originalIndex !== -1 ? originalIndex + 1 : i + 1;

                  return (
                    <div
                      key={clipKey}
                      className={`batch-title-card-item ${isCurrentActivePreview ? 'active-preview-border' : ''}`}
                    >
                      <div className="batch-title-card-header">
                        <div className="batch-title-card-left">
                          <span className="batch-title-clip-badge">#{clipDisplayNum}</span>
                          <span className="batch-title-ts">
                             {Math.floor(clip.start_time / 60)}:{(clip.start_time % 60).toFixed(0).padStart(2, '0')} - {Math.floor(clip.end_time / 60)}:{(clip.end_time % 60).toFixed(0).padStart(2, '0')} ({(clip.end_time - clip.start_time).toFixed(0)}s)
                          </span>
                          {typeof clip.virality_score === 'number' && (
                            <span className="batch-title-score-pill"> {clip.virality_score}%</span>
                          )}
                        </div>

                        <div className="batch-title-card-right">
                          {renderMode === 'merged' && (
                            <div className="segment-reorder-group">
                              <button
                                type="button"
                                className="segment-reorder-btn"
                                onClick={() => handleMoveClipUp(i)}
                                disabled={i === 0}
                                title={t.studio.moveSegmentUp}
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                className="segment-reorder-btn"
                                onClick={() => handleMoveClipDown(i)}
                                disabled={i === selectedClips.length - 1}
                                title={t.studio.moveSegmentDown}
                              >
                                ▼
                              </button>
                            </div>
                          )}
                          {hasCustomTitle && (
                            <button
                              type="button"
                              className="batch-title-reset-btn"
                              onClick={() => {
                                setCustomClipTitles(prev => {
                                  const next = { ...prev };
                                  delete next[clipKey];
                                  return next;
                                });
                              }}
                              title={t.studio.resetToAiTitle}
                            >
                              ↺ {t.studio.resetToAiTitle}
                            </button>
                          )}
                          <button
                            type="button"
                            className={`batch-title-preview-btn ${isCurrentActivePreview ? 'is-active' : ''}`}
                            onClick={() => {
                              if (originalIndex !== -1) {
                                setPreviewClipIndex(originalIndex);
                              }
                            }}
                            title={isCurrentActivePreview ? t.studio.batchClipTitlesActivePreview : t.studio.batchClipTitlesPreviewBtn}
                          >
                            {isCurrentActivePreview ? `● ${t.studio.batchClipTitlesActivePreview}` : t.studio.batchClipTitlesPreviewBtn}
                          </button>
                        </div>
                      </div>

                      <div className="batch-title-input-wrapper">
                        <input
                          type="text"
                          className="batch-title-input"
                          placeholder={originalSuggestion || t.studio.titlePlaceholder}
                          value={custom !== undefined ? custom : (originalSuggestion || '')}
                          onChange={e => {
                            const val = e.target.value;
                            setCustomClipTitles(prev => ({
                              ...prev,
                              [clipKey]: val,
                            }));
                          }}
                        />
                      </div>

                      {(titlePrefix || titleSuffix) && (
                        <div className="batch-title-combined-preview">
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{t.studio.batchClipTitlesCombinedPreview}</span>
                          <span>
                            {titlePrefix && <span className="pfx-highlight">{titlePrefix}</span>}
                            <span className="base-highlight">{baseTitle || 'YOUR VIRAL HOOK TITLE'}</span>
                            {titleSuffix && <span className="sfx-highlight">{titleSuffix}</span>}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Export Mode Switcher (Separate vs Merged Highlight Video) */}
          <div className="studio-card-group export-mode-group group-export-mode">
            <div className="group-header">
              <span className="group-title">* {t.studio.renderModeTitle}</span>
              {renderMode === 'merged' && (
                <span className="group-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  {t.studio.compilationSegmentsSummary(selectedClips.length, totalSelectedDuration)}
                </span>
              )}
            </div>

            <div className="export-mode-switcher">
              <button
                type="button"
                className={`export-mode-btn ${renderMode === 'separate' ? 'active' : ''}`}
                onClick={() => setRenderMode('separate')}
              >
                <div className="mode-btn-content">
                  <span className="mode-btn-title">{t.studio.renderModeSeparate}</span>
                  <span className="mode-btn-desc">{t.studio.renderModeSeparateDesc}</span>
                </div>
              </button>

              <button
                type="button"
                className={`export-mode-btn ${renderMode === 'merged' ? 'active' : ''}`}
                onClick={() => setRenderMode('merged')}
              >
                <div className="mode-btn-content">
                  <span className="mode-btn-title">{t.studio.renderModeMerged}</span>
                  <span className="mode-btn-desc">{t.studio.renderModeMergedDesc}</span>
                </div>
              </button>
            </div>

            {/* If Merged mode is selected, show Merged Video File Name input */}
            {renderMode === 'merged' && (
              <div className="compilation-config-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                  <label className="compilation-label" style={{ margin: 0, fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <span>[+] {t.studio.compilationHookLabel}</span>
                  </label>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    {t.studio.fileNameBadge || 'Optional'}
                  </span>
                </div>
                <input
                  type="text"
                  className="compilation-title-input"
                  placeholder={
                    (() => {
                      if (selectedClips.length === 0) return t.studio.compilationHookPlaceholder;
                      const first = selectedClips[0];
                      const firstKey = `${first.start_time}_${first.end_time}`;
                      const custom = customClipTitles[firstKey];
                      const base = (custom !== undefined && custom.trim()) ? custom.trim() : (first.title_suggestion || first.title || 'Highlight Video');
                      return `${base.trim()} (Merged)`;
                    })()
                  }
                  value={compilationTitle}
                  onChange={e => setCompilationTitle(e.target.value)}
                />
                <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.4 }}>
                  {t.studio.compilationFileNameHint}
                </p>
              </div>
            )}
          </div>

          {/* 9. Selected Clips Checklist */}
          <div className="studio-card-group group-checklist">
            <div className="group-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
              <span className="group-title">
                {t.studio.batchChecklist(selectedClips.length, allClips.length)}
              </span>
              {allClips.length > 0 && (
                <button
                  type="button"
                  className="studio-checklist-toggle-btn"
                  onClick={handleToggleAllClips}
                  title={selectedClips.length === allClips.length ? t.studio.unmarkAllClips : t.studio.markAllClips}
                  style={{
                    background: selectedClips.length === allClips.length ? 'rgba(239, 68, 68, 0.12)' : 'rgba(168, 85, 247, 0.15)',
                    border: selectedClips.length === allClips.length ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(168, 85, 247, 0.4)',
                    color: selectedClips.length === allClips.length ? '#f87171' : 'var(--primary, #a855f7)',
                    borderRadius: '6px',
                    padding: '0.22rem 0.55rem',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {selectedClips.length === allClips.length ? t.studio.unmarkAllClips : t.studio.markAllClips}
                </button>
              )}
            </div>
            <div className="batch-clips-list" style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {allClips.map((clip, i) => {
                const isSelected = selectedClips.some(
                  c => c.start_time === clip.start_time && c.end_time === clip.end_time
                );
                return (
                  <div
                    key={i}
                    className={`batch-clip-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleClip(clip)}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}} // handled by parent onClick
                    />
                    <div className="batch-clip-info">
                      <span className="batch-clip-title">
                        {(() => {
                          const clipKey = `${clip.start_time}_${clip.end_time}`;
                          const custom = customClipTitles[clipKey];
                          return (custom !== undefined && custom.trim()) ? custom.trim() : (clip.title_suggestion || clip.title);
                        })()}
                      </span>
                      <span className="batch-clip-ts">
                         {Math.floor(clip.start_time / 60)}:{(clip.start_time % 60).toFixed(0).padStart(2, '0')} -{' '}
                        {Math.floor(clip.end_time / 60)}:{(clip.end_time % 60).toFixed(0).padStart(2, '0')} (
                        {(clip.end_time - clip.start_time).toFixed(0)}s) · Score: {clip.virality_score}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 10. Hardware Acceleration & Video Encoder (Placed at the very bottom of controls pane) */}
          <div className="studio-card-group group-hw">
            <div className="group-header" style={{ marginBottom: '0.65rem' }}>
              <span className="group-title">{t.studio.hwTitle}</span>
              <span className="group-badge" style={{ fontWeight: 600 }}>
                {hardwareAccel === 'browser_wasm'
                  ? 'WASM'
                  : hardwareAccel === 'auto'
                  ? (hardwareInfo?.recommended ? hardwareInfo.recommended.toUpperCase() : t.studio.hwDetectedPill)
                  : hardwareAccel.toUpperCase()}
              </span>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 0.65rem 0', lineHeight: 1.4, fontWeight: 400 }}>
              {t.studio.hwSubtitle}
            </p>

            <div className="hardware-custom-dropdown" style={{ position: 'relative' }}>
              {/* Trigger Button */}
              <button
                type="button"
                id="hardware-accel-select-trigger"
                className={`hw-trigger-btn ${hwDropdownOpen ? 'open' : ''}`}
                onClick={() => setHwDropdownOpen(!hwDropdownOpen)}
                aria-haspopup="listbox"
                aria-expanded={hwDropdownOpen}
              >
                <div className="hw-trigger-left">
                  <span className="hw-trigger-badge">
                    {hardwareAccel === 'client_gpu' ? 'GPU' : hardwareAccel === 'browser_wasm' ? 'WASM' : hardwareAccel.toUpperCase()}
                  </span>
                  <div className="hw-trigger-info">
                    <span className="hw-trigger-name">
                      {hardwareAccel === 'auto'
                        ? t.studio.hwAuto
                        : hardwareAccel === 'client_gpu'
                        ? `Client GPU (${clientGpuName})`
                        : hardwareAccel === 'browser_wasm'
                        ? t.studio.hwWasm
                        : hardwareAccel === 'nvenc'
                        ? t.studio.hwNvenc
                        : hardwareAccel === 'amf'
                        ? t.studio.hwAmf
                        : hardwareAccel === 'qsv'
                        ? t.studio.hwQsv
                        : t.studio.hwCpu}
                    </span>
                    <span className="hw-trigger-status-pill">
                      {hardwareAccel === 'auto'
                        ? (hardwareInfo?.recommended ? `[${t.studio.hwDetectedPill}: ${hardwareInfo.recommended.toUpperCase()}]` : `[${t.studio.hwDetectedPill}]`)
                        : hardwareAccel === 'client_gpu'
                        ? '[WebCodecs GPU Accel]'
                        : hardwareAccel === 'browser_wasm'
                        ? '[Client Engine]'
                        : hardwareAccel === 'nvenc'
                        ? (hardwareInfo?.support?.nvenc ? `[${t.studio.hwSupportedPill}]` : `[${t.studio.hwUnavailablePill}]`)
                        : hardwareAccel === 'amf'
                        ? (hardwareInfo?.support?.amf ? `[${t.studio.hwSupportedPill}]` : `[${t.studio.hwUnavailablePill}]`)
                        : hardwareAccel === 'qsv'
                        ? (hardwareInfo?.support?.qsv ? `[${t.studio.hwSupportedPill}]` : `[${t.studio.hwUnavailablePill}]`)
                        : `[${t.studio.hwSupportedPill}]`}
                    </span>
                  </div>
                </div>
                <div className="hw-trigger-arrow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: hwDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </button>

              {/* Dropdown Menu */}
              {hwDropdownOpen && (
                <>
                  <div
                    className="hw-dropdown-backdrop"
                    onClick={() => setHwDropdownOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                  />
                  <div className="hw-dropdown-menu" role="listbox">
                    {(isLocalhost
                      ? [
                          {
                            value: 'auto' as HardwareAccelOption,
                            badge: 'AUTO',
                            title: t.studio.hwAuto,
                            desc: hardwareInfo?.recommended ? `${t.studio.hwAutoDesc} · Recommended: ${hardwareInfo.recommended.toUpperCase()}` : t.studio.hwAutoDesc,
                            status: hardwareInfo?.recommended ? `${t.studio.hwDetectedPill}: ${hardwareInfo.recommended.toUpperCase()}` : t.studio.hwDetectedPill,
                            isReady: true,
                            disabled: false,
                          },
                          ...(hasWebCodecs ? [{
                            value: 'client_gpu' as HardwareAccelOption,
                            badge: 'GPU',
                            title: `Client GPU Acceleration (${clientGpuName})`,
                            desc: 'Native WebCodecs VideoEncoder running directly on user GPU (0% Server CPU)',
                            status: 'Client GPU Native',
                            isReady: true,
                            disabled: false,
                          }] : []),
                          {
                            value: 'browser_wasm' as HardwareAccelOption,
                            badge: 'WASM',
                            title: t.studio.hwWasm,
                            desc: t.studio.hwWasmDesc || 'Browser engine client-side (0% server CPU)',
                            status: 'Client Engine',
                            isReady: true,
                            disabled: false,
                          },
                          {
                            value: 'nvenc' as HardwareAccelOption,
                            badge: 'NVENC',
                            title: t.studio.hwNvenc,
                            desc: t.studio.hwNvencDesc,
                            status: hardwareInfo?.support?.nvenc ? t.studio.hwSupportedPill : t.studio.hwUnavailablePill,
                            isReady: Boolean(hardwareInfo?.support?.nvenc),
                            disabled: Boolean(hardwareInfo?.support && !hardwareInfo.support.nvenc),
                          },
                          {
                            value: 'amf' as HardwareAccelOption,
                            badge: 'AMF',
                            title: t.studio.hwAmf,
                            desc: t.studio.hwAmfDesc,
                            status: hardwareInfo?.support?.amf ? t.studio.hwSupportedPill : t.studio.hwUnavailablePill,
                            isReady: Boolean(hardwareInfo?.support?.amf),
                            disabled: Boolean(hardwareInfo?.support && !hardwareInfo.support.amf),
                          },
                          {
                            value: 'qsv' as HardwareAccelOption,
                            badge: 'QSV',
                            title: t.studio.hwQsv,
                            desc: t.studio.hwQsvDesc,
                            status: hardwareInfo?.support?.qsv ? t.studio.hwSupportedPill : t.studio.hwUnavailablePill,
                            isReady: Boolean(hardwareInfo?.support?.qsv),
                            disabled: Boolean(hardwareInfo?.support && !hardwareInfo.support.qsv),
                          },
                          {
                            value: 'cpu' as HardwareAccelOption,
                            badge: 'CPU',
                            title: t.studio.hwCpu,
                            desc: t.studio.hwCpuDesc,
                            status: t.studio.hwSupportedPill,
                            isReady: true,
                            disabled: false,
                          },
                        ]
                      : [
                          ...(hasWebCodecs ? [{
                            value: 'client_gpu' as HardwareAccelOption,
                            badge: 'GPU',
                            title: `Client GPU Acceleration (${clientGpuName})`,
                            desc: 'WebCodecs GPU Hardware Encoder (0% Server CPU / RAM)',
                            status: 'Client GPU Native',
                            isReady: true,
                            disabled: false,
                          }] : []),
                          {
                            value: 'browser_wasm' as HardwareAccelOption,
                            badge: 'WASM',
                            title: t.studio.hwWasm || 'Browser Engine (WASM Fallback)',
                            desc: 'Client-Side WebAssembly Software Engine (0% Server CPU / RAM)',
                            status: 'Active Client Engine',
                            isReady: true,
                            disabled: false,
                          },
                        ]
                    ).map((opt) => {
                      const isSelected = hardwareAccel === opt.value;
                      return (
                        <div
                          key={opt.value}
                          className={`hw-dropdown-item ${isSelected ? 'active' : ''} ${opt.disabled ? 'disabled' : ''}`}
                          onClick={() => {
                            if (opt.disabled) return;
                            setHardwareAccel(opt.value);
                            setHwDropdownOpen(false);
                          }}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={opt.disabled}
                        >
                          <div className="hw-item-left">
                            <span className={`hw-item-badge ${opt.badge.toLowerCase()}`}>
                              {opt.badge}
                            </span>
                            <div className="hw-item-text">
                              <div className="hw-item-heading">
                                <span className="hw-item-title">{opt.title}</span>
                                <span className={`hw-status-pill ${opt.isReady ? 'ready' : 'unavailable'}`}>
                                  [{opt.status}]
                                </span>
                              </div>
                              <span className="hw-item-desc">{opt.desc}</span>
                            </div>
                          </div>
                          {isSelected && (
                            <span className="hw-item-selected-check">✓</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.55rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                <span>
                  {hardwareAccel === 'browser_wasm'
                    ? (t.studio.hwWasmDesc || 'Client-side browser WASM engine (Zero server load · 100% private in browser)')
                    : hardwareAccel === 'auto'
                    ? (hardwareInfo?.recommended ? `${t.studio.hwAutoDesc} · Recommended: ${hardwareInfo.recommended.toUpperCase()}` : t.studio.hwAutoDesc)
                    : hardwareAccel === 'nvenc'
                    ? t.studio.hwNvencDesc
                    : hardwareAccel === 'amf'
                    ? t.studio.hwAmfDesc
                    : hardwareAccel === 'qsv'
                    ? t.studio.hwQsvDesc
                    : t.studio.hwCpuDesc}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Real Video Live Preview */}
        <div className="studio-preview-pane">
          <div className="preview-sticky-wrap">
            <div className="preview-header-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.45rem 0.6rem' }}>
              <span className="preview-title" style={{ fontWeight: 700, fontSize: '0.88rem' }}>{t.studio.livePreview}</span>
              <span
                className="preview-indicator"
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: isPlaying ? '#10b981' : playerReady ? '#38bdf8' : '#94a3b8',
                  background: isPlaying ? 'rgba(16, 185, 129, 0.15)' : playerReady ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.08)',
                  border: isPlaying ? '1px solid rgba(16, 185, 129, 0.35)' : playerReady ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255, 255, 255, 0.15)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '6px',
                }}
              >
                {!playerReady ? t.studio.previewLoading : isPlaying ? t.studio.previewPlaying : t.studio.previewReady}
              </span>
            </div>

            <div
              ref={phoneContainerRef}
              className={`phone-wireframe-container real-preview-container ${isLandscape ? 'is-landscape' : ''}`}
              style={{ width: `${phoneWidth}px`, height: `${phoneHeight}px` }}
            >
              {/* Background Backdrop (Black or Ambient Blurred) */}
              <div
                className="real-frame-bg-layer"
                style={{ backgroundColor: '#000000' }}
              >
                {backgroundStyle === 'blurred' && aspectRatio !== '9:16' && aspectRatio !== '16:9_landscape' && (
                  <div className="ambient-blur-backdrop" style={{ overflow: 'hidden' }}>
                    {videoUrl && (videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.endsWith('.mov') || videoUrl.endsWith('.mkv') || videoUrl.includes('/api/video') || videoUrl.startsWith('blob:') || videoId?.startsWith('upload_') || videoId?.startsWith('gdrive_')) ? (
                      <video
                        ref={ambientVideoRef}
                        src={videoUrl ? encodeURI(videoUrl) : `/api/video/${encodeURIComponent(videoId || '')}`}
                        playsInline
                        muted
                        onError={(e) => {
                          const vid = e.currentTarget;
                          if (videoUrl?.startsWith('blob:')) {
                            console.warn('Ambient blob video playback error:', e);
                            return;
                          }
                          const fallback = `/api/video/${encodeURIComponent(videoId || '')}`;
                          if (videoId && vid.src !== fallback && !vid.src.endsWith(fallback)) {
                            vid.src = fallback;
                            vid.load();
                          }
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          filter: 'blur(20px) brightness(0.8) saturate(1.35)',
                          transform: 'scale(1.2)',
                          pointerEvents: 'none',
                        }}
                      />
                    ) : (
                      <img
                        src={videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined}
                        alt="Ambient Blurred"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          filter: 'blur(20px) brightness(0.8) saturate(1.35)',
                          transform: 'scale(1.2)',
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                )}

                {/* Content Box with Live Video Player */}
                <div className={`wireframe-single-layout ${streamerPreset === 'split_top_cam' ? 'split-active' : ''}`}>
                  {/* Top Facecam Box if split_top_cam */}
                  {streamerPreset === 'split_top_cam' && (
                    <>
                      <div className={`wireframe-split-cam-box aspect-${aspectRatio.replace(':', '').replace('_', '')}`}>
                        <div className="wireframe-facecam-skeleton">
                          <div className="skeleton-grid-mesh"></div>
                          <div className="skeleton-reticle">
                            <span className="reticle-bracket top-left"></span>
                            <span className="reticle-bracket top-right"></span>
                            <span className="reticle-bracket bottom-left"></span>
                            <span className="reticle-bracket bottom-right"></span>
                            <div className="skeleton-avatar">
                              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                              </svg>
                            </div>
                          </div>
                          <div className="skeleton-label-wrap">
                            <span className="skeleton-main-label">STREAMER CAM</span>
                            <span className="skeleton-sub-label">
                              {facecamPosition === 'auto' ? `AUTO FACE-CROP (${aspectRatio})` : `${facecamPosition.toUpperCase().replace('_', '-')} CROP (${aspectRatio})`}
                            </span>
                          </div>
                        </div>
                        <div className="wireframe-cam-badge">
                          <span className="live-dot"></span> FACECAM ({facecamPosition === 'auto' ? 'AI AUTO' : facecamPosition.toUpperCase().replace('_', '-')})
                        </div>
                      </div>
                      <div className="wireframe-split-divider"></div>
                    </>
                  )}

                  {/* Content scaled by aspect ratio with real playable video */}
                  <div className={`wireframe-content-box aspect-${aspectRatio.replace(':', '').replace('_', '')} ${streamerPreset === 'split_top_cam' ? 'split-mode' : ''}`}>
                    <div className="wireframe-content-inner">
                      {/* HTML5 or YouTube Player slot - ALWAYS STABLY MOUNTED */}
                      {videoUrl && (videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.endsWith('.mov') || videoUrl.endsWith('.mkv') || videoUrl.includes('/api/video') || videoUrl.startsWith('blob:') || videoId?.startsWith('upload_') || videoId?.startsWith('gdrive_')) ? (
                        <video
                          ref={directVideoRef}
                          src={videoUrl ? encodeURI(videoUrl) : `/api/video/${encodeURIComponent(videoId || '')}`}
                          playsInline
                          muted={isMuted}
                          onError={(e) => {
                            const vid = e.currentTarget;
                            if (videoUrl?.startsWith('blob:')) {
                              console.warn('Direct blob video playback error:', e);
                              return;
                            }
                            const fallback = `/api/video/${encodeURIComponent(videoId || '')}`;
                            if (videoId && vid.src !== fallback && !vid.src.endsWith(fallback)) {
                              vid.src = fallback;
                              vid.load();
                            }
                          }}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: isLandscape || aspectRatio === '16:9' ? 'contain' : 'cover',
                            objectPosition: isLandscape ? 'center center' : `${previewCropPercent}% 50%`,
                            transition: 'object-position 0.3s ease-out'
                          }}
                          onTimeUpdate={(e) => {
                            setCurrentTime(e.currentTarget.currentTime);
                          }}
                          onPlay={() => {
                            setIsPlaying(true);
                            startTracking();
                            if (ambientVideoRef.current) ambientVideoRef.current.play().catch(() => {});
                          }}
                          onPause={() => {
                            setIsPlaying(false);
                            stopTracking();
                            if (ambientVideoRef.current) ambientVideoRef.current.pause();
                          }}
                          onEnded={() => {
                            if (isLooping && currentPreviewClip) {
                              if (directVideoRef.current) {
                                directVideoRef.current.currentTime = currentPreviewClip.start_time;
                                directVideoRef.current.play();
                              }
                              if (ambientVideoRef.current) {
                                ambientVideoRef.current.currentTime = currentPreviewClip.start_time;
                                ambientVideoRef.current.play().catch(() => {});
                              }
                            }
                          }}
                        />
                      ) : isTwitch ? (
                        <div
                          id="studio-preview-twitch-container"
                          className="studio-yt-embed-slot"
                          style={{
                            opacity: playerReady ? 1 : 0,
                            transition: 'opacity 0.25s ease',
                            ['--preview-crop-pct' as any]: previewCropPercent,
                          }}
                        >
                          <div id="studio-twitch-iframe-slot"></div>
                        </div>
                      ) : (
                        <div
                          id="studio-preview-yt-container"
                          className="studio-yt-embed-slot"
                          style={{
                            opacity: playerReady ? 1 : 0,
                            transition: 'opacity 0.25s ease',
                            ['--preview-crop-pct' as any]: previewCropPercent,
                          }}
                        >
                          <div id="studio-yt-iframe-slot"></div>
                        </div>
                      )}

                      {/* Click overlay to toggle play/pause */}
                      <div
                        className="studio-preview-click-overlay"
                        onClick={togglePlayPause}
                        title={isPlaying ? t.studio.clickToPause : t.studio.clickToPlay}
                      >
                        {!isPlaying && (
                          <div className="preview-play-icon-bubble">
                            ▶
                          </div>
                        )}
                      </div>

                      {/* PIP Corner Box */}
                      {streamerPreset === 'pip_corner' && (
                        <div className="wireframe-pip-box" style={{ zIndex: 12 }}>
                          <div className="wireframe-pip-skeleton">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                              <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            <span className="pip-skeleton-text">CAM</span>
                          </div>
                          <div className="wireframe-pip-badge">[*] CAM</div>
                        </div>
                      )}

                      {/* Badge for Split Mode Bottom Feed */}
                      {streamerPreset === 'split_top_cam' && (
                        <div className="wireframe-gameplay-badge">
                          // GAMEPLAY ({aspectRatio})
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Title Overlay with Real-time Up/Down/Left/Right Position, Duration & Scaled Font */}
                {isTitleVisible && (
                  <div
                    className="wireframe-title-overlay"
                    style={{
                      top: `${safeTitleY}%`,
                      left: `${safeTitleX}%`,
                      transform: 'translateX(-50%)',
                      width: 'max-content',
                      maxWidth: '92%',
                      zIndex: 35,
                      pointerEvents: 'none',
                      display: 'flex',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      className="wireframe-title-text"
                      style={{
                        fontFamily: `'${titleFont}', sans-serif`,
                        fontSize: (() => {
                          const scale = isLandscape ? (320 / 1920) : (320 / 1080);
                          const px = Math.round(titleFontSizePx * scale);
                          const minPx = 4;
                          return `${Math.max(minPx, px)}px`;
                        })(),
                        lineHeight: titleLineCount >= 3 ? 1.10 : 1.08,
                        letterSpacing: '0.02em',
                        whiteSpace: 'pre-line',
                        textAlign: 'center',
                        color: '#ffffff',
                        fontWeight: 800,
                        textShadow: '0 0 2px #000, 0 1px 3px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.8)',
                        background: 'transparent',
                        padding: '0 8px',
                        boxSizing: 'border-box',
                        borderRadius: '0',
                        border: 'none',
                        boxShadow: 'none',
                        display: 'inline-block',
                        maxWidth: '96%',
                        wordBreak: 'break-word',
                      }}
                    >
                      {formattedTitle}
                    </span>
                  </div>
                )}

                {/* Subtitle Overlay with Real-time Up/Down Position & Scaled Font */}
                {captionStyle !== 'none' && (
                  <div
                    className={`wireframe-caption-overlay style-${captionStyle}${subtitlePositionMode === 'center' ? ' mode-center' : ''}`}
                    style={{
                      ...(subtitlePositionMode === 'center'
                        ? {
                            top: `${safeSubCenterY}%`,
                            bottom: 'auto',
                            transform: 'translateY(-50%)',
                          }
                        : {
                            bottom: `${safeSubtitleY}%`,
                            top: 'auto',
                            transform: 'none',
                          }),
                      zIndex: 35,
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      className="wireframe-caption-text"
                      style={{
                        fontFamily: `'${captionFont}', sans-serif`,
                        fontSize: (() => {
                          const scale = isLandscape ? (320 / 1920) : (320 / 1080);
                          const px = Math.round(fontSizePx * scale);
                          const minPx = 4;
                          return `${Math.max(minPx, px)}px`;
                        })(),
                        fontWeight: 800,
                        letterSpacing: '0.03em',
                        textAlign: 'center',
                        textShadow: '0 0 2px #000, 0 1px 3px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.8)',
                        display: 'inline-block',
                      }}
                    >
                      {activeCaption ? (
                        activeCaption.chunk.words.map((w, idx) => {
                          const isActive = idx === activeCaption.activeWordIndex;
                          const currentStyle = CAPTION_STYLE_CONFIG[captionStyle] || CAPTION_STYLE_CONFIG.viral_pop;
                          const color = isActive ? currentStyle.highlight : '#ffffff';
                          return (
                            <React.Fragment key={idx}>
                              {idx > 0 && ' '}
                              <span
                                style={{
                                  color,
                                  transform: isActive ? 'scale(1.08)' : 'scale(1)',
                                  display: 'inline-block',
                                  transition: 'transform 0.08s ease, color 0.08s ease',
                                  textShadow: isActive
                                    ? `0 0 3px #000, 0 1px 4px rgba(0,0,0,0.95), 0 0 8px ${currentStyle.highlight}88`
                                    : '0 0 2px #000, 0 1px 3px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.8)',
                                }}
                              >
                                {applyLetterCase(w.text, textCase)}
                              </span>
                            </React.Fragment>
                          );
                        })
                      ) : isPlaying ? (
                        null
                      ) : (
                        (() => {
                          const currentStyle = CAPTION_STYLE_CONFIG[captionStyle] || CAPTION_STYLE_CONFIG.viral_pop;
                          return (
                            <>
                              <span style={{ color: '#ffffff' }}>{applyLetterCase(currentStyle.sample[0], textCase)}</span>{' '}
                              <span style={{ color: currentStyle.highlight }}>{applyLetterCase(currentStyle.sample[1], textCase)}</span>
                            </>
                          );
                        })()
                      )}
                    </span>
                  </div>
                )}

                {/* Real-time Watermark Overlay */}
                {watermarkEnabled && (
                  <div
                    className="wireframe-watermark-overlay"
                    style={{
                      left: `${watermarkX}%`,
                      top: `${watermarkY}%`,
                      transform: 'translate(-50%, -50%)',
                      opacity: watermarkOpacity / 100,
                      zIndex: 25,
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    {watermarkType === 'image' && watermarkImageUrl ? (
                      <img
                        src={watermarkImageUrl}
                        alt="Watermark"
                        draggable={false}
                        style={{
                          width: watermarkSize === 0 ? '0px' : `${Math.round((phoneWidth * watermarkSize) / 100)}px`,
                          height: 'auto',
                          objectFit: 'contain',
                          display: watermarkSize === 0 ? 'none' : 'block',
                          pointerEvents: 'none',
                        }}
                      />
                    ) : watermarkText.trim() ? (
                      <span
                        className="wm-text-badge"
                        style={{
                          fontSize: watermarkSize === 0 ? '0px' : `${Math.max(8, Math.round((watermarkSize / 100) * 56))}px`,
                          display: watermarkSize === 0 ? 'none' : 'inline-block',
                          pointerEvents: 'none',
                        }}
                      >
                        {watermarkText}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Hidden Audio element for background music preview */}
            <audio
              ref={bgmAudioRef}
              src={bgmAudioUrl}
              onEnded={() => setIsBgmPlaying(false)}
              onLoadedMetadata={handleBgmLoadedMetadata}
              style={{ display: 'none' }}
            />

            {/* Hidden Audio element for hook sound effect preview */}
            <audio
              ref={hookSfxAudioRef}
              src={hookSfxAudioUrl}
              onEnded={() => setIsHookSfxPlaying(false)}
              style={{ display: 'none' }}
            />

            {/* External Video Player Controls (Outside preview clip, YouTube-like) */}
            <div className="studio-player-controls-card">
              {/* Timeline scrollbar like YouTube */}
              <div className="player-timeline-row">
                <input
                  type="range"
                  className="player-timeline-slider"
                  min={clipStart}
                  max={clipEnd}
                  step="0.1"
                  value={Math.min(Math.max(currentTime, clipStart), clipEnd)}
                  onChange={e => handleSeek(Number(e.target.value))}
                  title={t.studio.seekTimeline}
                  style={{
                    '--slider-progress': `${Math.max(0, Math.min(100, ((Math.min(Math.max(currentTime, clipStart), clipEnd) - clipStart) / (clipEnd - clipStart || 1)) * 100))}%`
                  } as React.CSSProperties}
                />
              </div>

              {/* Player actions row */}
              <div className="player-controls-bottom-row">
                <div className="player-controls-left">
                  <button
                    type="button"
                    className="player-ctrl-btn"
                    onClick={togglePlayPause}
                    title={isPlaying ? t.studio.pause : t.studio.play}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>

                  <button
                    type="button"
                    className="player-ctrl-btn"
                    onClick={handleRestart}
                    title={t.studio.restart}
                  >
                    ↺
                  </button>

                  <button
                    type="button"
                    className={`player-ctrl-btn ${isMuted ? 'active-mute' : ''}`}
                    onClick={toggleMute}
                    title={isMuted ? t.studio.unmute : t.studio.mute}
                    style={{
                      width: '30px',
                      height: '30px',
                      background: isMuted ? 'rgba(255, 0, 255, 0.15)' : '#060608',
                      border: isMuted ? '1px solid #ff00ff' : '1px solid #201e2c',
                      color: isMuted ? '#ff00ff' : '#ffffff',
                      boxShadow: isMuted ? '0 0 8px rgba(255, 0, 255, 0.35)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      borderRadius: 0,
                    }}
                  >
                    {isMuted ? (
                      /* Audio Speaker Muted (Sound disabled) */
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <line x1="23" y1="9" x2="17" y2="15"></line>
                        <line x1="17" y1="9" x2="23" y2="15"></line>
                      </svg>
                    ) : (
                      /* Audio Speaker Playing */
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                      </svg>
                    )}
                  </button>

                  <span className="player-time-badge">
                    {formatDuration(currentTime - clipStart)} / {formatDuration(clipDuration)}
                  </span>
                </div>

                <div className="player-controls-right">
                  <button
                    type="button"
                    className={`player-ctrl-btn ${isLooping ? 'active' : ''}`}
                    onClick={() => setIsLooping(!isLooping)}
                    title={isLooping ? t.studio.loopEnabled : t.studio.loopDisabled}
                    style={{
                      width: '30px',
                      height: '30px',
                      background: isLooping ? 'rgba(255, 0, 255, 0.2)' : '#060608',
                      border: isLooping ? '1px solid #ff00ff' : '1px solid #201e2c',
                      color: isLooping ? '#ff00ff' : 'var(--text-muted)',
                      boxShadow: isLooping ? '0 0 8px rgba(255, 0, 255, 0.45)' : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 0,
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="17 1 21 5 17 9"></polyline>
                      <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                      <polyline points="7 23 3 19 7 15"></polyline>
                      <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            {/* Studio Render History & Specs Card (under player controls so it won't be empty) */}
            <div className="studio-render-history-card">
              <div className="history-card-header">
                <span className="history-card-title">{t.studio.renderSpecsTitle}</span>
                <span className="history-badge-pill" style={{
                  background: 'rgba(0, 229, 255, 0.15)',
                  border: '1px solid #00e5ff',
                  color: '#00e5ff',
                  boxShadow: '0 0 8px rgba(0, 229, 255, 0.35)',
                  fontWeight: 700,
                  borderRadius: 0
                }}>
                  {aspectRatio === '16:9' || aspectRatio === '16:9_landscape' || aspectRatio === '4:3' ? '1920×1080' : aspectRatio === '1:1' ? '1080×1080' : '1080×1920'}
                </span>
              </div>

              <div className="history-info-grid">
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specResolution}</span>
                  <span className="info-val">
                    {aspectRatio === '16:9' || aspectRatio === '16:9_landscape'
                      ? '1920×1080 (16:9 Landscape)'
                      : aspectRatio === '1:1'
                      ? '1080×1080 (1:1 Square)'
                      : aspectRatio === '4:3'
                      ? '1920×1080 (4:3 Classic)'
                      : '1080×1920 (9:16 Portrait)'}
                  </span>
                </div>
                <div className="history-info-item history-hardware-item">
                  <span className="info-key">{t.studio.specHardware}</span>
                  <div className="history-hw-select-wrapper">
                    <select
                      className="history-hw-select"
                      value={hardwareAccel}
                      onChange={(e) => setHardwareAccel(e.target.value as HardwareAccelOption)}
                      title={t.studio.hwChangeHint}
                      disabled={!isLocalhost}
                    >
                      {isLocalhost ? (
                        <>
                          <option value="auto">
                            {t.studio.hwAuto} ({t.studio.hwDetectedPill}
                            {hardwareInfo?.recommended ? `: ${hardwareInfo.recommended.toUpperCase()}` : ''})
                          </option>
                          {hasWebCodecs && (
                            <option value="client_gpu">
                              [GPU] Client GPU Acceleration ({clientGpuName})
                            </option>
                          )}
                          <option value="browser_wasm">
                            [WASM] {t.studio.hwWasm || 'Browser Engine (Client-Side WASM · 0% Server CPU)'}
                          </option>
                          <option value="nvenc" disabled={hardwareInfo?.support && !hardwareInfo.support.nvenc}>
                            {t.studio.hwNvenc} {hardwareInfo?.support?.nvenc ? `(${t.studio.hwSupportedPill})` : `(${t.studio.hwUnavailablePill})`}
                          </option>
                          <option value="amf" disabled={hardwareInfo?.support && !hardwareInfo.support.amf}>
                            {t.studio.hwAmf} {hardwareInfo?.support?.amf ? `(${t.studio.hwSupportedPill})` : `(${t.studio.hwUnavailablePill})`}
                          </option>
                          <option value="qsv" disabled={hardwareInfo?.support && !hardwareInfo.support.qsv}>
                            {t.studio.hwQsv} {hardwareInfo?.support?.qsv ? `(${t.studio.hwSupportedPill})` : `(${t.studio.hwUnavailablePill})`}
                          </option>
                          <option value="cpu">
                            {t.studio.hwCpu} ({t.studio.hwSupportedPill})
                          </option>
                        </>
                      ) : (
                        <>
                          {hasWebCodecs && (
                            <option value="client_gpu">
                              [GPU] Client GPU Acceleration ({clientGpuName})
                            </option>
                          )}
                          <option value="browser_wasm">
                            [WASM] Browser Engine (Client-Side · 0% Server CPU)
                          </option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specAspect}</span>
                  <span className="info-val">{aspectRatio} ({backgroundStyle})</span>
                </div>
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specCaption}</span>
                  <span className="info-val">{captionStyle} · {captionFont} ({fontSizePx}px)</span>
                </div>
                {titlePosition !== 'none' && (
                  <div className="history-info-item">
                    <span className="info-key">Title Font:</span>
                    <span className="info-val">{titleFont} ({titleFontSizePx}px)</span>
                  </div>
                )}
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specQueue}</span>
                  <span className="info-val">{t.studio.specQueueVal(selectedClips.length, allClips.length)}</span>
                </div>
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specStatus}</span>
                  <span className="info-val">
                    {batchProgress?.overall_status === 'completed'
                      ? t.studio.statusCompleted(batchProgress.clips.filter(c => c.status === 'completed').length)
                      : isRendering
                      ? t.studio.statusRendering
                      : t.studio.statusReady}
                  </span>
                </div>
              </div>

              {/* Mini session output files list */}
              {batchProgress && batchProgress.clips.some(c => c.status === 'completed') && (
                <div className="history-recent-list">
                  <span className="recent-list-title">{t.studio.recentFilesTitle}</span>
                  <div className="recent-items-scroll">
                    {batchProgress.clips.filter(c => c.status === 'completed').map((c, i) => {
                      let rawBaseTitle = (c.base_title || '').trim();
                      if (!rawBaseTitle) {
                        let t = (c.title || `clip_${i + 1}`).trim();
                        if (titlePrefix && t.startsWith(titlePrefix)) {
                          t = t.slice(titlePrefix.length);
                        }
                        if (titleSuffix && t.endsWith(titleSuffix)) {
                          t = t.slice(0, t.length - titleSuffix.length);
                        }
                        rawBaseTitle = t.trim() || `clip_${i + 1}`;
                      }
                      rawBaseTitle = rawBaseTitle.replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${i + 1}`;
                      const fnPfx = (fileNamePrefix || '').replace(/[\\/*?:"<>|]/g, '');
                      const fnSfx = (fileNameSuffix || '').replace(/[\\/*?:"<>|]/g, '');
                      const cleanTitle = `${fnPfx}${rawBaseTitle}${fnSfx}`.trim() || rawBaseTitle;
                      let dupCount = 0;
                      const completedClips = batchProgress.clips.filter(x => x.status === 'completed');
                      for (let k = 0; k < i; k++) {
                        let priorBase = (completedClips[k].base_title || '').trim();
                        if (!priorBase) {
                          let pt = (completedClips[k].title || `clip_${k + 1}`).trim();
                          if (titlePrefix && pt.startsWith(titlePrefix)) {
                            pt = pt.slice(titlePrefix.length);
                          }
                          if (titleSuffix && pt.endsWith(titleSuffix)) {
                            pt = pt.slice(0, pt.length - titleSuffix.length);
                          }
                          priorBase = pt.trim() || `clip_${k + 1}`;
                        }
                        priorBase = priorBase.replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${k + 1}`;
                        const priorTitle = `${fnPfx}${priorBase}${fnSfx}`.trim() || priorBase;
                        if (priorTitle.toLowerCase() === cleanTitle.toLowerCase()) {
                          dupCount++;
                        }
                      }
                      const finalClipName = dupCount > 0 ? `${cleanTitle} (${dupCount})` : cleanTitle;
                      const dlUrlWithTitle = c.download_url
                        ? `${c.download_url}${c.download_url.includes('?') ? '&' : '?'}title=${encodeURIComponent(finalClipName)}`
                        : '';

                      return (
                        <div key={i} className="recent-file-row">
                          <span className="file-idx">#{i + 1}</span>
                          <span className="file-name" title={c.title}>{c.title}</span>
                          {c.download_url && (
                            <a
                              href={dlUrlWithTitle}
                              download={`${finalClipName}.mp4`}
                              className="quick-dl-btn"
                              title={`Download ${finalClipName}.mp4`}
                            >
                              ⬇️ MP4
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sticky Action Footer */}
      <div className="studio-bottom-action-bar">
        <div className="action-bar-meta">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="meta-badge">
              {t.studio.readyToRenderMeta(selectedClips.length)}
            </span>
            {allowAppUpdates && (
              <>
                <button
                  type="button"
                  className="studio-clear-temp-btn"
                  title={t.studio.clearTempTooltip}
                  onClick={handleClearTempClick}
                  disabled={isClearingTemp}
                  style={{
                    background: 'rgba(255, 255, 255, 0.07)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isClearingTemp ? t.studio.clearingTempBtn : t.studio.clearTempBtn}
                </button>
                {tempClearMsg && (
                  <span style={{ fontSize: '0.72rem', color: '#4ade80', fontWeight: 600 }}>
                    {tempClearMsg}
                  </span>
                )}
              </>
            )}
          </div>
          <span className="meta-sub">
            {t.studio.outputMetaSub}
          </span>
        </div>

        {!hasCookies && isYouTube && (
          <div
            className="studio-cookie-warning-banner"
            onClick={onOpenCookiesModal}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              padding: '0.7rem 1.1rem',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(217, 119, 6, 0.06) 100%)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              cursor: onOpenCookiesModal ? 'pointer' : 'default',
              margin: '0.65rem 0',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', textAlign: 'left' }}>
              <span style={{ fontSize: '1.15rem' }}>[!]</span>
              <span style={{ fontSize: '0.79rem', color: '#fbbf24', fontWeight: 500, lineHeight: 1.4 }}>
                {t.cookieWarning.studioBannerWarning}
              </span>
            </div>
            {onOpenCookiesModal && (
              <span
                style={{
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  color: '#34d399',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  padding: '0.25rem 0.65rem',
                  borderRadius: '6px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {t.cookieWarning.studioBannerAction} →
              </span>
            )}
          </div>
        )}

        <button
          className="studio-btn-render glowing-btn big-render-cta"
          onClick={handleLaunch}
          disabled={isRendering || batchProgress?.overall_status === 'running' || selectedClips.length === 0}
        >
          {batchProgress?.overall_status === 'running' ? (
            <>{t.studio.renderingInProgressBadge}</>
          ) : isRendering ? (
            <>{t.studio.launchingRenderBtn}</>
          ) : selectedClips.length === 0 ? (
            <>{t.studio.selectClipWarning}</>
          ) : renderMode === 'merged' ? (
            <>{t.studio.mergedRenderCta(selectedClips.length, totalSelectedDuration)}</>
          ) : (
            <>
              {t.studio.batchRenderCta(selectedClips.length)}
            </>
          )}
        </button>
      </div>

      {/* Batch Render Queue & Results Dashboard Card - Located below bottom action bar */}
      {batchProgress && (
        <div className={`bottom-batch-dashboard-card ${batchProgress.overall_status === 'running' ? 'is-processing' : ''}`}>
          <div className="batch-progress-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h4 className="batch-queue-title">{t.studio.batchQueueTitle}</h4>
                {batchProgress.overall_status === 'running' && (
                  <span className="queue-generating-pill">
                    <span className="queue-pulse-dot"></span> * GENERATING VIDEO...
                  </span>
                )}
              </div>
              <p className="batch-subtitle">
                {batchProgress.overall_status === 'completed'
                  ? (batchProgress.clips.some(c => c.status === 'error')
                      ? t.studio.someClipsFailed(batchProgress.clips.filter(c => c.status === 'error').length, batchProgress.total_clips)
                      : t.studio.allClipsRendered(batchProgress.total_clips))
                  : batchProgress.overall_status === 'error'
                  ? (batchProgress.error_message || t.studio.allClipsFailed)
                  : t.studio.processingClip((batchProgress.current_clip_index || 0) + 1, batchProgress.total_clips)}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              {batchProgress.clips.some(c => c.status === 'error') && batchProgress.overall_status !== 'running' && onRetryClip && (
                <button
                  type="button"
                  onClick={() => onRetryClip()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    border: '1px solid rgba(245, 158, 11, 0.7)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    boxShadow: '0 0 10px rgba(245, 158, 11, 0.35)',
                    transition: 'all 0.2s ease',
                  }}
                  title="Retry all failed clips in this batch"
                >
                  {t.studio.retryAllFailedBtn
                    ? t.studio.retryAllFailedBtn(batchProgress.clips.filter(c => c.status === 'error').length)
                    : `[~] Retry Failed (${batchProgress.clips.filter(c => c.status === 'error').length})`}
                </button>
              )}

              {(batchProgress.overall_status === 'completed' || batchProgress.clips.some(c => c.status === 'completed')) && (
                <a
                  href={batchProgress.zip_url || `/api/download-batch-zip/${batchProgress.batch_id}`}
                  download={`cheat_clip_pro_${batchProgress.batch_id}.zip`}
                  className="glowing-btn batch-zip-download-btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    border: '1px solid rgba(16, 185, 129, 0.6)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    boxShadow: '0 0 12px rgba(16, 185, 129, 0.35)',
                    cursor: 'pointer',
                  }}
                >
                  [PKG] ZIP
                </a>
              )}

              {(batchProgress.overall_status === 'completed' || batchProgress.overall_status === 'error') && onDismissProgress && (
                <button
                  type="button"
                  className="studio-close-btn"
                  onClick={onDismissProgress}
                  style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', padding: '0.1rem 0.3rem' }}
                  title={t.studio.dismissQueue}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Overall Batch Error Notice if all clips failed */}
          {batchProgress.overall_status === 'error' && (
            <div style={{
              margin: '0.5rem 0 0.2rem',
              padding: '0.55rem 0.75rem',
              background: 'rgba(255, 30, 39, 0.12)',
              border: '1px solid #ff1e27',
              borderRadius: 0,
              color: '#fca5a5',
              fontSize: '0.74rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.45rem',
              fontWeight: 600,
              boxShadow: '0 0 10px rgba(255, 30, 39, 0.25)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <AlertTriangle size={15} color="#ff1e27" />
                <span style={{ color: '#fff', fontWeight: 700 }}>{batchProgress.error_message || t.studio.allClipsFailed}</span>
              </div>
              {onRetryClip && (
                <button
                  type="button"
                  onClick={() => onRetryClip()}
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    border: '1px solid rgba(245, 158, 11, 0.6)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    padding: '3px 9px',
                    borderRadius: 0,
                    cursor: 'pointer',
                    boxShadow: '0 0 8px rgba(245, 158, 11, 0.35)',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                >
                  <RefreshCw size={11} />
                  {t.studio.retryClipBtn || 'Retry'}
                </button>
              )}
            </div>
          )}

          {/* Overall Progress Bar */}
          <div className="batch-overall-bar-wrap">
            <div className="batch-overall-bar" style={{ height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                className="batch-overall-fill"
                style={{
                  height: '100%',
                  background: batchProgress.overall_status === 'error'
                    ? '#ef4444'
                    : 'linear-gradient(90deg, #ff5e3a, #ff2a5f)',
                  width: `${Math.round((batchProgress.clips.filter(c => c.status === 'completed').length / (batchProgress.total_clips || 1)) * 100)}%`,
                  transition: 'width 0.3s ease'
                }}
              ></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              <span>{t.batchProgress.completedMeta(batchProgress.clips.filter(c => c.status === 'completed').length, batchProgress.total_clips)}</span>
              <span>{Math.round((batchProgress.clips.filter(c => c.status === 'completed').length / (batchProgress.total_clips || 1)) * 100)}%</span>
            </div>
          </div>

          {/* Render Items List */}
          <div className="batch-render-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.6rem' }}>
            {batchProgress.clips.map((clip, idx) => {
              let rawBaseTitle = (clip.base_title || '').trim();
              if (!rawBaseTitle) {
                let t = (clip.title || `clip_${idx + 1}`).trim();
                if (titlePrefix && t.startsWith(titlePrefix)) {
                  t = t.slice(titlePrefix.length);
                }
                if (titleSuffix && t.endsWith(titleSuffix)) {
                  t = t.slice(0, t.length - titleSuffix.length);
                }
                rawBaseTitle = t.trim() || `clip_${idx + 1}`;
              }
              rawBaseTitle = rawBaseTitle.replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${idx + 1}`;
              const fnPfx = (fileNamePrefix || '').replace(/[\\/*?:"<>|]/g, '');
              const fnSfx = (fileNameSuffix || '').replace(/[\\/*?:"<>|]/g, '');
              const cleanTitle = `${fnPfx}${rawBaseTitle}${fnSfx}`.trim() || rawBaseTitle;
              let dupCount = 0;
              for (let i = 0; i < idx; i++) {
                let priorBase = (batchProgress.clips[i].base_title || '').trim();
                if (!priorBase) {
                  let pt = (batchProgress.clips[i].title || `clip_${i + 1}`).trim();
                  if (titlePrefix && pt.startsWith(titlePrefix)) {
                    pt = pt.slice(titlePrefix.length);
                  }
                  if (titleSuffix && pt.endsWith(titleSuffix)) {
                    pt = pt.slice(0, pt.length - titleSuffix.length);
                  }
                  priorBase = pt.trim() || `clip_${i + 1}`;
                }
                priorBase = priorBase.replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${i + 1}`;
                const priorTitle = `${fnPfx}${priorBase}${fnSfx}`.trim() || priorBase;
                if (priorTitle.toLowerCase() === cleanTitle.toLowerCase()) {
                  dupCount++;
                }
              }
              const finalClipName = dupCount > 0 ? `${cleanTitle} (${dupCount})` : cleanTitle;
              const dlUrlWithTitle = clip.download_url
                ? `${clip.download_url}${clip.download_url.includes('?') ? '&' : '?'}title=${encodeURIComponent(finalClipName)}`
                : '';

              const isError = clip.status === 'error';
              const rawError = clip.error_message || clip.error || '';

              return (
                <div
                  key={idx}
                  className={`batch-item-row status-${clip.status}`}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    background: isError ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255,255,255,0.03)',
                    border: isError ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', maxWidth: '65%' }}>
                      <span style={{ fontSize: '0.7rem', color: isError ? '#f87171' : 'var(--text-muted)', fontWeight: 600 }}>#{idx + 1}</span>
                      <span style={{ fontSize: '0.75rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.title}</span>
                    </div>
                    <div>
                      {clip.status === 'pending' && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t.studio.statusWaitingShort}</span>}
                      {clip.status === 'downloading' && <span style={{ fontSize: '0.68rem', color: '#f59e0b' }}>{t.studio.statusSlicingShort}</span>}
                      {clip.status === 'transcribing' && <span style={{ fontSize: '0.68rem', color: '#8b5cf6' }}>{t.studio.statusCaptionsShort}</span>}
                      {clip.status === 'rendering' && <span style={{ fontSize: '0.68rem', color: '#3b82f6' }}>{t.studio.statusRenderingShort}</span>}
                      {clip.status === 'completed' && (
                        clip.download_url ? (
                          <a
                            href={dlUrlWithTitle}
                            download={`${finalClipName}.mp4`}
                            className="quick-dl-btn"
                            title={`Download ${finalClipName}.mp4`}
                          >
                            ⬇️ MP4
                          </a>
                        ) : (
                          <span className="quick-dl-btn" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                            ✓ Done
                          </span>
                        )
                      )}
                      {isError && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              color: '#ff1e27',
                              background: 'rgba(255, 30, 39, 0.15)',
                              padding: '2px 8px',
                              borderRadius: 0,
                              border: '1px solid #ff1e27',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            <X size={11} /> {t.studio.statusFailedShort}
                          </span>
                          {onRetryClip && batchProgress.overall_status !== 'running' && (
                            <button
                              type="button"
                              onClick={() => onRetryClip(idx)}
                              style={{
                                background: 'rgba(245, 158, 11, 0.18)',
                                border: '1px solid rgba(245, 158, 11, 0.5)',
                                borderRadius: 0,
                                color: '#fbbf24',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                              title="Retry rendering this clip"
                            >
                              <RefreshCw size={11} />
                              {t.studio.retryClipBtn || 'Retry'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visible Error Box when clip fails */}
                  {isError && rawError && (
                    <ClipRenderErrorBox
                      errorMessage={rawError}
                      t={t}
                      onRetry={onRetryClip && batchProgress.overall_status !== 'running' ? () => onRetryClip(idx) : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom Clear Temp Confirmation Modal */}
      {showClearConfirmModal && (
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
              borderRadius: '10px',
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
                <strong>{t.studio.confirmModalCookieNotice}</strong>
              </div>
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn-confirm-cancel"
                onClick={() => setShowClearConfirmModal(false)}
                disabled={isClearingTemp}
              >
                {t.studio.cancelBtn}
              </button>
              <button
                type="button"
                className="btn-confirm-purge"
                onClick={executeClearTemp}
                disabled={isClearingTemp}
              >
                {isClearingTemp ? t.studio.purgingBtn : t.studio.purgeBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
