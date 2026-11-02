import React, { useState } from 'react';

interface UploadModalProps {
  batchId: string;
  clipIndex: number;
  clipTitle: string;
  onClose: () => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ batchId, clipIndex, clipTitle, onClose }) => {
  const [platform, setPlatform] = useState<'youtube' | 'tiktok'>('youtube');
  const [title, setTitle] = useState(clipTitle);
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState('unlisted');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [scheduledAt, setScheduledAt] = useState('');

  const checkStatus = async () => {
    const res = await fetch(`/api/upload/${platform}/status`);
    const data = await res.json();
    setConnected(!!data.connected);
  };

  React.useEffect(() => { checkStatus(); }, [platform]);

  const connect = async () => {
    const res = await fetch(`/api/upload/${platform}/connect`);
    const data = await res.json();
    if (data.auth_url) window.open(data.auth_url, '_blank');
  };

  const submit = async () => {
    setError('');
    setStatus('queued');
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          batch_id: batchId,
          clip_index: clipIndex,
          title,
          description,
          privacy,
          scheduled_at: scheduledAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      setJobId(data.job_id);
      setStatus(data.status);
      // poll
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#1e1e2e', color: '#fff', padding: 24, borderRadius: 12, width: 420, maxWidth: '90%' }}>
        <h3>Upload Clip</h3>
        <div style={{ marginBottom: 12 }}>
          <label>Platform: </label>
          <select value={platform} onChange={e => setPlatform(e.target.value as any)}>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          {connected === false && (
            <button onClick={connect}>Connect {platform}</button>
          )}
          {connected === true && <span style={{ color: '#4ade80' }}>Connected</span>}
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Privacy</label>
          <select value={privacy} onChange={e => setPrivacy(e.target.value)}>
            {platform === 'youtube' ? (
              <>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </>
            ) : (
              <>
                <option value="PUBLIC_TO_EVERYONE">Public</option>
                <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                <option value="SELF_ONLY">Private</option>
              </>
            )}
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>Schedule (ISO, optional)</label>
          <input value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} placeholder="2026-11-02T14:00:00Z" style={{ width: '100%' }} />
        </div>
        {status && <div>Status: {status}</div>}
        {error && <div style={{ color: '#f87171' }}>{error}</div>}
        {jobId && status === 'completed' && <div style={{ color: '#4ade80' }}>Upload complete!</div>}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button onClick={submit} disabled={!connected || status === 'uploading'}>Upload</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default UploadModal;