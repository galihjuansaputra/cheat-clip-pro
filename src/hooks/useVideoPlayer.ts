import { useState, useRef, useEffect, useCallback } from 'react';
import type { AnalyzeResponse, ViralClip } from '../types';

interface UseVideoPlayerOptions {
  result: AnalyzeResponse | null;
  setActiveClip: (clip: ViralClip | null) => void;
}

export function useVideoPlayer({ result, setActiveClip }: UseVideoPlayerOptions) {
  const [currentTime, setCurrentTime] = useState<number>(0);
  const playerRef = useRef<any>(null);
  const directVideoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const twitchPlayerRef = useRef<any>(null);
  const trackingInterval = useRef<number | null>(null);
  const clipEndIntervalRef = useRef<number | null>(null);

  const stopTracking = useCallback(() => {
    if (trackingInterval.current !== null) {
      clearInterval(trackingInterval.current);
      trackingInterval.current = null;
    }
  }, []);

  const startTracking = useCallback(() => {
    stopTracking();
    trackingInterval.current = window.setInterval(() => {
      if (twitchPlayerRef.current && typeof twitchPlayerRef.current.getCurrentTime === 'function') {
        setCurrentTime(twitchPlayerRef.current.getCurrentTime());
      } else if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        setCurrentTime(playerRef.current.getCurrentTime());
      }
    }, 200);
  }, [stopTracking]);

  const destroyPlayer = useCallback(() => {
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
  }, [stopTracking]);

  const initTwitchPlayer = useCallback((videoId: string, forceRecreate = false) => {
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
  }, [startTracking, stopTracking]);

  const initPlayer = useCallback((videoId: string, forceRecreate = false) => {
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
                if (playerRef.current && playerRef.current.getCurrentTime) {
                  setCurrentTime(playerRef.current.getCurrentTime());
                }
              }
            },
          },
        });
      } catch (err) {
        console.error('Error instantiating YouTube Player:', err);
        setTimeout(() => initPlayer(videoId, forceRecreate), 300);
      }
    } else {
      setTimeout(() => initPlayer(videoId, forceRecreate), 200);
    }
  }, [destroyPlayer, initTwitchPlayer, startTracking, stopTracking]);

  const handleSeek = useCallback((seconds: number) => {
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
      if (playerRef.current.getPlayerState() !== 1) {
        playerRef.current.playVideo();
      }
    }
  }, []);

  const playClip = useCallback((clip: ViralClip) => {
    setActiveClip(clip);
    handleSeek(clip.start_time);

    if (clipEndIntervalRef.current !== null) {
      clearInterval(clipEndIntervalRef.current);
    }

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
  }, [handleSeek, setActiveClip]);

  const handleRefreshPlayer = useCallback(() => {
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
  }, [currentTime, initPlayer, result]);

  // YouTube IFrame API script tag loader
  useEffect(() => {
    const existingScript = document.getElementById('youtube-iframe-api-script');
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    window.onYouTubeIframeAPIReady = () => {
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
  }, [initPlayer, result, stopTracking]);

  return {
    currentTime,
    setCurrentTime,
    playerRef,
    directVideoPlayerRef,
    twitchPlayerRef,
    initPlayer,
    initTwitchPlayer,
    destroyPlayer,
    startTracking,
    stopTracking,
    handleSeek,
    playClip,
    handleRefreshPlayer,
  };
}
