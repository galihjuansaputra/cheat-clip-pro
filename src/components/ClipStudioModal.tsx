import React, { useState } from 'react';
import type {
  ViralClip,
  RenderSettings,
  AspectRatioOption,
  BackgroundStyle,
  CaptionStyle,
  CaptionFont,
  TitlePosition,
  StreamerPreset,
  FontSizeOption,
  TextCaseOption
} from '../types';

interface ClipStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  markedClips: ViralClip[];
  allClips: ViralClip[];
  onStartRender: (settings: RenderSettings) => void;
  isRendering: boolean;
}

export const ClipStudioModal: React.FC<ClipStudioModalProps> = ({
  isOpen,
  onClose,
  markedClips,
  allClips,
  onStartRender,
  isRendering,
}) => {
  // Default to marked clips if any, otherwise all clips
  const initialClips = markedClips.length > 0 ? markedClips : allClips.slice(0, 3);
  
  const [selectedClips, setSelectedClips] = useState<ViralClip[]>(initialClips);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('1:1');
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>('black');
  const [enableFaceTracking, setEnableFaceTracking] = useState<boolean>(true);
  const [streamerPreset, setStreamerPreset] = useState<StreamerPreset>('none');
  const [titleText, setTitleText] = useState<string>('');
  const [titlePosition, setTitlePosition] = useState<TitlePosition>('auto');
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('viral_pop');
  const [captionFont, setCaptionFont] = useState<CaptionFont>('Outfit');
  const [fontSize, setFontSize] = useState<FontSizeOption>('medium');
  const [textCase, setTextCase] = useState<TextCaseOption>('uppercase');

  if (!isOpen) return null;

  const toggleClip = (clip: ViralClip) => {
    if (selectedClips.some(c => c.start_time === clip.start_time && c.end_time === clip.end_time)) {
      if (selectedClips.length > 1) {
        setSelectedClips(selectedClips.filter(c => !(c.start_time === clip.start_time && c.end_time === clip.end_time)));
      }
    } else {
      setSelectedClips([...selectedClips, clip]);
    }
  };

  const handleLaunch = () => {
    onStartRender({
      aspectRatio,
      backgroundStyle,
      enableFaceTracking,
      streamerPreset,
      titleText,
      titlePosition,
      captionStyle,
      captionFont,
      fontSize,
      textCase,
      selectedClips
    });
  };

  const applyLetterCase = (text: string, style: TextCaseOption): string => {
    if (style === 'uppercase') return text.toUpperCase();
    if (style === 'lowercase') return text.toLowerCase();
    return text.replace(/\b\w/g, c => c.toUpperCase());
  };

  const formatTitlePreview = (rawText: string, style: TextCaseOption): string => {
    const text = applyLetterCase(rawText, style);
    if (text.length > 24) {
      const mid = Math.floor(text.length / 2);
      const leftSpace = text.lastIndexOf(' ', mid);
      const rightSpace = text.indexOf(' ', mid);
      let splitIdx = -1;
      if (leftSpace !== -1 && rightSpace !== -1) {
        splitIdx = (mid - leftSpace < rightSpace - mid) ? leftSpace : rightSpace;
      } else if (leftSpace !== -1) {
        splitIdx = leftSpace;
      } else if (rightSpace !== -1) {
        splitIdx = rightSpace;
      }
      if (splitIdx !== -1) {
        return text.substring(0, splitIdx) + '\n' + text.substring(splitIdx + 1);
      }
    }
    return text;
  };

  // Preview dimensions for the 9:16 smartphone mock
  const phoneWidth = 240;
  const phoneHeight = (phoneWidth * 16) / 9; // 426.6px

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="studio-modal-card" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="studio-modal-header">
          <div className="studio-header-title">
            <div className="studio-icon-badge">🎬</div>
            <div>
              <div className="studio-title-row">
                <h2>Cheat Clip Auto Clipper</h2>
                <span className="pro-badge">PRO</span>
              </div>
              <p className="studio-header-desc">
                Frame vertical 9:16 formats, customize captions & titles, and batch render ready-to-post clips
              </p>
            </div>
          </div>
          <button className="studio-close-btn" onClick={onClose} disabled={isRendering}>
            ✕
          </button>
        </div>

        {/* Studio Content Grid */}
        <div className="studio-content-grid">
          {/* Controls Column */}
          <div className="studio-controls-col">
            {/* 1. Aspect Ratio */}
            <div className="studio-section">
              <label className="studio-label">
                <span>📐 Canvas & Inner Aspect Ratio</span>
                <span className="studio-tag">9:16 Vertical Container</span>
              </label>
              <div className="aspect-options-grid">
                <button
                  type="button"
                  className={`aspect-card-btn ${aspectRatio === '9:16' ? 'active' : ''}`}
                  onClick={() => setAspectRatio('9:16')}
                >
                  <div className="aspect-icon-box ratio-916"></div>
                  <span className="aspect-name">9:16 Full</span>
                  <span className="aspect-sub">Full bleed crop</span>
                </button>

                <button
                  type="button"
                  className={`aspect-card-btn ${aspectRatio === '1:1' ? 'active' : ''}`}
                  onClick={() => setAspectRatio('1:1')}
                >
                  <div className="aspect-icon-box ratio-11"></div>
                  <span className="aspect-name">1:1 Square</span>
                  <span className="aspect-sub">Top & bottom bars</span>
                </button>

                <button
                  type="button"
                  className={`aspect-card-btn ${aspectRatio === '4:3' ? 'active' : ''}`}
                  onClick={() => setAspectRatio('4:3')}
                >
                  <div className="aspect-icon-box ratio-43"></div>
                  <span className="aspect-name">4:3 Standard</span>
                  <span className="aspect-sub">Classic video ratio</span>
                </button>

                <button
                  type="button"
                  className={`aspect-card-btn ${aspectRatio === '16:9' ? 'active' : ''}`}
                  onClick={() => setAspectRatio('16:9')}
                >
                  <div className="aspect-icon-box ratio-169"></div>
                  <span className="aspect-name">16:9 Letterbox</span>
                  <span className="aspect-sub">Original wide ratio</span>
                </button>
              </div>

              {/* Background Style when bars are active */}
              {aspectRatio !== '9:16' && (
                <div className="studio-sub-toggle">
                  <span className="sub-toggle-label">Margin Backdrop:</span>
                  <div className="toggle-pill-group">
                    <button
                      type="button"
                      className={`pill-btn ${backgroundStyle === 'black' ? 'active' : ''}`}
                      onClick={() => setBackgroundStyle('black')}
                    >
                      ⬛ Pure Black Bars
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${backgroundStyle === 'blurred' ? 'active' : ''}`}
                      onClick={() => setBackgroundStyle('blurred')}
                    >
                      ✨ Ambient Blurred Video
                    </button>
                  </div>
                </div>
              )}

              {/* Face tracking toggle for 9:16 */}
              {aspectRatio === '9:16' && (
                <div className="studio-checkbox-row">
                  <input
                    type="checkbox"
                    id="faceTracking"
                    checked={enableFaceTracking}
                    onChange={e => setEnableFaceTracking(e.target.checked)}
                  />
                  <label htmlFor="faceTracking">
                    <strong>AI Active Speaker Centering:</strong> Automatically pan camera to center faces in 9:16 crop.
                  </label>
                </div>
              )}
            </div>

            {/* 2. Streamer Facecam Presets */}
            <div className="studio-section">
              <label className="studio-label">
                <span>🎮 Streamer & Gaming Facecam Layout</span>
              </label>
              <div className="streamer-presets-row">
                <button
                  type="button"
                  className={`streamer-btn ${streamerPreset === 'none' ? 'active' : ''}`}
                  onClick={() => setStreamerPreset('none')}
                >
                  Standard (Single Video)
                </button>
                <button
                  type="button"
                  className={`streamer-btn ${streamerPreset === 'split_top_cam' ? 'active' : ''}`}
                  onClick={() => setStreamerPreset('split_top_cam')}
                >
                  📷 Top Facecam / Bottom Gameplay
                </button>
                <button
                  type="button"
                  className={`streamer-btn ${streamerPreset === 'pip_corner' ? 'active' : ''}`}
                  onClick={() => setStreamerPreset('pip_corner')}
                >
                  📌 Corner Picture-in-Picture
                </button>
              </div>
            </div>

            {/* 3. Title / Hook Banner */}
            <div className="studio-section">
              <label className="studio-label">
                <span>🏷️ Headline Hook / Title Banner</span>
                <span className="studio-tag" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
                  {aspectRatio === '9:16' ? 'Position: 4:3 Upper Edge' : 'On Top of Content'}
                </span>
              </label>
              <div className="title-inputs-row">
                <input
                  type="text"
                  className="studio-text-input"
                  placeholder="Leave empty to use AI suggested hook title..."
                  value={titleText}
                  onChange={e => setTitleText(e.target.value)}
                />
                <select
                  className="studio-select"
                  value={titlePosition}
                  onChange={e => setTitlePosition(e.target.value as TitlePosition)}
                >
                  <option value="auto">Top of Content Edge</option>
                  <option value="none">No Title Banner</option>
                </select>
              </div>
            </div>

            {/* 4. Subtitle Style & Font */}
            <div className="studio-section">
              <label className="studio-label">
                <span>💬 Animated Word-Level Subtitles</span>
                <span className="studio-tag" style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }}>
                  Strictly 1 Line
                </span>
              </label>
              <div className="caption-styles-grid">
                <button
                  type="button"
                  className={`caption-style-card viral-pop ${captionStyle === 'viral_pop' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('viral_pop')}
                >
                  <div className="caption-preview-text">
                    VIRAL <span className="pop-yellow">POP</span>
                  </div>
                  <span className="caption-style-sub">Hormozi Yellow Glow</span>
                </button>

                <button
                  type="button"
                  className={`caption-style-card beast-punch ${captionStyle === 'beast_punch' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('beast_punch')}
                >
                  <div className="caption-preview-text">
                    BEAST <span className="pop-green">PUNCH</span>
                  </div>
                  <span className="caption-style-sub">High Impact Green</span>
                </button>

                <button
                  type="button"
                  className={`caption-style-card cyber-violet ${captionStyle === 'cyber_violet' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('cyber_violet')}
                >
                  <div className="caption-preview-text">
                    CYBER <span className="pop-violet">VIOLET</span>
                  </div>
                  <span className="caption-style-sub">Neon Purple Glow</span>
                </button>

                <button
                  type="button"
                  className={`caption-style-card fire-red ${captionStyle === 'fire_red' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('fire_red')}
                >
                  <div className="caption-preview-text">
                    FIRE <span className="pop-red">CRIMSON</span>
                  </div>
                  <span className="caption-style-sub">High Energy Red</span>
                </button>

                <button
                  type="button"
                  className={`caption-style-card electric-cyan ${captionStyle === 'electric_cyan' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('electric_cyan')}
                >
                  <div className="caption-preview-text">
                    ELECTRIC <span className="pop-cyan">CYAN</span>
                  </div>
                  <span className="caption-style-sub">Ice Blue Glow</span>
                </button>

                <button
                  type="button"
                  className={`caption-style-card golden-aura ${captionStyle === 'golden_aura' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('golden_aura')}
                >
                  <div className="caption-preview-text">
                    GOLDEN <span className="pop-gold">AURA</span>
                  </div>
                  <span className="caption-style-sub">Luxury Warm Gold</span>
                </button>

                <button
                  type="button"
                  className={`caption-style-card clean-minimal ${captionStyle === 'clean_minimal' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('clean_minimal')}
                >
                  <div className="caption-preview-text">
                    <span className="pill-badge">Clean Minimal</span>
                  </div>
                  <span className="caption-style-sub">Soft Dark Box</span>
                </button>

                <button
                  type="button"
                  className={`caption-style-card none ${captionStyle === 'none' ? 'active' : ''}`}
                  onClick={() => setCaptionStyle('none')}
                >
                  <div className="caption-preview-text">✕ NONE</div>
                  <span className="caption-style-sub">Burn No Captions</span>
                </button>
              </div>

              {captionStyle !== 'none' && (
                <>
                  <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                    <span className="sub-toggle-label">Font Family:</span>
                    <div className="toggle-pill-group" style={{ flexWrap: 'wrap' }}>
                      {(
                        [
                          'Outfit',
                          'Montserrat',
                          'Inter',
                          'Impact',
                          'Bebas Neue',
                          'Anton',
                          'Poppins',
                          'Arial Black',
                        ] as CaptionFont[]
                      ).map(font => (
                        <button
                          key={font}
                          type="button"
                          className={`pill-btn ${captionFont === font ? 'active' : ''}`}
                          onClick={() => setCaptionFont(font)}
                          style={{ fontFamily: font, fontSize: '0.78rem' }}
                        >
                          {font}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font Size Presets */}
                  <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                    <span className="sub-toggle-label">Font Size:</span>
                    <div className="toggle-pill-group">
                      <button
                        type="button"
                        className={`pill-btn ${fontSize === 'small' ? 'active' : ''}`}
                        onClick={() => setFontSize('small')}
                      >
                        Small (36px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${fontSize === 'medium' ? 'active' : ''}`}
                        onClick={() => setFontSize('medium')}
                      >
                        Medium (44px)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${fontSize === 'big' ? 'active' : ''}`}
                        onClick={() => setFontSize('big')}
                      >
                        Big (54px)
                      </button>
                    </div>
                  </div>

                  {/* Text Letter Style Presets */}
                  <div className="studio-sub-toggle" style={{ marginTop: '0.75rem' }}>
                    <span className="sub-toggle-label">Letter Style:</span>
                    <div className="toggle-pill-group">
                      <button
                        type="button"
                        className={`pill-btn ${textCase === 'uppercase' ? 'active' : ''}`}
                        onClick={() => setTextCase('uppercase')}
                      >
                        ABC (Caps)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${textCase === 'capitalize' ? 'active' : ''}`}
                        onClick={() => setTextCase('capitalize')}
                      >
                        Abc (Title)
                      </button>
                      <button
                        type="button"
                        className={`pill-btn ${textCase === 'lowercase' ? 'active' : ''}`}
                        onClick={() => setTextCase('lowercase')}
                      >
                        abc (Lower)
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 5. Selected Clips Picker */}
            <div className="studio-section">
              <label className="studio-label">
                <span>🎞️ Select Clips for Batch Rendering ({selectedClips.length} selected)</span>
              </label>
              <div className="batch-clips-list">
                {(markedClips.length > 0 ? markedClips : allClips).map((clip, i) => {
                  const isSelected = selectedClips.some(
                    c => c.start_time === clip.start_time && c.end_time === clip.end_time
                  );
                  return (
                    <div
                      key={i}
                      className={`batch-clip-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleClip(clip)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // handled by parent onClick
                      />
                      <div className="batch-clip-info">
                        <span className="batch-clip-title">
                          {clip.title_suggestion || clip.title}
                        </span>
                        <span className="batch-clip-ts">
                          ⏱️ {Math.floor(clip.start_time / 60)}:{(clip.start_time % 60).toFixed(0).padStart(2, '0')} -{' '}
                          {Math.floor(clip.end_time / 60)}:{(clip.end_time % 60).toFixed(0).padStart(2, '0')} (
                          {(clip.end_time - clip.start_time).toFixed(0)}s)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Live 9:16 Wireframe Preview Column */}
          <div className="studio-preview-col">
            <h4 className="preview-heading">📱 Live 9:16 Video Wireframe</h4>
            <div
              className="phone-wireframe-container"
              style={{ width: `${phoneWidth}px`, height: `${phoneHeight}px` }}
            >
              {/* Background (Black or Blurred) */}
              <div className={`wireframe-bg ${backgroundStyle === 'blurred' && aspectRatio !== '9:16' ? 'blurred-ambient' : 'black-bg'}`}>
                {/* Content Box */}
                {streamerPreset === 'split_top_cam' ? (
                  <div className="wireframe-split-container">
                    <div className="wireframe-streamer-cam">
                      <span className="wireframe-label">Streamer Cam (35%)</span>
                    </div>
                    <div className="wireframe-divider-line"></div>
                    <div className="wireframe-gameplay-feed">
                      <span className="wireframe-label">Gameplay Feed (65%)</span>
                    </div>
                  </div>
                ) : (
                  <div className="wireframe-single-layout">
                    {/* Content scaled by selected aspect ratio */}
                    <div className={`wireframe-content-box aspect-${aspectRatio.replace(':', '')}`}>
                      <div className="wireframe-content-inner">
                        <span className="content-ratio-tag">{aspectRatio}</span>
                        {streamerPreset === 'pip_corner' && (
                          <div className="wireframe-pip-box">Cam</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Title Overlay Positioned Directly on Top of Content Box */}
                {titlePosition !== 'none' && (
                  <div
                    className="wireframe-title-overlay"
                    style={{
                      top: (() => {
                        if (streamerPreset === 'split_top_cam') return '24px';
                        if (aspectRatio === '1:1') return '58px'; // above 93px top edge
                        if (aspectRatio === '4:3') return '88px'; // above 123px top edge
                        if (aspectRatio === '16:9') return '110px'; // above 145px top edge
                        return '88px'; // 9:16 fullscreen uses 4:3 position
                      })(),
                    }}
                  >
                    <span
                      className="wireframe-title-text"
                      style={{
                        fontFamily: captionFont,
                        fontSize: fontSize === 'small' ? '0.68rem' : fontSize === 'big' ? '0.84rem' : '0.74rem',
                        lineHeight: 1.25,
                        whiteSpace: 'pre-line',
                        textAlign: 'center',
                        background: 'transparent',
                        boxShadow: 'none',
                        border: 'none',
                      }}
                    >
                      {formatTitlePreview(titleText || 'YOUR VIRAL HOOK TITLE', textCase)}
                    </span>
                  </div>
                )}

                {/* Subtitle Overlay Positioned on Bottom Edge (Mirroring Title) */}
                {captionStyle !== 'none' && (
                  <div
                    className={`wireframe-caption-overlay style-${captionStyle}`}
                    style={{
                      bottom: (() => {
                        if (aspectRatio === '1:1') return '58px';
                        if (aspectRatio === '4:3') return '88px';
                        if (aspectRatio === '16:9') return '110px';
                        return '88px'; // 9:16 fullscreen uses 4:3 position
                      })(),
                    }}
                  >
                    <span
                      className="wireframe-caption-text"
                      style={{
                        fontFamily: captionFont,
                        fontSize: fontSize === 'small' ? '0.72rem' : fontSize === 'big' ? '0.96rem' : '0.82rem',
                      }}
                    >
                      {captionStyle === 'viral_pop' && (
                        <>
                          {applyLetterCase('DISCOVER THE', textCase)}{' '}
                          <span className="pop-yellow">{applyLetterCase('VIRAL', textCase)}</span>{' '}
                          {applyLetterCase('MOMENT', textCase)}
                        </>
                      )}
                      {captionStyle === 'beast_punch' && (
                        <>
                          {applyLetterCase('UNREAL', textCase)}{' '}
                          <span className="pop-green">{applyLetterCase('HACK', textCase)}</span>{' '}
                          {applyLetterCase('TO GROW', textCase)}
                        </>
                      )}
                      {captionStyle === 'cyber_violet' && (
                        <>
                          {applyLetterCase('CYBER', textCase)}{' '}
                          <span className="pop-violet">{applyLetterCase('LEVEL', textCase)}</span>{' '}
                          {applyLetterCase('UNLOCKED', textCase)}
                        </>
                      )}
                      {captionStyle === 'fire_red' && (
                        <>
                          {applyLetterCase('CRITICAL', textCase)}{' '}
                          <span className="pop-red">{applyLetterCase('DAMAGE', textCase)}</span>{' '}
                          {applyLetterCase('ALERT', textCase)}
                        </>
                      )}
                      {captionStyle === 'electric_cyan' && (
                        <>
                          {applyLetterCase('ELECTRIC', textCase)}{' '}
                          <span className="pop-cyan">{applyLetterCase('ENERGY', textCase)}</span>{' '}
                          {applyLetterCase('BOOST', textCase)}
                        </>
                      )}
                      {captionStyle === 'golden_aura' && (
                        <>
                          {applyLetterCase('LUXURY', textCase)}{' '}
                          <span className="pop-gold">{applyLetterCase('GOLDEN', textCase)}</span>{' '}
                          {applyLetterCase('TICKET', textCase)}
                        </>
                      )}
                      {captionStyle === 'clean_minimal' && (
                        <span className="minimal-pill">
                          {applyLetterCase('Automated AI Clipping', textCase)}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <p className="preview-tip">
              Resolution: <strong>1080 × 1920 (9:16)</strong> · 30 FPS · H.264
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="studio-modal-footer">
          <button className="studio-btn-cancel" onClick={onClose} disabled={isRendering}>
            Cancel
          </button>
          <button
            className="studio-btn-render glowing-btn"
            onClick={handleLaunch}
            disabled={isRendering || selectedClips.length === 0}
          >
            {isRendering ? (
              <>⏳ Launching Render...</>
            ) : (
              <>
                🚀 Batch Render {selectedClips.length} Clip{selectedClips.length > 1 ? 's' : ''} (1080x1920)
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
