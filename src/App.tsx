import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { hasStoredCookies } from './utils/cookieUtils';
import { isLocalEnvironment } from './utils/deviceUtils';
import { LayoutMetricsSync } from './utils/layoutMetricsSync';
import { useLanguage } from './locales';

import type { AnalyzeResponse, ViralClip } from './types';
import { AppHeader } from './components/layout/AppHeader';
import { WorkflowTabs } from './components/layout/WorkflowTabs';
import { SourceInputTab } from './components/tabs/SourceInputTab';
import { RecommendedClipsTab } from './components/tabs/RecommendedClipsTab';
import { ClipStudioTab } from './components/tabs/ClipStudioTab';
import { LanguageConfirmModal } from './components/modals/LanguageConfirmModal';
import { ClipperMaintenanceModal } from './components/modals/ClipperMaintenanceModal';
import { DeveloperPasscodeModal } from './components/modals/DeveloperPasscodeModal';
import { GlobalClearModal } from './components/modals/GlobalClearModal';

import { useSourceForm } from './hooks/useSourceForm';
import { useVideoPlayer } from './hooks/useVideoPlayer';
import { useRawDownload } from './hooks/useRawDownload';
import { useHistory } from './hooks/useHistory';
import { useClipActions } from './hooks/useClipActions';
import { useClipFilters } from './hooks/useClipFilters';
import { useAiModels } from './hooks/useAiModels';
import { useVideoAnalysis } from './hooks/useVideoAnalysis';
import { useDevAccess } from './hooks/useDevAccess';
import { useBatchRender } from './hooks/useBatchRender';

// Lazy-loaded modals to minimize initial bundle size and speed up page load
const CookiesModal = lazy(() =>
  import('./components/CookiesModal').then(m => ({ default: m.CookiesModal }))
);
const CookieWarningModal = lazy(() =>
  import('./components/CookieWarningModal').then(m => ({ default: m.CookieWarningModal }))
);
const ClipTrimmerModal = lazy(() =>
  import('./components/ClipTrimmerModal').then(m => ({ default: m.ClipTrimmerModal }))
);
const AppUpdateModal = lazy(() =>
  import('./components/AppUpdateModal').then(m => ({ default: m.AppUpdateModal }))
);

// Declare YT global variables for TypeScript
declare global {
  interface Window {
    YT: {
      Player: any;
      [key: string]: any;
    };
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

export default function App() {
  const { t } = useLanguage();

  // Workflow tab navigation
  const [workflowTab, setWorkflowTab] = useState<'source' | 'clips' | 'clipper'>('source');

  // Source form & configuration state
  const form = useSourceForm();

  // Results & active clips state
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [activeClip, setActiveClip] = useState<ViralClip | null>(null);
  const [trimmerClip, setTrimmerClip] = useState<ViralClip | null>(null);
  const [markedClips, setMarkedClips] = useState<Record<string, boolean>>({});

  // Toast feedback state
  const [toastMessage, setToastMessageState] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setToastMessage = useCallback((msg: string | null) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessageState(msg);
  }, []);

  // System modals & updates state
  const [isCookiesModalOpen, setIsCookiesModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [allowAppUpdates, setAllowAppUpdates] = useState<boolean>(() => isLocalEnvironment());
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
  const [isClearingGlobalTemp, setIsClearingGlobalTemp] = useState<boolean>(false);
  const [showGlobalClearModal, setShowGlobalClearModal] = useState<boolean>(false);

  // Left panel dynamic layout height sync
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const [leftPanelHeight, setLeftPanelHeight] = useState<number | null>(null);

  // AI model catalog hook
  const {
    availableModels,
    loadingModels,
    openRouterModels,
    loadingOpenRouterModels,
  } = useAiModels({
    apiKey: form.apiKey,
    selectedModel: form.selectedModel,
    setSelectedModel: form.setSelectedModel,
    openRouterKey: form.openRouterKey,
  });

  // Video playback controller hook
  const player = useVideoPlayer({
    result,
    setActiveClip,
  });

  // Developer access & passcode gating hook
  const {
    isLocalhost,
    isDevUnlocked,
    showClipperMaintenanceModal,
    setShowClipperMaintenanceModal,
    showPasscodeDialog,
    setShowPasscodeDialog,
    passcodeError,
    setPasscodeError,
    handleUnlockWithPasscode,
    handleResetAdminStatus,
    handleNavigateToClipper,
  } = useDevAccess({
    result,
    workflowTab,
    setWorkflowTab,
  });

  // History management hook
  const historyOps = useHistory({
    t,
    setSourceMode: form.setSourceMode,
    setUrl: form.setUrl,
    setTwitchUrl: form.setTwitchUrl,
    setGdriveUrl: form.setGdriveUrl,
    setUploadedVideoInfo: form.setUploadedVideoInfo,
    setUploadedVideoFile: form.setUploadedVideoFile,
    setDurationPref: form.setDurationPref,
    setClipCountMode: form.setClipCountMode,
    setTargetClipCount: form.setTargetClipCount,
    setSubtitlesSource: form.setSubtitlesSource,
    setTranscriptLanguage: form.setTranscriptLanguage,
    setRangeType: form.setRangeType,
    setCustomRangeStart: form.setCustomRangeStart,
    setCustomRangeEnd: form.setCustomRangeEnd,
    destroyPlayer: player.destroyPlayer,
    initPlayer: player.initPlayer,
    setLoading: (l: boolean) => analysis.setLoading(l),
    setError: (err: string | null) => analysis.setError(err),
    setResult,
    setActiveClip,
    setCurrentStep: (step: number) => analysis.setCurrentStep(step),
    setStepProgress: (progress: Record<number, number>) => analysis.setStepProgress(progress),
    setOverallProgress: (progress: number) => analysis.setOverallProgress(progress),
    setLoadingDetails: (details: string) => analysis.setLoadingDetails(details),
    setAiStage: (stage: string) => analysis.setAiStage(stage),
    setAiDetail: (detail: string) => analysis.setAiDetail(detail),
    setWorkflowTab,
    setToastMessage,
  });

  // Video analysis pipeline hook
  const analysis = useVideoAnalysis({
    t,
    sourceMode: form.sourceMode,
    url: form.url,
    gdriveUrl: form.gdriveUrl,
    twitchUrl: form.twitchUrl,
    uploadedVideoFile: form.uploadedVideoFile,
    uploadedVideoInfo: form.uploadedVideoInfo,
    setUploadedVideoInfo: form.setUploadedVideoInfo,
    setIsUploadingVideo: form.setIsUploadingVideo,
    apiKey: form.apiKey,
    apiProvider: form.apiProvider,
    openRouterKey: form.openRouterKey,
    openRouterModel: form.openRouterModel,
    selectedModel: form.selectedModel,
    durationPref: form.durationPref,
    customPrompt: form.customPrompt,
    targetClipCount: form.targetClipCount,
    clipCountMode: form.clipCountMode,
    subtitlesSource: form.subtitlesSource,
    manualSubtitlesContent: form.manualSubtitlesContent,
    manualSubtitlesFileName: form.manualSubtitlesFileName,
    transcriptLanguage: form.transcriptLanguage,
    rangeType: form.rangeType,
    customRangeStart: form.customRangeStart,
    customRangeEnd: form.customRangeEnd,
    skipLanguageConfirm: form.skipLanguageConfirm,
    setShowLanguageConfirmModal: form.setShowLanguageConfirmModal,
    setWorkflowTab,
    setResult,
    setActiveClip,
    initPlayer: player.initPlayer,
    refreshHistory: historyOps.refreshHistory,
  });

  // Source type helper
  const isCurrentVideoYouTube = useCallback(() => {
    if (form.sourceMode === 'upload' || form.sourceMode === 'gdrive' || form.sourceMode === 'twitch') return false;
    if (result?.source_type === 'upload' || result?.source_type === 'gdrive' || result?.source_type === 'twitch') return false;
    if (result?.video_id?.startsWith('upload_') || result?.video_id?.startsWith('gdrive_') || result?.video_id?.startsWith('twitch_')) return false;
    if (result?.video_url?.includes('/api/video/') || result?.video_url?.includes('twitch.tv')) return false;
    return true;
  }, [form.sourceMode, result?.source_type, result?.video_id, result?.video_url]);

  const clips = result?.clips;
  const markedClipsList = useMemo(() => {
    if (!clips) return [];
    return clips.filter(c => !!markedClips[`${c.start_time}_${c.end_time}`]);
  }, [clips, markedClips]);

  const toggleMarkedClip = useCallback((clipId: string) => {
    if (!result?.video_id) return;
    const updated = {
      ...markedClips,
      [clipId]: !markedClips[clipId]
    };
    setMarkedClips(updated);
    localStorage.setItem(`marked_clips_${result.video_id}`, JSON.stringify(updated));
  }, [markedClips, result?.video_id]);

  const toggleAllMarkedClips = useCallback((forceSelect?: boolean) => {
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
  }, [markedClips, result]);

  // Raw downloads hook
  const rawDownload = useRawDownload({
    result,
    sourceMode: form.sourceMode,
    uploadedVideoFile: form.uploadedVideoFile,
    url: form.url,
    isCurrentVideoYouTube,
    setCookieWarningState,
    setToastMessage,
    setError: analysis.setError,
    t,
  });

  // Clip actions & clipboard / exports hook
  const clipActions = useClipActions({
    result,
    setResult,
    trimmerClip,
    markedClips,
    setMarkedClips,
    setToastMessage,
    t,
  });

  // Filter & sorting hook for clips
  const clipFilters = useClipFilters({
    result,
    activeClip,
    currentTime: player.currentTime,
    markedClips,
  });

  // Batch rendering hook
  const {
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
  } = useBatchRender({
    result,
    url: form.url,
    sourceMode: form.sourceMode,
    uploadedVideoFile: form.uploadedVideoFile,
    loading: analysis.loading,
    isCurrentVideoYouTube,
    setCookieWarningState,
  });

  // Deselect active video action
  const handleDeselectActiveVideo = useCallback(() => {
    player.destroyPlayer();
    setResult(null);
    setActiveClip(null);
    form.setUrl('');
    form.setGdriveUrl('');
    form.setUploadedVideoFile(null);
    form.setUploadedVideoInfo(null);
    if (form.videoFileInputRef.current) form.videoFileInputRef.current.value = '';
    setMarkedClips({});
    analysis.setError(null);
    if (workflowTab === 'clipper') {
      setWorkflowTab('source');
    }
    setToastMessage('Active video ditutup (deselected)');
    setTimeout(() => setToastMessage(null), 3000);
  }, [analysis, form, player, setToastMessage, workflowTab]);

  // Purge global temporary video frames and downloads
  const executeGlobalClearTemp = useCallback(async () => {
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
  }, [isClearingGlobalTemp, setToastMessage, t.header.clearedTempError, t.header.clearedTempFailed, t.header.clearedTempSuccess]);

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

  // Layout resize observer for sidebar cards
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
  }, [result, activeClip, clipFilters.expandedClipIndex]);

  // Check YouTube cookies configuration in browser localStorage
  useEffect(() => {
    const checkCookies = () => {
      setHasCookies(hasStoredCookies());
    };

    checkCookies();

    window.addEventListener('focus', checkCookies);
    window.addEventListener('storage', checkCookies);
    window.addEventListener('cheatclip_cookies_updated', checkCookies);

    return () => {
      window.removeEventListener('focus', checkCookies);
      window.removeEventListener('storage', checkCookies);
      window.removeEventListener('cheatclip_cookies_updated', checkCookies);
    };
  }, []);

  // Query server update permissions
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
        setAllowAppUpdates(isLocalEnvironment());
      });
  }, []);

  return (
    <>
      <AppHeader
        toastMessage={toastMessage}
        onCloseToast={() => setToastMessage(null)}
        hasCookies={hasCookies}
        onOpenCookiesModal={() => setIsCookiesModalOpen(true)}
        allowAppUpdates={allowAppUpdates}
        isClearingGlobalTemp={isClearingGlobalTemp}
        onOpenGlobalClearModal={() => setShowGlobalClearModal(true)}
        onOpenUpdateModal={() => setIsUpdateModalOpen(true)}
      />

      <div className="app-container">
        <WorkflowTabs
          workflowTab={workflowTab}
          setWorkflowTab={setWorkflowTab}
          result={result}
          loading={analysis.loading}
          overallProgress={analysis.overallProgress}
          historyCount={historyOps.history.length}
          markedClipsCount={markedClipsList.length}
          isLocalhost={isLocalhost}
          isDevUnlocked={isDevUnlocked}
          onNavigateToClipper={handleNavigateToClipper}
          onDeselectActiveVideo={handleDeselectActiveVideo}
          onResetAdminStatus={handleResetAdminStatus}
        />

        {/* Tab 01: SOURCE INPUT SECTION */}
        <SourceInputTab
          isActive={workflowTab === 'source'}
          onSubmit={analysis.handleFormSubmit}
          onAnalyze={analysis.handleAnalyze}
          {...form}
          availableModels={availableModels}
          loadingModels={loadingModels}
          openRouterModels={openRouterModels}
          loadingOpenRouterModels={loadingOpenRouterModels}
          loading={analysis.loading}
          setToastMessage={setToastMessage}
          error={analysis.error}
          setError={analysis.setError}
        />

        {/* Tab 02: CLIPS / HISTORY SECTION */}
        <RecommendedClipsTab
          isActive={workflowTab === 'clips'}
          {...historyOps}
          {...analysis}
          result={result}
          currentTime={player.currentTime}
          setCurrentTime={player.setCurrentTime}
          directVideoPlayerRef={player.directVideoPlayerRef}
          activeClip={activeClip}
          setActiveClip={setActiveClip}
          handleSeek={player.handleSeek}
          handleRefreshPlayer={player.handleRefreshPlayer}
          startTracking={player.startTracking}
          stopTracking={player.stopTracking}
          playClip={player.playClip}
          {...rawDownload}
          {...clipFilters}
          {...clipActions}
          subtitlesSource={form.subtitlesSource}
          selectedModel={form.selectedModel}
          markedClips={markedClips}
          toggleMarkedClip={toggleMarkedClip}
          toggleAllMarkedClips={toggleAllMarkedClips}
          setTrimmerClip={setTrimmerClip}
          leftPanelHeight={leftPanelHeight}
          leftPanelRef={leftPanelRef}
          setWorkflowTab={setWorkflowTab}
        />

        {/* Tab 03: CLIP STUDIO TAB */}
        <ClipStudioTab
          isActive={workflowTab === 'clipper'}
          result={result}
          url={form.url}
          isLocalhost={isLocalhost}
          isDevUnlocked={isDevUnlocked}
          activeClip={activeClip}
          markedClipsList={markedClipsList}
          onStartRender={handleStartBatchRender}
          isLaunchingRender={isLaunchingRender}
          toggleMarkedClip={toggleMarkedClip}
          toggleAllMarkedClips={toggleAllMarkedClips}
          batchProgress={batchProgress}
          sourcePrepProgress={sourcePrepProgress}
          onDismissProgress={() => {
            if (batchEventSourceRef.current) {
              batchEventSourceRef.current.close();
              batchEventSourceRef.current = null;
            }
            setBatchProgress(null);
            setSourcePrepProgress(null);
          }}
          onRetryClip={handleRetryBatchClip}
          onCancelRender={handleCancelRender}
          isCancellingRender={isCancellingRender}
          allowAppUpdates={allowAppUpdates}
          onOpenCookiesModal={() => setIsCookiesModalOpen(true)}
          onBackToClips={() => setWorkflowTab('clips')}
        />

        {/* Viewport and Hardware Metrics Sync Pipeline */}
        <LayoutMetricsSync />

        {/* Transcript Language Confirmation Notice Modal */}
        <LanguageConfirmModal
          isOpen={form.showLanguageConfirmModal}
          transcriptLanguage={form.transcriptLanguage}
          setTranscriptLanguage={form.setTranscriptLanguage}
          skipLanguageConfirm={form.skipLanguageConfirm}
          setSkipLanguageConfirm={form.setSkipLanguageConfirm}
          onClose={() => form.setShowLanguageConfirmModal(false)}
          onProceed={analysis.handleAnalyze}
        />

        {/* Clipper Maintenance Info Modal */}
        <ClipperMaintenanceModal
          isOpen={showClipperMaintenanceModal}
          onClose={() => setShowClipperMaintenanceModal(false)}
          onGoToClips={() => setWorkflowTab('clips')}
        />

        {/* Developer Passcode Dialog */}
        <DeveloperPasscodeModal
          isOpen={showPasscodeDialog}
          onClose={() => setShowPasscodeDialog(false)}
          onSubmit={handleUnlockWithPasscode}
          passcodeError={passcodeError}
          setPasscodeError={setPasscodeError}
        />

        {/* Lazy Loaded Modals */}
        <Suspense fallback={null}>
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
            onApply={clipActions.handleApplyAdjustedClipToResults}
            onDownload={async (adjustedClip) => {
              clipActions.handleApplyAdjustedClipToResults(adjustedClip);
              await rawDownload.handleDownloadRawClip(adjustedClip);
            }}
          />
        </Suspense>

        {/* Global Fancy Clear Temp Confirmation Modal */}
        <GlobalClearModal
          isOpen={showGlobalClearModal}
          onClose={() => setShowGlobalClearModal(false)}
          onConfirm={executeGlobalClearTemp}
          isClearing={isClearingGlobalTemp}
        />
      </div>
    </>
  );
}
