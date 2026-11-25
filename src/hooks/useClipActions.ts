import { useState, useEffect, useCallback } from 'react';
import type { AnalyzeResponse, ViralClip } from '../types';
import { formatSeconds } from '../utils/formatUtils';

interface UseClipActionsOptions {
  result: AnalyzeResponse | null;
  setResult: React.Dispatch<React.SetStateAction<AnalyzeResponse | null>>;
  trimmerClip: ViralClip | null;
  markedClips: Record<string, boolean>;
  setMarkedClips: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setToastMessage: (msg: string | null) => void;
  t: any;
}

export function useClipActions({
  result,
  setResult,
  trimmerClip,
  markedClips,
  setMarkedClips,
  setToastMessage,
  t,
}: UseClipActionsOptions) {
  const [copyTimestampMenuTarget, setCopyTimestampMenuTarget] = useState<'toolbar' | 'overview' | null>(null);
  const [copyTimestampScope, setCopyTimestampScope] = useState<'all' | 'marked'>('all');

  // Close timestamp format menu on click outside or escape
  useEffect(() => {
    if (!copyTimestampMenuTarget) return;
    const handleClickOutside = () => setCopyTimestampMenuTarget(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCopyTimestampMenuTarget(null);
    };
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [copyTimestampMenuTarget]);

  const handleCopyText = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setToastMessage(t.results.copiedGeneralToast(label));
      setTimeout(() => {
        setToastMessage(null);
      }, 3000);
    });
  }, [setToastMessage, t]);

  const handleCopyClip = useCallback((clip: ViralClip, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    let copyText = `CLIP: ${clip.title}
Timestamp: ${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)}
Virality Score: ${clip.virality_score}%

Transcript:
"${clip.transcript}"`;

    if (clip.key_quotes && clip.key_quotes.length > 0) {
      copyText += `\n\nKey Quotes:\n` + clip.key_quotes.map(q => `"${q}" `).join('\n');
    }
    if (clip.title_suggestion) {
      copyText += `\n\nTitle Suggestion: ${clip.title_suggestion}`;
    }
    if (clip.caption_suggestion) {
      const captionText = (() => {
        const lowercaseHashtags = (clip.hashtag_suggestion || '').toLowerCase();
        if (!lowercaseHashtags) return clip.caption_suggestion;
        if (clip.caption_suggestion.toLowerCase().includes(lowercaseHashtags)) return clip.caption_suggestion;
        return `${clip.caption_suggestion} ${lowercaseHashtags}`;
      })();
      copyText += `\n\nCaption Suggestion: ${captionText}`;
    }

    navigator.clipboard.writeText(copyText).then(() => {
      setToastMessage(t.results.copiedDetailsToast(clip.title));
      setTimeout(() => {
        setToastMessage(null);
      }, 3000);
    });
  }, [setToastMessage, t]);

  const handleCopyTimestamp = useCallback((clip: ViralClip, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const ts = `${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)}`;
    navigator.clipboard.writeText(ts).then(() => {
      setToastMessage(t.results.copiedTimestampToast(ts));
      setTimeout(() => setToastMessage(null), 3000);
    });
  }, [setToastMessage, t]);

  const handleCopyTimestampsFormat = useCallback((
    format: 'only' | 'with_title' | 'youtube',
    scope: 'all' | 'marked' = copyTimestampScope,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    setCopyTimestampMenuTarget(null);
    if (!result || !result.clips || result.clips.length === 0) return;

    const targetClips = scope === 'marked'
      ? result.clips.filter(clip => !!markedClips[`${clip.start_time}_${clip.end_time}`])
      : result.clips;

    if (targetClips.length === 0) {
      if (scope === 'marked') {
        setToastMessage(t.results.noMarkedClipsToCopyToast);
      }
      return;
    }

    let text = '';
    if (format === 'only') {
      text = targetClips
        .map(clip => `${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)}`)
        .join('\n');
      if (scope === 'marked') {
        setToastMessage(t.results.copiedMarkedTimestampsOnlyToast(targetClips.length));
      } else {
        setToastMessage(t.results.copiedTimestampsOnlyToast(targetClips.length));
      }
    } else if (format === 'with_title') {
      text = targetClips
        .map(clip => `${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)} | ${clip.title}`)
        .join('\n');
      if (scope === 'marked') {
        setToastMessage(t.results.copiedMarkedTimestampsWithTitlesToast(targetClips.length));
      } else {
        setToastMessage(t.results.copiedTimestampsWithTitlesToast(targetClips.length));
      }
    } else if (format === 'youtube') {
      text = targetClips
        .map(clip => `${formatSeconds(clip.start_time)} ${clip.title}`)
        .join('\n');
      if (scope === 'marked') {
        setToastMessage(t.results.copiedMarkedTimestampsYoutubeToast(targetClips.length));
      } else {
        setToastMessage(t.results.copiedTimestampsYoutubeToast(targetClips.length));
      }
    }

    navigator.clipboard.writeText(text).then(() => {
      setTimeout(() => setToastMessage(null), 3000);
    });
  }, [copyTimestampScope, markedClips, result, setToastMessage, t]);

  const handleExportJSON = useCallback(() => {
    if (!result) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.clips, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `cheat_clip_pro_${result.video_id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setToastMessage(t.results.downloadedJsonToast);
    setTimeout(() => setToastMessage(null), 3000);
  }, [result, setToastMessage, t]);

  const handleExportSRT = useCallback(() => {
    if (!result || !result.transcript) {
      setToastMessage(t.results.noTranscriptToExport);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const formatSRTTime = (secs: number): string => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    };

    let srtText = '';
    result.transcript.forEach((line, index) => {
      srtText += `${index + 1}\n`;
      srtText += `${formatSRTTime(line.start)} --> ${formatSRTTime(line.end)}\n`;
      srtText += `${line.text}\n\n`;
    });

    const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(srtText);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `cheat_clip_pro_${result.video_id}.srt`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setToastMessage(t.results.downloadedSrtToast);
    setTimeout(() => setToastMessage(null), 3000);
  }, [result, setToastMessage, t]);

  const handleCopyAllMarkdown = useCallback(() => {
    if (!result) return;
    let md = `# Viral Clips from "${result.title}"\n\n`;
    md += `**Overall Summary**: ${result.summary}\n\n`;
    result.clips.forEach((clip, index) => {
      md += `## ${index + 1}. ${clip.title} (${clip.virality_score}% Virality)\n`;
      md += `- **Timestamp**: ${formatSeconds(clip.start_time)} - ${formatSeconds(clip.end_time)} (Duration: ${formatSeconds(clip.end_time - clip.start_time)})\n`;
      if (clip.key_quotes && clip.key_quotes.length > 0) {
        md += `- **Key Quotes**:\n`;
        clip.key_quotes.forEach(q => md += `  - *"${q}"*\n`);
      }
      if (clip.title_suggestion) {
        md += `- **Title Suggestion**: ${clip.title_suggestion}\n`;
      }
      if (clip.caption_suggestion) {
        const captionText = (() => {
          const lowercaseHashtags = (clip.hashtag_suggestion || '').toLowerCase();
          if (!lowercaseHashtags) return clip.caption_suggestion;
          if (clip.caption_suggestion.toLowerCase().includes(lowercaseHashtags)) return clip.caption_suggestion;
          return `${clip.caption_suggestion} ${lowercaseHashtags}`;
        })();
        md += `- **Caption Suggestion**: ${captionText}\n`;
      }
      md += `- **Transcript**:\n  > ${clip.transcript.replace(/\n/g, '\n  > ')}\n\n`;
    });

    navigator.clipboard.writeText(md).then(() => {
      setToastMessage(t.results.copiedMarkdownToast);
      setTimeout(() => setToastMessage(null), 3000);
    });
  }, [result, setToastMessage, t]);

  const handleApplyAdjustedClipToResults = useCallback((adjustedClip: ViralClip) => {
    if (result && result.clips && trimmerClip) {
      const oldKey = `${trimmerClip.start_time}_${trimmerClip.end_time}`;
      const newKey = `${adjustedClip.start_time}_${adjustedClip.end_time}`;

      setMarkedClips(prev => {
        if (!prev[oldKey] || oldKey === newKey) return prev;
        const next = { ...prev };
        delete next[oldKey];
        next[newKey] = true;
        return next;
      });

      setResult(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          clips: prev.clips.map(c =>
            (c.start_time === trimmerClip.start_time && c.end_time === trimmerClip.end_time)
              ? adjustedClip
              : c
          )
        };
      });
    }
  }, [result, setMarkedClips, setResult, trimmerClip]);

  return {
    copyTimestampMenuTarget,
    setCopyTimestampMenuTarget,
    copyTimestampScope,
    setCopyTimestampScope,
    handleCopyText,
    handleCopyClip,
    handleCopyTimestamp,
    handleCopyTimestampsFormat,
    handleExportJSON,
    handleExportSRT,
    handleCopyAllMarkdown,
    handleApplyAdjustedClipToResults,
  };
}
