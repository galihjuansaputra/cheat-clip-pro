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
  const [titleYPercent, setTitleYPercent] = useState<number>(14);
  const [subtitleYPercent, setSubtitleYPercent] = useState<number>(18);
  const [subtitlePositionMode, setSubtitlePositionMode] = useState<SubtitlePositionMode>('bottom');
  const [subtitleCenterYPercent, setSubtitleCenterYPercent] = useState<number>(50);
  const [isCustomTitleY, setIsCustomTitleY] = useState<boolean>(false);
  const [titleDuration, setTitleDuration] = useState<TitleDurationOption>('entire');
  const [isClearingTemp, setIsClearingTemp] = useState<boolean>(false);
  const [tempClearMsg, setTempClearMsg] = useState<string>('');
  const [showClearConfirmModal, setShowClearConfirmModal] = useState<boolean>(false);

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
            if (currentPreviewClip && t >= currentPreviewClip.end_time) {
              if (isLooping) {
                directVideoRef.current.currentTime = currentPreviewClip.start_time;
              } else {
                directVideoRef.current.pause();
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
        setIsPlaying(false);
      } else {
        if (currentPreviewClip && (currentTime >= currentPreviewClip.end_time || currentTime < currentPreviewClip.start_time)) {
          directVideoRef.current.currentTime = currentPreviewClip.start_time;
        }
        directVideoRef.current.play();
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

  const applyLetterCase = (text: string, style: TextCaseOption): string => {
    if (style === 'uppercase') return text.toUpperCase();
    if (style === 'lowercase') return text.toLowerCase();
    return text.replace(/\b\w/g, c => c.toUpperCase());
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
        titleY: lines >= 3 ? 10.3 : lines === 2 ? 12.2 : 16.5,
        subtitleY: 18.0,
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
      titleY: lines >= 3 ? 9.5 : lines === 2 ? 11.5 : 13.5,
      subtitleY: 18.0,
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
                <span className="slider-value-badge">
                  {t.studio.titleYVal(safeTitleY, titleLineCount >= 3)}
                </span>
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
                      <button type="button" onClick={() => { setTitleYPercent(titleLineCount >= 3 ? 9.5 : 13.5); setIsCustomTitleY(true); }}>
                        {t.studio.quickDefault(titleLineCount >= 3 ? '9.5%' : '13.5%')}
                      </button>
                      <button type="button" onClick={() => { setTitleYPercent(18); setIsCustomTitleY(true); }}>{t.studio.quickLower(18)}</button>
                    </>
                  ) : aspectRatio === '1:1' ? (
                    <>
                      <button type="button" onClick={() => { setTitleYPercent(7); setIsCustomTitleY(true); }}>{t.studio.quickHigh(7)}</button>
                      <button type="button" onClick={() => { setTitleYPercent(titleLineCount >= 3 ? 10.3 : 16.5); setIsCustomTitleY(true); }}>
                        {t.studio.quickSnugDefault(titleLineCount >= 3 ? '10.3%' : '16.5%')}
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
                  <span className="slider-value-badge">{t.studio.subYBottomVal(safeSubtitleY)}</span>
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
                        <button type="button" onClick={() => setSubtitleYPercent(10)}>{t.studio.quickLow(10)}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(18)}>{t.studio.quickDefault('18%')}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(26)}>{t.studio.quickMid(26)}</button>
                      </>
                    ) : aspectRatio === '1:1' ? (
                      <>
                        <button type="button" onClick={() => setSubtitleYPercent(12)}>{t.studio.quickLow(12)}</button>
                        <button type="button" onClick={() => setSubtitleYPercent(18)}>{t.studio.quickSnugDefault('18%')}</button>
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
                  <span className="slider-value-badge">
                    {t.studio.subYCenterVal(
                      safeSubCenterY,
                      safeSubCenterY === 50
                        ? t.studio.posDeadCenter
                        : safeSubCenterY < 50
                        ? t.studio.posUpper
                        : t.studio.posLower
                    )}
                  </span>
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

          {/* 6. Selected Clips Checklist */}
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
              className="phone-wireframe-container real-preview-container"
              style={{ width: `${phoneWidth}px`, height: `${phoneHeight}px` }}
            >
              {/* Background Backdrop (Black or Ambient Blurred) */}
              <div
                className="real-frame-bg-layer"
                style={{ backgroundColor: '#000000' }}
              >
                {backgroundStyle === 'blurred' && aspectRatio !== '9:16' && (
                  <div className="ambient-blur-backdrop" style={{ filter: 'blur(28px)', opacity: 0.45 }}>
                    <div style={{ width: '100%', height: '100%', background: 'radial-gradient(circle, #3b82f6 0%, #1e1b4b 60%, #000 100%)' }}></div>
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
                          onPlay={() => { setIsPlaying(true); startTracking(); }}
                          onPause={() => { setIsPlaying(false); stopTracking(); }}
                          onEnded={() => {
                            if (isLooping && currentPreviewClip) {
                              if (directVideoRef.current) {
                                directVideoRef.current.currentTime = currentPreviewClip.start_time;
                                directVideoRef.current.play();
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
                              ? '14px'
                              : '16px'
                            : fontSize === 'big'
                            ? titleLineCount >= 3
                              ? '20px'
                              : '23px'
                            : titleLineCount >= 3
                            ? '17px'
                            : '19.5px',
                        lineHeight: titleLineCount >= 3 ? 1.15 : 1.22,
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
                        fontSize: fontSize === 'small' ? '15px' : fontSize === 'big' ? '22px' : '18.5px',
                        fontWeight: 800,
                        letterSpacing: '0.03em',
                        textAlign: 'center',
                        textShadow: '0 0 2px #000, 0 1px 3px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.8)',
                        display: 'inline-block',
                      }}
                    >
                      {captionStyle === 'viral_pop' && (
                        <>
                          <span style={{ color: '#ffffff' }}>{applyLetterCase('SENEGARA.', textCase)}</span>{' '}
                          <span style={{ color: '#FFE600' }}>{applyLetterCase('TAPI,', textCase)}</span>
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
              </div>
            </div>

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
                    {batchProgress.clips.filter(c => c.status === 'completed').map((c, i) => (
                      <div key={i} className="recent-file-row">
                        <span className="file-idx">#{i + 1}</span>
                        <span className="file-name" title={c.title}>{c.title}</span>
                        {c.download_url && (
                          <a href={c.download_url} download className="quick-dl-btn">
                            ⬇️ MP4
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Batch Render Queue Card - placed directly under Render Specs & History */}
            {batchProgress && (
              <div className="studio-batch-queue-card">
                <div className="batch-progress-header">
                  <div>
                    <h4 className="batch-queue-title">{t.studio.batchQueueTitle}</h4>
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
                  {batchProgress.clips.map((clip, idx) => (
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>{t.studio.statusDoneShort}</span>
                            {clip.download_url && (
                              <a href={clip.download_url} download className="btn-download-clip" style={{ padding: '0.15rem 0.45rem', fontSize: '0.68rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', textDecoration: 'none', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                                ⬇️ MP4
                              </a>
                            )}
                          </div>
                        )}
                        {clip.status === 'error' && <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{t.studio.statusFailedShort}</span>}
                      </div>
                    </div>
                  ))}
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
          disabled={isRendering || selectedClips.length === 0}
        >
          {isRendering ? (
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
            <p className="confirm-modal-desc">
              {t.studio.confirmModalDesc}
              <br /><br />
              <strong style={{ color: '#4ade80' }}>{t.studio.confirmModalNotice}</strong>
            </p>
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
