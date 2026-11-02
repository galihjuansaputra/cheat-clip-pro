import React, { useState } from 'react';

interface UploadModalProps {
  batchId?: string;
  clipIndex?: number;
  clipTitle?: string;
  filePath?: string;
  onClose: () => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ batchId, clipIndex, clipTitle, filePath, onClose }) => {
  const [title, setTitle] = useState(clipTitle || 'Clip');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState('unlisted');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const redirectUri = 'http://localhost:8000/api/upload/youtube/callback';

  const checkStatus = async () => {
    const res = await fetch('/api/upload/youtube/status');
    const data = await res.json();
    setConnected(!!data.connected);
  };

  React.useEffect(() => { checkStatus(); }, []);

  const connect = async () => {
    const res = await fetch('/api/upload/youtube/connect');
    const data = await res.json();
    if (data.auth_url) window.open(data.auth_url, '_blank');
  };

  const generateAI = async () => {
    setAiLoading(true);
    try {
      const apiKey = localStorage.getItem('cheat_clip_gemini_api_key') || '';
      const res = await fetch('/api/ai-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: clipTitle || title, transcript: '', api_key: apiKey, platform: 'youtube' }),
      });
      const data = await res.json();
      if (data.title) setTitle(data.title);
      if (data.description) setDescription(data.description);
      if (Array.isArray(data.tags)) setTags(data.tags.join(', '));
      if (data.privacy) setPrivacy(data.privacy);
    } catch {}
    setAiLoading(false);
  };

  const submit = async () => {
    setError('');
    setStatus('queued');
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'youtube',
          batch_id: batchId,
          clip_index: clipIndex,
          file_path: filePath,
          title,
          description,
          privacy,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          scheduled_at: scheduledAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      setJobId(data.job_id);
      setStatus(data.status);
      const poll = setInterval(async () => {
        const r = await fetch(`/api/upload/status/${data.job_id}`);
        const j = await r.json();
        setStatus(j.status);
        if (j.status === 'completed' || j.status === 'failed') {
          clearInterval(poll);
          if (j.status === 'failed') setError(j.error || 'Failed');
        }
      }, 2000);
    } catch (e: any) {
      setError(e.message);
      setStatus('failed');
    }
  };

  const copy = (txt: string) => { navigator.clipboard?.writeText(txt); };

  return (
    <div className="custom-confirm-modal-overlay">
      <div className="custom-confirm-modal-card" style={{ maxWidth: 480, textAlign: 'left', alignItems: 'stretch' }}>
        <h3>Upload to YouTube</h3>
        <button onClick={() => setShowSetup(v => !v)} style={{ marginBottom: 8, fontSize: 12 }}>
          {showSetup ? 'Hide setup guide' : 'Show setup guide (credentials & redirect)'}
        </button>
        {showSetup && (
          <div style={{ background: '#111827', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 12, lineHeight: 1.5 }}>
            <div><b>Redirect URI (copy):</b> {redirectUri} <button onClick={() => copy(redirectUri)}>Copy</button></div>
            <ol style={{ paddingLeft: 16, margin: '6px 0' }}>
              <li>Google Cloud Console → buat/select project.</li>
              <li>APIs & Services → Library → enable <b>YouTube Data API v3</b>.</li>
              <li>OAuth consent screen → External → tambah scope <b>youtube.upload</b> → tambah test user.</li>
              <li>Credentials → OAuth client ID (Web app) → Authorized redirect URIs: paste URI di atas.</li>
              <li>Copy Client ID/Secret → set di backend/.env.</li>
            </ol>
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Open Google Cloud Console</a>
            <div style={{ marginTop: 6, color: '#9ca3af' }}>
              Env keys: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI.
            </div>
          </div>
        )}
        <div style={{ marginBottom: 8 }}>
          <label>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Tags (comma separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Privacy</label>
          <select value={privacy} onChange={e => setPrivacy(e.target.value)}>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Schedule (ISO, optional)</label>
          <input value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} placeholder="2026-11-02T14:00:00Z" style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <button onClick={generateAI} disabled={aiLoading}>{aiLoading ? 'Generating...' : '✨ Generate with AI'}</button>
        </div>
        {status && <div>Status: {status}</div>}
        {error && <div style={{ color: '#f87171' }}>{error}</div>}
        {jobId && status === 'completed' && <div style={{ color: '#4ade80' }}>Upload complete!</div>}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button onClick={submit} disabled={!connected || status === 'uploading'}>Upload to YouTube</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default UploadModal;