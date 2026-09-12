import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../locales';
import type {
  ViralClip,
  RenderSettings,
  AspectRatioOption,
  BackgroundStyle,
  CaptionStyle,
  CaptionFont,
  TitlePosition,
  StreamerPreset,
  FontSizeOption,
  TextCaseOption,
  TitleDurationOption,
  SubtitlePositionMode,
  BatchRenderProgress,
} from '../types';

interface ClipStudioSectionProps {
  videoUrl: string;
  videoId: string;
  allClips: ViralClip[];
  markedClips: ViralClip[];
  activeClip: ViralClip | null;
  onStartRender: (settings: RenderSettings) => void;
  isRendering: boolean;
  onToggleMarkClip?: (clip: ViralClip) => void;
  batchProgress?: BatchRenderProgress | null;
  onDismissProgress?: () => void;
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
  batchProgress,
  onDismissProgress,
}) => {
  const { t } = useLanguage();
  // Directly reflect marked clips (supports selecting 0 clips)
  const [selectedClips, setSelectedClips] = useState<ViralClip[]>(markedClips);
  const [previewClipIndex, setPreviewClipIndex] = useState<number>(0);

  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('9:16');
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>('black');
  const [enableFaceTracking, setEnableFaceTracking] = useState<boolean>(true);
  const [streamerPreset, setStreamerPreset] = useState<StreamerPreset>('none');
  const [titleText, setTitleText] = useState<string>('');
  const [titlePosition, setTitlePosition] = useState<TitlePosition>('auto');
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('viral_pop');
  const [captionFont, setCaptionFont] = useState<CaptionFont>('Outfit');
  const [fontSize, setFontSize] = useState<FontSizeOption>('medium');
  const [textCase, setTextCase] = useState<TextCaseOption>('uppercase');

  // Manual Up/Down positioning for All Formats
  const [titleYPercent, setTitleYPercent] = useState<number>(17);
  const [subtitleYPercent, setSubtitleYPercent] = useState<number>(21);
  const [subtitlePositionMode, setSubtitlePositionMode] = useState<SubtitlePositionMode>('bottom');
  const [subtitleCenterYPercent, setSubtitleCenterYPercent] = useState<number>(50);
  const [isCustomTitleY, setIsCustomTitleY] = useState<boolean>(false);
  const [titleDuration, setTitleDuration] = useState<TitleDurationOption>('entire');
  const [isClearingTemp, setIsClearingTemp] = useState<boolean>(false);
  const [tempClearMsg, setTempClearMsg] = useState<string>('');
  const [showClearConfirmModal, setShowClearConfirmModal] = useState<boolean>(false);

  // Original Voice Audio Boost (0% - 200%, default 100%)
  const [originalAudioVolume, setOriginalAudioVolume] = useState<number>(100);

  // Background Music (BGM) state
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(false);
  const [bgmFileName, setBgmFileName] = useState<string>('');
  const [bgmFilePath, setBgmFilePath] = useState<string>('');
  const [bgmAudioUrl, setBgmAudioUrl] = useState<string>('');
  const [bgmVolume, setBgmVolume] = useState<number>(25);
  const [bgmDuration, setBgmDuration] = useState<number>(0);
  const [bgmStartOffset, setBgmStartOffset] = useState<number>(0);
  const [isBgmPlaying, setIsBgmPlaying] = useState<boolean>(false);
  const [isUploadingBgm, setIsUploadingBgm] = useState<boolean>(false);
  const [isBgmDragging, setIsBgmDragging] = useState<boolean>(false);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);

  // Hook Sound Effect (SFX) state
  const [hookSfxEnabled, setHookSfxEnabled] = useState<boolean>(false);
  const [hookSfxFileName, setHookSfxFileName] = useState<string>('');
  const [hookSfxFilePath, setHookSfxFilePath] = useState<string>('');
  const [hookSfxAudioUrl, setHookSfxAudioUrl] = useState<string>('');
  const [hookSfxVolume, setHookSfxVolume] = useState<number>(100);
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

  // Playable video player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [playerReady, setPlayerReady] = useState<boolean>(false);

  // Face detection tracking state
  const [, setFaceBox] = useState<{ cx: number; cy: number; w: number; h: number; found: boolean }>({
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

  // Fetch face detection coordinates
  useEffect(() => {
    if (!videoId) return;
    let isMounted = true;
    const fetchFace = async () => {
      try {
        const res = await fetch(`/api/detect-face?video_id=${encodeURIComponent(videoId)}&timestamp=${clipStart}&video_url=${encodeURIComponent(videoUrl || '')}`);
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
  }, [videoId, previewClipIndex, clipStart, videoUrl]);

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

    const isDirect = videoUrl && (videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.includes('/api/video'));
    if (isDirect) {
      setPlayerReady(true);
      setCurrentTime(clipStart);
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
            start: startSec,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              setPlayerReady(true);
              try {
                event.target.mute();
                setIsMuted(true);
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
                  previewPlayerRef.current.seekTo(currentPreviewClip.start_time, true);
                } else {
                  previewPlayerRef.current.pauseVideo();
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
    }, 150);
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
        if (isPlaying) {
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
    if (previewPlayerRef.current && typeof previewPlayerRef.current.seekTo === 'function') {
      try {
        previewPlayerRef.current.seekTo(newTime, true);
      } catch (e) {}
    } else if (directVideoRef.current) {
      directVideoRef.current.currentTime = newTime;
      if (ambientVideoRef.current) ambientVideoRef.current.currentTime = newTime;
    }
  };

  const handleRestart = () => {
    setCurrentTime(clipStart);
    if (previewPlayerRef.current && typeof previewPlayerRef.current.seekTo === 'function') {
      try {
        previewPlayerRef.current.seekTo(clipStart, true);
        previewPlayerRef.current.playVideo();
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
        if (isMuted) {
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
      setHookSfxEnabled(true);
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
    setHookSfxEnabled(false);
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
    try {
      const localUrl = URL.createObjectURL(file);
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
      alert('Failed to upload watermark image.');
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
    style: TextCaseOption
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
    if (words.length <= 1 || cased.length <= 22) {
      return { formatted: cased, lineCount: 1 };
    }

    const totalLen = cased.length;
    let targetLines = 2;
    if (totalLen <= 38) {
      targetLines = 2;
    } else if (totalLen <= 62) {
      targetLines = 3;
    } else {
      targetLines = Math.min(4, Math.max(3, Math.floor(totalLen / 20)));
    }

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
   * Snug defaults for each aspect ratio and line count:
   * Keeps title and subtitle CLOSE to the video content without touching.
   */
  const getDefaultPositions = (
    ratio: AspectRatioOption,
    lines: number
  ): { titleY: number; subtitleY: number; subCenterY: number } => {
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
  const getMaxPositions = (ratio: AspectRatioOption, lines: number) => {
    if (ratio === '1:1') {
      return {
        maxTitleY: lines >= 4 ? 12.5 : lines === 3 ? 13.5 : lines === 2 ? 15.0 : 18.0,
        maxSubY: 18.0,
      };
    }
    if (ratio === '4:3') {
      return {
        maxTitleY: lines >= 4 ? 19.5 : lines === 3 ? 20.5 : lines === 2 ? 22.0 : 25.0,
        maxSubY: 25.0,
      };
    }
    if (ratio === '16:9') {
      return {
        maxTitleY: lines >= 4 ? 24.5 : lines === 3 ? 25.5 : lines === 2 ? 27.0 : 30.0,
        maxSubY: 30.5,
      };
    }
    return {
      maxTitleY: 45.0,
      maxSubY: 45.0,
    };
  };

  const getCenterBounds = (ratio: AspectRatioOption) => {
    if (ratio === '16:9') return { min: 38, max: 62 };
    if (ratio === '4:3') return { min: 34, max: 66 };
    if (ratio === '1:1') return { min: 28, max: 72 };
    return { min: 25, max: 75 };
  };

  // Preview phone dimensions (enlarged for crystal-clear layout framing)
  const phoneWidth = 320;
  const phoneHeight = 569;

  const activeTitle =
    titleText.trim() ||
    currentPreviewClip?.title_suggestion ||
    currentPreviewClip?.title ||
    'YOUR VIRAL HOOK TITLE';

  const { formatted: formattedTitle, lineCount: titleLineCount } = formatTitleSmart(
    activeTitle,
    textCase
  );

  const { maxTitleY, maxSubY } = getMaxPositions(aspectRatio, titleLineCount);
  const { min: minCenterY, max: maxCenterY } = getCenterBounds(aspectRatio);

  // Safe clamped values for preview rendering
  const safeTitleY = Math.min(titleYPercent, maxTitleY);
  const safeSubtitleY = Math.min(subtitleYPercent, maxSubY);
  const safeSubCenterY = Math.max(minCenterY, Math.min(subtitleCenterYPercent, maxCenterY));

  // If user hasn't explicitly customized positions, auto-keep optimal default for ratio & lines
  useEffect(() => {
    if (!isCustomTitleY) {
      const defaults = getDefaultPositions(aspectRatio, titleLineCount);
      setTitleYPercent(defaults.titleY);
    }
  }, [aspectRatio, titleLineCount, isCustomTitleY]);

  const handleSelectAspectRatio = (newRatio: AspectRatioOption) => {
    setAspectRatio(newRatio);
    const defaults = getDefaultPositions(newRatio, titleLineCount);
    setTitleYPercent(defaults.titleY);
    setSubtitleYPercent(defaults.subtitleY);
    setSubtitleCenterYPercent(defaults.subCenterY);
    setIsCustomTitleY(false);
  };

  const handleResetPositions = () => {
    const defaults = getDefaultPositions(aspectRatio, titleLineCount);
    setTitleYPercent(defaults.titleY);
    setSubtitleYPercent(defaults.subtitleY);
    setSubtitleCenterYPercent(defaults.subCenterY);
    setIsCustomTitleY(false);
  };

  const handleLaunch = () => {
    onStartRender({
      aspectRatio,
      backgroundStyle,
      enableFaceTracking,
      streamerPreset,
      titleText,
      titlePosition,
      titleDuration,
      captionStyle,
      captionFont,
      fontSize,
      textCase,
      titleYPercent: safeTitleY,
      subtitleYPercent: safeSubtitleY,
      subtitlePositionMode,
      subtitleCenterYPercent: safeSubCenterY,
      selectedClips,
      // Background Music
      bgmEnabled: bgmEnabled && !!bgmFilePath,
      bgmFilePath,
      bgmFileName,
      bgmVolume,
      bgmStartOffset,
      // Hook SFX
      hookSfxEnabled: hookSfxEnabled && !!hookSfxFilePath,
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
    });
  };

  return (
    <section id="clip-studio-section" className="clip-studio-page-section glass-panel">
      {/* Fancy Glowing Section Header */}
      <div className="studio-section-header">
        <div className="studio-header-left">
          <div className="studio-icon-glow">🎬</div>
          <div>
            <div className="studio-title-badge-row">
              <h2 className="studio-main-heading">{t.studio.heading}</h2>
              <span className="pro-badge glowing-badge">PRO</span>
            </div>
            <p className="studio-subtext">
              {t.studio.subtext}
            </p>
          </div>
        </div>

        {/* Clip preview switcher */}
        {allClips.length > 1 && (
          <div className="preview-clip-picker-bar">
            <span className="preview-picker-label">{t.studio.previewClip}</span>
            <select
              className="preview-clip-select"
              value={previewClipIndex}
              onChange={e => setPreviewClipIndex(Number(e.target.value))}
            >
              {allClips.map((clip, idx) => (
                <option key={idx} value={idx}>
                  #{idx + 1}: {clip.title_suggestion || clip.title} ({Math.round(clip.end_time - clip.start_time)}s)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Studio Grid: Controls (Left) + Real Image Live Preview (Right) */}
      <div className="studio-workspace-grid">
        {/* Left Column: Interactive Controls */}
        <div className="studio-controls-pane">
          {/* 1. Canvas & Inner Aspect Ratio */}
          <div className="studio-card-group">
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
            </div>

            {/* Background Style when bars are active */}
            {aspectRatio !== '9:16' && (
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

            {/* AI Active Speaker centering */}
            {aspectRatio === '9:16' && (
              <div className="studio-checkbox-row" style={{ marginTop: '0.75rem' }}>
                <input
                  type="checkbox"
                  id="faceTrackingSec"
                  checked={enableFaceTracking}
                  onChange={e => setEnableFaceTracking(e.target.checked)}
                />
                <label htmlFor="faceTrackingSec">
                  <strong>{t.studio.faceTracking}</strong> {t.studio.faceTrackingDesc}
                </label>
              </div>
            )}
          </div>

          {/* 2. Manual Up/Down Position Adjustments for All Formats */}
          <div className="studio-card-group position-sliders-card">
            <div className="group-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="group-title">{t.studio.manualPositionTitle}</span>
                <span className="group-badge accent-badge">{t.studio.verticalBadge}</span>
              </div>
              <button
                type="button"
                className="reset-pos-btn"
                title={t.studio.resetPositionTooltip}
                onClick={handleResetPositions}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  padding: '0.22rem 0.65rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  transition: 'all 0.15s ease',
                }}
              >
                {t.studio.resetPosition}
              </button>
            </div>
            <p className="slider-hint-text">
              {t.studio.positionHint}
            </p>

            <div className="slider-control-row">
              <div className="slider-meta-header">
                <span className="slider-label">{t.studio.titleYLabel}</span>
                <div className="slider-input-badge-wrap">
                  <input
                    type="number"
                    className="slider-number-input"
                    min={aspectRatio === '9:16' ? 5 : 4}
                    max={maxTitleY}
                    step="0.5"
                    value={safeTitleY}
                    onChange={e => {
                      const val = Number(e.target.value);
                      if (!isNaN(val)) {
                        setTitleYPercent(val);
                        setIsCustomTitleY(true);
                      }
                    }}
                  />
                  <span className="slider-input-unit">%</span>
                </div>
              </div>
              <div className="slider-input-wrapper">
                <input
                  type="range"
                  min={aspectRatio === '9:16' ? 5 : 4}
                  max={maxTitleY}
                  step="0.5"
                  value={safeTitleY}
                  onChange={e => {
                    setTitleYPercent(Number(e.target.value));
                    setIsCustomTitleY(true);
                  }}
                  className="custom-range-slider"
                />
                <div className="slider-quick-buttons">
                  {aspectRatio === '9:16' ? (
                    <>
                      <button type="button" onClick={() => { setTitleYPercent(6); setIsCustomTitleY(true); }}>{t.studio.quickHigh(6)}</button>
                      <button type="button" onClick={() => { setTitleYPercent(titleLineCount >= 3 ? 12.0 : 17.0); setIsCustomTitleY(true); }}>
                        {t.studio.quickDefault(titleLineCount >= 3 ? '12%' : '17%')}
                      </button>
                      <button type="button" onClick={() => { setTitleYPercent(20); setIsCustomTitleY(true); }}>{t.studio.quickLower(20)}</button>
                    </>
                  ) : aspectRatio === '1:1' ? (
                    <>
                      <button type="button" onClick={() => { setTitleYPercent(7); setIsCustomTitleY(true); }}>{t.studio.quickHigh(7)}</button>
                      <button type="button" onClick={() => { setTitleYPercent(titleLineCount >= 3 ? 11.5 : 17.0); setIsCustomTitleY(true); }}>
                        {t.studio.quickSnugDefault(titleLineCount >= 3 ? '11.5%' : '17%')}
                      </button>
                    </>
                  ) : aspectRatio === '4:3' ? (
                    <>
                      <button type="button" onClick={() => { setTitleYPercent(12); setIsCustomTitleY(true); }}>{t.studio.quickHigh(12)}</button>
                      <button type="button" onClick={() => { setTitleYPercent(titleLineCount >= 3 ? 17.3 : 23.6); setIsCustomTitleY(true); }}>
                        {t.studio.quickSnugDefault(titleLineCount >= 3 ? '17.3%' : '23.6%')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setTitleYPercent(16); setIsCustomTitleY(true); }}>{t.studio.quickHigh(16)}</button>
                      <button type="button" onClick={() => { setTitleYPercent(titleLineCount >= 3 ? 22.6 : 28.8); setIsCustomTitleY(true); }}>
                        {t.studio.quickSnugDefault(titleLineCount >= 3 ? '22.6%' : '28.8%')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Subtitle Placement Mode Toggle */}
            <div className="studio-sub-toggle" style={{ marginTop: '0.95rem', marginBottom: '0.45rem' }}>
              <span className="sub-toggle-label" style={{ fontWeight: 700 }}>{t.studio.subPlacement}</span>
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

            {/* Subtitle Slider: Bottom Mode vs Center Mode */}
            {subtitlePositionMode === 'bottom' ? (
              <div className="slider-control-row" style={{ marginTop: '0.65rem' }}>
                <div className="slider-meta-header">
                  <span className="slider-label">{t.studio.subYBottomLabel}</span>
                  <div className="slider-input-badge-wrap">
                    <input
                      type="number"
                      className="slider-number-input"
                      min={aspectRatio === '9:16' ? 5 : 6}
                      max={maxSubY}
                      step="0.5"
                      value={safeSubtitleY}
                      onChange={e => {
                        const val = Number(e.target.value);
                        if (!isNaN(val)) setSubtitleYPercent(val);
                      }}
                    />
                    <span className="slider-input-unit">%</span>
                  </div>
                </div>
                <div className="slider-input-wrapper">
                  <input
                    type="range"
                    min={aspectRatio === '9:16' ? 5 : 6}
                    max={maxSubY}
                    step="0.5"
                    value={safeSubtitleY}
                    onChange={e => setSubtitleYPercent(Number(e.target.value))}
                    className="custom-range-slider"
                  />
                  <div className="slider-quick-buttons">
                    {aspectRatio === '9:16' ? (
                      <>
                        <button type="button" onClick={() => setSubtitleYPercent(12)}>{t.studio.quickLow(12)}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(21)}>{t.studio.quickDefault('21%')}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(28)}>{t.studio.quickMid(28)}</button>
                      </>
                    ) : aspectRatio === '1:1' ? (
                      <>
                        <button type="button" onClick={() => setSubtitleYPercent(14)}>{t.studio.quickLow(14)}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(20)}>{t.studio.quickSnugDefault('20%')}</button>
                      </>
                    ) : aspectRatio === '4:3' ? (
                      <>
                        <button type="button" onClick={() => setSubtitleYPercent(18)}>{t.studio.quickLow(18)}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(25)}>{t.studio.quickSnugDefault('25%')}</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => setSubtitleYPercent(22)}>{t.studio.quickLow(22)}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(30)}>{t.studio.quickSnugDefault('30%')}</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="slider-control-row" style={{ marginTop: '0.65rem' }}>
                <div className="slider-meta-header">
                  <span className="slider-label">{t.studio.subYCenterLabel}</span>
                  <div className="slider-input-badge-wrap">
                    <input
                      type="number"
                      className="slider-number-input"
                      min={minCenterY}
                      max={maxCenterY}
                      step="1"
                      value={safeSubCenterY}
                      onChange={e => {
                        const val = Number(e.target.value);
                        if (!isNaN(val)) setSubtitleCenterYPercent(val);
                      }}
                    />
                    <span className="slider-input-unit">%</span>
                  </div>
                </div>
                <div className="slider-input-wrapper">
                  <input
                    type="range"
                    min={minCenterY}
                    max={maxCenterY}
                    step="0.5"
                    value={safeSubCenterY}
                    onChange={e => setSubtitleCenterYPercent(Number(e.target.value))}
                    className="custom-range-slider"
                  />
                  <div className="slider-quick-buttons">
                    <button type="button" onClick={() => setSubtitleCenterYPercent(42)}>{t.studio.quickUpper(42)}</button>
                    <button type="button" onClick={() => setSubtitleCenterYPercent(50)}>{t.studio.quickDeadCenter(50)}</button>
                    <button type="button" onClick={() => setSubtitleCenterYPercent(58)}>{t.studio.quickLower(58)}</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Streamer Facecam Presets */}
          <div className="studio-card-group">
            <div className="group-header">
              <span className="group-title">{t.studio.streamerTitle}</span>
            </div>
            <div className="streamer-presets-row">
              <button
                type="button"
                className={`streamer-btn ${streamerPreset === 'none' ? 'active' : ''}`}
                onClick={() => setStreamerPreset('none')}
              >
                {t.studio.streamerNone}
              </button>
              <button
                type="button"
                className={`streamer-btn ${streamerPreset === 'split_top_cam' ? 'active' : ''}`}
                onClick={() => setStreamerPreset('split_top_cam')}
              >
                {t.studio.streamerSplit}
              </button>
              <button
                type="button"
                className={`streamer-btn ${streamerPreset === 'pip_corner' ? 'active' : ''}`}
                onClick={() => setStreamerPreset('pip_corner')}
              >
                {t.studio.streamerPip}
              </button>
            </div>
          </div>

          {/* 4. Title / Hook Banner */}
          <div className="studio-card-group">
            <div className="group-header">
              <span className="group-title">{t.studio.titleBannerTitle}</span>
              <span className="group-badge">
                {t.studio.customYBadge(safeTitleY)}
              </span>
            </div>
            <div className="title-inputs-row">
              <input
                type="text"
                className="studio-text-input"
                placeholder={t.studio.titlePlaceholder}
                value={titleText}
                onChange={e => setTitleText(e.target.value)}
              />
              <select
                className="studio-select"
                value={titlePosition}
                onChange={e => setTitlePosition(e.target.value as TitlePosition)}
              >
                <option value="auto">{t.studio.titleVisible}</option>
                <option value="none">{t.studio.titleDisabled}</option>
              </select>
            </div>

            {/* Title Duration Option */}
            {titlePosition !== 'none' && (
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
            )}
          </div>

          {/* 5. Subtitle Style & Font */}
          <div className="studio-card-group">
            <div className="group-header">
              <span className="group-title">{t.studio.subtitlesTitle}</span>
              <span className="group-badge success-badge">{t.studio.strictlyOneLine}</span>
            </div>

            <div className="caption-styles-grid">
              <button
                type="button"
                className={`caption-style-card viral-pop ${captionStyle === 'viral_pop' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('viral_pop')}
              >
                <div className="caption-preview-text">
                  VIRAL <span className="pop-yellow">POP</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleViralPopSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card beast-punch ${captionStyle === 'beast_punch' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('beast_punch')}
              >
                <div className="caption-preview-text">
                  BEAST <span className="pop-green">PUNCH</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleBeastPunchSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card cyber-violet ${captionStyle === 'cyber_violet' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('cyber_violet')}
              >
                <div className="caption-preview-text">
                  CYBER <span className="pop-violet">VIOLET</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleCyberVioletSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card fire-red ${captionStyle === 'fire_red' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('fire_red')}
              >
                <div className="caption-preview-text">
                  FIRE <span className="pop-red">CRIMSON</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleFireRedSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card electric-cyan ${captionStyle === 'electric_cyan' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('electric_cyan')}
              >
                <div className="caption-preview-text">
                  ELECTRIC <span className="pop-cyan">CYAN</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleElectricCyanSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card golden-aura ${captionStyle === 'golden_aura' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('golden_aura')}
              >
                <div className="caption-preview-text">
                  GOLDEN <span className="pop-gold">AURA</span>
                </div>
                <span className="caption-style-sub">{t.studio.styleGoldenAuraSub}</span>
              </button>

              <button
                type="button"
                className={`caption-style-card clean-minimal ${captionStyle === 'clean_minimal' ? 'active' : ''}`}
                onClick={() => setCaptionStyle('clean_minimal')}
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
                {/* Font Family */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.85rem' }}>
                  <span className="sub-toggle-label">{t.studio.fontFamily}</span>
                  <div className="toggle-pill-group" style={{ flexWrap: 'wrap' }}>
                    {(
                      [
                        'Outfit',
                        'Montserrat',
                        'Inter',
                        'Impact',
                        'Bebas Neue',
                        'Anton',
                        'Poppins',
                        'Arial Black',
                      ] as CaptionFont[]
                    ).map(font => (
                      <button
                        key={font}
                        type="button"
                        className={`pill-btn ${captionFont === font ? 'active' : ''}`}
                        onClick={() => setCaptionFont(font)}
                        style={{ fontFamily: font, fontSize: '0.78rem' }}
                      >
                        {font}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Size Presets */}
                <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                  <span className="sub-toggle-label">{t.studio.fontSize}</span>
                  <div className="toggle-pill-group">
                    <button
                      type="button"
                      className={`pill-btn ${fontSize === 'small' ? 'active' : ''}`}
                      onClick={() => setFontSize('small')}
                    >
                      {t.studio.sizeSmall}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${fontSize === 'medium' ? 'active' : ''}`}
                      onClick={() => setFontSize('medium')}
                    >
                      {t.studio.sizeMedium}
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${fontSize === 'big' ? 'active' : ''}`}
                      onClick={() => setFontSize('big')}
                    >
                      {t.studio.sizeBig}
                    </button>
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
              </>
            )}
          </div>

          {/* 6. Background Music (BGM) */}
          <div className="studio-card-group">
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
                  <div className="dropzone-icon">{isUploadingBgm ? '⏳' : isBgmDragging ? '📥' : '🎶'}</div>
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
                    <span className="bgm-icon">🎧</span>
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
                      >
                        {isBgmPlaying ? '⏸' : '▶'}
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
          <div className="studio-card-group">
            <div className="group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span className="group-title">{t.studio.hookSfxTitle}</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={hookSfxEnabled}
                    onChange={e => setHookSfxEnabled(e.target.checked)}
                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </label>
                <span className={`status-pill ${hookSfxEnabled && hookSfxFilePath ? 'pill-active' : ''}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                  {hookSfxEnabled && hookSfxFilePath ? t.studio.hookSfxActiveBadge : t.studio.bgmOptionalBadge}
                </span>
              </div>
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
                  <div className="dropzone-icon">{isUploadingHookSfx ? '⏳' : isHookSfxDragging ? '📥' : '⚡'}</div>
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
                    <span className="bgm-icon">⚡</span>
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
          <div className="studio-card-group">
            <div className="group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span className="group-title">{t.studio.rawAudioTitle}</span>
                <span className={`status-pill ${originalAudioVolume > 100 ? 'pill-active' : ''}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                  {originalAudioVolume > 100 ? `⚡ Boosted (${originalAudioVolume}%)` : `${originalAudioVolume}% Volume`}
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
          <div className="studio-card-group">
            <div className="group-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span className="group-title">{t.studio.watermarkTitle}</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={watermarkEnabled}
                    onChange={e => setWatermarkEnabled(e.target.checked)}
                    style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </label>
                <span className={`status-pill ${watermarkEnabled ? 'pill-active' : ''}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
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
                        <div className="dropzone-icon">{isUploadingWatermark ? '⏳' : isWatermarkDragging ? '📥' : '🖼️'}</div>
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

          {/* 8. Selected Clips Checklist */}
          <div className="studio-card-group">
            <div className="group-header">
              <span className="group-title">
                {t.studio.batchChecklist(selectedClips.length, allClips.length)}
              </span>
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
                        {clip.title_suggestion || clip.title}
                      </span>
                      <span className="batch-clip-ts">
                        ⏱️ {Math.floor(clip.start_time / 60)}:{(clip.start_time % 60).toFixed(0).padStart(2, '0')} -{' '}
                        {Math.floor(clip.end_time / 60)}:{(clip.end_time % 60).toFixed(0).padStart(2, '0')} (
                        {(clip.end_time - clip.start_time).toFixed(0)}s) · Score: {clip.virality_score}%
                      </span>
                    </div>
                  </div>
                );
              })}
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
              className="phone-wireframe-container real-preview-container"
              style={{ width: `${phoneWidth}px`, height: `${phoneHeight}px` }}
            >
              {/* Background Backdrop (Black or Ambient Blurred) */}
              <div
                className="real-frame-bg-layer"
                style={{ backgroundColor: '#000000' }}
              >
                {backgroundStyle === 'blurred' && aspectRatio !== '9:16' && (
                  <div className="ambient-blur-backdrop" style={{ overflow: 'hidden' }}>
                    {videoUrl && (videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.includes('/api/video')) ? (
                      <video
                        ref={ambientVideoRef}
                        src={videoUrl}
                        playsInline
                        muted
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
                      <div className={`wireframe-split-cam-box aspect-${aspectRatio.replace(':', '')}`}>
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
                            <span className="skeleton-sub-label">AUTO FACE-CROP ({aspectRatio})</span>
                          </div>
                        </div>
                        <div className="wireframe-cam-badge">
                          <span className="live-dot"></span> FACECAM ({aspectRatio})
                        </div>
                      </div>
                      <div className="wireframe-split-divider"></div>
                    </>
                  )}

                  {/* Content scaled by aspect ratio with real playable video */}
                  <div className={`wireframe-content-box aspect-${aspectRatio.replace(':', '')} ${streamerPreset === 'split_top_cam' ? 'split-mode' : ''}`}>
                    <div className="wireframe-content-inner">
                      {/* HTML5 or YouTube Player slot - ALWAYS STABLY MOUNTED */}
                      {videoUrl && (videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.includes('/api/video')) ? (
                        <video
                          ref={directVideoRef}
                          src={videoUrl}
                          playsInline
                          muted={isMuted}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
                      ) : (
                        <div id="studio-preview-yt-container" className="studio-yt-embed-slot">
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
                          <div className="wireframe-pip-badge">🔴 CAM</div>
                        </div>
                      )}

                      {/* Badge for Split Mode Bottom Feed */}
                      {streamerPreset === 'split_top_cam' && (
                        <div className="wireframe-gameplay-badge">
                          🎮 GAMEPLAY ({aspectRatio})
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Title Overlay with Real-time Up/Down Position & Scaled Font */}
                {titlePosition !== 'none' && (
                  <div
                    className="wireframe-title-overlay"
                    style={{
                      top: streamerPreset === 'split_top_cam' ? '24px' : `${safeTitleY}%`,
                      zIndex: 22,
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      className="wireframe-title-text"
                      style={{
                        fontFamily: captionFont,
                        fontSize:
                          fontSize === 'small'
                            ? titleLineCount >= 3
                              ? '15.5px'
                              : '17.5px'
                            : fontSize === 'big'
                            ? titleLineCount >= 3
                              ? '22px'
                              : '25.5px'
                            : titleLineCount >= 3
                            ? '18.5px'
                            : '21px',
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
                      zIndex: 22,
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      className="wireframe-caption-text"
                      style={{
                        fontFamily: captionFont,
                        fontSize: fontSize === 'small' ? '17px' : fontSize === 'big' ? '25px' : '20.5px',
                        fontWeight: 800,
                        letterSpacing: '0.03em',
                        textAlign: 'center',
                        textShadow: '0 0 2px #000, 0 1px 3px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.8)',
                        display: 'inline-block',
                      }}
                    >
                      {captionStyle === 'viral_pop' && (
                        <>
                          <span style={{ color: '#ffffff' }}>{applyLetterCase('VIRAL', textCase)}</span>{' '}
                          <span style={{ color: '#FFE600' }}>{applyLetterCase('POP', textCase)}</span>
                        </>
                      )}
                      {captionStyle === 'beast_punch' && (
                        <>
                          <span style={{ color: '#ffffff' }}>{applyLetterCase('UNREAL', textCase)}</span>{' '}
                          <span style={{ color: '#00FF66' }}>{applyLetterCase('HACK', textCase)}</span>
                        </>
                      )}
                      {captionStyle === 'cyber_violet' && (
                        <>
                          <span style={{ color: '#ffffff' }}>{applyLetterCase('CYBER', textCase)}</span>{' '}
                          <span style={{ color: '#D946EF' }}>{applyLetterCase('PUNCH', textCase)}</span>
                        </>
                      )}
                      {captionStyle === 'fire_red' && (
                        <>
                          <span style={{ color: '#ffffff' }}>{applyLetterCase('HOT', textCase)}</span>{' '}
                          <span style={{ color: '#FF2E2E' }}>{applyLetterCase('FIRE', textCase)}</span>
                        </>
                      )}
                      {captionStyle === 'electric_cyan' && (
                        <>
                          <span style={{ color: '#ffffff' }}>{applyLetterCase('ELECTRIC', textCase)}</span>{' '}
                          <span style={{ color: '#00F0FF' }}>{applyLetterCase('CYAN', textCase)}</span>
                        </>
                      )}
                      {captionStyle === 'golden_aura' && (
                        <>
                          <span style={{ color: '#ffffff' }}>{applyLetterCase('GOLDEN', textCase)}</span>{' '}
                          <span style={{ color: '#FFB800' }}>{applyLetterCase('MOMENT', textCase)}</span>
                        </>
                      )}
                      {captionStyle === 'clean_minimal' && (
                        <span style={{ color: '#ffffff' }}>
                          {applyLetterCase('CLEAN SUBTITLE', textCase)}
                        </span>
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
                    className="player-ctrl-btn"
                    onClick={toggleMute}
                    title={isMuted ? t.studio.unmute : t.studio.mute}
                  >
                    {isMuted ? '🔇' : '🔊'}
                  </button>

                  <span className="player-time-badge">
                    {formatDuration(currentTime - clipStart)} / {formatDuration(clipDuration)}
                  </span>
                </div>

                <div className="player-controls-right">
                  <button
                    type="button"
                    className={`player-loop-toggle ${isLooping ? 'active' : ''}`}
                    onClick={() => setIsLooping(!isLooping)}
                    title={isLooping ? t.studio.loopEnabled : t.studio.loopDisabled}
                  >
                    {t.studio.loop}
                  </button>
                </div>
              </div>
            </div>
            {/* Studio Render History & Specs Card (under player controls so it won't be empty) */}
            <div className="studio-render-history-card">
              <div className="history-card-header">
                <span className="history-card-title">{t.studio.renderSpecsTitle}</span>
                <span className="history-badge-pill">1080×1920</span>
              </div>

              <div className="history-info-grid">
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specResolution}</span>
                  <span className="info-val">{t.studio.specResolutionVal}</span>
                </div>
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specHardware}</span>
                  <span className="info-val highlight-green">{t.studio.specHardwareVal}</span>
                </div>
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specAspect}</span>
                  <span className="info-val">{aspectRatio} ({backgroundStyle})</span>
                </div>
                <div className="history-info-item">
                  <span className="info-key">{t.studio.specCaption}</span>
                  <span className="info-val">{captionStyle} · {captionFont}</span>
                </div>
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
                      const cleanTitle = (c.title || `clip_${i + 1}`).replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${i + 1}`;
                      let dupCount = 0;
                      const completedClips = batchProgress.clips.filter(x => x.status === 'completed');
                      for (let k = 0; k < i; k++) {
                        const priorTitle = (completedClips[k].title || `clip_${k + 1}`).replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${k + 1}`;
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

            {/* Batch Render Queue Card - Fancy glowing when generating */}
            {batchProgress && (
              <div className={`studio-batch-queue-card ${batchProgress.overall_status === 'running' ? 'is-processing' : ''}`}>
                <div className="batch-progress-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <h4 className="batch-queue-title">{t.studio.batchQueueTitle}</h4>
                      {batchProgress.overall_status === 'running' && (
                        <span className="queue-generating-pill">
                          <span className="queue-pulse-dot"></span> ⚡ GENERATING VIDEO...
                        </span>
                      )}
                    </div>
                    <p className="batch-subtitle">
                      {batchProgress.overall_status === 'completed'
                        ? t.studio.allClipsRendered(batchProgress.total_clips)
                        : t.studio.processingClip((batchProgress.current_clip_index || 0) + 1, batchProgress.total_clips)}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
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
                        📦 ZIP
                      </a>
                    )}

                    {batchProgress.overall_status === 'completed' && onDismissProgress && (
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

                {/* Overall Progress Bar */}
                <div className="batch-overall-bar-wrap">
                  <div className="batch-overall-bar" style={{ height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div
                      className="batch-overall-fill"
                      style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, #ff5e3a, #ff2a5f)',
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
                <div className="batch-render-items-list">
                  {batchProgress.clips.map((clip, idx) => {
                    const cleanTitle = (clip.title || `clip_${idx + 1}`).replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${idx + 1}`;
                    let dupCount = 0;
                    for (let i = 0; i < idx; i++) {
                      const priorTitle = (batchProgress.clips[i].title || `clip_${i + 1}`).replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${i + 1}`;
                      if (priorTitle.toLowerCase() === cleanTitle.toLowerCase()) {
                        dupCount++;
                      }
                    }
                    const finalClipName = dupCount > 0 ? `${cleanTitle} (${dupCount})` : cleanTitle;
                    const dlUrlWithTitle = clip.download_url
                      ? `${clip.download_url}${clip.download_url.includes('?') ? '&' : '?'}title=${encodeURIComponent(finalClipName)}`
                      : '';

                    return (
                      <div key={idx} className={`batch-item-row status-${clip.status}`} style={{ padding: '0.42rem 0.65rem', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', maxWidth: '62%' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>#{idx + 1}</span>
                          <span style={{ fontSize: '0.74rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.title}</span>
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
                          {clip.status === 'error' && <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{t.studio.statusFailedShort}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
          </div>
          <span className="meta-sub">
            {t.studio.outputMetaSub}
          </span>
        </div>

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
          ) : (
            <>
              {t.studio.batchRenderCta(selectedClips.length)}
            </>
          )}
        </button>
      </div>

      {/* Custom Clear Temp Confirmation Modal */}
      {showClearConfirmModal && (
        <div className="custom-confirm-modal-overlay">
          <div className="custom-confirm-modal-card">
            <div className="confirm-modal-icon-wrap">
              🧹
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
                <span>🛡️</span>
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
