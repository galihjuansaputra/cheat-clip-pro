import { useState, useEffect } from 'react';
import { resilientFetch } from '../utils/api';

interface UseAiModelsOptions {
  apiKey: string;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  openRouterKey: string;
}

export function useAiModels({
  apiKey,
  selectedModel,
  setSelectedModel,
  openRouterKey,
}: UseAiModelsOptions) {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [openRouterModels, setOpenRouterModels] = useState<Array<{
    id: string;
    name: string;
    description?: string;
    context_length?: number;
    recommended?: boolean;
  }>>([]);
  const [loadingOpenRouterModels, setLoadingOpenRouterModels] = useState(false);

  // Fetch available AI models when API key is detected/entered
  useEffect(() => {
    const fetchModels = async () => {
      const cleanKey = apiKey.trim();
      if (!cleanKey || cleanKey.length < 20 || cleanKey.toLowerCase() === 'mock') {
        setAvailableModels([]);
        return;
      }
      setLoadingModels(true);
      try {
        const res = await resilientFetch('/api/models', {
          headers: {
            'X-Gemini-API-Key': cleanKey,
          },
          maxRetries: 3,
          retryDelay: 800,
          silent: true
        });
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            setAvailableModels(data.models);
            if (!data.models.includes(selectedModel) || selectedModel.includes('1.5') || selectedModel.includes('1.0')) {
              const fallback = data.models.find((m: string) => m.includes('flash')) || data.models[0] || 'gemini-2.0-flash';
              setSelectedModel(fallback);
              localStorage.setItem('cheat_clip_selected_model', fallback);
            }
          }
        }
      } catch (err) {
        console.error('Failed to retrieve available models:', err);
      } finally {
        setLoadingModels(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      fetchModels();
    }, 600);

    return () => clearTimeout(delayDebounce);
  }, [apiKey, selectedModel, setSelectedModel]);

  // OpenRouter models retrieval
  useEffect(() => {
    let isCancelled = false;
    const fetchOpenRouterModels = async () => {
      setLoadingOpenRouterModels(true);
      try {
        const cleanKey = openRouterKey.trim();
        const res = await resilientFetch('/api/openrouter-models', {
          headers: cleanKey ? {
            'X-OpenRouter-API-Key': cleanKey,
            'Authorization': `Bearer ${cleanKey}`
          } : undefined,
          maxRetries: 2,
          retryDelay: 800,
          silent: true
        });
        if (res.ok && !isCancelled) {
          const data = await res.json();
          if (data.models && Array.isArray(data.models) && data.models.length > 0) {
            setOpenRouterModels(data.models);
          }
        }
      } catch (err) {
        console.error('Failed to retrieve OpenRouter models:', err);
      } finally {
        if (!isCancelled) setLoadingOpenRouterModels(false);
      }
    };

    fetchOpenRouterModels();
    return () => {
      isCancelled = true;
    };
  }, [openRouterKey]);

  return {
    availableModels,
    loadingModels,
    openRouterModels,
    loadingOpenRouterModels,
  };
}
