import React from 'react';
import type { BatchRenderProgress } from '../types';

interface BatchRenderProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  progress: BatchRenderProgress | null;
}

export const BatchRenderProgressModal: React.FC<BatchRenderProgressModalProps> = ({
  isOpen,
  onClose,
  progress,
}) => {
  if (!isOpen || !progress) return null;

  const isAllDone = progress.overall_status === 'completed';
  const completedCount = progress.clips.filter(c => c.status === 'completed').length;
  const overallPercent = Math.round((completedCount / (progress.total_clips || 1)) * 100);

  return (
    <div className="modal-backdrop">
      <div className="batch-progress-card" onClick={e => e.stopPropagation()}>
        <div className="batch-progress-header">
          <div>
            <h3>🎬 Batch Video Rendering Queue</h3>
            <p className="batch-subtitle">
              {isAllDone
                ? `🎉 All ${progress.total_clips} clips rendered successfully!`
                : `Processing clip ${(progress.current_clip_index || 0) + 1} of ${progress.total_clips}...`}
            </p>
          </div>
          {isAllDone && (
            <button className="studio-close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {/* Global Progress Bar */}
        <div className="batch-overall-bar-wrap">
          <div className="batch-overall-bar">
            <div
              className="batch-overall-fill"
              style={{ width: `${overallPercent}%` }}
            ></div>
          </div>
          <div className="batch-overall-meta">
            <span>{completedCount} of {progress.total_clips} completed</span>
            <span>{overallPercent}%</span>
          </div>
        </div>

        {/* Clips List */}
        <div className="batch-render-items-list">
          {progress.clips.map((clip, idx) => (
            <div key={idx} className={`batch-item-row status-${clip.status}`}>
              <div className="batch-item-col-title">
                <span className="batch-item-num">#{idx + 1}</span>
                <span className="batch-item-text">{clip.title}</span>
              </div>

              <div className="batch-item-status-wrap">
                {clip.status === 'pending' && <span className="status-badge pending">⏳ Waiting</span>}
                {clip.status === 'downloading' && (
                  <span className="status-badge active">⚡ Slicing Video (15%)</span>
                )}
                {clip.status === 'transcribing' && (
                  <span className="status-badge active">🧠 Word Captions (40%)</span>
                )}
                {clip.status === 'rendering' && (
                  <span className="status-badge active">🎬 1080x1920 Render (70%)</span>
                )}
                {clip.status === 'completed' && (
                  <div className="completed-action-row">
                    <span className="status-badge success">✅ Done</span>
                    {clip.download_url && (
                      <a
                        href={clip.download_url}
                        download
                        className="btn-download-clip"
                        title="Download Rendered MP4"
                      >
                        ⬇️ MP4
                      </a>
                    )}
                  </div>
                )}
                {clip.status === 'error' && (
                  <span className="status-badge error" title={clip.error_message}>
                    ⚠️ Failed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="batch-progress-footer">
          {isAllDone ? (
            <div className="batch-footer-actions">
              {progress.zip_url && (
                <a
                  href={progress.zip_url}
                  download
                  className="glowing-btn batch-zip-download-btn"
                >
                  📦 Download All Clips (.ZIP)
                </a>
              )}
              <button className="studio-btn-cancel" onClick={onClose}>
                Close Studio
              </button>
            </div>
          ) : (
            <div className="rendering-in-progress-hint">
              <span className="spinner-dots"></span>
              <span>FastAPI & FFmpeg hardware encoding in progress. You can keep this open or minimize.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
