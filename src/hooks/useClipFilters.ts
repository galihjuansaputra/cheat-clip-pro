import { useState, useMemo, useEffect, useRef } from 'react';
import type { AnalyzeResponse, ViralClip } from '../types';

interface UseClipFiltersOptions {
  result: AnalyzeResponse | null;
  activeClip: ViralClip | null;
  currentTime: number;
  markedClips: Record<string, boolean>;
}

export function useClipFilters({
  result,
  activeClip,
  currentTime,
  markedClips,
}: UseClipFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viralityFilter, setViralityFilter] = useState<'all' | 'high' | 'medium' | 'marked'>('all');
  const [sortBy, setSortBy] = useState<'virality' | 'time' | 'duration' | 'marked'>('virality');
  const [expandedClipIndex, setExpandedClipIndex] = useState<number | null>(null);

  // Clear expanded clip index when filters or sorting change
  useEffect(() => {
    setExpandedClipIndex(null);
  }, [sortBy, viralityFilter, searchQuery]);

  // Filter clips based on query and virality filters
  const filteredClips = useMemo(() => {
    if (!result?.clips || !Array.isArray(result.clips)) return [];
    const q = (searchQuery || '').trim().toLowerCase();

    return result.clips.filter((clip) => {
      if (!clip) return false;
      const title = (clip.title || '').toLowerCase();
      const transcript = (clip.transcript || '').toLowerCase();

      const matchesSearch =
        q === '' ||
        title.includes(q) ||
        transcript.includes(q);

      const score = typeof clip.virality_score === 'number' ? clip.virality_score : 0;
      const clipKey = `${clip.start_time ?? 0}_${clip.end_time ?? 0}`;

      const matchesVirality =
        viralityFilter === 'all' ||
        (viralityFilter === 'high' && score >= 90) ||
        (viralityFilter === 'medium' && score < 90) ||
        (viralityFilter === 'marked' && !!markedClips[clipKey]);

      return matchesSearch && matchesVirality;
    });
  }, [result?.clips, searchQuery, viralityFilter, markedClips]);

  // Sort the filtered clips based on selected sortBy
  const sortedClips = useMemo(() => {
    return [...filteredClips].sort((a, b) => {
      if (!a || !b) return 0;
      const aScore = typeof a.virality_score === 'number' ? a.virality_score : 0;
      const bScore = typeof b.virality_score === 'number' ? b.virality_score : 0;
      const aStart = typeof a.start_time === 'number' ? a.start_time : 0;
      const bStart = typeof b.start_time === 'number' ? b.start_time : 0;
      const aEnd = typeof a.end_time === 'number' ? a.end_time : aStart;
      const bEnd = typeof b.end_time === 'number' ? b.end_time : bStart;

      if (sortBy === 'virality') {
        return bScore - aScore;
      } else if (sortBy === 'time') {
        return aStart - bStart;
      } else if (sortBy === 'duration') {
        return (bEnd - bStart) - (aEnd - aStart);
      } else if (sortBy === 'marked') {
        const aMarked = !!markedClips[`${aStart}_${aEnd}`];
        const bMarked = !!markedClips[`${bStart}_${bEnd}`];
        if (aMarked && !bMarked) return -1;
        if (!aMarked && bMarked) return 1;
        return bScore - aScore;
      }
      return 0;
    });
  }, [filteredClips, sortBy, markedClips]);

  // Smooth scroll active clip card into view in the sidebar list ONLY when activeClip changes
  const prevActiveClipKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeClip) return;
    const clipKey = `${activeClip.start_time}_${activeClip.end_time}`;
    if (prevActiveClipKeyRef.current === clipKey) return;
    prevActiveClipKeyRef.current = clipKey;

    if (sortedClips) {
      const index = sortedClips.findIndex(
        (c) => c.start_time === activeClip.start_time && c.end_time === activeClip.end_time
      );
      if (index !== -1) {
        const element = document.getElementById(`clip-card-${index}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }, [activeClip, sortedClips]);

  // Find current subtitle line with slight gap tolerance to prevent jitter
  const currentSubtitle = useMemo(() => {
    return result?.transcript?.find(
      (line) => currentTime >= line.start - 0.05 && currentTime <= line.end + 0.25
    );
  }, [result?.transcript, currentTime]);

  return {
    searchQuery,
    setSearchQuery,
    viralityFilter,
    setViralityFilter,
    sortBy,
    setSortBy,
    expandedClipIndex,
    setExpandedClipIndex,
    filteredClips,
    sortedClips,
    currentSubtitle,
  };
}
