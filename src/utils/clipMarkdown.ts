import type { AnalyzeResponse, ViralClip } from '../types';

export interface ClipMarkdownEntry {
  index: number;
  headingTitle: string;
  virality: number;
  startTime: number;
  endTime: number;
  title: string;
  caption: string;
  hashtags: string[];
  keyQuotes: string[];
  transcript: string;
}

export function formatClipTimestamp(secs: number): string {
  const safe = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function parseClipTimestamp(value: string): number {
  const parts = value.trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function captionWithHashtags(clip: ViralClip): string {
  const hashtags = (clip.hashtag_suggestion || '').toLowerCase().trim();
  const caption = (clip.caption_suggestion || '').trim();
  if (!hashtags) return caption;
  if (caption.toLowerCase().includes(hashtags)) return caption;
  return `${caption} ${hashtags}`.trim();
}

function extractHashtags(value: string): string[] {
  return (value.match(/#[\p{L}\p{N}_]+/gu) || [])
    .map(tag => tag.replace(/^#/, '').trim())
    .filter(Boolean);
}

export function buildClipsMarkdown(result: AnalyzeResponse): string {
  let md = `# Viral Clips from "${result.title}"\n\n`;
  md += `**Overall Summary**: ${result.summary}\n\n`;

  result.clips.forEach((clip, index) => {
    md += `<!-- clip:${index} -->\n`;
    md += `## ${index + 1}. ${clip.title} (${clip.virality_score}% Virality)\n`;
    md += `- **Timestamp**: ${formatClipTimestamp(clip.start_time)} - ${formatClipTimestamp(clip.end_time)} (Duration: ${formatClipTimestamp(clip.end_time - clip.start_time)})\n`;
    if (clip.title_suggestion) {
      md += `- **Title Suggestion**: ${clip.title_suggestion}\n`;
    }
    if (clip.caption_suggestion) {
      md += `- **Caption Suggestion**: ${captionWithHashtags(clip)}\n`;
    }
    const hashtags = extractHashtags(clip.hashtag_suggestion || '');
    if (hashtags.length > 0) {
      md += `- **Hashtags**: ${hashtags.map(tag => `#${tag}`).join(' ')}\n`;
    }
    if (clip.key_quotes && clip.key_quotes.length > 0) {
      md += `- **Key Quotes**:\n`;
      clip.key_quotes.forEach(quote => {
        md += `  - *"${quote}"*\n`;
      });
    }
    if (clip.transcript) {
      md += `- **Transcript**:\n  > ${clip.transcript.replace(/\n/g, '\n  > ')}\n\n`;
    }
  });

  return md;
}

export function parseClipsMarkdown(markdown: string): ClipMarkdownEntry[] {
  if (!markdown.trim()) return [];

  const markerRegex = /<!--\s*clip:(\d+)\s*-->/g;
  const hasMarkers = markerRegex.test(markdown);
  let blocks: string[];
  if (hasMarkers) {
    // Drop the document header (title + overall summary) before splitting, so
    // block N always corresponds to the Nth clip marker.
    const firstMarker = markdown.search(/<!--\s*clip:\d+\s*-->/);
    blocks = markdown
      .slice(firstMarker)
      .split(/<!--\s*clip:\d+\s*-->/)
      .filter(block => block.trim());
  } else {
    blocks = markdown.split(/^##\s+/m).filter(block => block.trim()).map(block => `## ${block}`);
  }
  const markerIndexes: number[] = [];
  if (hasMarkers) {
    markerRegex.lastIndex = 0;
    let markerMatch: RegExpExecArray | null;
    while ((markerMatch = markerRegex.exec(markdown)) !== null) {
      markerIndexes.push(Number(markerMatch[1]));
    }
  }

  return blocks.map((block, position) => {
    const headingMatch = block.match(/##\s+\d+\.\s+(.+?)\s+\((\d+)%\s+Virality\)/i);
    const headingTitle = headingMatch ? headingMatch[1].trim() : '';
    const virality = headingMatch ? Number(headingMatch[2]) : 0;

    const timestampMatch = block.match(/\*\*Timestamp\*\*:\s*([0-9:]+)\s*-\s*([0-9:]+)/i);
    const titleMatch = block.match(/\*\*Title Suggestion\*\*:\s*(.+)/i);
    const captionMatch = block.match(/\*\*Caption Suggestion\*\*:\s*(.+)/i);
    const hashtagMatch = block.match(/\*\*Hashtags\*\*:\s*(.+)/i);

    const keyQuotes: string[] = [];
    const quoteRegex = /^\s*-\s*\*"(.+?)"\*\s*$/gm;
    let quoteMatch: RegExpExecArray | null;
    while ((quoteMatch = quoteRegex.exec(block)) !== null) {
      keyQuotes.push(quoteMatch[1]);
    }

    const transcriptLines: string[] = [];
    let inTranscript = false;
    for (const line of block.split(/\r?\n/)) {
      if (/\*\*Transcript\*\*:/i.test(line)) {
        inTranscript = true;
        continue;
      }
      if (inTranscript) {
        const text = line.replace(/^\s*>\s?/, '').trim();
        if (text) transcriptLines.push(text);
      }
    }

    const caption = (captionMatch?.[1] || '').trim();
    const hashtags = hashtagMatch?.[1]
      ? extractHashtags(hashtagMatch[1])
      : extractHashtags(caption);

    return {
      index: hasMarkers ? (markerIndexes[position] ?? position) : position,
      headingTitle,
      virality,
      startTime: timestampMatch ? parseClipTimestamp(timestampMatch[1]) : 0,
      endTime: timestampMatch ? parseClipTimestamp(timestampMatch[2]) : 0,
      title: (titleMatch?.[1] || headingTitle).trim(),
      caption,
      hashtags,
      keyQuotes,
      transcript: transcriptLines.join('\n'),
    };
  });
}

export function findMarkdownEntry(entries: ClipMarkdownEntry[], sourceIndex: number): ClipMarkdownEntry | undefined {
  return entries.find(entry => entry.index === sourceIndex);
}
