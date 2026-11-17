import React from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../locales';
import type { BatchRenderProgress } from '../types';
import styles from './BatchRenderProgressModal.module.css';

interface BatchRenderProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  progress: BatchRenderProgress | null;
  onRetryClip?: (clipIndex?: number) => void;
  onCancel?: () => void;
}

export const BatchRenderProgressModal: React.FC<BatchRenderProgressModalProps> = ({
  isOpen,
  onClose,
  progress,
  onRetryClip,
  onCancel,
}) => {
  const { t } = useLanguage();
  if (!isOpen || !progress) return null;

  const isAllDone = progress.overall_status === 'completed' || progress.overall_status === 'error' || progress.overall_status === 'cancelled';
  const isProcessing = progress.overall_status === 'running' || progress.overall_status === 'cancelling';
  const completedCount = progress.clips.filter(c => c.status === 'completed').length;
  const overallPercent = Math.round((completedCount / (progress.total_clips || 1)) * 100);

  return (
    <div className="modal-backdrop">
      <div className={styles.card} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>{t.batchProgress.modalTitle}</h3>
            <p className={styles.subtitle}>
              {progress.overall_status === 'error'
                ? (progress.error_message || t.batchProgress.statusFailed)
                : progress.overall_status === 'cancelled'
                  ? (progress.error_message || t.batchProgress.statusCancelled)
                  : isAllDone
                    ? t.batchProgress.allDoneSubtitle(progress.total_clips)
                    : t.batchProgress.processingSubtitle((progress.current_clip_index || 0) + 1, progress.total_clips)}
            </p>
          </div>
          {isAllDone ? (
            <button className={styles.closeBtn} onClick={onClose}>
              ✕
            </button>
          ) : onCancel ? (
            <button
              className={styles.closeBtn}
              onClick={onCancel}
              title={t.batchProgress.cancelRender || "Batal Render"}
              style={{ color: '#f87171' }}
            >
              ✕
            </button>
          ) : null}
        </div>

        {/* Global Progress Bar */}
        <div className={styles.overallBarWrap}>
          <div className={styles.overallBar}>
            <div
              className={styles.overallFill}
              style={{ width: `${overallPercent}%` }}
            ></div>
          </div>
          <div className={styles.overallMeta}>
            <span>{t.batchProgress.completedMeta(completedCount, progress.total_clips)}</span>
            <span>{overallPercent}%</span>
          </div>
        </div>

        {/* Clips List */}
        <div className={styles.itemsList}>
          {progress.clips.map((clip, idx) => (
            <div key={idx} className={styles.itemRow}>
              <div className={styles.itemColTitle}>
                <span className={styles.itemNum}>#{idx + 1}</span>
                <span className={styles.itemText}>{clip.title}</span>
              </div>

              <div className={styles.itemStatusWrap}>
                {clip.status === 'pending' && <span className={`${styles.statusBadge} ${styles.badgePending}`}>{t.batchProgress.statusWaiting}</span>}
                {clip.status === 'downloading' && (
                  <span className={`${styles.statusBadge} ${styles.badgeActive}`}>{clip.error_message || t.batchProgress.statusSlicing}</span>
                )}
                {clip.status === 'transcribing' && (
                  <span className={`${styles.statusBadge} ${styles.badgeActive}`}>{t.batchProgress.statusCaptions}</span>
                )}
                {clip.status === 'rendering' && (
                  <span className={`${styles.statusBadge} ${styles.badgeActive}`}>{t.batchProgress.statusRendering}</span>
                )}
                {clip.status === 'completed' && (
                  <div className={styles.completedActionRow}>
                    <span className={`${styles.statusBadge} ${styles.badgeSuccess}`}>{t.batchProgress.statusDone}</span>
                    {clip.download_url && (
                      <a
                        href={clip.download_url}
                        download
                        className={styles.btnDownloadClip}
                        title={t.batchProgress.downloadMp4Tooltip}
                      >
                        [v] MP4
                      </a>
                    )}
                  </div>
                )}
                {clip.status === 'cancelled' && (
                  <span className={`${styles.statusBadge} ${styles.badgeError}`} style={{ borderColor: '#ef4444', color: '#f87171' }}>
                    {t.batchProgress.statusCancelled || '[x] Dibatalkan'}
                  </span>
                )}
                {clip.status === 'error' && (
                  <div className={styles.itemErrorCol}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`${styles.statusBadge} ${styles.badgeError}`} title={clip.error_message || clip.error}>
                        {t.batchProgress.statusFailed}
                      </span>
                      {onRetryClip && !isProcessing && (
                        <button
                          type="button"
                          onClick={() => onRetryClip(idx)}
                          className={styles.retrySingleBtn}
                          title="Retry rendering this clip"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <RefreshCw size={11} />
                          {t.batchProgress.retryClip || 'Retry'}
                        </button>
                      )}
                    </div>
                    {(clip.error_message || clip.error) && (
                      <span
                        className={styles.errorMsgBox}
                        title="Click to copy full error message"
                        onClick={() => navigator.clipboard.writeText(clip.error_message || clip.error || '')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', justifyContent: 'flex-end' }}
                      >
                        <AlertTriangle size={11} color="#ff1e27" style={{ flexShrink: 0 }} />
                        <span>{clip.error_message || clip.error}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className={styles.footer}>
          {isAllDone ? (
            <>
              {progress.clips.some(c => c.status === 'error') && onRetryClip && (
                <button
                  type="button"
                  onClick={() => onRetryClip()}
                  className={styles.retryAllBtn}
                  title="Retry all failed clips"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <RefreshCw size={13} />
                  {t.batchProgress.retryAllFailed
                    ? t.batchProgress.retryAllFailed(progress.clips.filter(c => c.status === 'error').length)
                    : `Retry Failed (${progress.clips.filter(c => c.status === 'error').length})`}
                </button>
              )}
              {progress.zip_url && (
                <a
                  href={progress.zip_url}
                  download
                  className={styles.zipDownloadBtn}
                >
                  {t.batchProgress.downloadZip}
                </a>
              )}
              <button className={styles.closeStudioBtn} onClick={onClose}>
                {t.batchProgress.closeStudio}
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '1rem' }}>
              <div className={styles.inProgressHint}>
                <span className="spinner-dots"></span>
                <span>{t.batchProgress.hardwareEncodingHint}</span>
              </div>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  style={{
                    background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
                    border: '1px solid #ef4444',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    padding: '0.45rem 0.9rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  ✕ {t.batchProgress.cancelRender || 'Batal Render'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
