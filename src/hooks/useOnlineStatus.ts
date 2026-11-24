import { useEffect, useState } from 'react';
import { checkServerReachable } from '../lib/apiClient';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    let active = true;

    const verifyOnline = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (active) setIsOnline(false);
        return;
      }
      const reachable = await checkServerReachable();
      if (active) {
        setIsOnline(reachable);
      }
    };

    const handleOnline = () => {
      void verifyOnline();
    };
    const handleOffline = () => {
      if (active) setIsOnline(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void verifyOnline();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    // Periodic lightweight connectivity check when app is active
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void verifyOnline();
      }
    }, 20000);

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, []);

  return isOnline;
}
