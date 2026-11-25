import { useState, useRef } from 'react';

export function useSourceForm() {
  const [url, setUrl] = useState('');
  const [gdriveUrl, setGdriveUrl] = useState('');
  const [twitchUrl, setTwitchUrl] = useState('');
  const [sourceMode, setSourceMode] = useState<'youtube' | 'twitch' | 'gdrive' | 'upload'>('youtube');
  const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null);
  const [uploadedVideoInfo, setUploadedVideoInfo] = useState<{
    videoId: string;
    filename: string;
    savedName: string;
    duration: number;
    videoUrl: string;
    filePath: string;
    width: number;
    height: number;
  } | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isDragOverVideo, setIsDragOverVideo] = useState(false);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Duration & AI configuration states
  const [durationPref, setDurationPref] = useState<'15s' | '30s' | '60s' | 'auto'>(() => {
    const saved = localStorage.getItem('cheat_clip_duration_pref');
    if (saved === '15s' || saved === '30s' || saved === '60s' || saved === 'auto') return saved;
    return '30s';
  });
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('cheat_clip_gemini_api_key') || '');
  const [apiProvider, setApiProvider] = useState<'gemini' | 'openrouter'>(() => {
    const saved = localStorage.getItem('cheat_clip_api_provider');
    return (saved === 'openrouter' || saved === 'gemini') ? saved : 'gemini';
  });
  const [openRouterKey, setOpenRouterKey] = useState<string>(() => localStorage.getItem('cheat_clip_openrouter_key') || '');
  const [openRouterModel, setOpenRouterModel] = useState<string>(() => {
    const saved = localStorage.getItem('cheat_clip_openrouter_model');
    return saved || 'google/gemini-2.5-flash';
  });
  const [customOpenRouterModel, setCustomOpenRouterModel] = useState<string>('');
  const [isCustomOpenRouterModel, setIsCustomOpenRouterModel] = useState<boolean>(false);

  // Selected Gemini model
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const saved = localStorage.getItem('cheat_clip_selected_model');
    if (saved && (saved.includes('1.0') || saved.includes('vision'))) {
      localStorage.setItem('cheat_clip_selected_model', 'gemini-2.5-flash');
      return 'gemini-2.5-flash';
    }
    return saved || 'gemini-2.5-flash';
  });
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [targetClipCount, setTargetClipCount] = useState<number>(() => {
    const val = localStorage.getItem('cheat_clip_target_clip_count');
    return val ? Number(val) : 10;
  });
  const [clipCountMode, setClipCountMode] = useState<'auto' | 'custom'>(() => {
    const saved = localStorage.getItem('cheat_clip_clip_count_mode');
    return (saved === 'auto' || saved === 'custom') ? saved : 'auto';
  });

  // Range and subtitles settings
  const [rangeType, setRangeType] = useState<'entire' | 'custom'>('entire');
  const [customRangeStart, setCustomRangeStart] = useState<string>('');
  const [customRangeEnd, setCustomRangeEnd] = useState<string>('');
  const [subtitlesSource, setSubtitlesSource] = useState<'youtube' | 'manual'>('youtube');
  const [manualSubtitlesContent, setManualSubtitlesContent] = useState<string>('');
  const [manualSubtitlesFileName, setManualSubtitlesFileName] = useState<string>('');
  const [transcriptLanguage, setTranscriptLanguage] = useState<'id' | 'en'>(() => {
    const saved = localStorage.getItem('cheat_clip_transcript_language');
    if (saved === 'id' || saved === 'en') return saved;
    return 'en';
  });
  const [showLanguageConfirmModal, setShowLanguageConfirmModal] = useState<boolean>(false);
  const [skipLanguageConfirm, setSkipLanguageConfirm] = useState<boolean>(false);

  return {
    url,
    setUrl,
    gdriveUrl,
    setGdriveUrl,
    twitchUrl,
    setTwitchUrl,
    sourceMode,
    setSourceMode,
    uploadedVideoFile,
    setUploadedVideoFile,
    uploadedVideoInfo,
    setUploadedVideoInfo,
    isUploadingVideo,
    setIsUploadingVideo,
    isDragOverVideo,
    setIsDragOverVideo,
    videoFileInputRef,
    durationPref,
    setDurationPref,
    apiKey,
    setApiKey,
    apiProvider,
    setApiProvider,
    openRouterKey,
    setOpenRouterKey,
    openRouterModel,
    setOpenRouterModel,
    customOpenRouterModel,
    setCustomOpenRouterModel,
    isCustomOpenRouterModel,
    setIsCustomOpenRouterModel,
    selectedModel,
    setSelectedModel,
    customPrompt,
    setCustomPrompt,
    targetClipCount,
    setTargetClipCount,
    clipCountMode,
    setClipCountMode,
    rangeType,
    setRangeType,
    customRangeStart,
    setCustomRangeStart,
    customRangeEnd,
    setCustomRangeEnd,
    subtitlesSource,
    setSubtitlesSource,
    manualSubtitlesContent,
    setManualSubtitlesContent,
    manualSubtitlesFileName,
    setManualSubtitlesFileName,
    transcriptLanguage,
    setTranscriptLanguage,
    showLanguageConfirmModal,
    setShowLanguageConfirmModal,
    skipLanguageConfirm,
    setSkipLanguageConfirm,
  };
}
