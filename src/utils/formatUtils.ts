export const formatSeconds = (secs: number): string => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const extractHashtagsAndText = (summary: string): { text: string; hashtags: string[] } => {
  if (!summary) return { text: '', hashtags: [] };
  const hashtagRegex = /#\w+/g;
  const hashtags = (summary.match(hashtagRegex) || []).map(tag => tag.toLowerCase());
  const text = summary.replace(hashtagRegex, '').replace(/\s+/g, ' ').trim();
  return { text, hashtags };
};

export interface RelativeTimeTranslations {
  justNow: string;
  minsAgo: (mins: number) => string;
  hrsAgo: (hrs: number) => string;
  daysAgo: (days: number) => string;
}

export const formatRelativeTime = (iso: string, relativeTime: RelativeTimeTranslations): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return relativeTime.justNow;
  if (mins < 60) return relativeTime.minsAgo(mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return relativeTime.hrsAgo(hrs);
  const days = Math.floor(hrs / 24);
  return relativeTime.daysAgo(days);
};
