import { useState, useEffect, useRef, useCallback } from 'react';
import { requestWakeLock, releaseWakeLock, isMobileDevice } from '../utils/deviceUtils';
import { hasStoredCookies, getStoredCookies } from '../utils/cookieUtils';
import { buildCaptionChunksForClip } from '../services/captionUtils';
import { renderClipWebCodecs, isWebCodecsGpuSupported } from '../services/webcodecsRenderer';
import { renderClipClientSide, triggerBrowserDownload } from '../services/clientRenderer';
import type { RenderSettings, BatchRenderProgress, SourcePrepProgress, AnalyzeResponse } from '../types';

export interface UseBatchRenderProps {
  result: AnalyzeResponse | null;
  url: string;
  sourceMode: 'youtube' | 'twitch' | 'gdrive' | 'upload';
  uploadedVideoFile: File | null;
  loading: boolean;
  isCurrentVideoYouTube: () => boolean;
  setCookieWarningState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    actionType: 'render' | 'download';
    onProceed: () => void;
  }>>;
}

export function useBatchRender({
  result,
  url,
  sourceMode,
  uploadedVideoFile,
  loading,
  isCurrentVideoYouTube,
  setCookieWarningState,
}: UseBatchRenderProps) {

  const [batchProgress, setBatchProgress] = useState<BatchRenderProgress | null>(null);
  const [sourcePrepProgress, setSourcePrepProgress] = useState<SourcePrepProgress | null>(null);
  const [isLaunchingRender, setIsLaunchingRender] = useState(false);
  const [isCancellingRender, setIsCancellingRender] = useState(false);
  const batchEventSourceRef = useRef<EventSource | null>(null);
  const clientRenderCancelledRef = useRef(false);
  const activePrepJobIdRef = useRef<string | null>(null);
  const lastRenderSettingsRef = useRef<RenderSettings | null>(null);

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
        if (progressData.overall_status === 'completed' || progressData.overall_status === 'error' || progressData.overall_status === 'cancelled') {
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

  

  const handleStartBatchRender = async (settings: RenderSettings, forceProceed = false) => {
    if (!result) return;
    lastRenderSettingsRef.current = settings;

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

    const isClientMode = !isMobileDevice() && (
      settings.renderEngine === 'client' ||
      settings.hardwareAccel === 'browser_wasm' ||
      settings.hardwareAccel === 'client_gpu' ||
      (sourceMode === 'upload' && Boolean(uploadedVideoFile))
    );

    if (isClientMode) {
      try {
        const batchId = `client_${Date.now()}`;
        const selectedClips = settings.selectedClips;
        clientRenderCancelledRef.current = false;

        // =========================================================================
        // TAHAP 1: Ambil Bahan Master (1080p Master Source Acquisition)
        // Dipisah sebelum memotong klip agar queue hanya berfokus pada slicing & render.
        // =========================================================================
        const userCookies = getStoredCookies();
        const targetUrl = result.video_url || (url.trim() ? url.trim() : `https://www.youtube.com/watch?v=${result.video_id}`);
        let isMasterReady = false;

        if (sourceMode === 'upload' && uploadedVideoFile) {
          setSourcePrepProgress({
            status: 'ready',
            progress_percent: 100,
            detail: 'Video lokal siap diproses',
          });
          isMasterReady = true;
        } else if (result.source_type === 'upload' || result.video_id?.startsWith('upload_') || result.video_id?.startsWith('gdrive_')) {
          setSourcePrepProgress({
            status: 'ready',
            progress_percent: 100,
            detail: 'Video server siap diproses',
          });
          isMasterReady = true;
        } else {
          setSourcePrepProgress({
            status: 'checking',
            progress_percent: 20,
            detail: 'Memeriksa cache video bahan master di server...',
          });
          const maxEndTime = Math.max(...selectedClips.map(c => Number(c.end_time) || 0), 0);
          const reqDurationParam = maxEndTime > 0 ? `&required_duration=${encodeURIComponent(String(maxEndTime))}` : '';

          try {
            const chkRes = await fetch(`/api/source-status?video_id=${encodeURIComponent(result.video_id || '')}&video_url=${encodeURIComponent(targetUrl)}${reqDurationParam}`);
            if (chkRes.ok) {
              const chkData = await chkRes.json();
              if (chkData.ready) {
                setSourcePrepProgress({
                  status: 'ready',
                  progress_percent: 100,
                  detail: `✓ Video bahan master siap (${chkData.size_mb || ''} MB) - Slicing berjalan lokal`,
                });
                isMasterReady = true;
              }
            }
          } catch (e) {
            console.warn('Failed to check source cache:', e);
          }

          if (!isMasterReady) {
            setSourcePrepProgress({
              status: 'downloading',
              progress_percent: 5,
              detail: 'Menghubungkan ke YouTube & mengunduh video bahan master (1080p)...',
            });
            const prepClips = selectedClips.map(c => ({
              start_time: Number(c.start_time) || 0,
              end_time: Number(c.end_time) || 0,
              title: c.title || ''
            }));
            const prepReq = await fetch('/api/prepare-source', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                video_url: targetUrl,
                video_id: result.video_id,
                cookies: userCookies || undefined,
                max_end_time: maxEndTime > 0 ? maxEndTime : undefined,
                clips: prepClips
              })
            });
            if (!prepReq.ok) {
              const err = await prepReq.json().catch(() => ({}));
              throw new Error(err.detail || 'Gagal memulai unduhan video bahan master');
            }
            const prepData = await prepReq.json();
            const prepJobId = prepData.job_id;
            activePrepJobIdRef.current = prepJobId;

            if (prepData.status === 'ready') {
              activePrepJobIdRef.current = null;
              setSourcePrepProgress({
                status: 'ready',
                progress_percent: 100,
                detail: '✓ Video bahan master 1080p siap di cache server!',
              });
              isMasterReady = true;
            } else {
              await new Promise<void>((resolve, reject) => {
                let failCount = 0;
                const pollInterval = setInterval(async () => {
                  if (clientRenderCancelledRef.current) {
                    clearInterval(pollInterval);
                    activePrepJobIdRef.current = null;
                    reject(new Error('Render dibatalkan'));
                    return;
                  }
                  try {
                    const stRes = await fetch(`/api/prepare-source-status/${prepJobId}`);
                    if (!stRes.ok) {
                      failCount++;
                      if (failCount > 5) {
                        clearInterval(pollInterval);
                        activePrepJobIdRef.current = null;
                        reject(new Error('Koneksi terputus saat mengunduh bahan master'));
                      }
                      return;
                    }
                    failCount = 0;
                    const stData = await stRes.json();
                    if (stData.status === 'ready') {
                      clearInterval(pollInterval);
                      activePrepJobIdRef.current = null;
                      setSourcePrepProgress({
                        status: 'ready',
                        progress_percent: 100,
                        downloaded: stData.downloaded,
                        total: stData.total,
                        detail: `✓ Video bahan master siap (${stData.total || stData.downloaded || '1080p'})`,
                      });
                      resolve();
                    } else if (stData.status === 'cancelled') {
                      clearInterval(pollInterval);
                      activePrepJobIdRef.current = null;
                      setSourcePrepProgress(null);
                      reject(new Error('Pengambilan bahan dibatalkan'));
                    } else if (stData.status === 'failed') {
                      clearInterval(pollInterval);
                      activePrepJobIdRef.current = null;
                      setSourcePrepProgress({
                        status: 'error',
                        progress_percent: 0,
                        error_message: stData.error || 'Gagal mengunduh video bahan master',
                        detail: stData.error || 'Gagal mengunduh video bahan master',
                      });
                      reject(new Error(stData.error || 'Gagal mengunduh video bahan master'));
                    } else {
                      const rawPct = Number(stData.progress_percent);
                      const pct = (!isNaN(rawPct) && rawPct > 0)
                        ? Math.max(5, Math.min(99, Math.round(rawPct)))
                        : 5;
                      setSourcePrepProgress({
                        status: 'downloading',
                        progress_percent: pct,
                        downloaded: stData.downloaded,
                        total: stData.total,
                        speed: stData.speed,
                        eta: stData.eta,
                        detail: stData.detail || 'Mengunduh video bahan master 1080p dari YouTube...',
                      });
                    }
                  } catch (pollErr) {
                    clearInterval(pollInterval);
                    activePrepJobIdRef.current = null;
                    reject(pollErr);
                  }
                }, 1000);
              });
            }
          }
        }

        // =========================================================================
        // TAHAP 2: Antrean Render Klip (Batch Render Queue)
        // Bahan master sudah ada di disk / memory. Pemotongan klip berjalan sangat cepat.
        // =========================================================================
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
          if (clientRenderCancelledRef.current) break;
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
              clips: prev.clips.map((c, idx) => idx === i ? {
                ...c,
                status: 'downloading',
                progress_percent: 5,
                current_step: 1,
                total_steps: 4,
                step_key: 'slice_clip',
                step_name: 'Potong Klip',
                step_progress: 10,
                step_detail: 'Memotong klip dari video master lokal...',
                elapsed_sec: 0,
              } : c)
            };
          });

          // Step 1: Slice clip segment from master source (instant local trim)
          let rawSourceUrl = '';
          if (sourceMode === 'upload' && uploadedVideoFile) {
            rawSourceUrl = URL.createObjectURL(uploadedVideoFile);
            setBatchProgress(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                clips: prev.clips.map((c, idx) => idx === i ? {
                  ...c,
                  progress_percent: 25,
                  current_step: 1,
                  step_key: 'slice_clip',
                  step_name: 'Potong Klip',
                  step_progress: 100,
                  step_detail: 'Klip lokal siap diproses',
                } : c)
              };
            });
          } else if (result.source_type === 'upload' || result.video_id?.startsWith('upload_') || result.video_id?.startsWith('gdrive_')) {
            rawSourceUrl = `/api/video/${result.video_id}`;
            setBatchProgress(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                clips: prev.clips.map((c, idx) => idx === i ? {
                  ...c,
                  progress_percent: 25,
                  current_step: 1,
                  step_key: 'slice_clip',
                  step_name: 'Potong Klip',
                  step_progress: 100,
                  step_detail: 'Klip server siap diproses',
                } : c)
              };
            });
          } else {
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

            const downloadStartTime = Date.now();
            rawSourceUrl = await new Promise<string>((resolve, reject) => {
              let consecutiveNetworkFailures = 0;
              const pollInterval = setInterval(async () => {
                try {
                  const elapsedSec = Math.floor((Date.now() - downloadStartTime) / 1000);
                  let statusRes: Response;
                  try {
                    statusRes = await fetch(`/api/download-raw-clip-status/${jobId}`);
                    consecutiveNetworkFailures = 0;
                  } catch (netErr) {
                    consecutiveNetworkFailures++;
                    if (consecutiveNetworkFailures > 5) {
                      clearInterval(pollInterval);
                      reject(new Error('Koneksi terputus saat mengambil video sumber. Silakan klik [~] Retry untuk mencoba lagi.'));
                    }
                    return;
                  }

                  if (!statusRes.ok) {
                    consecutiveNetworkFailures++;
                    if (consecutiveNetworkFailures > 5) {
                      clearInterval(pollInterval);
                      reject(new Error('Gagal memeriksa status unduhan video sumber. Silakan klik [~] Retry.'));
                    }
                    return;
                  }
                  const statusData = await statusRes.json();
                  if (statusData.status === 'ready' && statusData.download_url) {
                    clearInterval(pollInterval);
                    resolve(statusData.download_url);
                  } else if (statusData.status === 'failed') {
                    clearInterval(pollInterval);
                    reject(new Error(statusData.error || 'Failed to acquire raw clip segment'));
                  } else {
                    const stageMsg = statusData.stage || 'Mengunduh video bahan...';
                    const dlPct = Math.max(10, Math.min(99, Math.round(statusData.progress_percent || 20)));
                    // Step 1 contributes 0 - 25% of overall clip progress
                    const clipOverallPct = Math.round((dlPct / 100) * 25);
                    setBatchProgress(prev => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        clips: prev.clips.map((c, idx) => idx === i ? {
                          ...c,
                          status: 'downloading',
                          progress_percent: clipOverallPct,
                          current_step: 1,
                          total_steps: 4,
                          step_key: 'slice_clip',
                          step_name: 'Potong Klip',
                          step_progress: dlPct,
                          step_detail: `${stageMsg} (${elapsedSec}s)`,
                          elapsed_sec: elapsedSec,
                          error_message: `${stageMsg} (${elapsedSec}s)`
                        } : c)
                      };
                    });
                  }
                } catch (e) {
                  clearInterval(pollInterval);
                  reject(e);
                }
              }, 1200);
            });
          }

          // Step 2: Prep Assets & Typography
          setBatchProgress(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              clips: prev.clips.map((c, idx) => idx === i ? {
                ...c,
                status: 'transcribing',
                progress_percent: 28,
                current_step: 2,
                total_steps: 4,
                step_key: 'prep_assets',
                step_name: 'Aset & Subtitle',
                step_progress: 50,
                step_detail: 'Sinkronisasi dialog kata-per-kata & font tipografi...',
              } : c)
            };
          });

          // Step 3: Render in client browser via GPU Hardware Encoder (WebCodecs) or WASM
          let blob: Blob;
          const useWebCodecsGpu = (settings.hardwareAccel === 'client_gpu' || (!settings.hardwareAccel && isWebCodecsGpuSupported())) && isWebCodecsGpuSupported();

          if (useWebCodecsGpu) {
            try {
              const isPreTrimmed = !(sourceMode === 'upload' && uploadedVideoFile);
              const clipChunks = buildCaptionChunksForClip(
                result.transcript,
                clip.start_time,
                clip.end_time,
                clip.transcript
              );

              blob = await renderClipWebCodecs({
                videoSourceUrl: rawSourceUrl,
                startTime: isPreTrimmed ? 0 : clip.start_time,
                endTime: isPreTrimmed ? undefined : clip.end_time,
                clipTimeOffset: isPreTrimmed ? clip.start_time : 0,
                aspectRatio: settings.aspectRatio as any,
                backgroundStyle: settings.backgroundStyle as any,
                titleText: (clip as any).formatted_title || settings.titleText || (clip.title_suggestion || clip.title),
                titleYPercent: settings.titleYPercent,
                titleFont: settings.titleFont,
                titleDuration: settings.titleDuration,
                titleFontSizePx: settings.titleFontSizePx,
                subtitlesEnabled: settings.subtitlesEnabled,
                captionChunks: clipChunks,
                captionStyle: settings.captionStyle,
                captionFont: settings.captionFont,
                fontSizePx: settings.fontSizePx,
                textCase: settings.textCase,
                subtitleYPercent: settings.subtitleYPercent,
                subtitleOffsetSeconds: settings.subtitleOffsetSeconds,
                subtitlePositionMode: settings.subtitlePositionMode,
                subtitleCenterYPercent: settings.subtitleCenterYPercent,
                streamerPreset: settings.streamerPreset,
                facecamPosition: settings.facecamPosition || 'auto',
                faceBox: settings.faceBox,
                cropXPercent: settings.cropXPercent,
                watermarkEnabled: settings.watermarkEnabled,
                watermarkType: settings.watermarkType,
                watermarkUrl: settings.watermarkUrl || settings.watermarkFilePath || undefined,
                watermarkText: settings.watermarkText,
                watermarkSize: settings.watermarkSize,
                watermarkOpacity: settings.watermarkOpacity,
                watermarkX: settings.watermarkX,
                watermarkY: settings.watermarkY,
                fileName: `${filename}.mp4`,
                onProgress: (pct, stage, meta) => {
                  const subPct = Math.max(1, Math.min(100, Math.round(pct)));
                  // Step 3 maps 25% -> 95% of overall clip progress
                  const clipOverallPct = Math.min(95, Math.round(25 + (subPct / 100) * 70));
                  setBatchProgress(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      clips: prev.clips.map((c, idx) => idx === i ? {
                        ...c,
                        status: 'rendering',
                        progress_percent: clipOverallPct,
                        current_step: 3,
                        total_steps: 4,
                        step_key: 'rendering_gpu',
                        step_name: 'Render GPU',
                        step_progress: subPct,
                        step_detail: stage,
                        eta_sec: meta?.etaSec,
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
                streamerPreset: settings.streamerPreset,
                facecamPosition: settings.facecamPosition || 'auto',
                faceBox: settings.faceBox,
                cropXPercent: settings.cropXPercent,
                titleText: (clip as any).formatted_title || settings.titleText || (clip.title_suggestion || clip.title),
                fileName: `${filename}.mp4`,
                onProgress: (pct, stage) => {
                  const subPct = Math.max(1, Math.min(100, Math.round(pct)));
                  const clipOverallPct = Math.min(95, Math.round(25 + (subPct / 100) * 70));
                  setBatchProgress(prev => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      clips: prev.clips.map((c, idx) => idx === i ? {
                        ...c,
                        status: 'rendering',
                        progress_percent: clipOverallPct,
                        current_step: 3,
                        total_steps: 4,
                        step_key: 'rendering_gpu',
                        step_name: 'Render WASM',
                        step_progress: subPct,
                        step_detail: stage,
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
              streamerPreset: settings.streamerPreset,
              facecamPosition: settings.facecamPosition || 'auto',
              faceBox: settings.faceBox,
              cropXPercent: settings.cropXPercent,
              titleText: (clip as any).formatted_title || settings.titleText || (clip.title_suggestion || clip.title),
              fileName: `${filename}.mp4`,
              onProgress: (pct, stage) => {
                const subPct = Math.max(1, Math.min(100, Math.round(pct)));
                const clipOverallPct = Math.min(95, Math.round(25 + (subPct / 100) * 70));
                setBatchProgress(prev => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    clips: prev.clips.map((c, idx) => idx === i ? {
                      ...c,
                      status: 'rendering',
                      progress_percent: clipOverallPct,
                      current_step: 3,
                      total_steps: 4,
                      step_key: 'rendering_gpu',
                      step_name: 'Render WASM',
                      step_progress: subPct,
                      step_detail: stage,
                      error_message: stage
                    } : c)
                  };
                });
              }
            });
          }

          // Step 4: Finalize container & Trigger automatic download
          setBatchProgress(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              clips: prev.clips.map((c, idx) => idx === i ? {
                ...c,
                status: 'rendering',
                progress_percent: 98,
                current_step: 4,
                total_steps: 4,
                step_key: 'finalizing',
                step_name: 'Finalisasi MP4',
                step_progress: 90,
                step_detail: 'Muxing MP4 container & menyiapkan unduhan...',
              } : c)
            };
          });

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
                current_step: 4,
                total_steps: 4,
                step_key: 'finalizing',
                step_name: 'Selesai',
                step_progress: 100,
                step_detail: 'Klip berhasil dirender & disimpan!',
                download_url: downloadBlobUrl
              } : c)
            };
          });
        }

        if (clientRenderCancelledRef.current) {
          return;
        }

        setBatchProgress(prev => prev ? { ...prev, overall_status: 'completed' } : null);
        return;
      } catch (clientErr: any) {
        console.error('Client rendering failed:', clientErr);
        if (clientRenderCancelledRef.current) return;

        // If video is available on the server (not an unsynced local upload), seamlessly fall back to server-side render
        if (!(sourceMode === 'upload' && Boolean(uploadedVideoFile))) {
          console.warn('[Render Engine] Client rendering encountered error, falling back to server-side render...');
          try {
            await handleStartBatchRender({
              ...settings,
              renderEngine: 'server',
              hardwareAccel: 'auto'
            }, true);
            return;
          } catch (serverFallbackErr) {
            console.error('Server render fallback also failed:', serverFallbackErr);
          }
        }

        let errorMsg = clientErr?.message || 'Client-side rendering error';
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('Load failed')) {
          errorMsg = 'Koneksi ke backend server terputus saat merender. Silakan klik [~] Retry untuk mencoba kembali.';
        }
        setBatchProgress(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            overall_status: 'error',
            error_message: errorMsg
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
            subtitles_enabled: settings.subtitlesEnabled !== false && settings.captionStyle !== 'none',
            caption_style: settings.subtitlesEnabled === false ? 'none' : settings.captionStyle,
            caption_font: settings.captionFont,
            title_font: settings.titleFont || settings.captionFont || 'Outfit',
            font_size: settings.fontSize,
            title_font_size: settings.titleFontSize || settings.fontSize || 'medium',
            font_size_px: settings.fontSizePx,
            title_font_size_px: settings.titleFontSizePx,
            text_case: settings.textCase,
            title_text_case: settings.titleTextCase || settings.textCase,
            title_y_percent: settings.titleYPercent,
            title_x_percent: settings.titleXPercent !== undefined ? settings.titleXPercent : 50.0,
            crop_x_percent: settings.cropXPercent !== undefined ? settings.cropXPercent : null,
            subtitle_y_percent: settings.subtitleYPercent,
            subtitle_offset_seconds: settings.subtitleOffsetSeconds !== undefined ? settings.subtitleOffsetSeconds : 0.0,
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

  const handleCancelRender = useCallback(async () => {
    clientRenderCancelledRef.current = true;
    if (activePrepJobIdRef.current) {
      const pId = activePrepJobIdRef.current;
      activePrepJobIdRef.current = null;
      fetch(`/api/cancel-prepare-source/${pId}`, { method: 'POST' }).catch(() => {});
    }
    setSourcePrepProgress(null);
    setIsLaunchingRender(false);
    if (!batchProgress?.batch_id) {
      return;
    }
    const batchId = batchProgress.batch_id;

    setIsCancellingRender(true);

    if (batchId.startsWith('client_')) {
      clientRenderCancelledRef.current = true;
      setBatchProgress(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          overall_status: 'cancelled',
          error_message: 'Render process was cancelled by the user.',
          clips: prev.clips.map(c =>
            (c.status === 'downloading' || c.status === 'transcribing' || c.status === 'rendering' || c.status === 'pending')
              ? { ...c, status: 'cancelled', error_message: 'Cancelled by user' }
              : c
          )
        };
      });
      setIsCancellingRender(false);
      return;
    }

    try {
      setBatchProgress(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          overall_status: 'cancelling',
        };
      });

      await fetch(`/api/render-batch/${batchId}/cancel`, {
        method: 'POST',
      });

      if (batchEventSourceRef.current) {
        batchEventSourceRef.current.close();
        batchEventSourceRef.current = null;
      }

      setBatchProgress(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          overall_status: 'cancelled',
          error_message: 'Render process was cancelled by the user.',
          clips: prev.clips.map(c =>
            (c.status === 'downloading' || c.status === 'transcribing' || c.status === 'rendering' || c.status === 'pending')
              ? { ...c, status: 'cancelled', error_message: 'Cancelled by user' }
              : c
          )
        };
      });
    } catch (err) {
      console.error('Failed to cancel render batch:', err);
    } finally {
      setIsCancellingRender(false);
    }
  }, [batchProgress?.batch_id]);

  const handleRetryBatchClip = async (clipIndex?: number) => {
    if (!batchProgress?.batch_id) return;
    const batchId = batchProgress.batch_id;
    if (batchId.startsWith('client_')) {
      if (lastRenderSettingsRef.current) {
        handleStartBatchRender(lastRenderSettingsRef.current, true);
        return;
      }
    }
    try {
      // Optimistically update the UI to show 'pending' / retrying state for selected clip(s)
      setBatchProgress(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          overall_status: 'running',
          clips: prev.clips.map(c => {
            if (clipIndex === undefined || c.clip_index === clipIndex) {
              if (c.status === 'error' || c.status === 'cancelled' || c.status === 'pending') {
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


  return {
    batchProgress,
    setBatchProgress,
    sourcePrepProgress,
    setSourcePrepProgress,
    isLaunchingRender,
    isCancellingRender,
    batchEventSourceRef,
    handleStartBatchRender,
    handleRetryBatchClip,
    handleCancelRender,
  };
}
