import { LoaderCircle } from 'lucide-react';
import type { YouTubeUploadItem } from './YouTubeUploadQueue';

const ACTIVE_STATUSES = new Set(['preparing', 'queued', 'uploading', 'processing']);
const STATUS_LABELS: Record<string, string> = {
  preparing: 'Menyiapkan file',
  queued: 'Menunggu antrean',
  uploading: 'Mengunggah ke YouTube',
  processing: 'Memproses metadata',
};

export function YouTubeUploadStatusBar({ items }: { items: YouTubeUploadItem[] }) {
  const active = items.filter(item => ACTIVE_STATUSES.has(item.status));
  if (!active.length) return null;
  const current = active[0];
  return (
    <div className="youtube-upload-floating" role="status" aria-live="polite" title={current.note || current.title}>
      <div className="youtube-upload-floating-icon">
        <LoaderCircle size={18} className="spin" />
      </div>
      <div className="youtube-upload-floating-body">
        <strong>{current.title}</strong>
        <span>
          {STATUS_LABELS[current.status] || current.status} · {current.progress}%
          {active.length > 1 ? ` (+${active.length - 1} lainnya)` : ''}
        </span>
        <div className="youtube-upload-floating-track">
          <span style={{ width: `${Math.max(2, current.progress)}%` }} />
        </div>
      </div>
    </div>
  );
}
