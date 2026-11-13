import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface WebCodecsRenderOptions {
  videoSourceUrl: string;
  startTime?: number;
  endTime?: number;
  aspectRatio: '9:16' | '1:1' | '16:9' | '4:5' | '4:3';
  backgroundStyle: 'blur' | 'black' | 'fit' | 'crop';
  titleText?: string;
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

  // 1. Check for NVIDIA pattern: e.g. "NVIDIA GeForce RTX 3060 Ti (0x00002489) Direct3D11..."
  const nvidiaMatch = raw.match(/(?:NVIDIA\s+)?(GeForce\s+(?:RTX|GTX|GT|MX)\s+[A-Za-z0-9\s]+?)(?=\s+(?:\(0x|Direct3D|vs_|ps_|OpenGL|Vulkan|\)|$|,))/i);
  if (nvidiaMatch) {
    const model = nvidiaMatch[1].replace(/\s*\([0-9a-fxX]+\)/gi, '').trim();
    return `NVIDIA ${model.replace(/^GeForce/i, 'GeForce')}`;
  }

  // 2. Check for AMD / Radeon pattern: e.g. "AMD Radeon RX 7900 XTX"
  const amdMatch = raw.match(/(?:AMD\s+)?(Radeon\s+(?:RX|PRO|Vega|\(TM\))?\s*[A-Za-z0-9\s]+?)(?=\s+(?:\(0x|Direct3D|vs_|ps_|OpenGL|Vulkan|\)|$|,))/i);
  if (amdMatch) {
    const model = amdMatch[1].replace(/\s*\([0-9a-fxX]+\)/gi, '').trim();
    return `AMD ${model.replace(/^Radeon/i, 'Radeon')}`;
  }

  // 3. Check for Intel Arc / Iris / UHD: e.g. "Intel Arc A770", "Intel(R) UHD Graphics 630"
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
  // Strip PCI vendor / device IDs like (0x00002489)
  clean = clean.replace(/\s*\([0-9a-fxX]+\)/gi, '');
  // Strip Direct3D, vs_, ps_, OpenGL, Vulkan, D3D suffixes
  clean = clean.split(' Direct3D')[0].split(' vs_')[0].split(' OpenGL')[0].split(' Vulkan')[0].split(' D3D')[0].trim();
  return clean || 'Hardware GPU';
}

/**
 * Renders a video clip client-side using WebCodecs hardware encoder and mp4-muxer.
 * 0% Server CPU, leverages client GPU encoder chip natively.
 */
export async function renderClipWebCodecs(options: WebCodecsRenderOptions): Promise<Blob> {
  const {
    videoSourceUrl,
    startTime = 0,
    endTime,
    aspectRatio = '9:16',
    backgroundStyle = 'blur',
    onProgress
  } = options;

  if (!isWebCodecsGpuSupported()) {
    throw new Error('WebCodecs Hardware API is not supported in this browser.');
  }

  if (onProgress) onProgress(5, 'Initializing Client GPU Hardware Encoder...');

  // Setup target dimensions
  let targetWidth = 1080;
  let targetHeight = 1920;

  if (aspectRatio === '9:16') {
    targetWidth = 1080;
    targetHeight = 1920;
  } else if (aspectRatio === '4:3') {
    targetWidth = 1440;
    targetHeight = 1080;
  } else if (aspectRatio === '1:1') {
    targetWidth = 1080;
    targetHeight = 1080;
  } else if (aspectRatio === '4:5') {
    targetWidth = 1080;
    targetHeight = 1350;
  } else {
    // 16:9 Landscape
    targetWidth = 1920;
    targetHeight = 1080;
  }

  // Load video element to inspect metadata and extract frames
  if (onProgress) onProgress(10, 'Loading media source into GPU canvas pipeline...');
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

  // Setup offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) throw new Error('Could not acquire 2D Canvas context');

  // Setup MP4 Muxer
  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: 'avc',
      width: targetWidth,
      height: targetHeight
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  // Setup Hardware Accelerated VideoEncoder
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
  const bitrate = 4_500_000; // 4.5 Mbps crisp 1080p

  // Check hardware acceleration support
  const encoderConfig = {
    codec: 'avc1.640028', // H.264 High Profile Level 4.0
    width: targetWidth,
    height: targetHeight,
    bitrate,
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware' as const,
  };

  try {
    const support = await (window as any).VideoEncoder.isConfigSupported(encoderConfig);
    if (support.supported) {
      videoEncoder.configure(encoderConfig);
    } else {
      // Fallback to baseline profile
      videoEncoder.configure({
        ...encoderConfig,
        codec: 'avc1.42001f', // Baseline profile
      });
    }
  } catch (err) {
    console.warn('[WebCodecs GPU] Config check warning, proceeding with config:', err);
    videoEncoder.configure(encoderConfig);
  }

  if (onProgress) onProgress(20, `Processing frames on GPU (${getClientGpuName()})...`);

  // Frame stepping helper with safety timeout to avoid hanging indefinitely
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

  // Draw & Encode Loop
  while (currentSec < (startTime + totalDuration)) {
    if (encodeError) throw encodeError;

    await seekTo(currentSec);

    // Composite Frame to Canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    if (backgroundStyle === 'blur') {
      ctx.save();
      ctx.filter = 'blur(16px)';
      // Draw background scaled to fill
      const scaleBg = Math.max(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
      const bgW = video.videoWidth * scaleBg;
      const bgH = video.videoHeight * scaleBg;
      ctx.drawImage(video, (targetWidth - bgW) / 2, (targetHeight - bgH) / 2, bgW, bgH);
      ctx.restore();
    }

    // Draw main foreground video fitted with original aspect ratio
    const scaleFg = Math.min(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
    const fgW = video.videoWidth * scaleFg;
    const fgH = video.videoHeight * scaleFg;
    const fgX = (targetWidth - fgW) / 2;
    const fgY = (targetHeight - fgH) / 2;
    ctx.drawImage(video, fgX, fgY, fgW, fgH);

    // Create VideoFrame from Canvas
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
      // Yield to avoid blocking browser main loop
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
