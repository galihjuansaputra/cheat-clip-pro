import React, { useState, useEffect } from 'react';

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
      setMessage({ text: `File "${file.name}" loaded (${(content.length / 1024).toFixed(1)} KB). Click "Save Cookies" to apply.`, type: 'info' });
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    if (!cookieText.trim()) {
      setMessage({ text: 'Please paste or upload your cookies.txt content first.', type: 'error' });
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
        setMessage({ text: '✅ Cookies saved successfully! High-resolution 1080p downloads enabled.', type: 'success' });
        setCookieText('');
        fetchStatus();
      } else {
        setMessage({ text: data.detail || 'Failed to save cookies.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Error communicating with backend.', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete stored YouTube cookies?')) return;
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cookies', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: '🗑️ Cookies removed.', type: 'info' });
        fetchStatus();
      } else {
        setMessage({ text: data.detail || 'Failed to remove cookies.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Error communicating with backend.', type: 'error' });
    } finally {
      setIsLoading(false);
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
                <h2>YouTube Cookies Manager</h2>
                <span className={`status-pill ${hasCookies ? 'active' : 'inactive'}`}>
                  {hasCookies ? '🟢 Active' : '⚪ Not Set'}
                </span>
              </div>
              <p className="studio-header-desc">
                Enable 1080p Full HD downloads & prevent YouTube bot verification throttling
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
                <strong>Active Cookies Installed</strong>
                <p>
                  <code>cookies.txt</code> is active ({cookieSize} bytes). yt-dlp will authenticate downloads to fetch highest available video formats.
                </p>
                {sampleLines.length > 0 && (
                  <details className="cookie-preview-details">
                    <summary>View loaded domains ({sampleLines.length} entries)</summary>
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
                onClick={handleDelete}
                disabled={isLoading}
              >
                Delete
              </button>
            </div>
          ) : (
            <div className="cookie-status-box warning">
              <span className="status-icon">⚠️</span>
              <div className="status-info">
                <strong>No Cookies Configured</strong>
                <p>
                  YouTube may restrict unauthenticated downloads to 360p or fail with bot verification. Adding cookies unlocks 1080p HD streams.
                </p>
              </div>
            </div>
          )}
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
              📁 Choose cookies.txt file
              <input
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </label>
            <span className="cookies-or-divider">or paste Netscape cookie content below:</span>
          </div>

          <textarea
            className="cookies-textarea"
            rows={7}
            placeholder={`# Netscape HTTP Cookie File\n# http://curl.haxx.se/rfc/cookie_spec.html\n.youtube.com\tTRUE\t/\tTRUE\t1750000000\tSID\t...\n.youtube.com\tTRUE\t/\tTRUE\t1750000000\tHSID\t...`}
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
          />

          <div className="cookies-guide-card">
            <h4>💡 How to get your YouTube cookies in 1 minute:</h4>
            <ol>
              <li>
                Install a browser extension such as <strong>"Get cookies.txt locally"</strong> (available on Chrome Web Store & Firefox Add-ons).
              </li>
              <li>
                Navigate to <a href="https://www.youtube.com" target="_blank" rel="noopener noreferrer">YouTube.com</a> while logged in.
              </li>
              <li>
                Click the extension icon, click <strong>"Export"</strong>, and upload or paste the downloaded file here.
              </li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="studio-modal-footer">
          <button className="studio-btn-cancel" onClick={onClose}>
            Close
          </button>
          <button
            className="studio-btn-render glowing-btn"
            onClick={handleSave}
            disabled={isLoading || !cookieText.trim()}
          >
            {isLoading ? 'Saving...' : '💾 Save Cookies'}
          </button>
        </div>
      </div>
    </div>
  );
};
