import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true);
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        window.setInterval(() => {
          if (navigator.onLine) {
            void registration.update();
          }
        }, 5 * 60 * 1000);
      }
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
