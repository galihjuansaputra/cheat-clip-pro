import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Play, Pause, ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from '../locales';
import type { ViralClip, TranscriptLine } from '../types';

interface ClipTrimmerModalProps {
  isOpen: boolean;
  clip: ViralClip | null;
  videoId: string;
  videoUrl?: string;
  sourceType?: string;
  videoTitle?: string;
  videoDuration: number;
  transcript?: TranscriptLine[];
  onClose: () => void;
  onApply?: (adjustedClip: ViralClip) => void;
  onDownload: (adjustedClip: ViralClip) => Promise<void> | void;
}

const formatSeconds = (sec: number): string => {
  if (isNaN(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  const remS = s % 60;
  if (h > 0) {
    return `${h}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
  }
  return `${remM}:${remS.toString().padStart(2, '0')}`;
};

const parseFormattedTime = (val: string): number | null => {
  const clean = val.trim();
  if (!clean) return null;
  if (/^\d+(\.\d+)?$/.test(clean)) return parseFloat(clean);
  const parts = clean.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
};

// 2 minutes maximum context window before start and after end
const CONTEXT_LIMIT_SEC = 120;

export const ClipTrimmerModal: React.FC<ClipTrimmerModalProps> = ({
  isOpen,
  clip,
  videoId,
  videoUrl,
  sourceType,
  videoDuration,
  transcript = [],
  onClose,
  onApply,
  onDownload,
}) => {
  const { t } = useLanguage();

  const isDirectVideo = Boolean(
    sourceType === 'gdrive' ||
    sourceType === 'upload' ||
    videoId?.startsWith('gdrive_') ||
    videoId?.startsWith('upload_') ||
    videoUrl?.startsWith('/api/video/') ||
    videoUrl?.startsWith('blob:')
  );
  const isTwitch = Boolean(
    sourceType === 'twitch' ||
    videoId?.startsWith('twitch_') ||
    videoUrl?.includes('twitch.tv')
  );
  const directVideoRef = useRef<HTMLVideoElement | null>(null);
  const twitchPlayerRef = useRef<any>(null);

  const origStart = clip?.start_time ?? 0;
  const origEnd = clip?.end_time ?? 0;
  const effectiveTotalDur = videoDuration > 0 ? videoDuration : origEnd + CONTEXT_LIMIT_SEC;

  // Maximum ±2 minutes (120 seconds) context window
  const minTimelineStart = Math.max(0, Math.floor(origStart - CONTEXT_LIMIT_SEC));
  const maxTimelineEnd = Math.min(effectiveTotalDur, Math.ceil(origEnd + CONTEXT_LIMIT_SEC));
  const timelineSpan = Math.max(1, maxTimelineEnd - minTimelineStart);

  const [adjustedStart, setAdjustedStart] = useState<number>(origStart);
  const [adjustedEnd, setAdjustedEnd] = useState<number>(origEnd);
  const [clipTitle, setClipTitle] = useState<string>(clip?.title_suggestion || clip?.title || 'Clip');
  const [startInputVal, setStartInputVal] = useState<string>(formatSeconds(origStart));
  const [endInputVal, setEndInputVal] = useState<string>(formatSeconds(origEnd));
  const [currentTime, setCurrentTime] = useState<number>(origStart);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showTranscript, setShowTranscript] = useState<boolean>(true);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);
  const [playerReady, setPlayerReady] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (directVideoRef.current) {
        directVideoRef.current.muted = false;
        directVideoRef.current.volume = volume || 0.8;
      } else if (isTwitch && twitchPlayerRef.current && typeof twitchPlayerRef.current.setMuted === 'function') {
        twitchPlayerRef.current.setMuted(false);
        if (typeof twitchPlayerRef.current.setVolume === 'function') {
          twitchPlayerRef.current.setVolume(volume || 0.8);
        }
      }
    } else {
      setIsMuted(true);
      if (directVideoRef.current) {
        directVideoRef.current.muted = true;
      } else if (isTwitch && twitchPlayerRef.current && typeof twitchPlayerRef.current.setMuted === 'function') {
        twitchPlayerRef.current.setMuted(true);
      }
    }
  };

  const timelineBarRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const timePollRef = useRef<number | null>(null);
  const playerReadyRef = useRef<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);
  const throttledSeekRef = useRef<number | null>(null);
  const boundsRef = useRef<{ start: number; end: number }>({ start: origStart, end: origEnd });
  const activeDragInfoRef = useRef<{
    type: 'start' | 'end' | 'playhead' | 'range';
    startClientX: number;
    initialStart: number;
    initialEnd: number;
    clipDur: number;
  } | null>(null);

  // Initialize or reset when clip changes
  useEffect(() => {
    if (clip) {
      setAdjustedStart(clip.start_time);
      setAdjustedEnd(clip.end_time);
      setClipTitle(clip.title_suggestion || clip.title || 'Clip');
      setStartInputVal(formatSeconds(clip.start_time));
      setEndInputVal(formatSeconds(clip.end_time));
      setCurrentTime(clip.start_time);
      setIsDownloading(false);
      setDownloadSuccess(false);
      if (isDirectVideo && directVideoRef.current) {
        directVideoRef.current.currentTime = clip.start_time;
      }
    }
  }, [clip, isDirectVideo]);

  // Keep manual text inputs synced with numeric state
  useEffect(() => {
    setStartInputVal(formatSeconds(adjustedStart));
  }, [adjustedStart]);

  useEffect(() => {
    setEndInputVal(formatSeconds(adjustedEnd));
  }, [adjustedEnd]);

  // Keep bounds ref synced for interval checks without re-creating interval
  useEffect(() => {
    boundsRef.current = { start: adjustedStart, end: adjustedEnd };
  }, [adjustedStart, adjustedEnd]);

  // Reset download success banner when timestamps change
  useEffect(() => {
    setDownloadSuccess(false);
  }, [adjustedStart, adjustedEnd]);

  // Setup Twitch interactive embed player for the modal preview
  useEffect(() => {
    if (!isOpen || !clip || !isTwitch) return;
    let isMounted = true;
    playerReadyRef.current = false;
    setPlayerReady(false);

    const isClip = videoId?.startsWith('twitch_clip_');
    const rawId = isClip ? videoId.replace('twitch_clip_', '') : videoId.replace('twitch_', '');

    const initTwitch = () => {
      if (!isMounted) return;
      const container = document.getElementById('trimmer-twitch-player-container');
      if (!container) {
        setTimeout(initTwitch, 150);
        return;
      }

      if ((window as any).Twitch && (window as any).Twitch.Player) {
        container.innerHTML = '<div id="trimmer-twitch-slot"></div>';
        try {
          const opts: any = {
            width: '100%',
            height: '100%',
            autoplay: false,
            parent: [window.location.hostname || 'localhost', 'localhost', '127.0.0.1']
          };
          if (isClip) opts.clip = rawId; else opts.video = rawId;
          const p = new (window as any).Twitch.Player('trimmer-twitch-slot', opts);
          twitchPlayerRef.current = p;
          p.addEventListener((window as any).Twitch.Player.READY, () => {
            if (!isMounted) return;
            playerReadyRef.current = true;
            setPlayerReady(true);
            try {
              p.seek(adjustedStart);
              setCurrentTime(adjustedStart);
            } catch (_) {}
          });
          p.addEventListener((window as any).Twitch.Player.PLAY, () => {
            if (isMounted) setIsPlaying(true);
          });
          p.addEventListener((window as any).Twitch.Player.PAUSE, () => {
            if (isMounted) setIsPlaying(false);
          });
        } catch (err) {
          console.error('Error init twitch trimmer:', err);
        }
      } else {
        setTimeout(initTwitch, 250);
      }
    };
    initTwitch();

    const interval = window.setInterval(() => {
      if (!isMounted || isDraggingRef.current) return;
      if (twitchPlayerRef.current && typeof twitchPlayerRef.current.getCurrentTime === 'function') {
        const curr = twitchPlayerRef.current.getCurrentTime();
        if (typeof curr === 'number' && !isNaN(curr)) {
          setCurrentTime(curr);
          if (curr >= boundsRef.current.end) {
            twitchPlayerRef.current.seek(boundsRef.current.start);
            twitchPlayerRef.current.pause();
            setIsPlaying(false);
          }
        }
      }
    }, 150);

    return () => {
      isMounted = false;
      clearInterval(interval);
      if (twitchPlayerRef.current) {
        twitchPlayerRef.current = null;
      }
    };
  }, [isOpen, clip, isTwitch, videoId]);

  // Setup YouTube Iframe API player for the modal preview (only for YouTube videos)
  useEffect(() => {
    if (!isOpen || !clip || isDirectVideo || isTwitch) {
      return;
    }
    let isMounted = true;
    let pollTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let attempts = 0;

    playerReadyRef.current = false;
    setPlayerReady(false);

    // Ensure YouTube IFrame API is present
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    const loadDirectIframe = (container: HTMLElement) => {
      if (!isMounted || playerReadyRef.current) return;
      const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${Math.floor(adjustedStart)}&controls=1&rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
      container.innerHTML = `<iframe id="trimmer-direct-yt-iframe" src="${embedUrl}" style="width:100%!important;height:100%!important;border:none;display:block;position:absolute;top:0;left:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      playerReadyRef.current = true;
      setPlayerReady(true);
    };

    const setupPlayer = () => {
      if (!isMounted || playerReadyRef.current) return;

      const container = document.getElementById('trimmer-yt-player-container');
      if (!container) {
        attempts++;
        if (attempts < 45) {
          pollTimer = window.setTimeout(setupPlayer, 100);
        }
        return;
      }

      if (!window.YT || !window.YT.Player) {
        attempts++;
        if (attempts < 40) {
          pollTimer = window.setTimeout(setupPlayer, 120);
        } else {
          loadDirectIframe(container);
        }
        return;
      }

      try {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
          try {
            ytPlayerRef.current.destroy();
          } catch {}
          ytPlayerRef.current = null;
        }

        container.innerHTML = '<div id="trimmer-yt-iframe-slot" style="width:100%;height:100%;"></div>';

        ytPlayerRef.current = new window.YT.Player('trimmer-yt-iframe-slot', {
          videoId: videoId,
          playerVars: {
            autoplay: 0,
            start: Math.floor(adjustedStart),
            controls: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (e: any) => {
              if (!isMounted) return;
              if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
              }
              playerReadyRef.current = true;
              setPlayerReady(true);
              try {
                e.target.seekTo(adjustedStart, true);
              } catch {}
            },
            onStateChange: (e: any) => {
              if (!isMounted) return;
              setIsPlaying(e.data === 1);
            },
            onError: (err: any) => {
              console.warn('YouTube Player transient error in trimmer:', err);
            }
          }
        });
      } catch (err) {
        console.warn('Could not initialize YT Player for trimmer:', err);
        attempts++;
        if (attempts < 40) {
          pollTimer = window.setTimeout(setupPlayer, 150);
        } else {
          loadDirectIframe(container);
        }
      }
    };

    fallbackTimer = window.setTimeout(() => {
      if (isMounted && !playerReadyRef.current && !ytPlayerRef.current) {
        const container = document.getElementById('trimmer-yt-player-container');
        if (container) {
          loadDirectIframe(container);
        }
      }
    }, 4500);

    pollTimer = window.setTimeout(setupPlayer, 60);

    return () => {
      isMounted = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (ytPlayerRef.current && typeof ytPlayerRef.current.destroy === 'function') {
        try {
          ytPlayerRef.current.destroy();
        } catch {}
        ytPlayerRef.current = null;
      }
    };
  }, [videoId, clip?.start_time, isOpen, isDirectVideo]);

  // Monitor playhead and enforce looping/pause at adjustedEnd
  useEffect(() => {
    timePollRef.current = window.setInterval(() => {
      // Do not poll or overwrite playhead while user is dragging
      if (isDraggingRef.current) return;
      if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
        try {
          const curr = ytPlayerRef.current.getCurrentTime();
          setCurrentTime(curr);
          const currentEnd = boundsRef.current.end;
          const currentStart = boundsRef.current.start;
          if (curr >= currentEnd) {
            ytPlayerRef.current.seekTo(currentStart, true);
            ytPlayerRef.current.pauseVideo();
            setIsPlaying(false);
          }
        } catch {}
      }
    }, 250);

    return () => {
      if (timePollRef.current) {
        clearInterval(timePollRef.current);
        timePollRef.current = null;
      }
    };
  }, []);

  // Throttled seeking helper during dragging to prevent excessive calls
  const doThrottledSeek = useCallback((targetSec: number) => {
    if (throttledSeekRef.current) return;
    throttledSeekRef.current = window.setTimeout(() => {
      throttledSeekRef.current = null;
      if (isDirectVideo) {
        if (directVideoRef.current) {
          directVideoRef.current.currentTime = targetSec;
        }
      } else if (isTwitch && twitchPlayerRef.current && typeof twitchPlayerRef.current.seek === 'function') {
        try {
          twitchPlayerRef.current.seek(targetSec);
        } catch {}
      } else if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
        try {
          ytPlayerRef.current.seekTo(targetSec, false);
        } catch {}
      }
    }, 100);
  }, [isDirectVideo]);

  // Player seeking helper (immediate)
  const seekToTime = useCallback((targetSec: number, play: boolean = false) => {
    const clamped = Math.max(minTimelineStart, Math.min(maxTimelineEnd, targetSec));
    setCurrentTime(clamped);
    if (throttledSeekRef.current) {
      clearTimeout(throttledSeekRef.current);
      throttledSeekRef.current = null;
    }
    if (isDirectVideo) {
      const vid = directVideoRef.current;
      if (vid) {
        vid.currentTime = clamped;
        if (play) {
          vid.muted = isMuted;
          vid.volume = isMuted ? 0 : volume;
          vid.play().then(() => setIsPlaying(true)).catch((err) => {
            console.warn('Seek play error:', err);
          });
        }
      }
    } else if (isTwitch && twitchPlayerRef.current && typeof twitchPlayerRef.current.seek === 'function') {
      try {
        twitchPlayerRef.current.seek(clamped);
        if (play) {
          twitchPlayerRef.current.play();
          setIsPlaying(true);
        }
      } catch {}
    } else if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
      try {
        ytPlayerRef.current.seekTo(clamped, true);
        if (play) {
          ytPlayerRef.current.playVideo();
          setIsPlaying(true);
        }
      } catch {}
    }
  }, [minTimelineStart, maxTimelineEnd, isDirectVideo, isMuted, volume]);

  const togglePlay = useCallback(async () => {
    if (isDirectVideo) {
      const vid = directVideoRef.current;
      if (!vid) return;
      if (!vid.paused) {
        vid.pause();
        setIsPlaying(false);
      } else {
        if (vid.currentTime >= boundsRef.current.end || vid.currentTime < boundsRef.current.start - 0.5) {
          vid.currentTime = boundsRef.current.start;
          setCurrentTime(boundsRef.current.start);
        }
        vid.muted = isMuted;
        vid.volume = isMuted ? 0 : volume;
        try {
          await vid.play();
          setIsPlaying(true);
        } catch (err) {
          console.warn('Playback with audio blocked, trying fallback:', err);
          try {
            vid.muted = true;
            setIsMuted(true);
            await vid.play();
            setIsPlaying(true);
          } catch (e) {
            console.error('Direct video play error:', e);
          }
        }
      }
    } else if (isTwitch && twitchPlayerRef.current) {
      try {
        if (isPlaying) {
          twitchPlayerRef.current.pause();
          setIsPlaying(false);
        } else {
          if (currentTime >= adjustedEnd || currentTime < adjustedStart) {
            seekToTime(adjustedStart, true);
          } else {
            twitchPlayerRef.current.play();
            setIsPlaying(true);
          }
        }
      } catch {}
    } else if (ytPlayerRef.current) {
      try {
        if (isPlaying && typeof ytPlayerRef.current.pauseVideo === 'function') {
          ytPlayerRef.current.pauseVideo();
          setIsPlaying(false);
        } else if (typeof ytPlayerRef.current.playVideo === 'function') {
          if (currentTime >= adjustedEnd || currentTime < adjustedStart) {
            seekToTime(adjustedStart, true);
          } else {
            ytPlayerRef.current.playVideo();
            setIsPlaying(true);
          }
        }
      } catch {}
    }
  }, [isDirectVideo, isPlaying, adjustedStart, adjustedEnd, currentTime, isMuted, volume, seekToTime]);

  // Position calculation helpers
  const timeToPct = useCallback((tSec: number): number => {
    const ratio = (tSec - minTimelineStart) / timelineSpan;
    return Math.max(0, Math.min(100, ratio * 100));
  }, [minTimelineStart, timelineSpan]);

  const pctToTime = useCallback((pct: number): number => {
    const ratio = Math.max(0, Math.min(1, pct / 100));
    return minTimelineStart + ratio * timelineSpan;
  }, [minTimelineStart, timelineSpan]);

  // Smooth dragging logic using global window pointer event listeners
  const handlePointerDown = (type: 'start' | 'end' | 'playhead' | 'range', e: React.PointerEvent) => {
    if (isDownloading) return;
    e.preventDefault();
    e.stopPropagation();

    if (!timelineBarRef.current) return;
    const rect = timelineBarRef.current.getBoundingClientRect();
    const clickPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const targetTime = pctToTime(clickPct);

    activeDragInfoRef.current = {
      type,
      startClientX: e.clientX,
      initialStart: adjustedStart,
      initialEnd: adjustedEnd,
      clipDur: Math.max(1, adjustedEnd - adjustedStart),
    };
    isDraggingRef.current = true;
    setIsDragging(true);

    if (type === 'playhead') {
      const clamped = Math.max(minTimelineStart, Math.min(maxTimelineEnd, targetTime));
      setCurrentTime(clamped);
      doThrottledSeek(clamped);
    }

    const onGlobalPointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current || !activeDragInfoRef.current || !timelineBarRef.current) return;
      const barRect = timelineBarRef.current.getBoundingClientRect();
      const currentPct = Math.max(0, Math.min(100, ((ev.clientX - barRect.left) / barRect.width) * 100));
      const currentT = pctToTime(currentPct);
      const { type: dragType, initialStart, clipDur, startClientX } = activeDragInfoRef.current;

      if (dragType === 'start') {
        const newStart = Math.max(minTimelineStart, Math.min(adjustedEnd - 3, Math.round(currentT)));
        setAdjustedStart(newStart);
        setCurrentTime(newStart);
        doThrottledSeek(newStart);
      } else if (dragType === 'end') {
        const newEnd = Math.min(maxTimelineEnd, Math.max(adjustedStart + 3, Math.round(currentT)));
        setAdjustedEnd(newEnd);
        setCurrentTime(newEnd);
        doThrottledSeek(newEnd);
      } else if (dragType === 'playhead') {
        const newPlayhead = Math.max(minTimelineStart, Math.min(maxTimelineEnd, currentT));
        setCurrentTime(newPlayhead);
        doThrottledSeek(newPlayhead);
      } else if (dragType === 'range') {
        const pixelDelta = ev.clientX - startClientX;
        const timeDelta = (pixelDelta / barRect.width) * timelineSpan;
        let newStart = Math.round(initialStart + timeDelta);
        let newEnd = newStart + clipDur;
        if (newStart < minTimelineStart) {
          newStart = minTimelineStart;
          newEnd = newStart + clipDur;
        }
        if (newEnd > maxTimelineEnd) {
          newEnd = maxTimelineEnd;
          newStart = newEnd - clipDur;
        }
        setAdjustedStart(newStart);
        setAdjustedEnd(newEnd);
        setCurrentTime(newStart);
        doThrottledSeek(newStart);
      }
    };

    const onGlobalPointerUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onGlobalPointerMove);
      window.removeEventListener('pointerup', onGlobalPointerUp);
      window.removeEventListener('pointercancel', onGlobalPointerUp);

      if (isDraggingRef.current && activeDragInfoRef.current && timelineBarRef.current) {
        const barRect = timelineBarRef.current.getBoundingClientRect();
        const currentPct = Math.max(0, Math.min(100, ((ev.clientX - barRect.left) / barRect.width) * 100));
        const currentT = pctToTime(currentPct);
        const { type: dragType } = activeDragInfoRef.current;

        let finalSeek = currentT;
        if (dragType === 'start') {
          finalSeek = Math.max(minTimelineStart, Math.min(adjustedEnd - 3, Math.round(currentT)));
        } else if (dragType === 'end') {
          finalSeek = Math.min(maxTimelineEnd, Math.max(adjustedStart + 3, Math.round(currentT)));
        } else if (dragType === 'playhead') {
          finalSeek = Math.max(minTimelineStart, Math.min(maxTimelineEnd, currentT));
        }

        if (throttledSeekRef.current) {
          clearTimeout(throttledSeekRef.current);
          throttledSeekRef.current = null;
        }
        if (ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
          try {
            ytPlayerRef.current.seekTo(finalSeek, true);
          } catch {}
        }
      }

      isDraggingRef.current = false;
      activeDragInfoRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', onGlobalPointerMove);
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerUp);
  };

  // Stepper handlers
  const nudgeStart = (deltaSec: number) => {
    const next = Math.max(minTimelineStart, Math.min(adjustedEnd - 3, adjustedStart + deltaSec));
    setAdjustedStart(next);
    seekToTime(next, false);
  };

  const nudgeEnd = (deltaSec: number) => {
    const next = Math.min(maxTimelineEnd, Math.max(adjustedStart + 3, adjustedEnd + deltaSec));
    setAdjustedEnd(next);
    seekToTime(next, false);
  };

  // Context metrics
  const frontAdded = Math.max(0, Math.round(origStart - adjustedStart));
  const endAdded = Math.max(0, Math.round(adjustedEnd - origEnd));
  const adjustedDuration = Math.max(1, Math.round(adjustedEnd - adjustedStart));
  const origDuration = Math.max(1, Math.round(origEnd - origStart));

  // Transcript lines within the 4-minute adjustment window
  const relevantTranscript = useMemo(() => {
    if (!transcript || transcript.length === 0) return [];
    return transcript.filter(line => line.end >= minTimelineStart && line.start <= maxTimelineEnd);
  }, [transcript, minTimelineStart, maxTimelineEnd]);

  // Construct adjusted clip object for downloading
  const getAdjustedClip = (): ViralClip => ({
    virality_score: 85,
    key_quotes: [],
    transcript: '',
    ...(clip || {}),
    title: clipTitle.trim() || clip?.title || 'Clip',
    title_suggestion: clipTitle.trim() || clip?.title_suggestion || 'Clip',
    start_time: adjustedStart,
    end_time: adjustedEnd,
  });

  const handleDownloadClick = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadSuccess(false);
    try {
      await onDownload(getAdjustedClip());
      setDownloadSuccess(true);
    } catch (err) {
      console.error('Failed to download clip:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isOpen || !clip) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 10000, padding: '1rem' }}>
      <div
        className="studio-modal-card clip-trimmer-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="trimmer-header">
          <div className="studio-header-title">
            <div>
              <div className="trimmer-title-row">
                <h2 className="trimmer-title">
                  <span style={{ color: 'var(--primary)' }}>&gt;_</span> {t.trimmer.modalTitle}
                </h2>
                <span className="trimmer-limit-pill">
                  ±2 MIN CONTEXT LIMIT
                </span>
              </div>
              <p className="studio-header-desc" style={{ fontSize: '0.78rem', margin: '0.25rem 0 0', color: 'var(--text-secondary)' }}>
                {t.trimmer.modalSubtitle}
              </p>
            </div>
          </div>
          <button
            className="trimmer-close-btn"
            onClick={onClose}
            title={t.trimmer.closeBtn}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="trimmer-body">

          {/* Title Editor Row */}
          <div className="trimmer-name-row">
            <span className="trimmer-name-label">
              {t.trimmer.clipTitleLabel}
            </span>
            <input
              type="text"
              className="trimmer-name-input"
              value={clipTitle}
              disabled={isDownloading}
              onChange={(e) => setClipTitle(e.target.value)}
              placeholder="Clip title"
            />
          </div>

          {/* Top Row: Embedded Video Preview Player & Live Context Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.25fr) minmax(260px, 1fr)', gap: '1rem', alignItems: 'start' }}>
            {/* Left Column: Video Player Box + External Control Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <div
                className="trimmer-player-wrapper"
                style={{
                  background: '#0a0a0f',
                  backgroundImage: (!isDirectVideo && videoId) ? `url(https://img.youtube.com/vi/${videoId}/hqdefault.jpg)` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  borderRadius: 0,
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.1)',
                  position: 'relative',
                  aspectRatio: '16/9',
                  cursor: isDirectVideo ? 'pointer' : 'default'
                }}
                onClick={isDirectVideo ? togglePlay : undefined}
              >
                {/* Thumbnail backdrop loading placeholder */}
                {!playerReady && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.45)',
                    backdropFilter: 'blur(2px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1,
                    pointerEvents: 'none'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.5rem 0.9rem',
                      background: 'rgba(10, 15, 28, 0.85)',
                      borderRadius: 0,
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 1.2s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                      </svg>
                      <span>Loading preview player...</span>
                    </div>
                  </div>
                )}

                {/* Player mount container */}
                {isDirectVideo ? (
                  <video
                    ref={directVideoRef}
                    src={videoUrl ? encodeURI(videoUrl) : `/api/video/${encodeURIComponent(videoId)}`}
                    playsInline
                    preload="auto"
                    onError={(e) => {
                      const vid = e.currentTarget;
                      if (videoUrl?.startsWith('blob:')) return;
                      const fallback = `/api/video/${encodeURIComponent(videoId)}`;
                      if (vid.src !== fallback && !vid.src.endsWith(fallback)) {
                        vid.src = fallback;
                        vid.load();
                      }
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'relative',
                      zIndex: 2,
                      opacity: playerReady ? 1 : 0,
                      transition: 'opacity 0.28s ease',
                      pointerEvents: isDragging ? 'none' : 'auto',
                      objectFit: 'contain',
                      background: '#000',
                      borderRadius: 0
                    }}
                    onLoadedMetadata={() => {
                      playerReadyRef.current = true;
                      setPlayerReady(true);
                      if (directVideoRef.current) {
                        directVideoRef.current.currentTime = adjustedStart;
                      }
                    }}
                    onTimeUpdate={(e) => {
                      if (isDraggingRef.current) return;
                      const curr = e.currentTarget.currentTime;
                      setCurrentTime(curr);
                      if (curr >= boundsRef.current.end) {
                        e.currentTarget.currentTime = boundsRef.current.start;
                        e.currentTarget.pause();
                        setIsPlaying(false);
                      }
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                ) : isTwitch ? (
                  <div
                    id="trimmer-twitch-player-container"
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'relative',
                      zIndex: 2,
                      opacity: playerReady ? 1 : 0,
                      transition: 'opacity 0.28s ease',
                      pointerEvents: isDragging ? 'none' : 'auto'
                    }}
                  >
                    <div id="trimmer-twitch-slot"></div>
                  </div>
                ) : (
                  <div
                    id="trimmer-yt-player-container"
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'relative',
                      zIndex: 2,
                      opacity: playerReady ? 1 : 0,
                      transition: 'opacity 0.28s ease',
                      pointerEvents: isDragging ? 'none' : 'auto'
                    }}
                  ></div>
                )}
              </div>

              {/* Dedicated External Player Controls (Outside the video frame) */}
              <div
                className="trimmer-video-controls-bar"
                style={{
                  background: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 0,
                  padding: '0.45rem 0.65rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <button
                    type="button"
                    onClick={togglePlay}
                    style={{
                      background: isPlaying ? 'rgba(255, 30, 39, 0.2)' : 'rgba(255, 0, 255, 0.15)',
                      border: `1px solid ${isPlaying ? '#ff1e27' : '#ff00ff'}`,
                      color: isPlaying ? '#ff1e27' : '#ff00ff',
                      borderRadius: 0,
                      padding: '0.35rem 0.85rem',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      fontFamily: 'var(--font-mono)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {isPlaying ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}
                    <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
                  </button>

                  {/* Audio Mute / Unmute & Volume */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <button
                      type="button"
                      onClick={toggleMute}
                      style={{
                        background: isMuted ? 'rgba(255, 30, 39, 0.15)' : '#0e0e14',
                        border: `1px solid ${isMuted ? '#ff1e27' : 'rgba(255, 255, 255, 0.15)'}`,
                        color: isMuted ? '#ff1e27' : '#fff',
                        borderRadius: 0,
                        padding: '0.35rem 0.6rem',
                        cursor: 'pointer',
                        fontSize: '0.74rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700
                      }}
                      title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                    >
                      {isMuted ? '[MUTE]' : '[AUDIO]'}
                    </button>
                    {isDirectVideo && (
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setVolume(v);
                          if (v === 0) {
                             setIsMuted(true);
                          } else if (isMuted) {
                             setIsMuted(false);
                          }
                          if (directVideoRef.current) {
                            directVideoRef.current.volume = v;
                            directVideoRef.current.muted = (v === 0);
                          }
                        }}
                        style={{
                          width: '48px',
                          accentColor: '#ff00ff',
                          cursor: 'pointer',
                          height: '4px',
                          '--slider-progress': `${Math.max(0, Math.min(100, (isMuted ? 0 : volume) * 100))}%`
                        } as React.CSSProperties}
                        title={`Volume: ${Math.round(volume * 100)}%`}
                      />
                    )}
                  </div>
                </div>

                {/* Quick boundary jumps */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => seekToTime(adjustedStart, true)}
                    style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-secondary)', borderRadius: 0, padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}
                    title={t.trimmer.jumpToStart}
                  >
                    [&lt;&lt;] START
                  </button>
                  <button
                    type="button"
                    onClick={() => seekToTime(origStart, true)}
                    style={{ background: 'rgba(250, 204, 21, 0.15)', border: '1px solid #facc15', color: '#facc15', borderRadius: 0, padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                    title={t.trimmer.jumpToAiStart}
                  >
                    [*] AI START
                  </button>
                  <button
                    type="button"
                    onClick={() => seekToTime(origEnd, true)}
                    style={{ background: 'rgba(250, 204, 21, 0.15)', border: '1px solid #facc15', color: '#facc15', borderRadius: 0, padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                    title={t.trimmer.jumpToAiEnd}
                  >
                    AI END [*]
                  </button>
                  <button
                    type="button"
                    onClick={() => seekToTime(adjustedEnd, true)}
                    style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-secondary)', borderRadius: 0, padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}
                    title={t.trimmer.jumpToEnd}
                  >
                    END [&gt;&gt;]
                  </button>
                </div>

                {/* Real-time Time / Length badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#0e0e14', padding: '0.25rem 0.6rem', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)' }}>
                  <span style={{ color: '#00ffff', fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {formatSeconds(currentTime)}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem' }}>/</span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                    {formatSeconds(adjustedEnd - adjustedStart)}
                  </span>
                </div>
              </div>
            </div>

            {/* Context Metrics & Quick Presets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {/* Metrics Card */}
              <div style={{
                background: '#0a0a0f',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 0,
                padding: '0.8rem 1rem',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.75rem'
              }}>
                <div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)' }}>
                    {t.trimmer.adjustedDuration}
                  </span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ff00ff', fontFamily: 'var(--font-mono)', marginTop: '0.15rem', textShadow: '0 0 10px rgba(255, 0, 255, 0.35)' }}>
                    {formatSeconds(adjustedDuration)}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)' }}>
                    {formatSeconds(adjustedStart)} → {formatSeconds(adjustedEnd)}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-mono)' }}>
                    {t.trimmer.originalDuration}
                  </span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#facc15', fontFamily: 'var(--font-mono)', marginTop: '0.15rem' }}>
                    {formatSeconds(origDuration)}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)' }}>
                    {formatSeconds(origStart)} → {formatSeconds(origEnd)}
                  </span>
                </div>

                {/* Added context summary pills */}
                <div style={{ gridColumn: 'span 2', display: 'flex', gap: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                  <div style={{ flex: 1, background: frontAdded > 0 ? 'rgba(0, 255, 255, 0.08)' : '#0e0e14', padding: '0.35rem 0.6rem', borderRadius: 0, border: `1px solid ${frontAdded > 0 ? '#00ffff' : 'rgba(255,255,255,0.08)'}` }}>
                    <div style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{t.trimmer.addedIntro}</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: frontAdded > 0 ? '#00ffff' : 'var(--text-secondary)' }}>
                      {frontAdded > 0 ? `+${frontAdded}s (${formatSeconds(frontAdded)})` : '0s'}
                    </div>
                  </div>
                  <div style={{ flex: 1, background: endAdded > 0 ? 'rgba(255, 0, 255, 0.08)' : '#0e0e14', padding: '0.35rem 0.6rem', borderRadius: 0, border: `1px solid ${endAdded > 0 ? '#ff00ff' : 'rgba(255,255,255,0.08)'}` }}>
                    <div style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{t.trimmer.addedOutro}</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: endAdded > 0 ? '#ff00ff' : 'var(--text-secondary)' }}>
                      {endAdded > 0 ? `+${endAdded}s (${formatSeconds(endAdded)})` : '0s'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Presets Bar */}
              <div style={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0, padding: '0.55rem 0.75rem' }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '0.35rem' }}>
                  {t.trimmer.quickPresets} (MAX ±2M)
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => {
                      setAdjustedStart(origStart);
                      setAdjustedEnd(origEnd);
                      seekToTime(origStart, false);
                    }}
                    style={{
                      background: (adjustedStart === origStart && adjustedEnd === origEnd) ? 'rgba(250, 204, 21, 0.2)' : '#0e0e14',
                      border: `1px solid ${(adjustedStart === origStart && adjustedEnd === origEnd) ? '#facc15' : 'rgba(255,255,255,0.12)'}`,
                      color: (adjustedStart === origStart && adjustedEnd === origEnd) ? '#facc15' : 'var(--text-secondary)',
                      borderRadius: 0,
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      cursor: isDownloading ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    [ {t.trimmer.presetOriginal.toUpperCase()} ]
                  </button>
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => {
                      setAdjustedStart(Math.max(minTimelineStart, origStart - 15));
                      setAdjustedEnd(Math.min(maxTimelineEnd, origEnd + 15));
                      seekToTime(Math.max(minTimelineStart, origStart - 15), false);
                    }}
                    style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', borderRadius: 0, padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}
                  >
                    [ {t.trimmer.presetPlus15s.toUpperCase()} ]
                  </button>
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => {
                      setAdjustedStart(Math.max(minTimelineStart, origStart - 30));
                      setAdjustedEnd(Math.min(maxTimelineEnd, origEnd + 30));
                      seekToTime(Math.max(minTimelineStart, origStart - 30), false);
                    }}
                    style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', borderRadius: 0, padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}
                  >
                    [ {t.trimmer.presetPlus30s.toUpperCase()} ]
                  </button>
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => {
                      setAdjustedStart(Math.max(minTimelineStart, origStart - 60));
                      setAdjustedEnd(Math.min(maxTimelineEnd, origEnd + 60));
                      seekToTime(Math.max(minTimelineStart, origStart - 60), false);
                    }}
                    style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', borderRadius: 0, padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}
                  >
                    [ {t.trimmer.presetPlus1m.toUpperCase()} ]
                  </button>
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => {
                      setAdjustedStart(minTimelineStart);
                      setAdjustedEnd(maxTimelineEnd);
                      seekToTime(minTimelineStart, false);
                    }}
                    style={{ background: 'rgba(255, 0, 255, 0.12)', border: '1px solid #ff00ff', color: '#ff00ff', borderRadius: 0, padding: '0.25rem 0.55rem', fontSize: '0.72rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                  >
                    [ {t.trimmer.presetMax2m.toUpperCase()} ]
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Video Editor Timeline Container */}
          <div style={{ background: '#0a0a0f', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)', padding: '0.9rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>

            {/* Timeline Ruler & Zone Legends */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: 0, background: '#00ffff', display: 'inline-block' }}></span>
                  {t.trimmer.introContextZone}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 700, color: '#facc15' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: 0, background: '#facc15', display: 'inline-block' }}></span>
                  {t.trimmer.originalRecommendation}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: 0, background: '#ff00ff', display: 'inline-block' }}></span>
                  {t.trimmer.outroContextZone}
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)' }}>
                {formatSeconds(minTimelineStart)} — {formatSeconds(maxTimelineEnd)}
              </span>
            </div>

            {/* Timeline Track Bar */}
            <div
              ref={timelineBarRef}
              onPointerDown={(e) => {
                if (isDownloading) return;
                handlePointerDown('playhead', e);
              }}
              style={{
                position: 'relative',
                height: '56px',
                background: '#0e0e14',
                borderRadius: 0,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                cursor: isDownloading ? 'not-allowed' : 'pointer',
                userSelect: 'none',
                touchAction: 'none',
                overflow: 'visible',
                boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.6)',
                opacity: isDownloading ? 0.7 : 1
              }}
            >
              {/* Background Zones */}
              {/* 1. Intro Context Zone (Left) - Clean flat tint, NO diagonal stripes */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${timeToPct(origStart)}%`,
                  background: 'rgba(0, 255, 255, 0.05)',
                  borderRight: '1px solid rgba(255, 255, 255, 0.2)',
                  pointerEvents: 'none'
                }}
              />

              {/* 2. Original AI Highlight Zone (Center - Crisp Amber) */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${timeToPct(origStart)}%`,
                  width: `${timeToPct(origEnd) - timeToPct(origStart)}%`,
                  background: 'rgba(250, 204, 21, 0.12)',
                  borderLeft: '2px solid #facc15',
                  borderRight: '2px solid #facc15',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 2
                }}
              >
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  fontFamily: 'var(--font-mono)',
                  color: '#facc15',
                  background: '#000000',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 0,
                  border: '1px solid #facc15',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none'
                }}>
                  [ AI PICK: {origDuration}S ]
                </span>
              </div>

              {/* 3. Outro Context Zone (Right) - Clean flat tint, NO diagonal stripes */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${timeToPct(origEnd)}%`,
                  right: 0,
                  background: 'rgba(255, 0, 255, 0.05)',
                  borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
                  pointerEvents: 'none'
                }}
              />

              {/* Active Selected Range Overlay (Draggable Window) - Solid magenta borders, no multi-color gradient */}
              <div
                onPointerDown={(e) => !isDownloading && handlePointerDown('range', e)}
                style={{
                  position: 'absolute',
                  top: '4px',
                  bottom: '4px',
                  left: `${timeToPct(adjustedStart)}%`,
                  width: `${Math.max(0.5, timeToPct(adjustedEnd) - timeToPct(adjustedStart))}%`,
                  background: 'rgba(255, 0, 255, 0.15)',
                  borderTop: '2px solid #ff00ff',
                  borderBottom: '2px solid #ff00ff',
                  boxShadow: '0 0 15px rgba(255, 0, 255, 0.3)',
                  cursor: isDownloading ? 'not-allowed' : 'grab',
                  zIndex: 3,
                  borderRadius: 0,
                  touchAction: 'none'
                }}
                title="Drag to slide entire clip window"
              />

              {/* Draggable Start Handle - Solid Cyan #00ffff */}
              <div
                onPointerDown={(e) => !isDownloading && handlePointerDown('start', e)}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  bottom: '-4px',
                  left: `${timeToPct(adjustedStart)}%`,
                  width: '18px',
                  marginLeft: '-9px',
                  background: '#00ffff',
                  borderRadius: 0,
                  border: '1px solid #ffffff',
                  cursor: isDownloading ? 'not-allowed' : 'ew-resize',
                  zIndex: 10,
                  boxShadow: '0 0 12px rgba(0, 255, 255, 0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  touchAction: 'none'
                }}
                title={`${t.trimmer.startTimeLabel}: ${formatSeconds(adjustedStart)}`}
              >
                <div style={{ width: '2px', height: '24px', background: '#000', pointerEvents: 'none' }}></div>
                <div style={{
                  position: 'absolute',
                  top: '-24px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#000000',
                  color: '#00ffff',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  padding: '0.1rem 0.4rem',
                  borderRadius: 0,
                  border: '1px solid #00ffff',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  fontFamily: 'var(--font-mono)'
                }}>
                  {formatSeconds(adjustedStart)}
                </div>
              </div>

              {/* Draggable End Handle - Solid Magenta #ff00ff */}
              <div
                onPointerDown={(e) => !isDownloading && handlePointerDown('end', e)}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  bottom: '-4px',
                  left: `${timeToPct(adjustedEnd)}%`,
                  width: '18px',
                  marginLeft: '-9px',
                  background: '#ff00ff',
                  borderRadius: 0,
                  border: '1px solid #ffffff',
                  cursor: isDownloading ? 'not-allowed' : 'ew-resize',
                  zIndex: 10,
                  boxShadow: '0 0 12px rgba(255, 0, 255, 0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  touchAction: 'none'
                }}
                title={`${t.trimmer.endTimeLabel}: ${formatSeconds(adjustedEnd)}`}
              >
                <div style={{ width: '2px', height: '24px', background: '#000', pointerEvents: 'none' }}></div>
                <div style={{
                  position: 'absolute',
                  top: '-24px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#000000',
                  color: '#ff00ff',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  padding: '0.1rem 0.4rem',
                  borderRadius: 0,
                  border: '1px solid #ff00ff',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  fontFamily: 'var(--font-mono)'
                }}>
                  {formatSeconds(adjustedEnd)}
                </div>
              </div>

              {/* Playhead Needle ("The Red Scrub Line") */}
              <div
                onPointerDown={(e) => !isDownloading && handlePointerDown('playhead', e)}
                style={{
                  position: 'absolute',
                  top: '-14px',
                  bottom: '-8px',
                  left: `${timeToPct(currentTime)}%`,
                  width: '28px',
                  marginLeft: '-14px',
                  zIndex: 15,
                  cursor: isDownloading ? 'not-allowed' : 'ew-resize',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  touchAction: 'none',
                  pointerEvents: 'auto'
                }}
                title={`Playhead: ${formatSeconds(currentTime)}`}
              >
                {/* Playhead Diamond Cap */}
                <div style={{
                  width: '12px',
                  height: '12px',
                  background: '#ff1e27',
                  borderRadius: 0,
                  border: '1px solid #ffffff',
                  boxShadow: '0 0 12px #ff1e27',
                  flexShrink: 0,
                  transform: 'rotate(45deg)',
                  pointerEvents: 'none'
                }} />
                {/* Playhead Vertical Line */}
                <div style={{
                  width: '2px',
                  flex: 1,
                  background: '#ff1e27',
                  boxShadow: '0 0 8px #ff1e27',
                  pointerEvents: 'none'
                }} />
              </div>
            </div>

            {/* Stepper Buttons and Manual Inputs Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.2rem' }}>
              {/* Left Column: Intro / Opening Steppers & Input */}
              <div style={{ background: '#0a0a0f', border: '1px solid rgba(0, 255, 255, 0.25)', borderRadius: 0, padding: '0.65rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#00ffff' }}>
                    {t.trimmer.introAdjustLabel}
                  </span>
                  <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: frontAdded > 0 ? '#00ffff' : 'var(--text-secondary)' }}>
                    {frontAdded > 0 ? `+${frontAdded}s intro` : t.trimmer.noAddedContext}
                  </span>
                </div>
                {/* Stepper Buttons */}
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeStart(-30)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    -30s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeStart(-15)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    -15s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeStart(-5)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    -5s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => { setAdjustedStart(origStart); seekToTime(origStart, false); }} style={{ background: 'rgba(250, 204, 21, 0.15)', border: '1px solid #facc15', color: '#facc15', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {t.trimmer.resetToAiStart}
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeStart(+5)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    +5s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeStart(+15)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    +15s
                  </button>
                </div>
                {/* Manual Timestamp Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
                  <label style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{t.trimmer.startTimeLabel}:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={startInputVal}
                    disabled={isDownloading}
                    onChange={(e) => setStartInputVal(e.target.value)}
                    onBlur={() => {
                      const sec = parseFormattedTime(startInputVal);
                      if (sec !== null) {
                        const clamped = Math.max(minTimelineStart, Math.min(adjustedEnd - 3, sec));
                        setAdjustedStart(clamped);
                        seekToTime(clamped, false);
                      } else {
                        setStartInputVal(formatSeconds(adjustedStart));
                      }
                    }}
                    style={{ width: '84px', padding: '0.25rem 0.45rem', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', textAlign: 'center', borderRadius: 0, background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)' }}
                  />
                </div>
              </div>

              {/* Right Column: Outro / Closing Steppers & Input */}
              <div style={{ background: '#0a0a0f', border: '1px solid rgba(255, 0, 255, 0.25)', borderRadius: 0, padding: '0.65rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#ff00ff' }}>
                    {t.trimmer.outroAdjustLabel}
                  </span>
                  <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: endAdded > 0 ? '#ff00ff' : 'var(--text-secondary)' }}>
                    {endAdded > 0 ? `+${endAdded}s outro` : t.trimmer.noAddedContext}
                  </span>
                </div>
                {/* Stepper Buttons */}
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeEnd(-15)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    -15s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeEnd(-5)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    -5s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => { setAdjustedEnd(origEnd); seekToTime(origEnd, false); }} style={{ background: 'rgba(250, 204, 21, 0.15)', border: '1px solid #facc15', color: '#facc15', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {t.trimmer.resetToAiEnd}
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeEnd(+5)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    +5s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeEnd(+15)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    +15s
                  </button>
                  <button type="button" disabled={isDownloading} onClick={() => nudgeEnd(+30)} style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 0, padding: '0.25rem 0.5rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
                    +30s
                  </button>
                </div>
                {/* Manual Timestamp Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
                  <label style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{t.trimmer.endTimeLabel}:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={endInputVal}
                    disabled={isDownloading}
                    onChange={(e) => setEndInputVal(e.target.value)}
                    onBlur={() => {
                      const sec = parseFormattedTime(endInputVal);
                      if (sec !== null) {
                        const clamped = Math.min(maxTimelineEnd, Math.max(adjustedStart + 3, sec));
                        setAdjustedEnd(clamped);
                        seekToTime(clamped, false);
                      } else {
                        setEndInputVal(formatSeconds(adjustedEnd));
                      }
                    }}
                    style={{ width: '84px', padding: '0.25rem 0.45rem', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', textAlign: 'center', borderRadius: 0, background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)' }}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Transcript Navigator Collapsible Section */}
          {relevantTranscript.length > 0 && (
            <div style={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0, padding: '0.75rem 0.95rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showTranscript ? '0.5rem' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <strong style={{ fontSize: '0.8rem', color: '#fff', fontFamily: 'var(--font-mono)' }}>{t.trimmer.transcriptTitle}</strong>
                  <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    ({relevantTranscript.length} lines in ±2m context)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTranscript(prev => !prev)}
                  style={{ background: 'none', border: 'none', color: '#ff00ff', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  {showTranscript ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  <span>{showTranscript ? 'HIDE' : 'SHOW'}</span>
                </button>
              </div>

              {showTranscript && (
                <>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0', fontFamily: 'var(--font-mono)' }}>
                    // {t.trimmer.transcriptHint}
                  </p>
                  <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem', paddingRight: '0.3rem' }}>
                    {relevantTranscript.map((line, idx) => {
                      const inAiPick = line.start >= origStart && line.end <= origEnd;
                      const inAdjusted = line.start >= adjustedStart && line.end <= adjustedEnd;

                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.35rem 0.55rem',
                            borderRadius: 0,
                            background: inAiPick
                              ? 'rgba(250, 204, 21, 0.12)'
                              : inAdjusted
                              ? 'rgba(255, 0, 255, 0.08)'
                              : '#0e0e14',
                            border: `1px solid ${inAiPick ? '#facc15' : inAdjusted ? '#ff00ff' : 'rgba(255, 255, 255, 0.06)'}`,
                            fontSize: '0.74rem',
                            gap: '0.55rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: 1, minWidth: 0 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: inAiPick ? '#facc15' : inAdjusted ? '#ff00ff' : 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                              {formatSeconds(line.start)}
                            </span>
                            <span style={{ color: inAdjusted ? '#fff' : 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                              {line.text}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                            {inAiPick ? (
                              <span style={{ fontSize: '0.62rem', background: 'rgba(250, 204, 21, 0.25)', color: '#facc15', padding: '0.1rem 0.35rem', borderRadius: 0, border: '1px solid #facc15', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                {t.trimmer.aiPickBadge}
                              </span>
                            ) : inAdjusted ? (
                              <span style={{ fontSize: '0.62rem', background: 'rgba(255, 0, 255, 0.2)', color: '#ff00ff', padding: '0.1rem 0.35rem', borderRadius: 0, border: '1px solid #ff00ff', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                {t.trimmer.contextBadge}
                              </span>
                            ) : null}

                            <button
                              type="button"
                              disabled={isDownloading}
                              onClick={() => {
                                setAdjustedStart(Math.floor(line.start));
                                seekToTime(line.start, false);
                              }}
                              style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-secondary)', borderRadius: 0, padding: '0.15rem 0.4rem', fontSize: '0.64rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}
                              title={`${t.trimmer.setAsStart} (${formatSeconds(line.start)})`}
                            >
                              {t.trimmer.setAsStart}
                            </button>

                            <button
                              type="button"
                              disabled={isDownloading}
                              onClick={() => {
                                setAdjustedEnd(Math.ceil(line.end));
                                seekToTime(line.end, false);
                              }}
                              style={{ background: '#0e0e14', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-secondary)', borderRadius: 0, padding: '0.15rem 0.4rem', fontSize: '0.64rem', fontFamily: 'var(--font-mono)', cursor: isDownloading ? 'not-allowed' : 'pointer' }}
                              title={`${t.trimmer.setAsEnd} (${formatSeconds(line.end)})`}
                            >
                              {t.trimmer.setAsEnd}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* Footer Action Bar */}
        <div className="trimmer-footer">
          {/* Left: Reset to Original AI */}
          <button
            type="button"
            disabled={isDownloading}
            onClick={() => {
              setAdjustedStart(origStart);
              setAdjustedEnd(origEnd);
              seekToTime(origStart, false);
            }}
            className="trimmer-reset-btn"
          >
            {t.trimmer.resetBtn}
          </button>

          {/* Right: Close, Apply & Download Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="trimmer-close-footer-btn"
            >
              [ {t.trimmer.closeBtn.toUpperCase()} ]
            </button>

            {onApply && (
              <button
                type="button"
                onClick={() => {
                  onApply(getAdjustedClip());
                  onClose();
                }}
                disabled={isDownloading}
                className="trimmer-download-btn"
                style={{
                  background: '#eab308',
                  borderColor: '#facc15',
                  color: '#09090b'
                }}
              >
                {t.trimmer.applyBtn}
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadClick}
              disabled={isDownloading}
              className={`trimmer-download-btn ${downloadSuccess ? 'is-success' : ''}`}
            >
              {isDownloading ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                  </svg>
                  <span>{t.trimmer.downloadingBtn}</span>
                </>
              ) : downloadSuccess ? (
                <span>{t.trimmer.downloadSuccessBtn(formatSeconds(adjustedStart), formatSeconds(adjustedEnd))}</span>
              ) : (
                <span>{t.trimmer.downloadRawBtn(formatSeconds(adjustedStart), formatSeconds(adjustedEnd))}</span>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
