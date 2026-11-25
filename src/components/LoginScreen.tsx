import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  FolderCheck,
  FolderOpen,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Trees,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  type BackupPreferenceInfo,
  getBackupPreferenceInfo,
  pickPhoneBackupDirectory,
} from '../lib/deviceBackup';
import { PWAInstallButton } from './PWAInstallButton';

const MAIN_FOREST_BACKGROUND =
  '/assets/aistudio/thick-forest-5120x2880-14776_2cf69776.jpg';

const ForestBackdrop: React.FC<{
  imgFailed: boolean;
  onError: () => void;
}> = ({ imgFailed, onError }) => (
  <div aria-hidden="true" className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
    <div className="absolute inset-0 bg-gradient-to-br from-[#07180E] via-[#113D23] to-[#051009]" />
    {!imgFailed && (
      <img
        src={MAIN_FOREST_BACKGROUND}
        alt="Latar hutan dengan cahaya matahari pagi"
        referrerPolicy="no-referrer"
        onError={onError}
        className="absolute inset-0 w-full h-full object-cover object-center select-none scale-[1.02]"
      />
    )}
    {/* Multi-layered atmospheric botanical scrim for serene readability */}
    <div className="absolute inset-0 bg-gradient-to-b from-[#041008]/80 via-[#071C10]/52 to-[#040E07]/88" />
    <div className="absolute inset-0 bg-gradient-to-r from-[#041109]/85 via-[#092314]/42 to-[#041109]/65" />
  </div>
);

export const LoginScreen: React.FC = () => {
  const {
    firebaseUser,
    authStatus,
    authError,
    signInWithGoogle,
    logout,
    refreshProfile,
  } = useAuth();
  const isOnline = useOnlineStatus();
  const [copied, setCopied] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [backupInfo, setBackupInfo] = useState<BackupPreferenceInfo>({
    folderName: null,
    supportsDirectoryPicker: false,
    hasDirectoryHandle: false,
  });
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  useEffect(() => {
    void getBackupPreferenceInfo().then(setBackupInfo);
  }, []);

  const handlePickBackupDir = async () => {
    setBackupNotice(null);
    try {
      const res = await pickPhoneBackupDirectory();
      const updated = await getBackupPreferenceInfo();
      setBackupInfo(updated);
      setBackupNotice(
        res.mode === 'directory_handle'
          ? `Folder cadangan harian aktif: "${res.folderName}"`
          : `Mode unduhan otomatis diaktifkan (${res.folderName}).`
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Pemilihan folder dibatalkan.';
      if (!msg.toLowerCase().includes('abort')) {
        setBackupNotice(msg);
      }
    }
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    await signInWithGoogle();
    setSigningIn(false);
  };

  const handleCopyEmail = () => {
    if (!firebaseUser?.email) return;
    navigator.clipboard?.writeText(firebaseUser.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (authStatus === 'loading') {
    return (
      <div className="relative isolate min-h-[100dvh] bg-[#07180E] flex flex-col items-center justify-center p-5 sm:p-8">
        <ForestBackdrop
          imgFailed={imgFailed}
          onError={() => setImgFailed(true)}
        />
        <div className="relative z-10 w-full max-w-sm bg-[#FAFAF6]/95 backdrop-blur-xl border border-white/75 rounded-2xl p-8 text-center space-y-5 shadow-[0_32px_72px_-16px_rgba(4,16,9,0.55)]">
          <div className="w-12 h-12 rounded-xl border border-[#14532D]/15 bg-[#14532D]/8 text-[#14532D] flex items-center justify-center mx-auto">
            <Trees className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#14532D]">
              Environment
            </p>
            <h1 className="text-xl font-bold tracking-tight text-stone-900 font-display">
              Menyiapkan Ruang Kerja
            </h1>
            <p className="text-sm text-stone-600 leading-relaxed">
              Memeriksa akses petugas dan preferensi cadangan perangkat...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthorized' || authStatus === 'inactive') {
    return (
      <div className="relative isolate min-h-[100dvh] bg-[#07180E] flex items-center justify-center p-4 sm:p-8">
        <ForestBackdrop
          imgFailed={imgFailed}
          onError={() => setImgFailed(true)}
        />
        <div className="relative z-10 w-full max-w-md bg-[#FAFAF6]/96 backdrop-blur-xl border border-white/75 rounded-2xl p-6 sm:p-8 shadow-[0_32px_72px_-16px_rgba(4,16,9,0.55)] divide-y divide-stone-200/85">
          <div className="pb-6 flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl border border-amber-200 bg-amber-50/90 text-amber-800 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800">
                Verifikasi Akses
              </div>
              <h1 className="text-xl font-bold tracking-tight text-stone-900 font-display leading-snug">
                {authStatus === 'inactive'
                  ? 'Akun Petugas Dinonaktifkan'
                  : 'Email Belum Terdaftar'}
              </h1>
              <p className="text-sm text-stone-600 leading-relaxed">
                {authStatus === 'inactive'
                  ? 'Akses akun Anda saat ini sedang dinonaktifkan oleh Administrator.'
                  : 'Hanya email Google yang sudah didaftarkan oleh Administrator yang dapat menginput data sensus dan monitoring.'}
              </p>
            </div>
          </div>

          <div className="py-5 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Email Google yang Sedang Masuk
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-mono font-medium text-stone-900 truncate">
                {firebaseUser?.email}
              </span>
              <button
                type="button"
                onClick={handleCopyEmail}
                className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-stone-300/90 bg-white text-xs font-semibold text-stone-800 hover:border-stone-400 hover:bg-stone-50 flex items-center gap-1.5 shrink-0 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#14532D]" />
                    Tersalin
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Salin
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={refreshProfile}
              className="flex-1 min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F3F22] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Cek Ulang Akses
            </button>
            <button
              type="button"
              onClick={logout}
              className="min-h-[46px] px-4 py-2.5 flex items-center justify-center gap-2 rounded-xl border border-stone-300/90 bg-white text-sm font-semibold text-stone-800 hover:bg-stone-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Ganti Akun
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate min-h-[100dvh] bg-[#07180E] flex flex-col justify-between px-4 py-5 sm:px-8 sm:py-7 lg:px-12 lg:py-8 gap-6">
      <ForestBackdrop
        imgFailed={imgFailed}
        onError={() => setImgFailed(true)}
      />

      {/* Minimal Top Bar */}
      <header className="relative z-10 max-w-6xl w-full mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg border border-white/25 bg-white/12 backdrop-blur-md flex items-center justify-center text-emerald-100 shrink-0">
            <Trees className="w-4 h-4" />
          </div>
          <span className="text-lg sm:text-xl font-bold font-display text-white tracking-tight whitespace-nowrap shrink-0 drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)]">
            Environment
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton variant="overlay" />
        </div>
      </header>

      {/* Main Split Editorial & Operational Portal */}
      <main className="relative z-10 max-w-6xl w-full mx-auto my-auto py-2 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 sm:gap-9 lg:gap-14 items-center">
          {/* Left Column: Serene Atmospheric Field Narrative */}
          <div className="lg:col-span-6 space-y-4 sm:space-y-6 text-white">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200/90">
              PT. NBSS · PT. DTSA · PT. DTR
            </div>

            <h1 className="text-[28px] sm:text-4xl lg:text-[44px] font-bold font-display leading-[1.13] tracking-[-0.025em] text-white max-w-xl">
              Pencatatan Lapangan yang Presisi, Tenang, dan Siap Tanpa Sinyal.
            </h1>

            <div className="w-14 h-px bg-emerald-200/40" aria-hidden="true" />

            <p className="text-sm sm:text-base text-stone-100/90 leading-relaxed max-w-lg">
              Berdoa sebelum bekerja, utamakan keselamatan kerja, serta gunakan
              APD lengkap di seluruh area operasional.
            </p>

            <div className="pt-1 hidden sm:flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-100/80 tracking-wide">
              <span>Sensus Tanaman</span>
              <span aria-hidden="true" className="text-emerald-200/50">
                ·
              </span>
              <span>Monitoring IPPKH</span>
              <span aria-hidden="true" className="text-emerald-200/50">
                ·
              </span>
              <span>Monitoring APL</span>
              <span aria-hidden="true" className="text-emerald-200/50">
                ·
              </span>
              <span>Cadangan Lokal Otomatis</span>
            </div>
          </div>

          {/* Right Column: Warm Mineral Alabaster Entry Sheet */}
          <div className="lg:col-span-6 w-full max-w-xl mx-auto lg:max-w-none bg-[#FAFAF6]/96 backdrop-blur-xl border border-white/80 rounded-3xl p-6 sm:p-9 lg:p-10 shadow-[0_32px_72px_-16px_rgba(4,16,9,0.58)] divide-y divide-stone-200/85">
            {/* Portal Heading */}
            <div className="pb-6 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#14532D]">
                Sistem Sensus &amp; Monitoring Tanaman
              </div>
              <h2 className="text-2xl sm:text-[26px] font-bold tracking-tight text-stone-900 font-display leading-snug">
                Persiapan Sesi Kerja
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Atur lokasi cadangan harian di perangkat Anda, lalu masuk
                dengan akun Google yang terdaftar untuk memulai pencatatan.
              </p>
            </div>

            {/* Step 01: Daily Backup Location (Hairline Row, Zero Nested Card) */}
            <div className="py-6 space-y-3.5">
              <div className="flex items-start gap-3.5">
                <span className="mt-0.5 text-xs font-mono font-semibold text-[#14532D]/75 tabular-nums select-none">
                  01
                </span>
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-stone-900">
                      Lokasi Cadangan Harian di Perangkat
                    </h3>
                    {backupInfo.folderName && (
                      <span className="text-[11px] font-semibold text-[#14532D] shrink-0">
                        Aktif
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Mengantisipasi kendala unggah saat sinyal lemah, data hari
                    ini dicadangkan otomatis ke folder pilihan Anda.
                  </p>
                </div>
              </div>

              <div className="pl-0 sm:pl-7 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2 text-xs">
                  {backupInfo.folderName ? (
                    <>
                      <FolderCheck className="w-4 h-4 text-[#14532D] shrink-0" />
                      <span className="font-mono font-medium text-stone-800 truncate">
                        {backupInfo.folderName}
                      </span>
                    </>
                  ) : (
                    <>
                      <FolderOpen className="w-4 h-4 text-stone-400 shrink-0" />
                      <span className="text-stone-500">
                        Belum memilih folder cadangan
                      </span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handlePickBackupDir}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-stone-300/90 bg-white text-xs font-semibold text-stone-800 hover:border-[#14532D]/45 hover:bg-stone-50 active:scale-[0.99] flex items-center justify-center gap-2 shrink-0 transition-all"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#14532D]" />
                  {backupInfo.folderName
                    ? 'Ubah Lokasi'
                    : 'Pilih Folder Perangkat'}
                </button>
              </div>

              {backupNotice && (
                <p className="pl-0 sm:pl-7 text-xs font-medium text-[#14532D]">
                  {backupNotice}
                </p>
              )}
            </div>

            {/* Step 02: Google Account Sign-In */}
            <div className="pt-6 space-y-4">
              <div className="flex items-start gap-3.5">
                <span className="mt-0.5 text-xs font-mono font-semibold text-[#14532D]/75 tabular-nums select-none">
                  02
                </span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-stone-900">
                    Autentikasi Akun Google
                  </h3>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Gunakan email Google yang telah didaftarkan oleh
                    Administrator perusahaan.
                  </p>
                </div>
              </div>

              {!isOnline && (
                <div className="rounded-xl bg-amber-50/90 border border-amber-200/90 p-3.5 flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed">
                  <WifiOff className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                  <span>
                    Perangkat sedang offline. Login Google pertama kali
                    membutuhkan koneksi internet sebelum dapat dipakai tanpa
                    sinyal di lapangan.
                  </span>
                </div>
              )}

              {authError && (
                <div className="rounded-xl bg-red-50/90 border border-red-200/90 p-3.5 text-xs text-red-800 leading-relaxed">
                  {authError}
                </div>
              )}

              <button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn || !isOnline}
                className="group w-full min-h-[52px] flex items-center justify-between gap-3 rounded-xl bg-[#14532D] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgba(20,83,45,0.55)] hover:bg-[#0F3F22] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <span className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-white/95 text-[#14532D] flex items-center justify-center shrink-0">
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                      />
                    </svg>
                  </span>
                  <span>
                    {signingIn
                      ? 'Menghubungkan Akun Google...'
                      : 'Masuk dengan Akun Google'}
                  </span>
                </span>
                <ArrowUpRight className="w-4 h-4 text-emerald-200 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="relative z-10 max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-200/80 pb-safe">
        <span>Environment · Sistem Sensus &amp; Monitoring Terpadu</span>
        <span className="text-stone-300/70">
          Data Lapangan Terpusat Administrator
        </span>
      </footer>
    </div>
  );
};
