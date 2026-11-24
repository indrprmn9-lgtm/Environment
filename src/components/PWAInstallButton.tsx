import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="min-h-[40px] flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F3F22] active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
      >
        <Download className="w-4 h-4 shrink-0" />
        Instal Aplikasi HP
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[40px] flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-4 h-4 shrink-0 text-[#14532D]" />
          Instal di iOS
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white border border-stone-200 p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-stone-900 font-display">
                  Instal Aplikasi di iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100"
                  aria-label="Tutup panduan"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="text-sm text-stone-600 space-y-2.5 list-decimal list-inside leading-relaxed">
                <li>
                  Ketuk tombol <strong>Bagikan (Share)</strong> di bilah Safari.
                </li>
                <li>
                  Gulir ke bawah dan pilih{' '}
                  <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
                </li>
                <li>
                  Buka Environment dari layar utama agar siap dipakai saat tanpa
                  sinyal.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-[#14532D] text-white text-sm font-semibold hover:bg-[#0F3F22] transition-colors"
              >
                Mengerti
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
