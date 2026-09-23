import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../locales';

export interface VersionInfo {
  current_commit: string;
  current_commit_full?: string;
  commit_message?: string;
  commit_date?: string;
  branch?: string;
  remote_url?: string;
  update_available?: boolean;
  behind_count?: number;
  remote_commit?: string;
  changelog?: Array<{ hash: string; message: string; date: string }>;
  error?: string;
}

interface AppUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppUpdateModal: React.FC<AppUpdateModalProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isRestarting, setIsRestarting] = useState<boolean>(false);
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  // Clear polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const fetchVersion = async () => {
    try {
      const res = await fetch('/api/system/version');
      if (res.ok) {
        const data = await res.json();
        setInfo((prev) => ({ ...prev, ...data }));
      }
    } catch {
      // Ignored
    }
  };

  const handleCheckUpdate = async () => {
    setIsChecking(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/system/check-update');
      if (res.ok) {
        const data = await res.json();
        setInfo(data);
        if (data.error) {
          setErrorMessage(data.error);
        }
      } else {
        setErrorMessage(t.updateModal.errorTitle);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error while checking updates');
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchVersion();
      handleCheckUpdate();
    } else {
      setErrorMessage(null);
      setIsUpdating(false);
      setIsRestarting(false);
      setReconnectAttempt(0);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [isOpen]);

  const startPollingReconnect = () => {
    setIsRestarting(true);
    setStatusText(t.updateModal.reconnecting);
    let attempts = 0;

    // Wait 3.5 seconds before starting polling so the old processes have time to shut down
    setTimeout(() => {
      pollTimerRef.current = setInterval(async () => {
        attempts += 1;
        setReconnectAttempt(attempts);
        try {
          const res = await fetch('/api/health?refresh=true', { cache: 'no-store' });
          if (res.ok) {
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setStatusText(t.updateModal.reconnected);
            setTimeout(() => {
              window.location.reload();
            }, 800);
          }
        } catch {
          // Still waiting for restart
        }

        if (attempts >= 45) {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setErrorMessage('Restart took longer than expected. Please manually refresh your browser window.');
          setIsRestarting(false);
        }
      }, 1500);
    }, 3500);
  };

  const handleUpdateAndRestart = async () => {
    setIsUpdating(true);
    setErrorMessage(null);
    setStatusText(t.updateModal.updatingApp);

    try {
      const res = await fetch('/api/system/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Update failed');
      }
      setIsUpdating(false);
      startPollingReconnect();
    } catch (err: any) {
      setIsUpdating(false);
      setErrorMessage(err.message || 'Error executing update');
    }
  };

  const handleDirectRestart = async () => {
    setErrorMessage(null);
    try {
      await fetch('/api/system/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      startPollingReconnect();
    } catch {
      startPollingReconnect();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 7, 12, 0.75)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUpdating && !isRestarting) {
          onClose();
        }
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '540px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#121620',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75), 0 0 20px rgba(255, 94, 58, 0.1)',
          overflow: 'hidden',
          animation: 'fadeInScale 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🔄</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.updateModal.title}
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {t.updateModal.subtitle}
              </p>
            </div>
          </div>
          {!isUpdating && !isRestarting && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: 'none',
                borderRadius: '8px',
                width: '32px',
                height: '32px',
                color: 'var(--text-secondary)',
                fontSize: '1.1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
              title={t.updateModal.closeBtn}
            >
              ✕
            </button>
          )}
        </div>

        {/* Modal Content */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {/* Active Restarting Overlay / Screen */}
          {isRestarting ? (
            <div
              style={{
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  border: '3px solid rgba(255, 94, 58, 0.2)',
                  borderTopColor: 'var(--primary)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div>
                <h4 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                  {t.updateModal.restartingTitle}
                </h4>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t.updateModal.restartingDesc}
                </p>
              </div>
              <div
                style={{
                  fontSize: '0.8rem',
                  padding: '0.4rem 0.9rem',
                  borderRadius: '20px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span>{statusText || t.updateModal.reconnecting}</span>
                {reconnectAttempt > 0 && <span>({reconnectAttempt})</span>}
              </div>
            </div>
          ) : isUpdating ? (
            /* Active Updating Progress */
            <div
              style={{
                padding: '2rem 1.5rem',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  border: '3px solid rgba(16, 185, 129, 0.2)',
                  borderTopColor: '#10b981',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                  {t.updateModal.updatingApp}
                </h4>
                <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Pulling latest commits from GitHub and preparing restart...
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Version Information Card */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
                    {t.updateModal.currentVersion}
                  </span>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <span
                      style={{
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        color: 'var(--primary)',
                        fontWeight: 600,
                      }}
                    >
                      {info?.current_commit || '...'}
                    </span>
                    <span
                      style={{
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {info?.branch || 'master'}
                    </span>
                  </div>
                </div>

                {info?.commit_message && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.4 }}>
                    "{info.commit_message}"
                  </div>
                )}

                {info?.commit_date && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {t.updateModal.lastUpdated}: {info.commit_date}
                  </div>
                )}
              </div>

              {/* Update Status Banner */}
              {isChecking ? (
                <div
                  style={{
                    padding: '1rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <div
                    style={{
                      width: '18px',
                      height: '18px',
                      border: '2px solid rgba(255, 255, 255, 0.2)',
                      borderTopColor: 'var(--primary)',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {t.updateModal.checkingUpdate}
                  </span>
                </div>
              ) : info?.update_available ? (
                <div
                  style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    borderRadius: '12px',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🚀</span>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#34d399', fontWeight: 700 }}>
                        {t.updateModal.updateAvailableTitle}
                      </h4>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {t.updateModal.updateAvailableDesc(info.behind_count || 1)}
                      </p>
                    </div>
                  </div>

                  {/* Changelog list */}
                  {info.changelog && info.changelog.length > 0 && (
                    <div style={{ marginTop: '0.25rem' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
                        {t.updateModal.newCommits}
                      </span>
                      <div
                        style={{
                          maxHeight: '120px',
                          overflowY: 'auto',
                          background: 'rgba(0, 0, 0, 0.25)',
                          borderRadius: '8px',
                          padding: '0.5rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                        }}
                      >
                        {info.changelog.map((c, i) => (
                          <div key={i} style={{ fontSize: '0.78rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: 'monospace', color: '#6ee7b7', fontWeight: 600, flexShrink: 0 }}>
                              {c.hash}
                            </span>
                            <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                              {c.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Primary Update & Restart Action */}
                  <button
                    onClick={handleUpdateAndRestart}
                    style={{
                      marginTop: '0.25rem',
                      padding: '0.7rem 1rem',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <span>⚡ {t.updateModal.updateRestartBtn}</span>
                  </button>
                </div>
              ) : (
                /* Up to date Banner */
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '12px',
                    padding: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>✅</span>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#34d399', fontWeight: 600 }}>
                        {t.updateModal.upToDateTitle}
                      </h4>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                        {t.updateModal.upToDateDesc}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleCheckUpdate}
                    disabled={isChecking}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '0.4rem 0.75rem',
                      fontSize: '0.78rem',
                      color: 'var(--text-primary)',
                      cursor: isChecking ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {isChecking ? t.updateModal.checkingAgain : t.updateModal.checkUpdateBtn}
                  </button>
                </div>
              )}

              {/* Error Alert */}
              {errorMessage && (
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '8px',
                    color: '#f87171',
                    fontSize: '0.8rem',
                    lineHeight: 1.4,
                  }}
                >
                  ⚠️ {errorMessage}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {!isUpdating && !isRestarting && (
          <div
            style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.01)',
            }}
          >
            <button
              onClick={handleDirectRestart}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '0.45rem 0.85rem',
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                transition: 'all 0.15s ease',
              }}
              title="Restart backend and frontend dev server"
            >
              <span>🔄 {t.updateModal.restartBtn}</span>
            </button>

            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                borderRadius: '8px',
                padding: '0.5rem 1.1rem',
                fontSize: '0.82rem',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              {t.updateModal.closeBtn}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
