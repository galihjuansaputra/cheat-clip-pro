export const isGoogleDriveUrl = (urlStr: string): boolean => {
  if (!urlStr) return false;
  return /(?:drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com)/i.test(urlStr.trim());
};

export const extractGoogleDriveId = (urlStr: string): string | null => {
  if (!urlStr) return null;
  const trimmed = urlStr.trim();
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]{20,})/,
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]{20,})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) return match[1];
  }
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
};

export const isTwitchUrl = (urlStr: string): boolean => {
  if (!urlStr) return false;
  const trimmed = urlStr.trim();
  return (
    trimmed.includes('twitch.tv') ||
    trimmed.startsWith('twitch_') ||
    /(?:twitch\.tv\/videos\/|clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/)/.test(trimmed)
  );
};

export const extractTwitchId = (urlStr: string): { type: 'vod' | 'clip'; id: string } | null => {
  if (!urlStr) return null;
  const trimmed = urlStr.trim();
  const mVod = trimmed.match(/(?:twitch\.tv\/videos\/|twitch\.tv\/[a-zA-Z0-9_]+\/v\/|twitch_vod_|twitch_)(\d+)/);
  if (mVod && mVod[1]) {
    return { type: 'vod', id: mVod[1] };
  }
  const mClip = trimmed.match(/(?:clips\.twitch\.tv\/|twitch\.tv\/[^/]+\/clip\/|twitch_clip_)([a-zA-Z0-9_-]+)/);
  if (mClip && mClip[1]) {
    return { type: 'clip', id: mClip[1] };
  }
  return null;
};

export const extractVideoId = (urlStr: string): string | null => {
  if (!urlStr) return null;
  const trimmed = urlStr.trim();
  if (isGoogleDriveUrl(trimmed)) {
    const gId = extractGoogleDriveId(trimmed);
    return gId ? `gdrive_${gId}` : null;
  }
  if (isTwitchUrl(trimmed)) {
    const tw = extractTwitchId(trimmed);
    if (tw) {
      return tw.type === 'vod' ? `twitch_${tw.id}` : `twitch_clip_${tw.id}`;
    }
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/|(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:embed|v|shorts|live)\/)([a-zA-Z0-9_-]{11})/,
    /(?:v=|\/v\/|embed\/|shorts\/|live\/|youtu\.be\/|\/embed\/|\/watch\?v=|\/watch\?.+&v=)([a-zA-Z0-9_-]{11})/
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
};
