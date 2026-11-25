import { useState, useEffect, useMemo, useCallback } from 'react';
import type { AnalyzeResponse, HistoryEntry, ViralClip } from '../types';
import { formatSeconds, formatRelativeTime } from '../utils/formatUtils';

interface UseHistoryOptions {
  t: any;
  setSourceMode: (m: 'youtube' | 'twitch' | 'gdrive' | 'upload') => void;
  setUrl: (u: string) => void;
  setTwitchUrl: (u: string) => void;
  setGdriveUrl: (u: string) => void;
  setUploadedVideoInfo: (info: any) => void;
  setUploadedVideoFile: (file: File | null) => void;
  setDurationPref: (d: '15s' | '30s' | '60s' | 'auto') => void;
  setClipCountMode: (m: 'auto' | 'custom') => void;
  setTargetClipCount: (c: number) => void;
  setSubtitlesSource: (s: 'youtube' | 'manual') => void;
  setTranscriptLanguage: (l: 'id' | 'en') => void;
  setRangeType: (r: 'entire' | 'custom') => void;
  setCustomRangeStart: (s: string) => void;
  setCustomRangeEnd: (s: string) => void;
  destroyPlayer: () => void;
  initPlayer: (id: string, force?: boolean) => void;
  setLoading: (l: boolean) => void;
  setError: (err: string | null) => void;
  setResult: (res: AnalyzeResponse | null) => void;
  setActiveClip: (clip: ViralClip | null) => void;
  setCurrentStep: (step: number) => void;
  setStepProgress: (progress: Record<number, number>) => void;
  setOverallProgress: (progress: number) => void;
  setLoadingDetails: (details: string) => void;
  setAiStage: (stage: string) => void;
  setAiDetail: (detail: string) => void;
  setWorkflowTab: (tab: 'source' | 'clips' | 'clipper') => void;
  setToastMessage: (msg: string | null) => void;
}

export function useHistory({
  t,
  setSourceMode,
  setUrl,
  setTwitchUrl,
  setGdriveUrl,
  setUploadedVideoInfo,
  setUploadedVideoFile,
  setDurationPref,
  setClipCountMode,
  setTargetClipCount,
  setSubtitlesSource,
  setTranscriptLanguage,
  setRangeType,
  setCustomRangeStart,
  setCustomRangeEnd,
  destroyPlayer,
  initPlayer,
  setLoading,
  setError,
  setResult,
  setActiveClip,
  setCurrentStep,
  setStepProgress,
  setOverallProgress,
  setLoadingDetails,
  setAiStage,
  setAiDetail,
  setWorkflowTab,
  setToastMessage,
}: UseHistoryOptions) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const refreshHistory = useCallback(() => {
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
          const suffix = rest.substring(video_id.length + 1);
          const duration_pref = suffix.split('_')[0];
          const range_suffix = suffix.substring(duration_pref.length);

          const tsKey = `cheat_clip_ts_${video_id}_${duration_pref}${range_suffix}`;
          const analyzed_at = localStorage.getItem(tsKey) || new Date().toISOString();
          const clip_titles = (data.clips || []).map((c: any) => c.title || '').filter(Boolean);
          const key_quotes = (data.clips || []).flatMap((c: any) => c.key_quotes || []).filter(Boolean);

          const isGDrive = data.source_type === 'gdrive' || video_id.startsWith('gdrive_');
          const isUpload = data.source_type === 'upload' || video_id.startsWith('upload_');
          const isTwitch = data.source_type === 'twitch' || video_id.startsWith('twitch_');
          const sourceType: 'youtube' | 'upload' | 'gdrive' | 'twitch' = isTwitch
            ? 'twitch'
            : isGDrive
            ? 'gdrive'
            : isUpload
            ? 'upload'
            : 'youtube';

          let itemUrl = `https://www.youtube.com/watch?v=${video_id}`;
          if (isTwitch) {
            itemUrl =
              data.video_url ||
              (video_id.startsWith('twitch_clip_')
                ? `https://clips.twitch.tv/${video_id.replace('twitch_clip_', '')}`
                : `https://www.twitch.tv/videos/${video_id.replace('twitch_', '')}`);
          } else if (isGDrive) {
            const gdriveIdMatch = video_id.match(/gdrive_([a-zA-Z0-9_-]+)/);
            const gdriveId = gdriveIdMatch ? gdriveIdMatch[1] : '';
            itemUrl = gdriveId ? `https://drive.google.com/file/d/${gdriveId}/view` : data.video_url || '';
          } else if (isUpload) {
            itemUrl = data.video_url || `/api/video/${video_id}`;
          }

          const thumb =
            isGDrive || isUpload || isTwitch
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
            key_quotes,
          });
        } catch (_) {}
      }
    }
    entries.sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime());
    setHistory(entries);
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const loadFromHistory = useCallback(
    (entry: HistoryEntry) => {
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
          const targetGDriveUrl =
            entry.url && entry.url.includes('drive.google.com')
              ? entry.url
              : gdriveId
              ? `https://drive.google.com/file/d/${gdriveId}/view`
              : entry.video_id;
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
            height: 1920,
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

        if (entry.range_suffix?.includes('_clips_auto')) {
          setClipCountMode('auto');
        } else {
          const clipMatch = entry.range_suffix?.match(/_clips_(\d+)/);
          if (clipMatch) {
            setClipCountMode('custom');
            setTargetClipCount(Number(clipMatch[1]));
          }
        }

        if (entry.range_suffix?.includes('_manual')) {
          setSubtitlesSource('manual');
        } else {
          setSubtitlesSource('youtube');
        }

        if (entry.range_suffix?.includes('_lang_en')) {
          setTranscriptLanguage('en');
        } else if (entry.range_suffix?.includes('_lang_id')) {
          setTranscriptLanguage('id');
        }

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
            setTimeout(() => initPlayer(data.video_id, true), 150);
          }, 500);
        }, 600);
      } catch (_) {
        setToastMessage(t.form.historyLoadFailed);
        setTimeout(() => setToastMessage(null), 3000);
      }
    },
    [
      destroyPlayer,
      initPlayer,
      setActiveClip,
      setAiDetail,
      setAiStage,
      setClipCountMode,
      setCustomRangeEnd,
      setCustomRangeStart,
      setDurationPref,
      setError,
      setGdriveUrl,
      setLoading,
      setLoadingDetails,
      setOverallProgress,
      setRangeType,
      setResult,
      setSourceMode,
      setStepProgress,
      setSubtitlesSource,
      setTargetClipCount,
      setToastMessage,
      setTranscriptLanguage,
      setTwitchUrl,
      setUploadedVideoFile,
      setUploadedVideoInfo,
      setUrl,
      setWorkflowTab,
      setCurrentStep,
      t,
    ]
  );

  const deleteHistoryEntry = useCallback(
    (entry: HistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      const rangeSuffix = entry.range_suffix || '';
      const cacheKey = `cheat_clip_cache_${entry.video_id}_${entry.duration_pref}${rangeSuffix}`;
      const tsKey = `cheat_clip_ts_${entry.video_id}_${entry.duration_pref}${rangeSuffix}`;
      localStorage.removeItem(cacheKey);
      localStorage.removeItem(tsKey);
      refreshHistory();
      setToastMessage(t.form.removedFromHistory(entry.title));
      setTimeout(() => setToastMessage(null), 3000);
    },
    [refreshHistory, setToastMessage, t]
  );

  const clearAllHistory = useCallback(() => {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('cheat_clip_cache_') || key.startsWith('cheat_clip_ts_'))) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    setHistory([]);
    setToastMessage(t.form.allHistoryCleared);
    setTimeout(() => setToastMessage(null), 3000);
  }, [setToastMessage, t]);

  const filteredHistory = useMemo(() => {
    if (!historySearchQuery.trim()) return history;
    const q = historySearchQuery.trim().toLowerCase();
    return history.filter((entry) => {
      const matchesVideoTitle = (entry.title || '').toLowerCase().includes(q);
      const matchesUrl =
        (entry.url || '').toLowerCase().includes(q) || (entry.video_id || '').toLowerCase().includes(q);
      const matchesDuration = (entry.duration_pref || '').toLowerCase().includes(q);
      const matchesSummary = (entry.summary || '').toLowerCase().includes(q);
      const matchesClips = (entry.clip_titles || []).some((tit) => tit.toLowerCase().includes(q));
      const matchesQuotes = (entry.key_quotes || []).some((k) => k.toLowerCase().includes(q));

      return (
        matchesVideoTitle ||
        matchesUrl ||
        matchesDuration ||
        matchesSummary ||
        matchesClips ||
        matchesQuotes
      );
    });
  }, [history, historySearchQuery]);

  const formatRelTime = useCallback((iso: string) => formatRelativeTime(iso, t.relativeTime), [t.relativeTime]);

  return {
    history,
    setHistory,
    showHistory,
    setShowHistory,
    historySearchQuery,
    setHistorySearchQuery,
    confirmClearAll,
    setConfirmClearAll,
    filteredHistory,
    refreshHistory,
    loadFromHistory,
    deleteHistoryEntry,
    clearAllHistory,
    formatRelTime,
  };
}
