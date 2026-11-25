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
    if (!result?.clips) return [];
    return result.clips.filter((clip) => {
      const matchesSearch =
        searchQuery.trim() === '' ||
        clip.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        clip.transcript.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesVirality =
        viralityFilter === 'all' ||
        (viralityFilter === 'high' && clip.virality_score >= 90) ||
        (viralityFilter === 'medium' && clip.virality_score < 90) ||
        (viralityFilter === 'marked' && !!markedClips[`${clip.start_time}_${clip.end_time}`]);

      return matchesSearch && matchesVirality;
    });
  }, [result?.clips, searchQuery, viralityFilter, markedClips]);

  // Sort the filtered clips based on selected sortBy
  const sortedClips = useMemo(() => {
    return [...filteredClips].sort((a, b) => {
      if (sortBy === 'virality') {
        return b.virality_score - a.virality_score;
      } else if (sortBy === 'time') {
        return a.start_time - b.start_time;
      } else if (sortBy === 'duration') {
        return b.end_time - b.start_time - (a.end_time - a.start_time);
      } else if (sortBy === 'marked') {
        const aMarked = !!markedClips[`${a.start_time}_${a.end_time}`];
        const bMarked = !!markedClips[`${b.start_time}_${b.end_time}`];
        if (aMarked && !bMarked) return -1;
        if (!aMarked && bMarked) return 1;
        return b.virality_score - a.virality_score;
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
