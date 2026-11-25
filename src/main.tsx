import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    // Clean up any stale/invalid dev service workers from earlier sessions
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)))
      )
      .catch(() => {});
  } else {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        void Promise.resolve(updateSW(true)).catch(() => {});
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        window.setInterval(() => {
          if (!navigator.onLine) return;
          const worker =
            registration.active || registration.waiting || registration.installing;
          if (!worker || worker.state === 'redundant') return;
          try {
            void registration.update().catch(() => {});
          } catch {
            // Ignore InvalidStateError if registration became invalid
          }
        }, 5 * 60 * 1000);
      },
      onRegisterError() {
        // Ignore transient or unsupported SW registration errors (e.g. restricted iframe/incognito)
      },
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);
