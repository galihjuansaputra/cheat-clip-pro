import React from 'react';
import { Bookmark, Check, Heart, RefreshCw, Trash2 } from 'lucide-react';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { useLanguage } from '../../locales';

interface AppHeaderProps {
  toastMessage: string | null;
  onCloseToast: () => void;
  hasCookies: boolean;
  onOpenCookiesModal: () => void;
  allowAppUpdates: boolean;
  isClearingGlobalTemp: boolean;
  onOpenGlobalClearModal: () => void;
  onOpenUpdateModal: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  toastMessage,
  onCloseToast,
  hasCookies,
  onOpenCookiesModal,
  allowAppUpdates,
  isClearingGlobalTemp,
  onOpenGlobalClearModal,
  onOpenUpdateModal,
}) => {
  const { t } = useLanguage();

  return (
    <>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-msg" role="status" aria-live="polite">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ flexShrink: 0 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="toast-text">{toastMessage}</span>
          <button
            type="button"
            className="toast-close-btn"
            onClick={onCloseToast}
            title="Dismiss notification"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Full-Width Cyber Header Bar (johansa.com style - Edge-to-Edge Solid Dark) */}
      <div className="app-header-wrapper">
        <div className="app-header-inner">
          <header className="app-header">
            <div className="header-logo">
              <div>
                <div className="logo-title-row">
                  <span className="prompt-marker">&gt;_</span>
                  <h1 className="logo-title">CHEAT CLIP PRO</h1>
                  <span className="status-dot" title="Online" />
                </div>
                <p className="header-subtitle">&gt; {t.header.subtitle}</p>
              </div>
            </div>
            <div className="header-nav">
              <button
                type="button"
                className={`header-nav-btn${hasCookies ? ' cookies-active' : ''}`}
                onClick={onOpenCookiesModal}
                title={hasCookies ? t.header.cookiesTooltipActive : t.header.cookiesTooltipSetup}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Bookmark size={13} /> {t.header.cookiesBtn}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  {hasCookies ? (
                    <>
                      <Check size={12} style={{ color: '#00ff66' }} />
                      <span style={{ color: '#00ff66' }}>{t.header.cookiesStatusActive}</span>
                    </>
                  ) : (
                    <>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--text-muted)',
                          display: 'inline-block',
                        }}
                      />
                      <span>{t.header.cookiesStatusSetup}</span>
                    </>
                  )}
                </span>
              </button>

              {allowAppUpdates && (
                <button
                  type="button"
                  className="header-nav-btn"
                  onClick={onOpenGlobalClearModal}
                  disabled={isClearingGlobalTemp}
                  title={t.header.clearTempTooltip}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Trash2 size={13} /> {isClearingGlobalTemp ? t.header.clearingTempBtn : t.header.clearTempBtn}
                  </span>
                </button>
              )}

              {allowAppUpdates && (
                <button
                  type="button"
                  className="header-nav-btn"
                  onClick={onOpenUpdateModal}
                  title={t.header.updateBtnTooltip}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <RefreshCw size={13} /> {t.header.updateBtn}
                  </span>
                </button>
              )}

              <LanguageSwitcher />

              <a
                href="https://tako.id/johansa"
                target="_blank"
                rel="noopener noreferrer"
                className="header-nav-btn support-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Heart size={13} /> {t.header.supportProject}
              </a>
            </div>
          </header>
        </div>
      </div>
    </>
  );
};
