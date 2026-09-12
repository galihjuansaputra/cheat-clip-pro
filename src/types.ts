export interface HeatmapPoint {
  start_time: number;
  end_time: number;
  value: number;
}

export interface TranscriptLine {
  start: number;
  end: number;
  text: string;
  engagement?: number;
}

export interface ViralClip {
  title: string;
  start_time: number;
  end_time: number;
  hook_time?: number;
  virality_score: number;
  key_quotes: string[];
  transcript: string;
  title_suggestion?: string;
  caption_suggestion?: string;
  hashtag_suggestion?: string;
}

export interface AnalyzeResponse {
  video_id: string;
  title: string;
  duration: number;
  heatmap: HeatmapPoint[];
  summary: string;
  clips: ViralClip[];
  transcript?: TranscriptLine[];
  model?: string;
}

export type AspectRatioOption = '9:16' | '1:1' | '4:3' | '16:9';
export type BackgroundStyle = 'black' | 'blurred';
export type CaptionStyle = 
  | 'viral_pop' 
  | 'beast_punch' 
  | 'cyber_violet' 
  | 'fire_red' 
  | 'electric_cyan' 
  | 'golden_aura' 
  | 'clean_minimal' 
  | 'none';
export type CaptionFont = 
  | 'Outfit' 
  | 'Montserrat' 
  | 'Inter' 
  | 'Impact' 
  | 'Bebas Neue' 
  | 'Anton' 
  | 'Poppins' 
  | 'Arial Black';
export type TitlePosition = 'auto' | 'safe_zone' | 'middle' | 'none';
export type TitleDurationOption = 'entire' | '5s' | '10s';
export type SubtitlePositionMode = 'bottom' | 'center';
export type StreamerPreset = 'none' | 'split_top_cam' | 'pip_corner';
export type FontSizeOption = 'small' | 'medium' | 'big';
export type TextCaseOption = 'uppercase' | 'capitalize' | 'lowercase';
export type HardwareAccelOption = 'auto' | 'nvenc' | 'amf' | 'qsv' | 'cpu';

export interface HardwareAccelInfo {
  status: string;
  active_default: string;
  recommended: string;
  support: {
    nvenc: boolean;
    amf: boolean;
    qsv: boolean;
    cpu: boolean;
    recommended: string;
  };
  options: Array<{
    id: HardwareAccelOption;
    label: string;
    sub: string;
    available: boolean;
  }>;
}

export interface RenderSettings {
  aspectRatio: AspectRatioOption;
  backgroundStyle: BackgroundStyle;
  enableFaceTracking: boolean;
  streamerPreset: StreamerPreset;
  titleText: string;
  titlePosition: TitlePosition;
  titleDuration?: TitleDurationOption;
  captionStyle: CaptionStyle;
  captionFont: CaptionFont;
  fontSize: FontSizeOption;
  textCase: TextCaseOption;
  titleYPercent?: number;
  subtitleYPercent?: number;
  subtitlePositionMode?: SubtitlePositionMode;
  subtitleCenterYPercent?: number;
  selectedClips: ViralClip[];
  // Background Music
  bgmEnabled?: boolean;
  bgmFilePath?: string;
  bgmFileName?: string;
  bgmVolume?: number; // 0 to 100%
  bgmStartOffset?: number; // seconds from start of audio track
  // Hook SFX
  hookSfxEnabled?: boolean;
  hookSfxFilePath?: string;
  hookSfxFileName?: string;
  hookSfxVolume?: number; // 0 to 150%
  // Raw Audio / Voice Boost
  originalAudioVolume?: number; // 0 to 200%
  // Watermark
  watermarkEnabled?: boolean;
  watermarkType?: 'image' | 'text';
  watermarkFilePath?: string;
  watermarkUrl?: string;
  watermarkText?: string;
  watermarkSize?: number; // 5 to 50%
  watermarkOpacity?: number; // 10 to 100%
  watermarkX?: number; // 0 to 100%
  watermarkY?: number; // 0 to 100%
  // Hardware Acceleration / Video Encoder
  hardwareAccel?: HardwareAccelOption;
}

export interface RenderClipStatus {
  clip_index: number;
  title: string;
  status: 'pending' | 'downloading' | 'transcribing' | 'tracking' | 'rendering' | 'completed' | 'error';
  progress_percent: number;
  download_url?: string;
  error_message?: string;
}

export interface BatchRenderProgress {
  batch_id: string;
  total_clips: number;
  current_clip_index: number;
  overall_status: 'running' | 'completed' | 'error';
  zip_url?: string;
  clips: RenderClipStatus[];
}
