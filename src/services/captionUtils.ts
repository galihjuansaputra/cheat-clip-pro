import type { CaptionStyle, TextCaseOption, TranscriptLine } from '../types';

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionChunk {
  words: CaptionWord[];
  start: number;
  end: number;
}

export const CAPTION_STYLE_CONFIG: Record<CaptionStyle, { highlight: string; sample: [string, string] }> = {
  viral_pop: { highlight: '#FFE600', sample: ['VIRAL', 'POP'] },
  beast_punch: { highlight: '#00FF66', sample: ['UNREAL', 'HACK'] },
  cyber_violet: { highlight: '#D946EF', sample: ['CYBER', 'PUNCH'] },
  fire_red: { highlight: '#FF2E2E', sample: ['HOT', 'FIRE'] },
  electric_cyan: { highlight: '#00F0FF', sample: ['ELECTRIC', 'CYAN'] },
  golden_aura: { highlight: '#FFB800', sample: ['GOLDEN', 'MOMENT'] },
  clean_minimal: { highlight: '#38BDF8', sample: ['CLEAN', 'SUBTITLE'] },
  none: { highlight: '#FFFFFF', sample: ['', ''] },
};

export function cleanCaptionText(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\[.*?\]|\(.*?\)|[*].*?[*]/g, ' ')
    .replace(/\b(laughter|applause|music|cheering|snickering|giggle|cough)\b/gi, ' ')
    .replace(/^\s*[\.,…:;]+\s*/, '')
    .replace(/\s*[\.,…:;]+\s*$/, '')
    .replace(/[^\w\s.,%&$?]|_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function applyLetterCase(text: string, style?: TextCaseOption | string): string {
  if (!text) return '';
  if (style === 'uppercase') return text.toUpperCase();
  if (style === 'lowercase') return text.toLowerCase();
  if (style === 'capitalize') {
    return text.toLowerCase().replace(/(?:^|\s|\b)\w/g, c => c.toUpperCase());
  }
  return text;
}

/**
 * Returns the proper font-weight for a given font family.
 * Single-weight display fonts (Bebas Neue, Anton, Impact) require '400' / normal to match
 * Google Fonts @font-face rules, whereas standard sans fonts (Outfit, Montserrat, Inter) use 800.
 */
export function getFontWeightForFamily(fontName?: string): string {
  const norm = (fontName || '').toLowerCase().trim();
  if (norm.includes('anton') || norm.includes('bebas') || norm.includes('impact')) {
    return '400';
  }
  if (norm.includes('arial black')) {
    return '900';
  }
  return '800';
}

/**
 * Returns a CSS-safe font-family string with quotes and fallback font family.
 */
export function getFontFamilyWithFallback(fontName?: string): string {
  const clean = (fontName || 'Outfit').replace(/['"]/g, '').trim();
  const lower = clean.toLowerCase();
  if (lower.includes('impact')) {
    return `"${clean}", "Anton", sans-serif`;
  }
  if (lower.includes('arial black')) {
    return `"${clean}", "Montserrat", sans-serif`;
  }
  return `"${clean}", sans-serif`;
}

/**
 * Builds aligned 1-to-3 word chunks for a given video segment [clipStart, clipEnd],
 * perfectly matching the preview and backend subtitle generator.
 */
export function buildCaptionChunksForClip(
  transcript?: TranscriptLine[],
  clipStart: number = 0,
  clipEnd: number = 60,
  fallbackText?: string
): CaptionChunk[] {
  const allWords: CaptionWord[] = [];

  // 1. Primary: Extract from timestamped transcript lines
  if (transcript && transcript.length > 0) {
    const relevantLines = transcript.filter(line => {
      const lStart = line.start;
      const lEnd = (typeof line.end === 'number' && line.end > lStart) ? line.end : (lStart + ((line as any).duration || 2.0));
      return lEnd >= clipStart - 0.5 && lStart <= clipEnd + 0.5;
    });

    for (const line of relevantLines) {
      const cleaned = cleanCaptionText(line.text || '');
      if (!cleaned) continue;
      const lStart = line.start;
      const lEnd = (typeof line.end === 'number' && line.end > lStart) ? line.end : (lStart + ((line as any).duration || 2.0));
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;

      const rawLineDur = Math.max(0.4, lEnd - lStart);
      const maxPlausibleDur = tokens.length * 0.52 + 0.25;
      const spokenDuration = Math.min(rawLineDur, maxPlausibleDur);

      const tokenWeights = tokens.map(t => Math.max(2, t.replace(/[^a-zA-Z0-9]/g, '').length || t.length));
      const totalWeight = tokenWeights.reduce((a, b) => a + b, 0);

      let curTime = lStart;
      tokens.forEach((tok, idx) => {
        const ratio = tokenWeights[idx] / Math.max(1, totalWeight);
        const wDur = Math.max(0.14, Math.min(0.60, spokenDuration * ratio));
        const wStart = curTime;
        const wEnd = wStart + wDur;
        curTime = wEnd;

        allWords.push({
          text: tok,
          start: wStart,
          end: wEnd,
        });
      });
    }
  }

  // 2. Fallback: If no transcript lines found, use fallbackText
  if (allWords.length === 0 && fallbackText) {
    const cleaned = cleanCaptionText(fallbackText);
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const duration = Math.max(1, clipEnd - clipStart);
      const maxPlausibleDur = tokens.length * 0.52 + 0.25;
      const spokenDuration = Math.min(duration, maxPlausibleDur);
      const tokenWeights = tokens.map(t => Math.max(2, t.replace(/[^a-zA-Z0-9]/g, '').length || t.length));
      const totalWeight = tokenWeights.reduce((a, b) => a + b, 0);

      let curTime = clipStart;
      tokens.forEach((tok, idx) => {
        const ratio = tokenWeights[idx] / Math.max(1, totalWeight);
        const wDur = Math.max(0.14, Math.min(0.60, spokenDuration * ratio));
        const wStart = curTime;
        const wEnd = wStart + wDur;
        curTime = wEnd;

        allWords.push({
          text: tok,
          start: wStart,
          end: wEnd,
        });
      });
    }
  }

  if (allWords.length === 0) return [];

  // Group words into punchy chunks of 1 to 3 words (max 18 chars), splitting on punctuation or pauses >= 0.28s
  const chunks: CaptionChunk[] = [];
  let currentWords: CaptionWord[] = [];
  let currentChars = 0;

  for (const w of allWords) {
    const wLen = w.text.length;
    const hasPause = currentWords.length > 0 && (w.start - currentWords[currentWords.length - 1].end >= 0.28);
    const endsSentence = currentWords.length > 0 && /[.?!,]$/.test(currentWords[currentWords.length - 1].text);

    if (currentWords.length >= 3 || hasPause || endsSentence || (currentWords.length > 0 && currentChars + wLen > 18)) {
      chunks.push({
        words: currentWords,
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
      });
      currentWords = [w];
      currentChars = wLen;
    } else {
      currentWords.push(w);
      currentChars += wLen + 1;
    }
  }
  if (currentWords.length > 0) {
    chunks.push({
      words: currentWords,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
    });
  }

  // Anti-orphan balancing pass: strictly prevent single-word chunks when total words >= 2
  if (allWords.length >= 2 && chunks.length > 1) {
    let changed = true;
    let passes = 0;
    while (changed && passes < 10) {
      changed = false;
      passes++;
      let i = 0;
      while (i < chunks.length) {
        if (chunks[i].words.length === 1 && chunks.length > 1) {
          if (i > 0) {
            const prevChunk = chunks[i - 1];
            if (prevChunk.words.length >= 3) {
              const movedWord = prevChunk.words.pop()!;
              chunks[i].words.unshift(movedWord);
              prevChunk.end = prevChunk.words[prevChunk.words.length - 1].end;
              chunks[i].start = chunks[i].words[0].start;
              changed = true;
            } else {
              prevChunk.words.push(...chunks[i].words);
              prevChunk.end = prevChunk.words[prevChunk.words.length - 1].end;
              chunks.splice(i, 1);
              changed = true;
              continue;
            }
          } else if (i < chunks.length - 1) {
            const nextChunk = chunks[i + 1];
            if (nextChunk.words.length >= 3) {
              const movedWord = nextChunk.words.shift()!;
              chunks[i].words.push(movedWord);
              chunks[i].end = chunks[i].words[chunks[i].words.length - 1].end;
              nextChunk.start = nextChunk.words[0].start;
              changed = true;
            } else {
              chunks[i].words.push(...nextChunk.words);
              chunks[i].end = chunks[i].words[chunks[i].words.length - 1].end;
              chunks.splice(i + 1, 1);
              changed = true;
              continue;
            }
          }
        }
        i++;
      }
    }
  }

  return chunks;
}

/**
 * Wraps title cleanly into 1, 2, or 3 balanced lines separated by newline '\n'.
 * Strictly caps at 3 lines max (never 4 lines).
 * Prevents orphan single-word lines when total words >= 4 (each line has at least 2 words).
 * Preserves manual newlines (capped to max 3 lines with orphan balancing).
 */
export function wrapTitleSmart(
  text: string,
  maxSingleLen: number = 22
): { formatted: string; lineCount: number } {
  const raw = text.trim();
  if (!raw) return { formatted: '', lineCount: 1 };

  // Preserve manual newlines if the user specifically broke lines, capped at max 3 lines
  if (raw.includes('\n')) {
    const lines = raw
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    while (lines.length > 3) {
      lines[lines.length - 2] = lines[lines.length - 2] + ' ' + lines[lines.length - 1];
      lines.pop();
    }
    const allManualWords = lines.reduce((acc, l) => acc + l.split(/\s+/).filter(Boolean).length, 0);
    if (allManualWords >= 4) {
      for (let idx = 0; idx < lines.length; idx++) {
        const wList = lines[idx].split(/\s+/).filter(Boolean);
        if (wList.length === 1) {
          if (idx > 0) {
            const prevW = lines[idx - 1].split(/\s+/).filter(Boolean);
            if (prevW.length > 2) {
              wList.unshift(prevW.pop()!);
              lines[idx - 1] = prevW.join(' ');
              lines[idx] = wList.join(' ');
            }
          } else if (idx < lines.length - 1) {
            const nextW = lines[idx + 1].split(/\s+/).filter(Boolean);
            if (nextW.length > 2) {
              wList.push(nextW.shift()!);
              lines[idx + 1] = nextW.join(' ');
              lines[idx] = wList.join(' ');
            }
          }
        }
      }
    }
    return { formatted: lines.join('\n'), lineCount: Math.max(1, lines.length) };
  }

  const words = raw.split(/\s+/).filter(Boolean);
  const totalWords = words.length;
  const totalLen = raw.length;

  if (totalWords <= 1 || totalLen <= maxSingleLen) {
    return { formatted: raw, lineCount: 1 };
  }
  if (totalWords === 2) {
    return { formatted: words.join('\n'), lineCount: 2 };
  }
  if (totalWords === 3) {
    if (totalLen <= maxSingleLen) {
      return { formatted: raw, lineCount: 1 };
    }
    return { formatted: `${words[0]} ${words[1]}\n${words[2]}`, lineCount: 2 };
  }

  // For >= 4 words: strictly 2 or 3 lines max, and NEVER leave 1 lonely word on any line
  const targetLines = totalWords >= 6 && totalLen > maxSingleLen * 1.2 ? 3 : 2;

  if (targetLines === 2) {
    let bestDiff = Infinity;
    let bestSplit = Math.floor(totalWords / 2);
    for (let k = 2; k <= totalWords - 2; k++) {
      const l1 = words.slice(0, k).join(' ');
      const l2 = words.slice(k).join(' ');
      const diff = Math.abs(l1.length - l2.length);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestSplit = k;
      }
    }
    const lines = [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
    return { formatted: lines.join('\n'), lineCount: 2 };
  } else {
    let bestScore = Infinity;
    let bestSplit = [2, 4];
    for (let i = 2; i <= totalWords - 4; i++) {
      for (let j = i + 2; j <= totalWords - 2; j++) {
        const l1 = words.slice(0, i).join(' ');
        const l2 = words.slice(i, j).join(' ');
        const l3 = words.slice(j).join(' ');
        const lengths = [l1.length, l2.length, l3.length];
        const score = Math.max(...lengths) - Math.min(...lengths);
        if (score < bestScore) {
          bestScore = score;
          bestSplit = [i, j];
        }
      }
    }
    const [i, j] = bestSplit;
    const lines = [
      words.slice(0, i).join(' '),
      words.slice(i, j).join(' '),
      words.slice(j).join(' '),
    ];
    return { formatted: lines.join('\n'), lineCount: 3 };
  }
}
