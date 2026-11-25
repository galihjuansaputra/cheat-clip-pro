import React, { Suspense, lazy } from 'react';
import { Wrench } from 'lucide-react';
import type { AnalyzeResponse, ViralClip, BatchRenderProgress, SourcePrepProgress } from '../../types';

const ClipStudioSection = lazy(() =>
  import('../ClipStudioSection').then(m => ({ default: m.ClipStudioSection }))
);

export interface ClipStudioTabProps {
  isActive: boolean;
  result: AnalyzeResponse | null;
  url: string;
  isLocalhost: boolean;
  isDevUnlocked: boolean;
  activeClip: ViralClip | null;
  markedClipsList: ViralClip[];
  onStartRender: (settings: any) => void;
  isLaunchingRender: boolean;
  toggleMarkedClip: (clipId: string) => void;
  toggleAllMarkedClips: (forceSelect?: boolean) => void;
  batchProgress: BatchRenderProgress | null;
  sourcePrepProgress: SourcePrepProgress | null;
  onDismissProgress: () => void;
  onRetryClip: (clipIndex?: number) => void;
  onCancelRender: () => void;
  isCancellingRender: boolean;
  allowAppUpdates: boolean;
  onOpenCookiesModal: () => void;
  onBackToClips: () => void;
}

export const ClipStudioTab: React.FC<ClipStudioTabProps> = ({
  isActive,
  result,
  url,
  isLocalhost,
  isDevUnlocked,
  activeClip,
  markedClipsList,
  onStartRender,
  isLaunchingRender,
  toggleMarkedClip,
  toggleAllMarkedClips,
  batchProgress,
  sourcePrepProgress,
  onDismissProgress,
  onRetryClip,
  onCancelRender,
  isCancellingRender,
  allowAppUpdates,
  onOpenCookiesModal,
  onBackToClips,
}) => {
  if (!result) return null;

  return (
    <div style={{ display: isActive ? 'block' : 'none' }}>
      {!isLocalhost && !isDevUnlocked ? (
        <div
          className="glass-panel"
          style={{
            padding: '2.5rem 2rem',
            textAlign: 'center',
            background: 'linear-gradient(180deg, rgba(20, 15, 30, 0.95), rgba(10, 8, 16, 0.98))',
            border: '1.5px solid rgba(217, 70, 239, 0.4)',
            boxShadow: '0 0 30px rgba(217, 70, 239, 0.2)',
            maxWidth: '680px',
            margin: '2rem auto',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(217, 70, 239, 0.15)',
              border: '1px solid #d946ef',
              marginBottom: '1.25rem',
              boxShadow: '0 0 15px rgba(217, 70, 239, 0.4)',
            }}
          >
            <Wrench size={32} color="#d946ef" />
          </div>
          <h3
            style={{
              fontSize: '1.25rem',
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              color: '#fff',
              marginBottom: '0.8rem',
              letterSpacing: '0.04em',
            }}
          >
            🛠️ FITUR AUTO CLIPPER SEDANG DALAM PENINGKATAN
          </h3>
          <p
            style={{
              color: '#cbd5e1',
              fontSize: '0.92rem',
              lineHeight: 1.6,
              maxWidth: '540px',
              margin: '0 auto 1.5rem',
            }}
          >
            Fitur rendering &amp; auto-cropping video pada server deployment sedang dioptimasi untuk menghasilkan proses render yang lebih cepat dan bebas antrean. silahkan gunakan versi lokal (localhost) untuk mengakses fitur ini, atau tunggu hingga perbaikan selesai.
          </p>
          <div
            style={{
              padding: '1rem',
              background: 'rgba(217, 70, 239, 0.08)',
              border: '1px solid rgba(217, 70, 239, 0.3)',
              color: '#f8fafc',
              fontSize: '0.85rem',
              lineHeight: 1.5,
              maxWidth: '540px',
              margin: '0 auto 1.8rem',
              textAlign: 'left',
            }}
          >
            ✨ <strong>Rekomendasi:</strong> Anda tetap dapat menikmati seluruh hasil deteksi momen viral, memutar segmen video, dan mengekspor daftar timestamp di <strong>Tab 02 // RECOMMENDED CLIPS</strong>.
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              className="glowing-btn"
              onClick={onBackToClips}
              style={{
                padding: '0.65rem 1.6rem',
                background: 'var(--primary)',
                color: '#000',
                fontWeight: 800,
                fontSize: '0.88rem',
              }}
            >
              [ &lt;- KEMBALI KE TAB 02 // CLIPS ]
            </button>
          </div>
        </div>
      ) : (
        <Suspense
          fallback={
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '360px',
                color: '#888',
              }}
            >
              <span className="pulsing-text">Loading Studio Engine...</span>
            </div>
          }
        >
          <ClipStudioSection
            videoUrl={result.video_url || url}
            videoId={result.video_id}
            allClips={result.clips}
            transcript={result.transcript || []}
            markedClips={markedClipsList}
            activeClip={activeClip}
            onStartRender={onStartRender}
            isRendering={isLaunchingRender}
            onToggleMarkClip={(clip) => toggleMarkedClip(`${clip.start_time}_${clip.end_time}`)}
            onToggleAllClips={toggleAllMarkedClips}
            batchProgress={batchProgress}
            sourcePrepProgress={sourcePrepProgress}
            onDismissProgress={onDismissProgress}
            onRetryClip={onRetryClip}
            onCancelRender={onCancelRender}
            isCancellingRender={isCancellingRender}
            allowAppUpdates={allowAppUpdates}
            onOpenCookiesModal={onOpenCookiesModal}
            onBackToClips={onBackToClips}
          />
        </Suspense>
      )}
    </div>
  );
};
