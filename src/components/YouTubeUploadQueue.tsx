import { CheckCircle2, ExternalLink, LoaderCircle, XCircle } from 'lucide-react';

export interface YouTubeUploadItem {
  id: string;
  title: string;
  status: string;
  progress: number;
  url?: string;
  error?: string;
  note?: string;
  warning?: string;
  retry?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  preparing: 'Menyiapkan',
  queued: 'Menunggu',
  uploading: 'Mengunggah',
  processing: 'Memproses',
  completed: 'Selesai',
  failed: 'Gagal',
};

export function YouTubeUploadQueue({ items }: { items: YouTubeUploadItem[] }) {
  if (!items.length) return null;
  return (
    <section className="youtube-upload-queue glass-panel">
      <div className="metadata-eyebrow">YouTube Upload Queue</div>
      {items.map(item => (
        <div className="youtube-upload-item" key={item.id}>
          <div className="youtube-upload-item-head">
            <strong>{item.title}</strong>
            {item.status === 'completed' ? <CheckCircle2 size={15} color="var(--status-success)" /> : item.status === 'failed' ? <XCircle size={15} color="var(--status-error)" /> : <LoaderCircle size={15} className="spin" />}
          </div>
          <div className="youtube-upload-track"><span style={{ width: `${item.progress}%` }} /></div>
          <div className="youtube-upload-meta">
            <span>{STATUS_LABELS[item.status] || item.status} · {item.progress}%</span>
            {item.url && <a href={item.url} target="_blank" rel="noreferrer">Open video <ExternalLink size={12} /></a>}
            {item.status === 'failed' && item.retry && <button type="button" className="copy-title-btn" onClick={item.retry}>Retry</button>}
          </div>
          {item.error && <small className="metadata-error">{item.error}</small>}
          {!item.error && (item.note || item.warning) && <small>{item.note || item.warning}</small>}
        </div>
      ))}
    </section>
  );
}
