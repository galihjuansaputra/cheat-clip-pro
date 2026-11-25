import { useState, useCallback } from 'react';
import type { AnalyzeResponse, ViralClip } from '../types';
import { getStoredCookies, hasStoredCookies } from '../utils/cookieUtils';
import { renderClipClientSide, triggerBrowserDownload } from '../services/clientRenderer';

interface UseRawDownloadOptions {
  result: AnalyzeResponse | null;
  sourceMode: 'youtube' | 'twitch' | 'gdrive' | 'upload';
  uploadedVideoFile: File | null;
  url: string;
  isCurrentVideoYouTube: () => boolean;
  setCookieWarningState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    actionType: 'render' | 'download';
    onProceed: () => void;
  }>>;
  setToastMessage: (msg: string | null) => void;
  setError: (err: string | null) => void;
  t: any;
}

export function useRawDownload({
  result,
  sourceMode,
  uploadedVideoFile,
  url,
  isCurrentVideoYouTube,
  setCookieWarningState,
  setToastMessage,
  setError,
  t,
}: UseRawDownloadOptions) {
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
    status: 'idle' | 'downloading' | 'ready' | 'error' | 'cancelled';
    percent?: number;
    downloaded?: string;
    total?: string;
    speed?: string;
    eta?: string;
    stage?: string;
    jobId?: string;
    error?: string;
  }>>({});

  const handleDownloadRawVideo = useCallback(async (forceProceed?: boolean | React.MouseEvent) => {
    if (!result || !result.video_id) return;

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
            } else if (statusData.status === 'failed' || statusData.status === 'cancelled') {
              clearInterval(intervalId);
              setIsDownloadingRaw(false);
              setRawDownloadProgress(null);
              if (statusData.status !== 'cancelled') {
                reject(new Error(statusData.error || t.rawDownload.failedToast));
              } else {
                resolve();
              }
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
  }, [isCurrentVideoYouTube, result, setCookieWarningState, setError, setToastMessage, sourceMode, t, uploadedVideoFile, url]);

  const handleCancelRawDownload = useCallback(async (jobId: string) => {
    try {
      await fetch(`/api/download-raw-cancel/${jobId}`, { method: 'POST' });
    } catch {}
    setIsDownloadingRaw(false);
    setRawDownloadProgress(null);
    setToastMessage('Unduhan video lengkap dibatalkan');
  }, [setToastMessage]);

  const handleDownloadRawClip = useCallback(async (clip: ViralClip, e?: React.MouseEvent, forceProceed = false) => {
    if (e) e.stopPropagation();
    if (!result || !result.video_id) return;

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
      setClipDownloadStates(prev => ({
        ...prev,
        [clipKey]: {
          status: 'downloading',
          percent: 5,
          downloaded: '',
          total: '',
          speed: '',
          eta: '',
          stage: 'Menghubungkan...',
          jobId
        }
      }));

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
                [clipKey]: { status: 'ready', percent: 100 }
              }));
              setToastMessage(`✓ ${clip.title} (raw)`);
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
            } else if (statusData.status === 'failed' || statusData.status === 'cancelled') {
              clearInterval(intervalId);
              setClipDownloadStates(prev => ({
                ...prev,
                [clipKey]: { status: 'idle' }
              }));
              if (statusData.status !== 'cancelled') {
                reject(new Error(statusData.error || "Clip download failed"));
              } else {
                resolve();
              }
            } else {
              setClipDownloadStates(prev => ({
                ...prev,
                [clipKey]: {
                  status: 'downloading',
                  percent: statusData.progress_percent || 0,
                  downloaded: statusData.downloaded || '',
                  total: statusData.total || '',
                  speed: statusData.speed || '',
                  eta: statusData.eta || '',
                  stage: statusData.stage || statusData.step_name || 'Mengunduh potongan klip...',
                  jobId
                }
              }));
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
  }, [clipDownloadStates, isCurrentVideoYouTube, result, setCookieWarningState, setError, setToastMessage, sourceMode, t, uploadedVideoFile, url]);

  const handleCancelRawClipDownload = useCallback(async (jobId: string, clipKey: string) => {
    try {
      await fetch(`/api/download-raw-clip-cancel/${jobId}`, { method: 'POST' });
    } catch {}
    setClipDownloadStates(prev => ({
      ...prev,
      [clipKey]: { status: 'idle' }
    }));
    setToastMessage('Unduhan klip dibatalkan');
  }, [setToastMessage]);

  return {
    isDownloadingRaw,
    rawDownloadProgress,
    clipDownloadStates,
    setClipDownloadStates,
    handleDownloadRawVideo,
    handleCancelRawDownload,
    handleDownloadRawClip,
    handleCancelRawClipDownload,
  };
}
