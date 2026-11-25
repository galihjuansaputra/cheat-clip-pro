import React from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronRight, FileVideo, Film, Lock, RefreshCw, Scissors, Unlock } from 'lucide-react';
import type { AnalyzeResponse } from '../../types';

interface WorkflowTabsProps {
  workflowTab: 'source' | 'clips' | 'clipper';
  setWorkflowTab: (tab: 'source' | 'clips' | 'clipper') => void;
  result: AnalyzeResponse | null;
  loading: boolean;
  overallProgress: number;
  historyCount: number;
  markedClipsCount: number;
  isLocalhost: boolean;
  isDevUnlocked: boolean;
  onNavigateToClipper: () => void;
  onDeselectActiveVideo: () => void;
  onResetAdminStatus: () => void;
}

export const WorkflowTabs: React.FC<WorkflowTabsProps> = ({
  workflowTab,
  setWorkflowTab,
  result,
  loading,
  overallProgress,
  historyCount,
  markedClipsCount,
  isLocalhost,
  isDevUnlocked,
  onNavigateToClipper,
  onDeselectActiveVideo,
  onResetAdminStatus,
}) => {
  return (
    <>
      {/* Tester / Dev Mode Active Banner in Deployment */}
      {!isLocalhost && isDevUnlocked && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            padding: '0.45rem 0.85rem',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1.5px solid #10b981',
            borderRadius: 0,
            color: '#34d399',
            fontSize: '0.74rem',
            fontWeight: 700,
            marginBottom: '0.9rem',
            boxShadow: '0 0 12px rgba(16, 185, 129, 0.25)',
            gap: '0.6rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Unlock size={14} color="#10b981" />
            <span>[MODE TESTER / DEVELOPER AKTIF] — Tab 03 Auto Clipper Terbuka di Deployment</span>
          </div>
          <button
            type="button"
            onClick={onResetAdminStatus}
            style={{
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              border: '1px solid #b91c1c',
              color: '#fff',
              padding: '0.3rem 0.75rem',
              fontSize: '0.72rem',
              fontWeight: 700,
              borderRadius: 2,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              boxShadow: '0 0 8px rgba(239, 68, 68, 0.35)',
            }}
            title="Kembali ke mode user biasa untuk menguji tampilan pemeliharaan"
          >
            <Lock size={12} color="#fff" />
            <span>Reset Status Admin (Tes Mode User Biasa)</span>
          </button>
        </div>
      )}

      {/* Workflow Navigation Tabs Pipeline (01 SOURCE -> 02 RECOMMENDED CLIPS -> 03 AUTO CLIPPER) */}
      <nav className="workflow-tab-bar" aria-label="Workflow Navigation">
        <button
          type="button"
          id="tab-step-source"
          className={`workflow-tab-btn ${workflowTab === 'source' ? 'active' : ''} ${result ? 'step-done' : ''}`}
          onClick={() => setWorkflowTab('source')}
        >
          <span className="workflow-step-num">
            {result ? <Check size={11} strokeWidth={3} /> : '01'}
          </span>
          <FileVideo size={15} className="workflow-step-icon" />
          <span className="workflow-step-title">SOURCE</span>
        </button>

        <div className={`workflow-process-connector ${result ? 'completed' : ''}`} aria-hidden="true">
          <span className="connector-line" />
          <span className="connector-arrow-box">
            <ChevronRight size={13} strokeWidth={2.5} />
          </span>
          <span className="connector-line" />
        </div>

        <button
          type="button"
          id="tab-step-clips"
          className={`workflow-tab-btn ${workflowTab === 'clips' ? 'active' : ''} ${loading ? 'is-analyzing' : ''} ${result?.clips && result.clips.length > 0 ? 'step-has-content' : ''}`}
          onClick={() => {
            setWorkflowTab('clips');
          }}
          disabled={!loading && !result && historyCount === 0}
          title={
            loading
              ? 'Sedang menganalisa video...'
              : result
                ? 'Lihat hasil rekomendasi klip'
                : historyCount > 0
                  ? 'Buka riwayat klip tersimpan'
                  : 'Selesaikan analisis video terlebih dahulu'
          }
        >
          <span className="workflow-step-num">02</span>
          {loading ? (
            <RefreshCw size={15} className="spinner-icon workflow-step-icon" />
          ) : (
            <Film size={15} className="workflow-step-icon" />
          )}
          <span className="workflow-step-title">
            {loading ? (
              'ANALYZING...'
            ) : result ? (
              'RECOMMENDED CLIPS'
            ) : (
              'HISTORY CLIPS'
            )}
          </span>
          {loading ? (
            <span className="workflow-tab-count analyzing-badge">
              {overallProgress}%
            </span>
          ) : result?.clips ? (
            <span className="workflow-tab-count">[{result.clips.length}]</span>
          ) : historyCount > 0 ? (
            <span className="workflow-tab-count">[{historyCount}]</span>
          ) : null}
        </button>

        <div className={`workflow-process-connector ${markedClipsCount > 0 ? 'completed' : ''}`} aria-hidden="true">
          <span className="connector-line" />
          <span className="connector-arrow-box">
            <ChevronRight size={13} strokeWidth={2.5} />
          </span>
          <span className="connector-line" />
        </div>

        <button
          type="button"
          id="tab-step-clipper"
          className={`workflow-tab-btn ${workflowTab === 'clipper' ? 'active' : ''} ${markedClipsCount > 0 ? 'step-has-content' : ''}`}
          onClick={onNavigateToClipper}
          disabled={!result && (isLocalhost || isDevUnlocked)}
          title={(!isLocalhost && !isDevUnlocked) ? 'Fitur dalam tahap optimasi performa cloud (Klik untuk info)' : (!result ? 'Selesaikan analisis video terlebih dahulu' : 'Buka Auto Clipper Studio')}
        >
          <span className="workflow-step-num">03</span>
          {(!isLocalhost && !isDevUnlocked) ? (
            <Lock size={14} className="workflow-step-icon" style={{ color: '#d946ef' }} />
          ) : (
            <Scissors size={15} className="workflow-step-icon" />
          )}
          <span className="workflow-step-title">AUTO CLIPPER</span>
          {(!isLocalhost && !isDevUnlocked) ? (
            <span className="workflow-tab-count" style={{ background: 'rgba(217, 70, 239, 0.2)', color: '#d946ef', border: '1px solid rgba(217, 70, 239, 0.5)' }}>
              [OPTIMASI]
            </span>
          ) : markedClipsCount > 0 ? (
            <span className="workflow-tab-count">
              [{markedClipsCount} READY]
            </span>
          ) : null}
        </button>
      </nav>

      {/* Active Video Status Banner (Flow level - placed directly below workflow tabs for all steps) */}
      {result && (
        <div className="active-video-banner">
          <div className="active-video-info">
            <span className="studio-tab-preview-title">&gt;_ ACTIVE VIDEO:</span>
            <span className="studio-tab-preview-name">{result.title}</span>
            <span className="studio-tab-preview-count">[{result.clips?.length || 0} klip tersedia]</span>
          </div>
          <div className="active-video-actions">
            {/* If on Tab 01 (Source): Show 02 -> and 03 -> */}
            {workflowTab === 'source' && (
              <>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={() => setWorkflowTab('clips')}
                  style={{
                    padding: '0.4rem 0.95rem',
                    fontSize: '0.78rem',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>[ 02 LIHAT CLIPS</span>
                  <ArrowRight size={13} />
                  <span>]</span>
                </button>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={onNavigateToClipper}
                  style={{
                    padding: '0.4rem 0.95rem',
                    fontSize: '0.78rem',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>[ 03 AUTO CLIPPER {(!isLocalhost && !isDevUnlocked) ? '🔒' : ''}</span>
                  <ArrowRight size={13} />
                  <span>]</span>
                </button>
              </>
            )}

            {/* If on Tab 02 (Clips): Show <- 01 and 03 -> */}
            {workflowTab === 'clips' && (
              <>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={() => setWorkflowTab('source')}
                  style={{
                    padding: '0.4rem 0.95rem',
                    fontSize: '0.78rem',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>[</span>
                  <ArrowLeft size={13} />
                  <span>01 SOURCE ]</span>
                </button>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={onNavigateToClipper}
                  style={{
                    padding: '0.4rem 0.95rem',
                    fontSize: '0.78rem',
                    background: (!isLocalhost && !isDevUnlocked) ? 'transparent' : 'var(--primary)',
                    color: (!isLocalhost && !isDevUnlocked) ? 'var(--text-primary)' : '#000000',
                    border: (!isLocalhost && !isDevUnlocked) ? '1px solid rgba(217, 70, 239, 0.5)' : undefined,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>[ 03 AUTO CLIPPER {(!isLocalhost && !isDevUnlocked) ? '🔒' : ''}</span>
                  <ArrowRight size={13} />
                  <span>]</span>
                </button>
              </>
            )}

            {/* If on Tab 03 (Auto Clipper): Show <- 01 and <- 02 */}
            {workflowTab === 'clipper' && (
              <>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={() => setWorkflowTab('source')}
                  style={{
                    padding: '0.4rem 0.95rem',
                    fontSize: '0.78rem',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>[</span>
                  <ArrowLeft size={13} />
                  <span>01 SOURCE ]</span>
                </button>
                <button
                  type="button"
                  className="glowing-btn"
                  onClick={() => setWorkflowTab('clips')}
                  style={{
                    padding: '0.4rem 0.95rem',
                    fontSize: '0.78rem',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <span>[</span>
                  <ArrowLeft size={13} />
                  <span>02 LIHAT CLIPS ]</span>
                </button>
              </>
            )}

            <button
              type="button"
              className="active-video-close-btn"
              onClick={onDeselectActiveVideo}
              title="Tutup & Nonaktifkan Active Video (Deselect)"
              aria-label="Close active video"
            >
              [ ✕ ]
            </button>
          </div>
        </div>
      )}
    </>
  );
};
