import React, { useEffect, useState } from 'react';
import {
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
  <>
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-20 bg-gradient-to-br from-[#0B2214] via-[#14532D] to-[#08170E]"
    />
    {!imgFailed && (
      <img
        src={MAIN_FOREST_BACKGROUND}
        alt="Latar hutan dengan cahaya matahari pagi"
        referrerPolicy="no-referrer"
        onError={onError}
        className="fixed inset-0 -z-10 w-full h-full object-cover object-center select-none pointer-events-none"
      />
    )}
    <div
      aria-hidden="true"
      className="fixed inset-0 -z-10 bg-gradient-to-br from-[#07130B]/70 via-[#0D2215]/45 to-[#07130B]/78 pointer-events-none"
    />
  </>
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
      <div className="relative min-h-screen flex flex-col items-center justify-center p-6">
        <ForestBackdrop
          imgFailed={imgFailed}
          onError={() => setImgFailed(true)}
        />
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-md border border-white/60 rounded-2xl p-8 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-[#14532D]/10 text-[#14532D] flex items-center justify-center mx-auto">
            <Trees className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-stone-900 font-display">
              Environment
            </h1>
            <p className="text-sm text-stone-600">
              Memeriksa akses petugas dan penyimpanan lokal...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthorized' || authStatus === 'inactive') {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-6">
        <ForestBackdrop
          imgFailed={imgFailed}
          onError={() => setImgFailed(true)}
        />
        <div className="w-full max-w-md bg-white/95 backdrop-blur-md border border-white/60 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-bold text-stone-900 font-display">
                {authStatus === 'inactive'
                  ? 'Akun Petugas Dinonaktifkan'
                  : 'Email Belum Terdaftar sebagai Petugas'}
              </h1>
              <p className="text-sm text-stone-600 leading-relaxed">
                {authStatus === 'inactive'
                  ? 'Akses akun Anda saat ini sedang dinonaktifkan oleh Administrator.'
                  : 'Hanya email Google yang sudah didaftarkan oleh Administrator yang dapat menginput data sensus dan monitoring.'}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[#F6F7F4] border border-stone-200 p-4 space-y-1.5">
            <div className="text-xs font-medium text-stone-500">
              Email Google yang sedang masuk
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-mono font-medium text-stone-900 truncate">
                {firebaseUser?.email}
              </span>
              <button
                type="button"
                onClick={handleCopyEmail}
                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-50 flex items-center gap-1.5 shrink-0"
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

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={refreshProfile}
              className="flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F3F22] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Cek Ulang Akses
            </button>
            <button
              type="button"
              onClick={logout}
              className="min-h-[44px] px-4 py-2 flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50 transition-colors"
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
    <div className="relative min-h-screen flex flex-col justify-between p-4 sm:p-8">
      <ForestBackdrop
        imgFailed={imgFailed}
        onError={() => setImgFailed(true)}
      />

      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-8">
        <span className="text-xl font-bold font-display text-white tracking-tight whitespace-nowrap shrink-0 drop-shadow-xs">
          Environment
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton />
        </div>
      </header>

      <main className="max-w-5xl w-full mx-auto my-auto py-6 sm:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Open Atmospheric Field Introduction over Forest Background */}
          <div className="lg:col-span-6 space-y-4 text-white">
            <div className="text-xs font-semibold text-emerald-200 tracking-wide">
              PT. NBSS · PT. DTSA · PT. DTR
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold font-display leading-tight text-white drop-shadow-xs max-w-xl">
              Pencatatan Lapangan yang Cepat, Rapi, dan Siap Tanpa Sinyal
            </h1>
            <p className="text-sm sm:text-base text-stone-100/90 leading-relaxed max-w-lg">
              Berdoa sebelum bekerja, utamakan keselamatan kerja, serta gunakan
              APD lengkap di seluruh area operasional.
            </p>
          </div>

          {/* Clean Sign-In Card */}
          <div className="lg:col-span-6 bg-white/95 backdrop-blur-md border border-white/60 rounded-3xl p-6 sm:p-9 shadow-2xl flex flex-col justify-between gap-6">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#14532D]">
                Sistem Sensus & Monitoring Tanaman
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-stone-900 font-display leading-snug">
                Masuk ke Portal Kerja Lapangan
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Catat data Sensus, Monitoring IPPKH, dan Monitoring APL dengan
                koordinat GNSS otomatis, foto bukti ringan, dan cadangan harian
                di ponsel.
              </p>
            </div>

            {/* Phone Backup Directory Selector */}
            <div className="rounded-2xl border border-stone-200 bg-[#F6F7F4] p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-stone-900">
                    Lokasi Cadangan Harian di Ponsel
                  </div>
                  <p className="text-[11px] text-stone-600 leading-relaxed">
                    Mengantisipasi kendala unggah saat sinyal buruk, data hari
                    ini dicadangkan otomatis ke penyimpanan perangkat Anda.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <span className="text-xs font-medium text-stone-700 flex items-center gap-1.5 truncate">
                  {backupInfo.folderName ? (
                    <>
                      <FolderCheck className="w-4 h-4 text-[#14532D] shrink-0" />
                      <span className="truncate">{backupInfo.folderName}</span>
                    </>
                  ) : (
                    <span>Belum memilih folder cadangan</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={handlePickBackupDir}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-stone-50 flex items-center justify-center gap-1.5 shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#14532D]" />
                  {backupInfo.folderName
                    ? 'Ubah Lokasi'
                    : 'Pilih Folder Ponsel'}
                </button>
              </div>
              {backupNotice && (
                <p className="text-[11px] font-medium text-[#14532D]">
                  {backupNotice}
                </p>
              )}
            </div>

            <div className="space-y-3">
              {!isOnline && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
                  <WifiOff className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                  <span>
                    Perangkat sedang offline. Login Google pertama kali
                    membutuhkan koneksi internet sebelum dapat dipakai tanpa
                    sinyal di lapangan.
                  </span>
                </div>
              )}

              {authError && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-800">
                  {authError}
                </div>
              )}

              <button
                type="button"
                onClick={handleSignIn}
                disabled={signingIn || !isOnline}
                className="w-full min-h-[50px] flex items-center justify-center gap-3 rounded-xl bg-[#14532D] px-6 py-3 text-sm font-semibold text-white hover:bg-[#0F3F22] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27c3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10c5.35 0 9.25-3.67 9.25-9.09c0-1.15-.15-1.81-.15-1.81Z"
                  />
                </svg>
                {signingIn
                  ? 'Menghubungkan Google...'
                  : 'Masuk dengan Akun Google'}
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-stone-200/90">
        Environment · Data Lapangan Terpusat Administrator
      </footer>
    </div>
  );
};
