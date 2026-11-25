import React from 'react';
import { Trash2 } from 'lucide-react';
import { useLanguage } from '../../locales';

interface GlobalClearModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isClearing: boolean;
}

export const GlobalClearModal: React.FC<GlobalClearModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isClearing,
}) => {
  const { t } = useLanguage();
  if (!isOpen) return null;

  return (
    <div className="custom-confirm-modal-overlay">
      <div className="custom-confirm-modal-card">
        <div
          className="confirm-modal-icon-wrap"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Trash2 size={24} color="#ff1e27" />
        </div>
        <h3 className="confirm-modal-title">{t.studio.confirmModalTitle}</h3>
        <p className="confirm-modal-desc" style={{ marginBottom: '1rem' }}>
          {t.studio.confirmModalDesc}
        </p>
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            margin: '0 0 1.5rem 0',
            padding: '0.85rem 1rem',
            borderRadius: 0,
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            textAlign: 'left',
            fontSize: '0.78rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#4ade80' }}>
            <span>✓</span>
            <strong>{t.studio.confirmModalNotice}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#38bdf8' }}>
            <span>[SEC]</span>
            <strong>{t.header.confirmModalCookieNotice}</strong>
          </div>
        </div>
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="btn-confirm-cancel"
            onClick={onClose}
            disabled={isClearing}
          >
            {t.studio.cancelBtn}
          </button>
          <button
            type="button"
            className="btn-confirm-purge"
            onClick={onConfirm}
            disabled={isClearing}
          >
            {isClearing ? t.studio.purgingBtn : t.studio.purgeBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
