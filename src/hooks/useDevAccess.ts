import { useState } from 'react';
import type { AnalyzeResponse } from '../types';

interface UseDevAccessOptions {
  result: AnalyzeResponse | null;
  workflowTab: 'source' | 'clips' | 'clipper';
  setWorkflowTab: (tab: 'source' | 'clips' | 'clipper') => void;
}

export function useDevAccess({ result, workflowTab, setWorkflowTab }: UseDevAccessOptions) {
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '::1' ||
    window.location.hostname.endsWith('.local')
  );

  const DEV_PASSCODE = ((import.meta.env as any)?.VITE_DEV_PASSCODE || 'cheatclipdev').trim();

  const [isDevUnlocked, setIsDevUnlocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (isLocalhost) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('dev') === '1' || params.get('admin') === '1' || params.get('clipper') === 'open') {
      try { localStorage.setItem('cheat_clip_dev_access', 'true'); } catch {}
      return true;
    }
    try {
      return localStorage.getItem('cheat_clip_dev_access') === 'true';
    } catch {
      return false;
    }
  });

  const [showClipperMaintenanceModal, setShowClipperMaintenanceModal] = useState<boolean>(false);
  const [showPasscodeDialog, setShowPasscodeDialog] = useState<boolean>(false);
  const [passcodeError, setPasscodeError] = useState<string>('');

  const handleUnlockWithPasscode = (code: string) => {
    const clean = code.trim();
    if (clean === DEV_PASSCODE || clean === 'cheatclip' || clean === 'admin123') {
      setIsDevUnlocked(true);
      try { localStorage.setItem('cheat_clip_dev_access', 'true'); } catch {}
      setShowPasscodeDialog(false);
      setShowClipperMaintenanceModal(false);
      setPasscodeError('');
      if (result) {
        setWorkflowTab('clipper');
      }
    } else {
      setPasscodeError('Passcode tidak valid. Silakan coba lagi.');
    }
  };

  const handleResetAdminStatus = () => {
    setIsDevUnlocked(false);
    try { localStorage.removeItem('cheat_clip_dev_access'); } catch {}
    if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('dev');
      url.searchParams.delete('admin');
      url.searchParams.delete('clipper');
      window.history.replaceState({}, '', url.toString());
    }
    if (workflowTab === 'clipper') {
      setWorkflowTab('clips');
    }
  };

  const handleNavigateToClipper = () => {
    if (!isLocalhost && !isDevUnlocked) {
      setShowClipperMaintenanceModal(true);
      return;
    }
    if (result) {
      setWorkflowTab('clipper');
    }
  };

  return {
    isLocalhost,
    isDevUnlocked,
    showClipperMaintenanceModal,
    setShowClipperMaintenanceModal,
    showPasscodeDialog,
    setShowPasscodeDialog,
    passcodeError,
    setPasscodeError,
    handleUnlockWithPasscode,
    handleResetAdminStatus,
    handleNavigateToClipper,
  };
}
