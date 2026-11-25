import React from 'react';
import { Wrench } from 'lucide-react';

interface ClipperMaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToClips: () => void;
}

export const ClipperMaintenanceModal: React.FC<ClipperMaintenanceModalProps> = ({
  isOpen,
  onClose,
  onGoToClips,
}) => {
  if (!isOpen) return null;

  return (
    <div className="custom-confirm-modal-overlay" style={{ zIndex: 10005 }}>
      <div
        className="custom-confirm-modal-card"
        style={{
          maxWidth: '520px',
          background: '#0a0910',
          border: '1.5px solid #d946ef',
          boxShadow: '0 0 35px rgba(217, 70, 239, 0.35)',
          textAlign: 'left',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #272238',
            paddingBottom: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Wrench size={18} color="#d946ef" />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 800,
                fontSize: '0.9rem',
                color: '#fff',
                letterSpacing: '0.04em',
              }}
            >
              FITUR SEDANG DALAM PERBAIKAN
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1.1rem',
            }}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        <p style={{ color: '#cbd5e1', fontSize: '0.86rem', lineHeight: 1.6, marginBottom: '1rem' }}>
          Fitur Auto Clipper saat ini sedang dalam proses perbaikan dan pemeliharaan sistem. silahkan gunakan versi lokal untuk mengakses fitur ini.
        </p>

        <div
          style={{
            padding: '0.75rem 0.9rem',
            background: 'rgba(217, 70, 239, 0.08)',
            border: '1px solid rgba(217, 70, 239, 0.25)',
            marginBottom: '1.25rem',
            fontSize: '0.82rem',
            color: '#f1f5f9',
            lineHeight: 1.5,
          }}
        >
          💡 <strong>Tips:</strong> Anda tetap dapat melihat, memutar, dan mengekspor seluruh daftar rekomendasi klip viral beserta timestamp di <strong>Tab 02 | RECOMMENDED CLIPS</strong>.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            type="button"
            className="glowing-btn"
            onClick={() => {
              onClose();
              onGoToClips();
            }}
            style={{
              padding: '0.55rem 1.25rem',
              fontSize: '0.82rem',
              background: 'var(--primary)',
              color: '#000',
              fontWeight: 700,
            }}
          >
            [ Mengerti, Buka Tab 02 ]
          </button>
        </div>
      </div>
    </div>
  );
};
