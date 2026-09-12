import React from 'react';
import { useLanguage } from '../locales';
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
  const { t } = useLanguage();
  if (!isOpen || !progress) return null;

  const isAllDone = progress.overall_status === 'completed';
  const completedCount = progress.clips.filter(c => c.status === 'completed').length;
  const overallPercent = Math.round((completedCount / (progress.total_clips || 1)) * 100);

  return (
    <div className="modal-backdrop">
      <div className="batch-progress-card" onClick={e => e.stopPropagation()}>
        <div className="batch-progress-header">
          <div>
            <h3>{t.batchProgress.modalTitle}</h3>
            <p className="batch-subtitle">
              {isAllDone
                ? t.batchProgress.allDoneSubtitle(progress.total_clips)
                : t.batchProgress.processingSubtitle((progress.current_clip_index || 0) + 1, progress.total_clips)}
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
            <span>{t.batchProgress.completedMeta(completedCount, progress.total_clips)}</span>
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
                {clip.status === 'pending' && <span className="status-badge pending">{t.batchProgress.statusWaiting}</span>}
                {clip.status === 'downloading' && (
                  <span className="status-badge active">{t.batchProgress.statusSlicing}</span>
                )}
                {clip.status === 'transcribing' && (
                  <span className="status-badge active">{t.batchProgress.statusCaptions}</span>
                )}
                {clip.status === 'rendering' && (
                  <span className="status-badge active">{t.batchProgress.statusRendering}</span>
                )}
                {clip.status === 'completed' && (
                  <div className="completed-action-row">
                    <span className="status-badge success">{t.batchProgress.statusDone}</span>
                    {clip.download_url && (
                      <a
                        href={clip.download_url}
                        download
                        className="btn-download-clip"
                        title={t.batchProgress.downloadMp4Tooltip}
                      >
                        ⬇️ MP4
                      </a>
                    )}
                  </div>
                )}
                {clip.status === 'error' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <span className="status-badge error" title={clip.error_message}>
                      {t.batchProgress.statusFailed}
                    </span>
                    {clip.error_message && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          color: '#f87171',
                          maxWidth: '260px',
                          lineHeight: '1.25',
                          textAlign: 'right',
                          wordBreak: 'break-word',
                          background: 'rgba(239, 68, 68, 0.1)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid rgba(239, 68, 68, 0.25)'
                        }}
                        title={clip.error_message}
                      >
                        {clip.error_message.length > 100 ? clip.error_message.slice(0, 100) + '...' : clip.error_message}
                      </span>
                    )}
                  </div>
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
                  {t.batchProgress.downloadZip}
                </a>
              )}
              <button className="studio-btn-cancel" onClick={onClose}>
                {t.batchProgress.closeStudio}
              </button>
            </div>
          ) : (
            <div className="rendering-in-progress-hint">
              <span className="spinner-dots"></span>
              <span>{t.batchProgress.hardwareEncodingHint}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
