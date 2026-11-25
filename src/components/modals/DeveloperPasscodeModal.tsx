import React, { useState } from 'react';
import { Lock } from 'lucide-react';

interface DeveloperPasscodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (passcode: string) => void;
  passcodeError: string;
  setPasscodeError: (err: string) => void;
}

export const DeveloperPasscodeModal: React.FC<DeveloperPasscodeModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  passcodeError,
  setPasscodeError,
}) => {
  const [passcodeInput, setPasscodeInput] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    setPasscodeInput('');
    setPasscodeError('');
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(passcodeInput);
  };

  return (
    <div className="custom-confirm-modal-overlay" style={{ zIndex: 10006 }}>
      <div
        className="custom-confirm-modal-card"
        style={{
          maxWidth: '440px',
          background: '#0a0910',
          border: '1.5px solid #00f0ff',
          boxShadow: '0 0 30px rgba(0, 240, 255, 0.35)',
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
            <Lock size={16} color="#00f0ff" />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 800,
                fontSize: '0.9rem',
                color: '#fff',
                letterSpacing: '0.04em',
              }}
            >
              VERIFIKASI AKSES
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
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

        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
          Fitur ini sedang dalam perbaikan dan pemeliharaan sistem. Masukkan passcode untuk melanjutkan:
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Masukkan passcode..."
            value={passcodeInput}
            onChange={(e) => {
              setPasscodeInput(e.target.value);
              setPasscodeError('');
            }}
            style={{
              width: '100%',
              padding: '0.65rem 0.8rem',
              background: '#12111a',
              border: passcodeError ? '1px solid #ef4444' : '1px solid #332d4a',
              color: '#fff',
              borderRadius: 4,
              marginBottom: '0.5rem',
              fontSize: '0.88rem',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
          {passcodeError && (
            <div style={{ color: '#ef4444', fontSize: '0.75rem', marginBottom: '0.75rem', fontWeight: 600 }}>
              [!] {passcodeError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: '0.5rem 1rem',
                background: '#1e1c2b',
                border: 'none',
                color: '#fff',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              Batal
            </button>
            <button
              type="submit"
              style={{
                padding: '0.5rem 1.25rem',
                background: 'linear-gradient(135deg, #00f0ff, #0077ff)',
                border: 'none',
                color: '#000',
                fontWeight: 700,
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.82rem',
              }}
            >
              Buka Akses
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
