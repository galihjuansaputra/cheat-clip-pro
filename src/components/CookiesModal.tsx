import React, { useState, useEffect } from 'react';
import { useLanguage } from '../locales';

interface CookiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCookieStatusChange?: (hasCookies: boolean) => void;
}

export const CookiesModal: React.FC<CookiesModalProps> = ({
  isOpen,
  onClose,
  onCookieStatusChange,
}) => {
  const { t } = useLanguage();
  const [cookieText, setCookieText] = useState<string>('');
  const [hasCookies, setHasCookies] = useState<boolean>(false);
  const [cookieSize, setCookieSize] = useState<number>(0);
  const [sampleLines, setSampleLines] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/cookies');
      const data = await res.json();
      setHasCookies(data.exists);
      setCookieSize(data.size || 0);
      setSampleLines(data.sample_lines || []);
      if (data.cookies_content) {
        setCookieText(data.cookies_content);
      } else if (!data.exists) {
        setCookieText('');
      }
      if (onCookieStatusChange) {
        onCookieStatusChange(data.exists);
      }
    } catch {
      // Backend might not be reachable yet
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      setMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCookieText(content || '');
      setMessage({
        text: t.cookies.fileLoadedInfo(file.name, (content.length / 1024).toFixed(1)),
        type: 'info'
      });
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    if (!cookieText.trim()) {
      setMessage({ text: t.cookies.emptyError, type: 'error' });
      return;
    }
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies_content: cookieText }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: t.cookies.saveSuccess, type: 'success' });
        fetchStatus();
      } else {
        setMessage({ text: data.detail || t.cookies.saveFailed, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || t.cookies.networkError, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);

  const executeDeleteCookies = async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cookies', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: t.cookies.deletedSuccess, type: 'info' });
        fetchStatus();
      } else {
        setMessage({ text: data.detail || t.cookies.removeFailed, type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || t.cookies.networkError, type: 'error' });
    } finally {
      setIsLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="cookies-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="studio-modal-header">
          <div className="studio-header-title">
            <div className="studio-icon-badge">🍪</div>
            <div>
              <div className="studio-title-row">
                <h2>{t.cookies.modalTitle}</h2>
                <span className={`status-pill ${hasCookies ? 'active' : 'inactive'}`}>
                  {hasCookies ? t.cookies.statusActive : t.cookies.statusInactive}
                </span>
              </div>
              <p className="studio-header-desc">
                {t.cookies.headerDesc}
              </p>
            </div>
          </div>
          <button className="studio-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Status banner */}
        <div className="cookies-status-section">
          {hasCookies ? (
            <div className="cookie-status-box active">
              <span className="status-icon">🛡️</span>
              <div className="status-info">
                <strong>{t.cookies.installedTitle}</strong>
                <p>
                  {t.cookies.installedDesc(cookieSize)}
                </p>
                {sampleLines.length > 0 && (
                  <details className="cookie-preview-details">
                    <summary>{t.cookies.viewDomains(sampleLines.length)}</summary>
                    <div className="cookie-preview-code">
                      {sampleLines.map((line, idx) => (
                        <div key={idx}>{line}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              <button
                type="button"
                className="btn-danger-outline"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
              >
                {t.cookies.clearCookiesBtn}
              </button>
            </div>
          ) : (
            <div className="cookie-status-box warning">
              <span className="status-icon">⚠️</span>
              <div className="status-info">
                <strong>{t.cookies.noCookiesTitle}</strong>
                <p>
                  {t.cookies.noCookiesDesc}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Separate Storage Security Notice */}
        <div style={{
          margin: '0 1.5rem 0.6rem',
          padding: '0.65rem 0.95rem',
          borderRadius: '8px',
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          lineHeight: 1.45
        }}>
          <span style={{ fontSize: '1.15rem' }}>🛡️</span>
          <span>{t.cookies.clearCookiesNotice}</span>
        </div>

        {message && (
          <div className={`cookie-alert-box alert-${message.type}`}>
            {message.text}
          </div>
        )}

        {/* Input & Upload */}
        <div className="cookies-body-section">
          <div className="cookies-upload-row">
            <label className="cookies-file-label">
              {t.cookies.chooseFile}
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </label>
            <span className="cookies-or-divider">{t.cookies.orPaste}</span>
          </div>

          <textarea
            className="cookies-textarea"
            rows={7}
            placeholder={`# Netscape HTTP Cookie File\n# http://curl.haxx.se/rfc/cookie_spec.html\n.youtube.com\tTRUE\t/\tTRUE\t1750000000\tSID\t...\n.youtube.com\tTRUE\t/\tTRUE\t1750000000\tHSID\t...`}
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
          />

          <div className="cookies-guide-card">
            <h4>{t.cookies.guideTitle}</h4>
            <ol>
              <li>
                {t.cookies.guideStep1Prefix}
                <strong>{t.cookies.guideStep1Name}</strong>
                {t.cookies.guideStep1Suffix}
              </li>
              <li>
                {t.cookies.guideStep2Prefix}
                <a href="https://www.youtube.com" target="_blank" rel="noopener noreferrer">YouTube.com</a>
                {t.cookies.guideStep2Suffix}
              </li>
              <li>
                {t.cookies.guideStep3Prefix}
                <strong>{t.cookies.guideStep3Export}</strong>
                {t.cookies.guideStep3Suffix}
              </li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="studio-modal-footer">
          <button className="studio-btn-cancel" onClick={onClose}>
            {t.cookies.closeBtn}
          </button>
          <button
            className="studio-btn-render glowing-btn"
            onClick={handleSave}
            disabled={isLoading || !cookieText.trim()}
          >
            {isLoading ? t.cookies.savingBtn : t.cookies.saveBtn}
          </button>
        </div>

        {/* Fancy Clear Cookies Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="custom-confirm-modal-overlay" style={{ zIndex: 10005 }}>
            <div className="custom-confirm-modal-card">
              <div className="confirm-modal-icon-wrap" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#ef4444' }}>
                🍪
              </div>
              <h3 className="confirm-modal-title">{t.cookies.clearCookiesConfirmTitle}</h3>
              <p className="confirm-modal-desc">
                {t.cookies.clearCookiesConfirmDesc}
              </p>
              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="btn-confirm-cancel"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isLoading}
                >
                  {t.cookies.clearCookiesConfirmKeep}
                </button>
                <button
                  type="button"
                  className="btn-confirm-purge"
                  onClick={executeDeleteCookies}
                  disabled={isLoading}
                >
                  {isLoading ? t.cookies.deletingBtn : t.cookies.clearCookiesConfirmPurge}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
