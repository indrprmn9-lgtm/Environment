import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'default' | 'overlay';
  compactMobile?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'default',
  compactMobile = false,
}) => {
  const { isInstallable, isInstalled, isIOS, platform, install } =
    usePWAInstall();
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  useEffect(() => {
    if (!showInstallGuide) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowInstallGuide(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showInstallGuide]);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowInstallGuide(true);
      }
      return;
    }
    setShowInstallGuide(true);
  };

  const buttonClass =
    variant === 'overlay'
      ? 'min-h-[40px] flex items-center justify-center gap-2 rounded-xl border border-white/80 bg-[#FAFAF6]/95 px-3.5 sm:px-4 py-2 text-xs font-semibold text-[#14532D] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45)] hover:bg-white active:scale-[0.98] transition-all whitespace-nowrap shrink-0'
      : `min-h-[38px] sm:min-h-[40px] flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl bg-[#14532D] ${
          compactMobile ? 'px-2.5 sm:px-3.5' : 'px-4'
        } py-1.5 sm:py-2 text-xs font-semibold text-white hover:bg-[#0F3F22] active:scale-[0.98] transition-all whitespace-nowrap shrink-0`;

  const labelText = isIOS ? 'Instal di iOS' : 'Instal Aplikasi HP';

  const guideModal =
    showInstallGuide && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-guide-title"
            onClick={() => setShowInstallGuide(false)}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-stone-950/65 backdrop-blur-xs p-4 overflow-y-auto"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-[#FAFAF6] border border-stone-200 p-6 shadow-2xl space-y-5 my-auto"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#14532D]">
                    Mode Offline Lapangan
                  </p>
                  <h3
                    id="pwa-install-guide-title"
                    className="text-lg font-bold text-stone-900 font-display leading-snug"
                  >
                    {platform === 'ios'
                      ? 'Instal di iPhone / iPad'
                      : platform === 'android'
                      ? 'Instal Aplikasi di Android'
                      : 'Instal Aplikasi ke Perangkat'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-stone-500 hover:bg-stone-200/60 shrink-0"
                  aria-label="Tutup panduan"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {platform === 'ios' ? (
                <ol className="text-sm text-stone-700 space-y-3 leading-relaxed border-y border-stone-200/80 py-4">
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      01
                    </span>
                    <span>
                      Buka halaman ini di <strong>Safari</strong>, lalu ketuk
                      tombol <Share className="inline w-3.5 h-3.5 mx-0.5" />{' '}
                      <strong>Bagikan (Share)</strong> di bilah bawah.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      02
                    </span>
                    <span>
                      Gulir ke bawah dan pilih{' '}
                      <strong>Tambahkan ke Layar Utama</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      03
                    </span>
                    <span>
                      Buka ikon <strong>Environment</strong> dari layar utama
                      agar siap dipakai saat tanpa sinyal.
                    </span>
                  </li>
                </ol>
              ) : platform === 'android' ? (
                <ol className="text-sm text-stone-700 space-y-3 leading-relaxed border-y border-stone-200/80 py-4">
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      01
                    </span>
                    <span>
                      Pastikan tautan dibuka lewat <strong>Google Chrome</strong>
                      , lalu ketuk ikon menu{' '}
                      <MoreVertical className="inline w-3.5 h-3.5 mx-0.5" /> di
                      pojok kanan atas.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      02
                    </span>
                    <span>
                      Pilih <strong>Instal aplikasi</strong> atau{' '}
                      <strong>Tambahkan ke layar utama</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      03
                    </span>
                    <span>
                      Konfirmasi <strong>Instal</strong>, lalu buka aplikasi
                      dari ikon <strong>Environment</strong> di layar utama
                      sebelum masuk area blank spot.
                    </span>
                  </li>
                </ol>
              ) : (
                <ol className="text-sm text-stone-700 space-y-3 leading-relaxed border-y border-stone-200/80 py-4">
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      01
                    </span>
                    <span>
                      Klik ikon <strong>Instal</strong> di sisi kanan bilah
                      alamat Chrome/Edge, atau buka menu{' '}
                      <MoreVertical className="inline w-3.5 h-3.5 mx-0.5" /> di
                      pojok kanan atas.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-xs font-mono font-semibold text-[#14532D] mt-0.5">
                      02
                    </span>
                    <span>
                      Pilih <strong>Instal Environment</strong> agar aplikasi
                      tersimpan di perangkat Anda.
                    </span>
                  </li>
                </ol>
              )}

              <button
                type="button"
                onClick={() => setShowInstallGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-[#14532D] text-white text-sm font-semibold hover:bg-[#0F3F22] transition-colors"
              >
                Mengerti
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button type="button" onClick={handleClick} className={buttonClass}>
        {isIOS ? (
          <Smartphone className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
        ) : (
          <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
        )}
        {compactMobile ? (
          <>
            <span className="sm:hidden">Instal</span>
            <span className="hidden sm:inline">{labelText}</span>
          </>
        ) : (
          <span>{labelText}</span>
        )}
      </button>

      {guideModal}
    </>
  );
};
