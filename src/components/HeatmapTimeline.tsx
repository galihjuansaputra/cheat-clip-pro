import React, { useRef, useState, useEffect } from 'react';
import type { HeatmapPoint } from '../types';
import { useLanguage } from '../locales';
import styles from './HeatmapTimeline.module.css';

interface HeatmapTimelineProps {
  duration: number;
  heatmap: HeatmapPoint[];
  currentTime: number;
  onSeek: (seconds: number) => void;
  activeClip?: { start_time: number; end_time: number } | null;
}

export const HeatmapTimeline: React.FC<HeatmapTimelineProps> = ({
  duration,
  heatmap,
  currentTime,
  onSeek,
  activeClip,
}) => {
  const { t } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number>(0);
  const [hoverValue, setHoverValue] = useState<number>(0);

  const height = 70;
  const paddingBottom = 5;
  const paddingTop = 15;
  const chartHeight = height - paddingBottom - paddingTop;

  // Format seconds to MM:SS or H:MM:SS
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Convert points to SVG coordinates
  const getCoordinates = (svgWidth: number) => {
    if (!heatmap || heatmap.length === 0 || duration === 0) return [];
    
    const divisor = heatmap.length > 1 ? heatmap.length - 1 : 1;
    return heatmap.map((point, index) => {
      // Position x based on time or index (index is safer for uniform distribution)
      const x = (index / divisor) * svgWidth;
      // Invert Y coordinate so 1.0 value is at top
      const val = typeof point.value === 'number' ? point.value : 0;
      const y = paddingTop + chartHeight - (val * chartHeight);
      return { x, y, value: val, time: point.start_time ?? 0 };
    });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || duration === 0) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const time = pct * duration;
    
    // Find closest heatmap value
    let val = 0;
    if (heatmap && heatmap.length > 0) {
      const closestPoint = heatmap.reduce((prev, curr) => {
        const prevDiff = Math.abs((prev.start_time + prev.end_time) / 2 - time);
        const currDiff = Math.abs((curr.start_time + curr.end_time) / 2 - time);
        return prevDiff < currDiff ? prev : curr;
      });
      val = closestPoint.value;
    }
    
    setHoverX(x);
    setHoverTime(time);
    setHoverValue(val);
  };

  const handleMouseLeave = () => {
    setHoverX(null);
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || duration === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    onSeek(pct * duration);
  };

  const [svgWidth, setSvgWidth] = useState(600);

  // Resize handler
  useEffect(() => {
    if (!svgRef.current) return;
    const updateWidth = () => {
      if (svgRef.current) {
        setSvgWidth(svgRef.current.clientWidth);
      }
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    
    // Set a timeout to trigger another resize check after the layout settles
    const timer = setTimeout(updateWidth, 100);
    
    return () => {
      window.removeEventListener('resize', updateWidth);
      clearTimeout(timer);
    };
  }, [heatmap]);

  const coords = getCoordinates(svgWidth);
  
  // Build SVG Path lines
  let strokePath = '';
  let fillPath = '';

  if (coords.length > 0) {
    const pointsStr = coords.map(c => `${c.x},${c.y}`).join(' ');
    strokePath = `M ${pointsStr}`;
    fillPath = `M 0,${height} L ${pointsStr} L ${svgWidth},${height} Z`;
  }

  // Playback cursor positioning
  const playheadX = duration > 0 ? (currentTime / duration) * svgWidth : 0;

  // Active clip highlight boundaries
  let activeClipStart = 0;
  let activeClipWidth = 0;
  if (activeClip && duration > 0) {
    activeClipStart = (activeClip.start_time / duration) * svgWidth;
    const activeClipEnd = (activeClip.end_time / duration) * svgWidth;
    activeClipWidth = Math.max(2, activeClipEnd - activeClipStart);
  }

  return (
    <div className={styles.container}>
      <div className={styles.topRow}>
        <span className={styles.titleGroup}>
          {t.heatmap.title}
          {(!heatmap || heatmap.length === 0) && (
            <span className={styles.naBadge}>{t.heatmap.notAvailable}</span>
          )}
        </span>
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>
      
      <div className={styles.canvasCard}>
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          className={styles.svg}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        >
          <defs>
            {/* Background Heatmap Gradient */}
            <linearGradient id="heatmapFillGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
            </linearGradient>
            
            {/* Active Range Pattern */}
            <linearGradient id="activeRangeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--secondary)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Fallback dotted baseline when no heatmap exists */}
          {(!heatmap || heatmap.length === 0) && (
            <line
              x1="0"
              y1={height - 20}
              x2={svgWidth}
              y2={height - 20}
              stroke="var(--border-color)"
              strokeDasharray="4,4"
              strokeWidth="2"
            />
          )}

          {/* Render Heatmap Curve */}
          {coords.length > 0 && (
            <>
              {/* Heatmap Area Fill */}
              <path d={fillPath} fill="url(#heatmapFillGradient)" />
              {/* Heatmap Stroke Line */}
              <path d={strokePath} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {/* Active Clip Highlight Zone */}
          {activeClip && activeClipWidth > 0 && (
            <g>
              <rect
                x={activeClipStart}
                y={paddingTop - 5}
                width={activeClipWidth}
                height={chartHeight + 10}
                fill="url(#activeRangeGrad)"
                stroke="var(--secondary)"
                strokeWidth="1.5"
                strokeDasharray="3,3"
                rx="0"
              />
            </g>
          )}

          {/* Live Playback cursor line */}
          {duration > 0 && (
            <g>
              <line
                x1={playheadX}
                y1="0"
                x2={playheadX}
                y2={height}
                stroke="var(--text-primary)"
                strokeWidth="2"
                style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.6))' }}
              />
              <circle
                cx={playheadX}
                cy={height / 2}
                r="4"
                fill="var(--text-primary)"
              />
            </g>
          )}

          {/* Hover Guide Line & Tooltip Indicator */}
          {hoverX !== null && (
            <g>
              <line
                x1={hoverX}
                y1="0"
                x2={hoverX}
                y2={height}
                stroke="rgba(255, 255, 255, 0.25)"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <circle
                cx={hoverX}
                cy={coords.length > 0 ? coords[Math.floor((hoverX / svgWidth) * (coords.length - 1))]?.y || height / 2 : height / 2}
                r="5"
                fill="var(--secondary)"
                style={{ filter: 'drop-shadow(0 0 3px var(--secondary-glow))' }}
              />
            </g>
          )}
        </svg>

        {/* Hover Tooltip HTML positioning */}
        {hoverX !== null && (
          <div
            className={styles.tooltip}
            style={{
              left: `${Math.min(svgWidth - 90, Math.max(10, hoverX - 45))}px`,
            }}
          >
            <span className={styles.tooltipTime}>{formatTime(hoverTime)}</span>
            {heatmap && heatmap.length > 0 && (
              <span className={styles.tooltipInterest}>
                {t.heatmap.interest(Math.round(hoverValue * 100))}
              </span>
            )}
          </div>
        )}
      </div>
      
      {/* Timeline legends */}
      <div className={styles.footerRow}>
        <span>00:00</span>
        {heatmap && heatmap.length > 0 && (
          <span className={styles.legendGroup}>
            <span className={styles.legendItem}>
              <span className={styles.dotPrimary}></span>
              {t.heatmap.mostReplayed}
            </span>
            {activeClip && (
              <span className={styles.legendItem}>
                <span className={styles.boxClip}></span>
                {t.heatmap.activeClipZone}
              </span>
            )}
          </span>
        )}
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};
export default HeatmapTimeline;
