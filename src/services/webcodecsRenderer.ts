import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { CAPTION_STYLE_CONFIG, applyLetterCase, getFontWeightForFamily, getFontFamilyWithFallback, wrapTitleSmart } from './captionUtils';
import type { CaptionChunk } from './captionUtils';
import type { CaptionStyle, SubtitlePositionMode } from '../types';

export interface WebCodecsRenderOptions {
  videoSourceUrl: string;
  startTime?: number;
  endTime?: number;
  clipTimeOffset?: number; // Time offset when source is pre-trimmed
  aspectRatio: '9:16' | '1:1' | '16:9' | '4:5' | '4:3' | '16:9_landscape';
  backgroundStyle: 'blur' | 'black' | 'fit' | 'crop' | 'blurred';
  // Title
  titleText?: string;
  titleYPercent?: number;
  titleFont?: string;
  titleDuration?: 'entire' | '5s' | '10s';
  titleFontSizePx?: number;
  // Subtitles
  subtitlesEnabled?: boolean;
  captionChunks?: CaptionChunk[];
  captionStyle?: CaptionStyle | string;
  captionFont?: string;
  fontSizePx?: number;
  textCase?: string;
  subtitleYPercent?: number;
  subtitleOffsetSeconds?: number;
  subtitlePositionMode?: SubtitlePositionMode;
  subtitleCenterYPercent?: number;
  // General
  fileName?: string;
  onProgress?: (percent: number, stage: string) => void;
}

/**
 * Checks if the user's browser environment supports native WebCodecs hardware encoding.
 */
export function isWebCodecsGpuSupported(): boolean {
  return typeof window !== 'undefined' &&
    typeof (window as any).VideoEncoder === 'function' &&
    typeof (window as any).VideoFrame === 'function';
}

/**
 * Detects the client's GPU renderer information via WebGL (synchronous fallback).
 * Uses high-performance power preference to ensure discrete GPUs are selected.
 */
export function getClientGpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const glOptions = { powerPreference: 'high-performance' as const, failIfMajorPerformanceCaveat: false };
    const gl = canvas.getContext('webgl2', glOptions) ||
      canvas.getContext('webgl', glOptions) ||
      canvas.getContext('experimental-webgl2', glOptions) ||
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl');
    if (!gl) return 'Browser GPU';
    const debugInfo = (gl as any).getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (renderer) return cleanGpuName(renderer);
    }
    const stdRenderer = (gl as any).getParameter((gl as any).RENDERER);
    if (stdRenderer) return cleanGpuName(stdRenderer);
    return 'Client Hardware GPU';
  } catch {
    return 'Client Hardware GPU';
  }
}

/**
 * Asynchronously detects the precise client GPU using WebGPU (Chrome 113+, Edge)
 * or high-performance WebGL. Accurately identifies discrete GPUs like NVIDIA RTX.
 */
export async function detectClientGpuAccurate(): Promise<string> {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
    try {
      const gpu = (navigator as any).gpu;
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        if (typeof (adapter as any).requestAdapterInfo === 'function') {
          const info = await (adapter as any).requestAdapterInfo();
          if (info?.description) return cleanGpuName(info.description);
          if (info?.device) return cleanGpuName(info.device);
        }
        const info = (adapter as any).info;
        if (info?.description) return cleanGpuName(info.description);
        if (info?.device) return cleanGpuName(info.device);
        if (info?.architecture) return cleanGpuName(info.architecture);
      }
    } catch {
      // Fallback to WebGL
    }
  }
  return getClientGpuName();
}

export function cleanGpuName(raw: string): string {
  if (!raw) return 'Hardware GPU';

  // 1. Check for NVIDIA pattern
  const nvidiaMatch = raw.match(/(?:NVIDIA\s+)?(GeForce\s+(?:RTX|GTX|GT|MX)\s+[A-Za-z0-9\s]+?)(?=\s+(?:\(0x|Direct3D|vs_|ps_|OpenGL|Vulkan|\)|$|,))/i);
  if (nvidiaMatch) {
    const model = nvidiaMatch[1].replace(/\s*\([0-9a-fxX]+\)/gi, '').trim();
    return `NVIDIA ${model.replace(/^GeForce/i, 'GeForce')}`;
  }

  // 2. Check for AMD / Radeon pattern
  const amdMatch = raw.match(/(?:AMD\s+)?(Radeon\s+(?:RX|PRO|Vega|\(TM\))?\s*[A-Za-z0-9\s]+?)(?=\s+(?:\(0x|Direct3D|vs_|ps_|OpenGL|Vulkan|\)|$|,))/i);
  if (amdMatch) {
    const model = amdMatch[1].replace(/\s*\([0-9a-fxX]+\)/gi, '').trim();
    return `AMD ${model.replace(/^Radeon/i, 'Radeon')}`;
  }

  // 3. Check for Intel Arc / Iris / UHD
  const intelMatch = raw.match(/(Intel(?:\(R\))?\s+(?:Arc\s+[A-Za-z0-9]+|Iris(?:\(R\))?\s+[A-Za-z0-9\s]+|UHD\s+Graphics(?:\s+[A-Za-z0-9]+)?))/i);
  if (intelMatch) {
    return intelMatch[1].replace(/\(R\)/gi, '').replace(/\s*\([0-9a-fxX]+\)/gi, '').replace(/\s+/g, ' ').trim();
  }

  // 4. Check for Apple Silicon (M1/M2/M3/M4)
  const appleMatch = raw.match(/(Apple\s+M\d+(?:\s+(?:Pro|Max|Ultra))?)/i);
  if (appleMatch) {
    return appleMatch[1].trim();
  }

  // 5. General fallback cleaning
  let clean = raw.replace(/^ANGLE\s*\(/i, '').replace(/\)$/, '');
  const parts = clean.split(',');
  if (parts.length > 1) {
    clean = parts[1].trim();
  }
  clean = clean.replace(/\s*\([0-9a-fxX]+\)/gi, '');
  clean = clean.split(' Direct3D')[0].split(' vs_')[0].split(' OpenGL')[0].split(' Vulkan')[0].split(' D3D')[0].trim();
  return clean || 'Hardware GPU';
}

/**
 * Draws the title overlay onto the canvas frame.
 */
function drawTitleOnCanvas(
  ctx: CanvasRenderingContext2D,
  titleText: string | undefined,
  canvasWidth: number,
  canvasHeight: number,
  yPercent: number = 15,
  titleFont: string = 'Outfit',
  baseFontSizePx: number = 75,
  titleDuration: string = 'entire',
  elapsedSec: number = 0
) {
  if (!titleText || !titleText.trim()) return;
  if (titleDuration === '5s' && elapsedSec > 5.0) return;
  if (titleDuration === '10s' && elapsedSec > 10.0) return;

  const scaleFactor = canvasWidth / 1080;
  let fontSize = Math.max(24, Math.round(baseFontSizePx * scaleFactor));

  // Format title into strictly max 2 balanced lines, avoiding orphan words
  const { formatted } = wrapTitleSmart(titleText);
  const lines = formatted.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  // Exact parity with video_engine.py: auto-scale down font if any line exceeds safe width
  const maxAllowedW = canvasWidth - Math.round(70 * scaleFactor);
  let fontStr = `${getFontWeightForFamily(titleFont)} ${fontSize}px ${getFontFamilyWithFallback(titleFont)}`;
  ctx.save();
  ctx.font = fontStr;

  let maxLineW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineW) maxLineW = w;
  }
  if (maxLineW > maxAllowedW && maxLineW > 0) {
    const fitFactor = maxAllowedW / maxLineW;
    fontSize = Math.max(20, Math.round(fontSize * fitFactor));
    fontStr = `${getFontWeightForFamily(titleFont)} ${fontSize}px ${getFontFamilyWithFallback(titleFont)}`;
    ctx.font = fontStr;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const titleY = Math.round(canvasHeight * (yPercent / 100.0));
  const centerX = canvasWidth / 2;
  const lineHeight = fontSize * 1.15;

  lines.forEach((line, idx) => {
    const lineY = titleY + (idx * lineHeight);

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 8 * scaleFactor;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * scaleFactor;

    // Stroke outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(3, 5.0 * scaleFactor);
    ctx.lineJoin = 'round';
    ctx.strokeText(line, centerX, lineY);

    // Text fill
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(line, centerX, lineY);
  });

  ctx.restore();
}

/**
 * Draws bouncing pop subtitles onto the canvas frame for the active timestamp.
 */
function drawCaptionsOnCanvas(
  ctx: CanvasRenderingContext2D,
  chunks: CaptionChunk[] | undefined,
  currentTime: number,
  canvasWidth: number,
  canvasHeight: number,
  style: CaptionStyle | string = 'viral_pop',
  fontFamily: string = 'Outfit',
  baseFontSizePx: number = 75,
  yPercent: number = 21,
  textCase: string = 'uppercase',
  positionMode: SubtitlePositionMode = 'bottom',
  centerYPercent: number = 50
) {
  if (!chunks || !chunks.length || !style || style === 'none') return;

  // 1. Locate active chunk (with inter-chunk pause bridging and frame 0 intro)
  let activeChunk: CaptionChunk | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const nxt = chunks[i + 1];
    const bridgeEnd = nxt ? nxt.start : (c.end + 2.0);
    if (currentTime >= (c.start - 0.05) && currentTime < bridgeEnd) {
      activeChunk = c;
      break;
    }
  }

  // Frame 0 intro caption visibility
  if (!activeChunk && currentTime < chunks[0].start && (chunks[0].start - currentTime) <= 5.0) {
    activeChunk = chunks[0];
  }

  if (!activeChunk || !activeChunk.words.length) return;

  const currentStyle = (CAPTION_STYLE_CONFIG as any)[style] || CAPTION_STYLE_CONFIG.viral_pop;
  const highlightColor = currentStyle.highlight;

  // 2. Locate active word index and progress
  let activeWordIdx = -1;
  let wordProgress = 0;
  for (let idx = 0; idx < activeChunk.words.length; idx++) {
    const w = activeChunk.words[idx];
    if (currentTime >= w.start && currentTime <= w.end) {
      activeWordIdx = idx;
      wordProgress = (currentTime - w.start) / Math.max(0.06, w.end - w.start);
      break;
    }
  }
  if (activeWordIdx === -1 && currentTime >= activeChunk.end) {
    activeWordIdx = activeChunk.words.length - 1;
    wordProgress = 1.0;
  }

  // 3. Compute position and font sizing
  const scaleFactor = canvasWidth / 1080;
  const fontSize = Math.max(26, Math.round(baseFontSizePx * scaleFactor));
  const fontStr = `${getFontWeightForFamily(fontFamily)} ${fontSize}px ${getFontFamilyWithFallback(fontFamily)}`;

  ctx.save();
  ctx.font = fontStr;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let subY: number;
  if (positionMode === 'center') {
    subY = Math.round(canvasHeight * (centerYPercent / 100.0));
  } else {
    subY = Math.round(canvasHeight * (1.0 - (yPercent / 100.0)));
  }
  const centerX = canvasWidth / 2;

  // 4. Measure words to horizontally center the line
  const formattedWords = activeChunk.words.map(w => applyLetterCase(w.text, textCase));
  const spaceWidth = ctx.measureText(' ').width;
  const wordMetrics = formattedWords.map(txt => ctx.measureText(txt).width);
  const totalLineWidth = wordMetrics.reduce((a, b) => a + b, 0) + (formattedWords.length - 1) * spaceWidth;

  let currentX = centerX - (totalLineWidth / 2);

  // 5. Draw each word with bouncing pop scale on the active word
  for (let i = 0; i < formattedWords.length; i++) {
    const wordText = formattedWords[i];
    const wordWidth = wordMetrics[i];
    const wordCenterX = currentX + (wordWidth / 2);
    const isActive = (i === activeWordIdx);

    // Calculate bouncing pop animation matching the preview
    // Word pops from 1.0 to 1.16 in first 35%, then settles to 1.08
    let popScale = 1.0;
    if (isActive) {
      if (wordProgress < 0.35) {
        popScale = 1.0 + (0.16 * (wordProgress / 0.35));
      } else if (wordProgress < 0.70) {
        const settle = (wordProgress - 0.35) / 0.35;
        popScale = 1.16 - (0.08 * settle);
      } else {
        popScale = 1.08;
      }
    }

    ctx.save();
    ctx.translate(wordCenterX, subY);
    if (popScale !== 1.0) {
      ctx.scale(popScale, popScale);
    }

    // Drop shadow / glow
    ctx.shadowColor = isActive ? `${highlightColor}99` : 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = isActive ? 12 * scaleFactor : 6 * scaleFactor;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * scaleFactor;

    // Stroke outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(3, 5.5 * scaleFactor);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(wordText, 0, 0);

    // Fill color
    ctx.fillStyle = isActive ? highlightColor : '#FFFFFF';
    ctx.fillText(wordText, 0, 0);

    ctx.restore();

    currentX += wordWidth + spaceWidth;
  }

  ctx.restore();
}

/**
 * Normalizes an AudioBuffer to standard 44.1kHz stereo/mono Float32Array channels.
 * Uses OfflineAudioContext for pristine sample-rate conversion without clicks or distortion.
 */
async function normalizeAudioBuffer(
  audioBuffer: AudioBuffer,
  alreadyTrimmed: boolean,
  startTime: number,
  duration: number
): Promise<{ channelData: Float32Array[]; sampleRate: number; numberOfChannels: number }> {
  const targetSampleRate = 44100;
  const numChannels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels));

  let startSample = 0;
  let endSample = audioBuffer.length;

  if (!alreadyTrimmed) {
    startSample = Math.max(0, Math.floor(startTime * audioBuffer.sampleRate));
    endSample = Math.min(audioBuffer.length, Math.floor((startTime + duration) * audioBuffer.sampleRate));
  }

  // If already at target sample rate and channels <= 2 and pre-trimmed
  if (audioBuffer.sampleRate === targetSampleRate && audioBuffer.numberOfChannels <= 2 && alreadyTrimmed) {
    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(audioBuffer.getChannelData(c).slice(startSample, endSample));
    }
    return {
      channelData: channels,
      sampleRate: targetSampleRate,
      numberOfChannels: numChannels,
    };
  }

  // Resample/render through OfflineAudioContext
  const sourceDuration = Math.max(0.1, (endSample - startSample) / audioBuffer.sampleRate);
  const targetFrames = Math.max(1, Math.round(sourceDuration * targetSampleRate));
  const offlineCtx = new OfflineAudioContext(numChannels, targetFrames, targetSampleRate);

  let bufferToRender = audioBuffer;
  if (!alreadyTrimmed) {
    const subFrames = Math.max(1, endSample - startSample);
    const subBuffer = offlineCtx.createBuffer(audioBuffer.numberOfChannels, subFrames, audioBuffer.sampleRate);
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      subBuffer.copyToChannel(audioBuffer.getChannelData(c).subarray(startSample, endSample), c);
    }
    bufferToRender = subBuffer;
  }

  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = bufferToRender;
  sourceNode.connect(offlineCtx.destination);
  sourceNode.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(renderedBuffer.getChannelData(c));
  }

  return {
    channelData: channels,
    sampleRate: targetSampleRate,
    numberOfChannels: numChannels,
  };
}

/**
 * Extracts and decodes audio data from the source video URL for WebCodecs muxing.
 * Multi-tiered strategy:
 * 1. Fast dedicated backend /api/clip-audio endpoint (returns raw WAV stream from server FFmpeg)
 * 2. Client-side WASM FFmpeg extraction (for local blob: URLs or offline)
 * 3. Direct Web Audio API decodeAudioData fallback
 */
async function extractAudioData(
  videoSourceUrl: string,
  startTime: number,
  duration: number
): Promise<{ channelData: Float32Array[]; sampleRate: number; numberOfChannels: number } | null> {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  const audioCtx = new AudioContextClass();

  try {
    let audioBuffer: AudioBuffer | null = null;
    let isAlreadyTrimmed = false;

    // Strategy 1: Server-side audio extraction endpoint
    // Extracts clean PCM WAV stream in ~30ms; eliminates browser MP4-container WebAudio decoding errors
    if (typeof videoSourceUrl === 'string' && !videoSourceUrl.startsWith('blob:')) {
      try {
        const audioUrl = `/api/clip-audio?source_url=${encodeURIComponent(videoSourceUrl)}&start_time=${startTime}&duration=${duration}`;
        const res = await fetch(audioUrl);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          if (arrayBuffer.byteLength > 44) {
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            isAlreadyTrimmed = true;
          }
        }
      } catch (backendErr) {
        console.warn('[WebCodecs] Backend audio extraction attempt failed, trying fallback:', backendErr);
      }
    }

    // Strategy 2: Client-side WASM FFmpeg extraction
    // Essential for local blob: URLs (uploaded files) or when backend is unreachable
    if (!audioBuffer && (videoSourceUrl.startsWith('blob:') || !audioBuffer)) {
      try {
        const { getFFmpeg } = await import('./clientRenderer');
        const { fetchFile } = await import('@ffmpeg/util');
        const ffmpeg = await getFFmpeg();
        const inputData = await fetchFile(videoSourceUrl);
        const tempIn = `audio_in_${Date.now()}.mp4`;
        const tempOut = `audio_out_${Date.now()}.wav`;
        await ffmpeg.writeFile(tempIn, inputData);
        await ffmpeg.exec([
          '-ss', String(startTime),
          '-t', String(duration),
          '-i', tempIn,
          '-vn',
          '-c:a', 'pcm_s16le',
          '-ar', '44100',
          '-ac', '2',
          tempOut
        ]);
        const wavData = await ffmpeg.readFile(tempOut);
        try {
          await ffmpeg.deleteFile(tempIn);
          await ffmpeg.deleteFile(tempOut);
        } catch (_) {}
        const rawWavBytes = wavData as Uint8Array;
        const arrayBufferCopy = new ArrayBuffer(rawWavBytes.byteLength);
        new Uint8Array(arrayBufferCopy).set(new Uint8Array(rawWavBytes.buffer, rawWavBytes.byteOffset, rawWavBytes.byteLength));
        audioBuffer = await audioCtx.decodeAudioData(arrayBufferCopy);
        isAlreadyTrimmed = true;
      } catch (wasmErr) {
        console.warn('[WebCodecs] Client WASM audio extraction attempt failed:', wasmErr);
      }
    }

    // Strategy 3: Direct Web Audio decodeAudioData (e.g. pure audio sources or Safari)
    if (!audioBuffer) {
      try {
        const response = await fetch(videoSourceUrl);
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        isAlreadyTrimmed = false;
      } catch (directErr) {
        console.warn('[WebCodecs] Direct Web Audio decode failed:', directErr);
      }
    }

    if (!audioBuffer) {
      console.warn('[WebCodecs] No audio track could be extracted; video may have no audio.');
      await audioCtx.close();
      return null;
    }

    const normalized = await normalizeAudioBuffer(audioBuffer, isAlreadyTrimmed, startTime, duration);
    await audioCtx.close();
    return normalized;
  } catch (err) {
    console.warn('[WebCodecs] Audio extraction unexpected failure:', err);
    try { await audioCtx.close(); } catch (_) {}
    return null;
  }
}

/**
 * Renders a video clip client-side using WebCodecs hardware encoder and mp4-muxer.
 * 0% Server CPU, leverages client GPU encoder chip natively.
 * Supports full bouncing subtitles, title animations, and audio muxing!
 */
export async function renderClipWebCodecs(options: WebCodecsRenderOptions): Promise<Blob> {
  const {
    videoSourceUrl,
    startTime = 0,
    endTime,
    clipTimeOffset = 0,
    aspectRatio = '9:16',
    backgroundStyle = 'blur',
    titleText,
    titleYPercent = 15,
    titleFont = 'Outfit',
    titleDuration = 'entire',
    titleFontSizePx = 75,
    subtitlesEnabled = true,
    captionChunks,
    captionStyle = 'viral_pop',
    captionFont = 'Outfit',
    fontSizePx = 75,
    textCase = 'uppercase',
    subtitleYPercent = 21,
    subtitleOffsetSeconds = 0,
    subtitlePositionMode = 'bottom',
    subtitleCenterYPercent = 50,
    onProgress
  } = options;

  if (!isWebCodecsGpuSupported()) {
    throw new Error('WebCodecs Hardware API is not supported in this browser.');
  }

  if (onProgress) onProgress(5, 'Initializing Client GPU Hardware Encoder...');

  // 1. Setup target dimensions based on aspect ratio
  // Only '16:9_landscape' is true 1920x1080 landscape. All other modes (9:16, 16:9 letterbox, 1:1, 4:3)
  // render onto a 1080x1920 vertical canvas, perfectly matching the server NVENC engine.
  const isLandscape = (aspectRatio === '16:9_landscape');
  const targetWidth = isLandscape ? 1920 : 1080;
  const targetHeight = isLandscape ? 1080 : 1920;

  // 2. Load video element to inspect metadata and extract frames
  if (onProgress) onProgress(8, 'Loading media source into GPU canvas pipeline...');
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = videoSourceUrl;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Failed to load video element for WebCodecs processing'));
  });

  const duration = (endTime && endTime > startTime) ? (endTime - startTime) : (video.duration - startTime);
  const totalDuration = Math.max(1, duration);

  // 3. Extract audio data if AudioEncoder is available
  if (onProgress) onProgress(12, 'Preparing audio tracks...');
  const hasAudioEncoder = typeof (window as any).AudioEncoder === 'function';
  let audioData: { channelData: Float32Array[]; sampleRate: number; numberOfChannels: number } | null = null;
  let audioCodec: 'aac' | 'opus' | null = null;
  let audioEncoderCodec = 'mp4a.40.2';
  const audioBitrate = 192000;

  if (hasAudioEncoder) {
    audioData = await extractAudioData(videoSourceUrl, startTime, totalDuration);
    if (audioData && audioData.channelData.length > 0 && audioData.channelData[0].length > 0) {
      try {
        const aacConfig = {
          codec: 'mp4a.40.2',
          numberOfChannels: audioData.numberOfChannels,
          sampleRate: audioData.sampleRate,
          bitrate: audioBitrate,
        };
        const aacSupport = await (window as any).AudioEncoder.isConfigSupported(aacConfig);
        if (aacSupport && aacSupport.supported) {
          audioCodec = 'aac';
          audioEncoderCodec = 'mp4a.40.2';
        } else {
          const opusConfig = {
            codec: 'opus',
            numberOfChannels: audioData.numberOfChannels,
            sampleRate: 48000,
            bitrate: audioBitrate,
          };
          const opusSupport = await (window as any).AudioEncoder.isConfigSupported(opusConfig);
          if (opusSupport && opusSupport.supported) {
            audioCodec = 'opus';
            audioEncoderCodec = 'opus';
          }
        }
      } catch (chkErr) {
        console.warn('[WebCodecs GPU] AudioEncoder config check warning:', chkErr);
        audioCodec = 'aac';
        audioEncoderCodec = 'mp4a.40.2';
      }
    }
  }

  // 4. Setup offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) throw new Error('Could not acquire 2D Canvas context');

  // 5. Setup MP4 Muxer with Video + optional Audio track
  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: 'avc',
      width: targetWidth,
      height: targetHeight
    },
    audio: (audioData && audioCodec) ? {
      codec: audioCodec,
      numberOfChannels: audioData.numberOfChannels,
      sampleRate: audioData.sampleRate,
    } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  // 6. Setup Hardware Accelerated VideoEncoder
  let encodeError: Error | null = null;
  const videoEncoder = new (window as any).VideoEncoder({
    output: (chunk: any, meta: any) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e: any) => {
      encodeError = e instanceof Error ? e : new Error(String(e));
      console.error('[WebCodecs GPU] VideoEncoder error:', e);
    }
  });

  const fps = 30;
  const bitrate = 8_500_000; // 8.5 Mbps crisp 1080p high quality

  // Check hardware acceleration support
  const encoderConfig = {
    codec: 'avc1.64002a', // H.264 High Profile Level 4.2
    width: targetWidth,
    height: targetHeight,
    bitrate,
    bitrateMode: 'variable' as const,
    latencyMode: 'quality' as const,
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware' as const,
  };

  try {
    const support = await (window as any).VideoEncoder.isConfigSupported(encoderConfig);
    if (support.supported) {
      videoEncoder.configure(encoderConfig);
    } else {
      videoEncoder.configure({
        ...encoderConfig,
        codec: 'avc1.42001f', // Baseline profile
      });
    }
  } catch (err) {
    console.warn('[WebCodecs GPU] Config check warning, proceeding with config:', err);
    videoEncoder.configure(encoderConfig);
  }

  // 7. Setup AudioEncoder and encode all audio packets if audio is present
  if (audioData && audioCodec && hasAudioEncoder) {
    let audioEncodeError: Error | null = null;
    let audioChunksCount = 0;

    try {
      const audioEncoder = new (window as any).AudioEncoder({
        output: (chunk: any, meta: any) => {
          audioChunksCount++;
          const chunkData = new Uint8Array(chunk.byteLength);
          chunk.copyTo(chunkData);
          const chunkDuration = (typeof chunk.duration === 'number' && Number.isFinite(chunk.duration) && chunk.duration >= 0)
            ? chunk.duration
            : Math.round((1024 / audioData!.sampleRate) * 1_000_000);
          muxer.addAudioChunkRaw(chunkData, chunk.type, chunk.timestamp, chunkDuration, meta);
        },
        error: (e: any) => {
          audioEncodeError = e instanceof Error ? e : new Error(String(e));
          console.warn('[WebCodecs GPU] AudioEncoder error:', e);
        }
      });

      audioEncoder.configure({
        codec: audioEncoderCodec,
        numberOfChannels: audioData.numberOfChannels,
        sampleRate: audioData.sampleRate,
        bitrate: audioBitrate,
      });

      // Encode audio chunks (1024 samples per frame)
      const chunkSize = 1024;
      const totalAudioFrames = audioData.channelData[0].length;
      for (let offset = 0; offset < totalAudioFrames; offset += chunkSize) {
        if (audioEncodeError) throw audioEncodeError;
        const end = Math.min(totalAudioFrames, offset + chunkSize);
        const length = end - offset;
        const timestampUs = Math.round((offset / audioData.sampleRate) * 1_000_000);

        const block = new Float32Array(length * audioData.numberOfChannels);
        for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
          block.set(audioData.channelData[ch].subarray(offset, end), ch * length);
        }

        const audioFrame = new (window as any).AudioData({
          format: 'f32-planar',
          sampleRate: audioData.sampleRate,
          numberOfFrames: length,
          numberOfChannels: audioData.numberOfChannels,
          timestamp: timestampUs,
          data: block
        });
        audioEncoder.encode(audioFrame);
        audioFrame.close();
      }

      await audioEncoder.flush();
      audioEncoder.close();

      if (audioEncodeError) throw audioEncodeError;
      if (audioChunksCount === 0) {
        throw new Error('No audio chunks were output by AudioEncoder.');
      }
      console.info(`[WebCodecs GPU] Successfully muxed ${audioChunksCount} audio frames with ${audioCodec.toUpperCase()}.`);
    } catch (aErr) {
      console.warn('[WebCodecs GPU] Audio encoding failure:', aErr);
      throw new Error(`WebCodecs audio encoding failed: ${aErr instanceof Error ? aErr.message : String(aErr)}`);
    }
  }

  if (onProgress) onProgress(18, 'Preparing fonts for canvas rendering...');
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      const tWeight = getFontWeightForFamily(titleFont);
      const sWeight = getFontWeightForFamily(captionFont);
      await Promise.allSettled([
        document.fonts.load(`${tWeight} 36px "${titleFont}"`),
        document.fonts.load(`${sWeight} 36px "${captionFont}"`),
        document.fonts.ready,
      ]);
    } catch (fontErr) {
      console.warn('[WebCodecs GPU] Font preload warning:', fontErr);
    }
  }

  if (onProgress) onProgress(20, 'Processing video frames with Client GPU...');

  // Frame stepping helper with safety timeout
  const seekTo = (time: number): Promise<void> => {
    return new Promise((resolve) => {
      let resolved = false;
      let timer: any = null;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        video.removeEventListener('error', finish);
        resolve();
      };

      video.addEventListener('seeked', finish);
      video.addEventListener('error', finish);
      timer = setTimeout(finish, 800);
      video.currentTime = time;
    });
  };

  const frameIntervalSec = 1 / fps;
  let currentSec = startTime;
  let frameIndex = 0;
  const totalFrames = Math.ceil(totalDuration * fps);

  // 8. Draw & Encode Loop
  while (currentSec < (startTime + totalDuration)) {
    if (encodeError) throw encodeError;

    await seekTo(currentSec);

    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Composite Background (blurred or black)
    if (backgroundStyle === 'blur' || backgroundStyle === 'blurred') {
      ctx.save();
      ctx.filter = 'blur(16px)';
      const scaleBg = Math.max(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
      const bgW = video.videoWidth * scaleBg;
      const bgH = video.videoHeight * scaleBg;
      ctx.drawImage(video, (targetWidth - bgW) / 2, (targetHeight - bgH) / 2, bgW, bgH);
      ctx.restore();
    }

    // Composite Foreground Video according to Aspect Ratio (100% parity with server NVENC engine)
    if (isLandscape) {
      // 16:9 Landscape: fit inside 1920x1080
      const scaleFg = Math.min(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
      const fgW = video.videoWidth * scaleFg;
      const fgH = video.videoHeight * scaleFg;
      const fgX = (targetWidth - fgW) / 2;
      const fgY = (targetHeight - fgH) / 2;
      ctx.drawImage(video, fgX, fgY, fgW, fgH);
    } else if (aspectRatio === '9:16') {
      // 9:16 Full Bleed Vertical: Crop to cover 1080x1920 full screen
      const scaleCover = Math.max(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
      const fgW = video.videoWidth * scaleCover;
      const fgH = video.videoHeight * scaleCover;
      const fgX = (targetWidth - fgW) / 2;
      const fgY = (targetHeight - fgH) / 2;
      ctx.drawImage(video, fgX, fgY, fgW, fgH);
    } else if (aspectRatio === '1:1') {
      // 1:1 Square on 1080x1920 vertical canvas: video is 1080x1080 centered at Y=420 (matching backend content_top=420)
      const squareSize = 1080;
      const scaleSquare = Math.max(squareSize / video.videoWidth, squareSize / video.videoHeight);
      const cropW = video.videoWidth * scaleSquare;
      const cropH = video.videoHeight * scaleSquare;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 420, squareSize, squareSize);
      ctx.clip();
      ctx.drawImage(video, (squareSize - cropW) / 2, 420 + (squareSize - cropH) / 2, cropW, cropH);
      ctx.restore();
    } else if (aspectRatio === '4:3') {
      // 4:3 on 1080x1920 vertical canvas: video is 1080x810 centered at Y=555 (matching backend content_top=555)
      const boxW = 1080;
      const boxH = 810;
      const scale43 = Math.max(boxW / video.videoWidth, boxH / video.videoHeight);
      const cropW = video.videoWidth * scale43;
      const cropH = video.videoHeight * scale43;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 555, boxW, boxH);
      ctx.clip();
      ctx.drawImage(video, (boxW - cropW) / 2, 555 + (boxH - cropH) / 2, cropW, cropH);
      ctx.restore();
    } else {
      // 16:9 Letterbox on 1080x1920 vertical canvas (Foto 1!): video is 1080x608 centered at Y=656
      const boxW = 1080;
      const boxH = 608;
      const scale169 = Math.min(boxW / video.videoWidth, boxH / video.videoHeight);
      const fgW = video.videoWidth * scale169;
      const fgH = video.videoHeight * scale169;
      const fgX = (targetWidth - fgW) / 2;
      const fgY = 656 + (boxH - fgH) / 2;
      ctx.drawImage(video, fgX, fgY, fgW, fgH);
    }

    const elapsedSec = currentSec - startTime;
    const captionTimestamp = (clipTimeOffset > 0 ? (clipTimeOffset + elapsedSec) : currentSec) - subtitleOffsetSeconds;

    // Draw Title Overlay
    drawTitleOnCanvas(
      ctx,
      titleText,
      targetWidth,
      targetHeight,
      titleYPercent,
      titleFont,
      titleFontSizePx,
      titleDuration,
      elapsedSec
    );

    // Draw Bouncing Subtitles Overlay (Strict check: only when subtitles are enabled and style is not none)
    const isSubtitleActive = Boolean(subtitlesEnabled) && captionStyle !== 'none' && Boolean(captionChunks?.length);
    if (isSubtitleActive) {
      drawCaptionsOnCanvas(
        ctx,
        captionChunks,
        captionTimestamp,
        targetWidth,
        targetHeight,
        captionStyle,
        captionFont,
        fontSizePx,
        subtitleYPercent,
        textCase,
        subtitlePositionMode,
        subtitleCenterYPercent
      );
    }

    // Create VideoFrame from Canvas and Encode
    const timestampUs = Math.round(frameIndex * (1_000_000 / fps));
    const frame = new (window as any).VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / fps)
    });

    const isKeyFrame = frameIndex % (fps * 2) === 0;
    videoEncoder.encode(frame, { keyFrame: isKeyFrame });
    frame.close();

    frameIndex++;
    currentSec += frameIntervalSec;

    if (frameIndex % 5 === 0) {
      const pct = Math.min(95, 20 + Math.round((frameIndex / totalFrames) * 75));
      if (onProgress) {
        onProgress(pct, `GPU rendering frame ${frameIndex}/${totalFrames} (${pct}%)...`);
      }
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (onProgress) onProgress(96, 'Finalizing video bitstream on GPU...');
  await videoEncoder.flush();
  videoEncoder.close();

  if (encodeError) throw encodeError;

  if (onProgress) onProgress(98, 'Muxing MP4 container...');
  muxer.finalize();

  const buffer = muxerTarget.buffer;
  const blob = new Blob([buffer], { type: 'video/mp4' });

  if (onProgress) onProgress(100, 'Rendering Complete!');
  return blob;
}
