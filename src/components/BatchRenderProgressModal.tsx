import React from 'react';
import { useLanguage } from '../locales';
import type { BatchRenderProgress } from '../types';

interface BatchRenderProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  progress: BatchRenderProgress | null;
  onRetryClip?: (clipIndex?: number) => void;
}

export const BatchRenderProgressModal: React.FC<BatchRenderProgressModalProps> = ({
  isOpen,
  onClose,
  progress,
  onRetryClip,
}) => {
  const { t } = useLanguage();
  if (!isOpen || !progress) return null;

  const isAllDone = progress.overall_status === 'completed' || progress.overall_status === 'error';
  const isProcessing = progress.overall_status === 'running';
  const completedCount = progress.clips.filter(c => c.status === 'completed').length;
  const overallPercent = Math.round((completedCount / (progress.total_clips || 1)) * 100);

  return (
    <div className="modal-backdrop">
      <div className="batch-progress-card" onClick={e => e.stopPropagation()}>
        <div className="batch-progress-header">
          <div>
            <h3>{t.batchProgress.modalTitle}</h3>
            <p className="batch-subtitle">
              {progress.overall_status === 'error'
                ? (progress.error_message || t.batchProgress.statusFailed)
                : isAllDone
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
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', marginTop: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="status-badge error" title={clip.error_message || clip.error}>
                        {t.batchProgress.statusFailed}
                      </span>
                      {onRetryClip && !isProcessing && (
                        <button
                          type="button"
                          onClick={() => onRetryClip(idx)}
                          style={{
                            background: 'rgba(245, 158, 11, 0.18)',
                            border: '1px solid rgba(245, 158, 11, 0.5)',
                            borderRadius: '4px',
                            color: '#fbbf24',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                          title="Retry rendering this clip"
                        >
                          {t.batchProgress.retryClip || '🔄 Retry'}
                        </button>
                      )}
                    </div>
                    {(clip.error_message || clip.error) && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          color: '#fca5a5',
                          maxWidth: '320px',
                          lineHeight: '1.3',
                          textAlign: 'right',
                          wordBreak: 'break-word',
                          background: 'rgba(239, 68, 68, 0.12)',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          cursor: 'pointer'
                        }}
                        title="Click to copy full error message"
                        onClick={() => navigator.clipboard.writeText(clip.error_message || clip.error || '')}
                      >
                        ⚠️ {clip.error_message || clip.error}
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
              {progress.clips.some(c => c.status === 'error') && onRetryClip && (
                <button
                  type="button"
                  onClick={() => onRetryClip()}
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    border: '1px solid rgba(245, 158, 11, 0.7)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    padding: '0.4rem 0.85rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    boxShadow: '0 0 10px rgba(245, 158, 11, 0.35)',
                    transition: 'all 0.2s ease',
                  }}
                  title="Retry all failed clips"
                >
                  {t.batchProgress.retryAllFailed
                    ? t.batchProgress.retryAllFailed(progress.clips.filter(c => c.status === 'error').length)
                    : `🔄 Retry Failed (${progress.clips.filter(c => c.status === 'error').length})`}
                </button>
              )}
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
