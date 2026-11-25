import { useState, useRef, useEffect, useCallback } from 'react';
import type { AnalyzeResponse, ViralClip } from '../types';
import { isGoogleDriveUrl, extractVideoId } from '../utils/urlUtils';
import { getStoredCookies } from '../utils/cookieUtils';
import { extractAudioFromVideoClient } from '../utils/audioExtractor';

interface UseVideoAnalysisOptions {
  t: any;
  sourceMode: 'youtube' | 'twitch' | 'gdrive' | 'upload';
  url: string;
  gdriveUrl: string;
  twitchUrl: string;
  uploadedVideoFile: File | null;
  uploadedVideoInfo: any;
  setUploadedVideoInfo: (info: any) => void;
  setIsUploadingVideo: (isUploading: boolean) => void;
  apiKey: string;
  apiProvider: 'gemini' | 'openrouter';
  openRouterKey: string;
  openRouterModel: string;
  selectedModel: string;
  durationPref: '15s' | '30s' | '60s' | 'auto';
  customPrompt: string;
  targetClipCount: number;
  clipCountMode: 'auto' | 'custom';
  subtitlesSource: 'youtube' | 'manual';
  manualSubtitlesContent: string;
  manualSubtitlesFileName: string;
  transcriptLanguage: 'id' | 'en';
  rangeType: 'entire' | 'custom';
  customRangeStart: string;
  customRangeEnd: string;
  skipLanguageConfirm: boolean;
  setShowLanguageConfirmModal: (show: boolean) => void;
  setWorkflowTab: (tab: 'source' | 'clips' | 'clipper') => void;
  setResult: (res: AnalyzeResponse | null) => void;
  setActiveClip: (clip: ViralClip | null) => void;
  initPlayer: (id: string, force?: boolean) => void;
  refreshHistory: () => void;
}

export function useVideoAnalysis({
  t,
  sourceMode,
  url,
  gdriveUrl,
  twitchUrl,
  uploadedVideoFile,
  uploadedVideoInfo,
  setUploadedVideoInfo,
  setIsUploadingVideo,
  apiKey,
  apiProvider,
  openRouterKey,
  openRouterModel,
  selectedModel,
  durationPref,
  customPrompt,
  targetClipCount,
  clipCountMode,
  subtitlesSource,
  manualSubtitlesContent,
  manualSubtitlesFileName,
  transcriptLanguage,
  rangeType,
  customRangeStart,
  customRangeEnd,
  skipLanguageConfirm,
  setShowLanguageConfirmModal,
  setWorkflowTab,
  setResult,
  setActiveClip,
  initPlayer,
  refreshHistory,
}: UseVideoAnalysisOptions) {
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  const [stepProgress, setStepProgress] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [overallProgress, setOverallProgress] = useState<number>(0);
  const [aiStage, setAiStage] = useState<string>('');
  const [aiDetail, setAiDetail] = useState<string>('');
  const [activeProcessingModel, setActiveProcessingModel] = useState<string>('');
  const [loadingElapsedTime, setLoadingElapsedTime] = useState<number>(0);
  const [loadingDetails, setLoadingDetails] = useState('');
  const loadingSectionRef = useRef<HTMLElement | null>(null);

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

  const parseTimeToSeconds = (val: string): number | null => {
    const clean = val.trim();
    if (!clean) return null;

    if (/^\d+(\.\d+)?$/.test(clean)) {
      return parseFloat(clean);
    }

    const parts = clean.split(':').map(Number);
    if (parts.some(isNaN)) return null;

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  };

  const handleAnalyze = useCallback(async (e?: React.FormEvent) => {
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
            videoUrl: metadata.objectUrl,
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

    // Cache check for YouTube
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

      if (resultData.video_id) {
        try {
          const promptSuffix = customPrompt.trim() ? `_prompt_${customPrompt.trim().replace(/[^a-zA-Z0-9]/g, '_')}` : '';
          const modelSuffix = `_model_${selectedModel}`;
          const clipsSuffix = clipCountMode === 'auto' ? '_clips_auto' : `_clips_${targetClipCount}`;
          const langSuffix = subtitlesSource === 'youtube' ? `_lang_${transcriptLanguage}` : '';
          const targetCacheKey = `cheat_clip_cache_${resultData.video_id}_${durationPref}${modelSuffix}${clipsSuffix}${promptSuffix}${rangeSuffix}${manualSuffix}${langSuffix}`;
          const tsKey = `cheat_clip_ts_${resultData.video_id}_${durationPref}${modelSuffix}${clipsSuffix}${promptSuffix}${rangeSuffix}${manualSuffix}${langSuffix}`;

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

      setTimeout(() => {
        const dashboard = document.querySelector('.dashboard-grid');
        if (dashboard) {
          dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 250);

    } catch (err: any) {
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
        msg.includes('server on port') ||
        msg.includes('not running')
      ) {
        setError(
          '[CONN] Backend API Server is unreachable.\n' +
          'Please ensure the full app is running in your terminal (`npm run dev` or `start.bat`).\n' +
          'If Python dependencies were not installed yet, run: `pip install -r requirements.txt`'
        );
      } else {
        setError(msg || 'An unexpected error occurred during analysis.');
      }
      setLoading(false);
    }
  }, [
    apiKey,
    apiProvider,
    clipCountMode,
    customPrompt,
    customRangeEnd,
    customRangeStart,
    durationPref,
    gdriveUrl,
    initPlayer,
    manualSubtitlesContent,
    manualSubtitlesFileName,
    openRouterKey,
    openRouterModel,
    rangeType,
    refreshHistory,
    selectedModel,
    setActiveClip,
    setIsUploadingVideo,
    setResult,
    setUploadedVideoInfo,
    setWorkflowTab,
    sourceMode,
    subtitlesSource,
    t,
    targetClipCount,
    transcriptLanguage,
    twitchUrl,
    uploadedVideoFile,
    uploadedVideoInfo,
    url,
  ]);

  const handleCancelAnalyze = useCallback(() => {
    if (analyzeAbortRef.current) {
      analyzeAbortRef.current.abort();
      analyzeAbortRef.current = null;
    }
    setLoading(false);
    setCurrentStep(1);
    setStepProgress({ 1: 0, 2: 0, 3: 0, 4: 0 });
    setOverallProgress(0);
    setLoadingTooLong(false);
  }, []);

  const handleFormSubmit = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (sourceMode === 'youtube' && subtitlesSource === 'youtube' && !skipLanguageConfirm) {
      setShowLanguageConfirmModal(true);
      return;
    }
    handleAnalyze(e);
  }, [handleAnalyze, setShowLanguageConfirmModal, skipLanguageConfirm, sourceMode, subtitlesSource]);

  return {
    loading,
    setLoading,
    currentStep,
    setCurrentStep,
    error,
    setError,
    loadingTooLong,
    setLoadingTooLong,
    stepProgress,
    setStepProgress,
    overallProgress,
    setOverallProgress,
    aiStage,
    setAiStage,
    aiDetail,
    setAiDetail,
    activeProcessingModel,
    setActiveProcessingModel,
    loadingElapsedTime,
    setLoadingElapsedTime,
    loadingDetails,
    setLoadingDetails,
    loadingSectionRef,
    analyzeAbortRef,
    parseTimeToSeconds,
    handleAnalyze,
    handleCancelAnalyze,
    handleFormSubmit,
  };
}
