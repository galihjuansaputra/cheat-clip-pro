import React from 'react';

interface LanguageConfirmModalProps {
  isOpen: boolean;
  transcriptLanguage: 'en' | 'id';
  setTranscriptLanguage: (lang: 'en' | 'id') => void;
  skipLanguageConfirm: boolean;
  setSkipLanguageConfirm: (skip: boolean) => void;
  onClose: () => void;
  onProceed: () => void;
}

export const LanguageConfirmModal: React.FC<LanguageConfirmModalProps> = ({
  isOpen,
  transcriptLanguage,
  setTranscriptLanguage,
  skipLanguageConfirm,
  setSkipLanguageConfirm,
  onClose,
  onProceed,
}) => {
  if (!isOpen) return null;

  return (
    <div className="custom-confirm-modal-overlay" style={{ zIndex: 10000 }}>
      <div
        className="custom-confirm-modal-card"
        style={{
          maxWidth: '520px',
          textAlign: 'left',
          alignItems: 'stretch',
          background: '#0a0910',
          border: '1.5px solid #ff00ff',
          boxShadow: '0 0 35px rgba(255, 0, 255, 0.35)',
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
            <span style={{ color: '#ff1e27', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1rem' }}>
              &gt;_
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 800,
                fontSize: '0.86rem',
                color: '#fff',
                letterSpacing: '0.04em',
              }}
            >
              SYS // KONFIRMASI BAHASA AUDIO VIDEO
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

        <p
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            lineHeight: '1.5',
            marginBottom: '1.25rem',
          }}
        >
          Cheat Clip Pro akan mengambil subtitle/transkrip otomatis dari YouTube sesuai bahasa yang Anda pilih.
          Pastikan audio video ini sesuai agar deteksi momen viral AI tidak meleset:
        </p>

        <div style={{ marginBottom: '1.25rem' }}>
          <label
            style={{
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              display: 'block',
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
            }}
          >
            &gt; PILIHAN TARGET BAHASA TRANSKRIP:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => {
                setTranscriptLanguage('en');
                localStorage.setItem('cheat_clip_transcript_language', 'en');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.85rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                background: transcriptLanguage === 'en' ? 'rgba(255, 0, 255, 0.12)' : '#0d0d14',
                border: transcriptLanguage === 'en' ? '2px solid #ff00ff' : '1px solid #272238',
                color: transcriptLanguage === 'en' ? '#ff00ff' : 'var(--text-muted)',
                boxShadow: transcriptLanguage === 'en' ? '0 0 15px rgba(255, 0, 255, 0.3)' : 'none',
              }}
            >
              <span>[EN]</span>
              <span>ENGLISH</span>
              {transcriptLanguage === 'en' && <span style={{ color: '#ff00ff', marginLeft: '0.25rem' }}>✓</span>}
            </button>
            <button
              type="button"
              onClick={() => {
                setTranscriptLanguage('id');
                localStorage.setItem('cheat_clip_transcript_language', 'id');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.85rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                background: transcriptLanguage === 'id' ? 'rgba(255, 0, 255, 0.12)' : '#0d0d14',
                border: transcriptLanguage === 'id' ? '2px solid #ff00ff' : '1px solid #272238',
                color: transcriptLanguage === 'id' ? '#ff00ff' : 'var(--text-muted)',
                boxShadow: transcriptLanguage === 'id' ? '0 0 15px rgba(255, 0, 255, 0.3)' : 'none',
              }}
            >
              <span>[ID]</span>
              <span>INDONESIA</span>
              {transcriptLanguage === 'id' && <span style={{ color: '#ff00ff', marginLeft: '0.25rem' }}>✓</span>}
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.55rem',
            marginBottom: '1.5rem',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
          }}
        >
          <input
            type="checkbox"
            id="skip-lang-check"
            checked={skipLanguageConfirm}
            onChange={(e) => setSkipLanguageConfirm(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: '#ff00ff', cursor: 'pointer' }}
          />
          <label htmlFor="skip-lang-check" style={{ cursor: 'pointer' }}>
            Jangan tampilkan konfirmasi ini lagi (ingat untuk sesi ini)
          </label>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-confirm-cancel"
            onClick={onClose}
            style={{ padding: '0.65rem 1.25rem', fontFamily: 'var(--font-mono)' }}
          >
            [ BATAL ]
          </button>
          <button
            type="button"
            className="glowing-btn"
            onClick={() => {
              onClose();
              onProceed();
            }}
            style={{ padding: '0.65rem 1.75rem' }}
          >
            [ LANJUTKAN HACK CLIPS → ]
          </button>
        </div>
      </div>
    </div>
  );
};
