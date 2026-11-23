import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegInstance: FFmpeg | null = null;
let isLoaded = false;
let loadPromise: Promise<FFmpeg> | null = null;

export interface ClientRenderOptions {
  videoSourceUrl: string; // URL or Blob URL of the source clip
  startTime?: number;
  endTime?: number;
  aspectRatio: '9:16' | '1:1' | '16:9' | '4:5' | '4:3' | '16:9_landscape';
  backgroundStyle: 'blur' | 'black' | 'fit' | 'crop' | 'blurred';
  titleText?: string;
  titlePosition?: 'top' | 'center' | 'bottom';
  subtitles?: Array<{ start: number; end: number; text: string }>;
  streamerPreset?: 'none' | 'split_top_cam' | 'pip_corner';
  facecamPosition?: string;
  faceBox?: { found?: boolean; cx: number; cy: number; w?: number; h?: number };
  cropXPercent?: number;
  fileName?: string;
  onProgress?: (percent: number, stage: string) => void;
}

/**
 * Initializes and loads FFmpeg WebAssembly instance in browser worker with fallback.
 */
export async function getFFmpeg(onLoadProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (ffmpegInstance && isLoaded) {
    return ffmpegInstance;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      console.debug('[FFmpeg-WASM]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
      if (onLoadProgress) {
        onLoadProgress(pct);
      }
    });

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      isLoaded = true;
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    } catch (err) {
      console.warn('Primary ESM FFmpeg WASM load failed, trying standard core fallback...', err);
      const fallbackBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${fallbackBase}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${fallbackBase}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      isLoaded = true;
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    }
  })();

  return loadPromise;
}

/**
 * Renders a video clip directly in the client's browser using WebAssembly.
 * Fully offloads CPU computation from the server with 100% parity for streamer facecam & aspect ratios.
 */
export async function renderClipClientSide(options: ClientRenderOptions): Promise<Blob> {
  const {
    videoSourceUrl,
    startTime = 0,
    endTime,
    aspectRatio = '9:16',
    backgroundStyle = 'blur',
    streamerPreset = 'none',
    facecamPosition = 'auto',
    faceBox,
    cropXPercent,
    onProgress
  } = options;

  if (onProgress) onProgress(5, 'Loading Client-Side Engine (WASM)...');
  const ffmpeg = await getFFmpeg((ratio) => {
    if (onProgress) onProgress(Math.min(25, 5 + Math.round(ratio * 0.2)), 'Initializing WASM core...');
  });

  if (onProgress) onProgress(28, 'Fetching video stream to browser memory...');
  const inputData = await fetchFile(videoSourceUrl);
  await ffmpeg.writeFile('input.mp4', inputData);

  // Determine face coordinates for streamer facecam & smart crop
  const isStreamer = streamerPreset === 'split_top_cam' || streamerPreset === 'pip_corner';
  let defaultCx = isStreamer ? 0.85 : 0.50;
  let defaultCy = isStreamer ? 0.78 : 0.35;
  const pos = (facecamPosition || 'auto').toLowerCase().trim();
  if (pos === 'bottom_right') { defaultCx = 0.85; defaultCy = 0.78; }
  else if (pos === 'top_right') { defaultCx = 0.85; defaultCy = 0.22; }
  else if (pos === 'bottom_left') { defaultCx = 0.16; defaultCy = 0.78; }
  else if (pos === 'top_left') { defaultCx = 0.16; defaultCy = 0.22; }
  else if (pos === 'center') { defaultCx = 0.50; defaultCy = 0.50; }
  else if (pos === 'left') { defaultCx = 0.28; defaultCy = 0.35; }
  else if (pos === 'right') { defaultCx = 0.72; defaultCy = 0.35; }

  let face_cx = defaultCx;
  let face_cy = defaultCy;
  if (faceBox && typeof faceBox.cx === 'number') {
    face_cx = faceBox.cx;
    if (typeof faceBox.cy === 'number') face_cy = faceBox.cy;
  } else if (cropXPercent !== undefined) {
    face_cx = Math.max(0.05, Math.min(0.95, cropXPercent / 100));
  }
  face_cx = Math.max(0.08, Math.min(0.92, face_cx));
  face_cy = Math.max(0.08, Math.min(0.92, face_cy));

  // Construct FFmpeg filters based on aspect ratio, streamer presets, and background style
  let filterStr = '';
  let targetWidth = 1080;
  let targetHeight = 1920;

  const recentLogs: string[] = [];
  let lastFfmpegLog = '';
  const logHandler = ({ message }: { message: string }) => {
    lastFfmpegLog = message;
    recentLogs.push(message);
    if (recentLogs.length > 25) recentLogs.shift();
    console.debug('[FFmpeg-WASM-Exec]', message);
  };
  ffmpeg.on('log', logHandler);

  const isBlurred = (backgroundStyle === 'blur' || backgroundStyle === 'blurred');

  if (streamerPreset === 'split_top_cam') {
    if (aspectRatio === '16:9') {
      filterStr = `[0:v]split=2[cam_raw][game_raw];` +
        `[cam_raw]crop=min(iw\\,ih*0.38*16/9):min(ih\\,ih*0.38):max(0\\,min(iw-ow\\,iw*${face_cx.toFixed(3)}-ow/2)):max(0\\,min(ih-oh\\,ih*${face_cy.toFixed(3)}-oh/2)),scale=1080:608[cam_box];` +
        `[game_raw]crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16):(iw-min(iw\\,ih*16/9))/2:(ih-min(ih\\,iw*9/16))/2,scale=1080:608[game_box];` +
        `[cam_box][game_box]vstack=inputs=2[both_split];` +
        (isBlurred
          ? `[0:v]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=1080:1920[bg];[bg][both_split]overlay=0:352[v]`
          : `[both_split]pad=1080:1920:0:352:black[v]`);
    } else if (aspectRatio === '1:1') {
      filterStr = `[0:v]split=2[cam_raw][game_raw];` +
        `[cam_raw]crop=min(iw\\,ih*0.38):min(ih\\,ih*0.38):max(0\\,min(iw-ow\\,iw*${face_cx.toFixed(3)}-ow/2)):max(0\\,min(ih-oh\\,ih*${face_cy.toFixed(3)}-oh/2)),scale=960:960[cam_box];` +
        `[game_raw]crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(ih\\,iw))/2,scale=960:960[game_box];` +
        `[cam_box][game_box]vstack=inputs=2[both_split];` +
        (isBlurred
          ? `[0:v]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=1080:1920[bg];[bg][both_split]overlay=60:0[v]`
          : `[both_split]pad=1080:1920:60:0:black[v]`);
    } else if (aspectRatio === '4:3') {
      filterStr = `[0:v]split=2[cam_raw][game_raw];` +
        `[cam_raw]crop=min(iw\\,ih*0.38*4/3):min(ih\\,ih*0.38):max(0\\,min(iw-ow\\,iw*${face_cx.toFixed(3)}-ow/2)):max(0\\,min(ih-oh\\,ih*${face_cy.toFixed(3)}-oh/2)),scale=1080:810[cam_box];` +
        `[game_raw]crop=min(iw\\,ih*4/3):min(ih\\,iw*3/4):(iw-min(iw\\,ih*4/3))/2:(ih-min(ih\\,iw*3/4))/2,scale=1080:810[game_box];` +
        `[cam_box][game_box]vstack=inputs=2[both_split];` +
        (isBlurred
          ? `[0:v]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=1080:1920[bg];[bg][both_split]overlay=0:150[v]`
          : `[both_split]pad=1080:1920:0:150:black[v]`);
    } else {
      // 9:16 Full Bleed Vertical Split
      filterStr = `[0:v]split=2[cam_raw][game_raw];` +
        `[cam_raw]crop=min(iw\\,ih*0.38*4/3):min(ih\\,ih*0.38):max(0\\,min(iw-ow\\,iw*${face_cx.toFixed(3)}-ow/2)):max(0\\,min(ih-oh\\,ih*${face_cy.toFixed(3)}-oh/2)),scale=1080:810[cam_box];` +
        `[game_raw]crop=min(iw\\,ih*1080/1110):ih:(iw-ow)/2:(ih-oh)/2,scale=1080:1110[game_box];` +
        `[cam_box][game_box]vstack=inputs=2[v]`;
    }
  } else if (streamerPreset === 'pip_corner') {
    const pipCrop = `crop=min(iw\\,ih*0.35*4/3):min(ih\\,ih*0.35):max(0\\,min(iw-ow\\,iw*${face_cx.toFixed(3)}-ow/2)):max(0\\,min(ih-oh\\,ih*${face_cy.toFixed(3)}-oh/2)),scale=320:240`;
    if (aspectRatio === '16:9_landscape') {
      targetWidth = 1920;
      targetHeight = 1080;
      filterStr = `[0:v]split=2[main_raw][pip_raw];` +
        `[main_raw]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black[main_base];` +
        `[pip_raw]${pipCrop}[pip_box];` +
        `[main_base][pip_box]overlay=x=1550:y=780[v]`;
    } else if (aspectRatio === '1:1') {
      filterStr = `[0:v]split=3[bg_raw][main_raw][pip_raw];` +
        (isBlurred
          ? `[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=1080:1920[bg];` +
            `[main_raw]crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(ih\\,iw))/2,scale=1080:1080[fg];` +
            `[bg][fg]overlay=0:420[main_base];`
          : `[main_raw]crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(ih\\,iw))/2,scale=1080:1080,pad=1080:1920:0:420:black[main_base];`) +
        `[pip_raw]${pipCrop}[pip_box];` +
        `[main_base][pip_box]overlay=x=736:y=444[v]`;
    } else if (aspectRatio === '4:3') {
      filterStr = `[0:v]split=3[bg_raw][main_raw][pip_raw];` +
        (isBlurred
          ? `[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=1080:1920[bg];` +
            `[main_raw]crop=min(iw\\,ih*4/3):min(ih\\,iw*3/4):(iw-min(iw\\,ih*4/3))/2:(ih-min(ih\\,iw*3/4))/2,scale=1080:810[fg];` +
            `[bg][fg]overlay=0:555[main_base];`
          : `[main_raw]crop=min(iw\\,ih*4/3):min(ih\\,iw*3/4):(iw-min(iw\\,ih*4/3))/2:(ih-min(ih\\,iw*3/4))/2,scale=1080:810,pad=1080:1920:0:555:black[main_base];`) +
        `[pip_raw]${pipCrop}[pip_box];` +
        `[main_base][pip_box]overlay=x=736:y=579[v]`;
    } else if (aspectRatio === '16:9') {
      filterStr = `[0:v]split=3[bg_raw][main_raw][pip_raw];` +
        (isBlurred
          ? `[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=1080:1920[bg];` +
            `[main_raw]crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16):(iw-min(iw\\,ih*16/9))/2:(ih-min(ih\\,iw*9/16))/2,scale=1080:608[fg];` +
            `[bg][fg]overlay=0:656[main_base];`
          : `[main_raw]crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16):(iw-min(iw\\,ih*16/9))/2:(ih-min(ih\\,iw*9/16))/2,scale=1080:608,pad=1080:1920:0:656:black[main_base];`) +
        `[pip_raw]${pipCrop}[pip_box];` +
        `[main_base][pip_box]overlay=x=736:y=676[v]`;
    } else {
      // 9:16 PIP
      filterStr = `[0:v]split=2[main_raw][pip_raw];` +
        `[main_raw]crop=min(iw\\,ih*9/16):ih:max(0\\,min(iw-ow\\,iw*${face_cx.toFixed(3)}-ow/2)):(ih-oh)/2,scale=1080:1920[main_base];` +
        `[pip_raw]${pipCrop}[pip_box];` +
        `[main_base][pip_box]overlay=x=736:y=1400[v]`;
    }
  } else if (aspectRatio === '16:9_landscape') {
    targetWidth = 1920;
    targetHeight = 1080;
    filterStr = `[0:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black[v]`;
  } else if (aspectRatio === '9:16') {
    targetWidth = 1080;
    targetHeight = 1920;
    if (isBlurred) {
      filterStr = `[0:v]split=2[in_bg][in_fg];[in_bg]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=${targetWidth}:${targetHeight}[bg];[in_fg]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[v]`;
    } else if (backgroundStyle === 'black') {
      filterStr = `[0:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black[v]`;
    } else {
      // Face-tracking horizontal crop
      filterStr = `[0:v]crop=ih*9/16:ih:max(0\\,min(iw-ow\\,iw*${face_cx.toFixed(3)}-ow/2)):(ih-oh)/2,scale=${targetWidth}:${targetHeight}[v]`;
    }
  } else if (aspectRatio === '1:1') {
    targetWidth = 1080;
    targetHeight = 1920;
    if (isBlurred) {
      filterStr = `[0:v]split=2[in_bg][in_fg];[in_bg]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=${targetWidth}:${targetHeight}[bg];[in_fg]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080[fg];[bg][fg]overlay=0:420:shortest=1[v]`;
    } else {
      filterStr = `[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080[fg];[fg]pad=1080:1920:0:420:black[v]`;
    }
  } else if (aspectRatio === '4:3') {
    targetWidth = 1080;
    targetHeight = 1920;
    if (isBlurred) {
      filterStr = `[0:v]split=2[in_bg][in_fg];[in_bg]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=${targetWidth}:${targetHeight}[bg];[in_fg]scale=1080:810:force_original_aspect_ratio=increase,crop=1080:810[fg];[bg][fg]overlay=0:555:shortest=1[v]`;
    } else {
      filterStr = `[0:v]scale=1080:810:force_original_aspect_ratio=increase,crop=1080:810[fg];[fg]pad=1080:1920:0:555:black[v]`;
    }
  } else {
    // 16:9 Letterbox on 1080x1920 vertical canvas
    targetWidth = 1080;
    targetHeight = 1920;
    if (isBlurred) {
      filterStr = `[0:v]split=2[in_bg][in_fg];[in_bg]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=8:2,scale=${targetWidth}:${targetHeight}[bg];[in_fg]scale=1080:608:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=0:656:shortest=1[v]`;
    } else {
      filterStr = `[0:v]scale=1080:608:force_original_aspect_ratio=decrease[fg];[fg]pad=1080:1920:0:656:black[v]`;
    }
  }

  const outputName = 'output.mp4';
  const ffmpegArgs: string[] = ['-i', 'input.mp4'];

  if (startTime > 0) {
    ffmpegArgs.unshift('-ss', startTime.toFixed(2));
  }
  if (endTime && endTime > startTime) {
    ffmpegArgs.push('-t', (endTime - startTime).toFixed(2));
  }

  // Engage hardware threads automatically instead of locking to single thread
  ffmpegArgs.push(
    '-filter_complex', filterStr,
    '-map', '[v]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-threads', '0',
    '-pix_fmt', 'yuv420p',
    '-crf', '25',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-max_muxing_queue_size', '2048',
    '-movflags', '+faststart',
    outputName
  );

  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.min(98, 30 + Math.round(progress * 68));
    if (onProgress) {
      onProgress(pct, `Rendering on your device GPU/CPU (${pct}%)...`);
    }
  });

  if (onProgress) onProgress(35, 'Encoding video on client browser WASM engine...');
  try {
    const exitCode = await ffmpeg.exec(ffmpegArgs);
    if (exitCode !== 0) {
      const errDetails = recentLogs.slice(-5).join('; ') || lastFfmpegLog || 'Encoding error';
      throw new Error(`FFmpeg WASM exited with code ${exitCode}. Details: ${errDetails}`);
    }
  } catch (err: any) {
    console.error('FFmpeg WASM execution error:', err, 'Recent logs:', recentLogs);
    const errDetails = recentLogs.slice(-5).join('; ') || err?.message || lastFfmpegLog || 'Browser WASM engine memory limit exceeded';
    throw new Error(errDetails);
  } finally {
    try {
      ffmpeg.off('log', logHandler);
    } catch {
      // Ignore
    }
  }

  if (onProgress) onProgress(99, 'Extracting rendered MP4 file...');
  const outputData = await ffmpeg.readFile(outputName);
  const blob = new Blob([outputData as any], { type: 'video/mp4' });

  // Cleanup virtual files to free WASM memory
  try {
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile(outputName);
  } catch {
    // Ignore cleanup
  }

  if (onProgress) onProgress(100, 'Rendering Complete!');
  return blob;
}

/**
 * Helper to trigger automatic download of a Blob file in the user's browser.
 */
export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
