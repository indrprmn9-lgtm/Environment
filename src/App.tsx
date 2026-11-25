import React, { useEffect, useState } from 'react';
import {
  CloudOff,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  Layers,
  LogOut,
  Map as MapIcon,
  RefreshCw,
  Sprout,
  Trees,
  Users,
  Wifi,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider, useData } from './contexts/DataContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/LoginScreen';
import { AppTab, DashboardView } from './components/DashboardView';
import { PlantEntryForm } from './components/PlantEntryForm';
import { DataExplorerView } from './components/DataExplorerView';
import { StaffManagerView } from './components/StaffManagerView';
import { MasterDataView } from './components/MasterDataView';
import { MapViewerView } from './components/MapViewerView';
import { PWAInstallButton } from './components/PWAInstallButton';

const MainShell: React.FC = () => {
  const { authStatus, profile, logout } = useAuth();
  const {
    isOnline,
    isSyncing,
    pendingCount,
    lastSyncError,
    clearSyncError,
    syncPendingQueue,
  } = useData();
  const isAdmin = profile?.role === 'admin';
  const [activeTab, setActiveTab] = useState<AppTab>('sensus');

  // Route Admin to Dashboard by default and lock Petugas out of Admin tabs
  useEffect(() => {
    if (!profile) return;
    if (profile.role === 'admin') {
      setActiveTab((prev) => (prev === 'sensus' ? 'dashboard' : prev));
    } else {
      setActiveTab((prev) =>
        prev === 'dashboard' || prev === 'staff' || prev === 'master'
          ? 'sensus'
          : prev
      );
    }
  }, [profile]);

  if (authStatus !== 'authorized' || !profile) {
    return <LoginScreen />;
  }

  const navItems: {
    id: AppTab;
    label: string;
    mobileLabel: string;
    icon: React.FC<{ className?: string }>;
  }[] = [
    ...(isAdmin
      ? [
          {
            id: 'dashboard' as AppTab,
            label: 'Dasbor',
            mobileLabel: 'Dasbor',
            icon: LayoutDashboard,
          },
        ]
      : []),
    {
      id: 'sensus',
      label: 'Sensus Tanaman',
      mobileLabel: 'Sensus',
      icon: Sprout,
    },
    {
      id: 'ippkh',
      label: 'Monitoring IPPKH',
      mobileLabel: 'IPPKH',
      icon: Trees,
    },
    {
      id: 'apl',
      label: 'Monitoring APL',
      mobileLabel: 'APL',
      icon: Layers,
    },
    {
      id: 'map',
      label: 'Peta Lapangan',
      mobileLabel: 'Peta',
      icon: MapIcon,
    },
    {
      id: 'data',
      label: isAdmin ? 'Rekap & Sheets' : 'Riwayat Input',
      mobileLabel: 'Data',
      icon: FileSpreadsheet,
    },
  ];

  const effectiveTab: AppTab =
    !isAdmin &&
    (activeTab === 'dashboard' ||
      activeTab === 'staff' ||
      activeTab === 'master')
      ? 'sensus'
      : activeTab;

  return (
    <div className="relative isolate min-h-[100dvh] bg-[#F6F7F4]/90 text-[#141A15] flex flex-col lg:flex-row overflow-x-clip">
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-20 bg-[#E7ECE4] bg-cover bg-center pointer-events-none"
        style={{
          backgroundImage:
            "url('/assets/aistudio/thick-forest-5120x2880-14776_2cf69776.jpg')",
        }}
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 bg-[#F6F7F4]/88 backdrop-blur-[2px] pointer-events-none"
      />

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white/95 backdrop-blur-md border-r border-stone-200 z-30">
        <div className="px-5 py-5 border-b border-stone-200/80">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-[#14532D] text-white flex items-center justify-center shrink-0">
              <Sprout className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-base font-bold font-display text-[#141A15] tracking-tight leading-tight">
                Environment
              </div>
              <div className="text-[11px] text-stone-500 truncate mt-0.5">
                {isAdmin ? 'Administrator' : 'Petugas'} · {profile.name}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = effectiveTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-700 hover:bg-[#F6F7F4] hover:text-[#141A15]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-stone-200/80 space-y-1">
              <button
                type="button"
                onClick={() => setActiveTab('master')}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'master'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-700 hover:bg-[#F6F7F4] hover:text-[#141A15]'
                }`}
              >
                <Database className="w-4 h-4 shrink-0" />
                <span>Data Master</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('staff')}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'staff'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-700 hover:bg-[#F6F7F4] hover:text-[#141A15]'
                }`}
              >
                <Users className="w-4 h-4 shrink-0" />
                <span>Kelola Petugas</span>
              </button>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-stone-200/80 space-y-3">
          <div className="rounded-xl bg-[#F6F7F4] border border-stone-200 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-stone-800">
                {isOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-[#14532D]" />
                    Online
                  </>
                ) : (
                  <>
                    <CloudOff className="w-3.5 h-3.5 text-amber-700" />
                    Offline
                  </>
                )}
              </span>
              <span className="font-mono tabular-nums text-stone-500">
                {pendingCount} antrean
              </span>
            </div>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() => void syncPendingQueue(true)}
                disabled={isSyncing}
                className="w-full min-h-[38px] rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                />
                {isSyncing ? 'Sinkron...' : 'Sinkronkan'}
              </button>
            )}
          </div>

          <PWAInstallButton />

          <button
            type="button"
            onClick={logout}
            className="w-full min-h-[42px] flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-[#F6F7F4]"
          >
            <LogOut className="w-4 h-4" />
            Keluar Akun
          </button>
        </div>
      </aside>

      {/* Mobile Compact Sticky Top Bar (<= 52px height) */}
      <header className="lg:hidden sticky top-0 z-30 h-[52px] bg-white/95 backdrop-blur-md border-b border-stone-200 px-3 sm:px-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[#14532D] text-white flex items-center justify-center shrink-0">
            <Sprout className="w-3.5 h-3.5" />
          </span>
          <span className="text-sm sm:text-base font-bold font-display text-[#141A15] whitespace-nowrap truncate max-w-[125px] sm:max-w-none">
            Environment
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 text-xs shrink-0">
          {pendingCount > 0 ? (
            <button
              type="button"
              onClick={() => void syncPendingQueue(true)}
              disabled={isSyncing}
              className="min-h-[36px] px-2 sm:px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold flex items-center gap-1 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3 h-3 shrink-0 ${isSyncing ? 'animate-spin' : ''}`}
              />
              <span>
                {isOnline ? `Kirim (${pendingCount})` : `(${pendingCount})`}
              </span>
            </button>
          ) : !isOnline ? (
            <span className="flex items-center gap-1 text-amber-800 font-semibold whitespace-nowrap px-1">
              <CloudOff className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xs:inline">Offline</span>
            </span>
          ) : null}

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('master')}
                className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg ${
                  effectiveTab === 'master'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
                title="Data Master"
                aria-label="Data Master"
              >
                <Database className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('staff')}
                className={`min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg ${
                  effectiveTab === 'staff'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-600 hover:bg-stone-100'
                }`}
                title="Kelola Petugas"
                aria-label="Kelola Petugas"
              >
                <Users className="w-4 h-4" />
              </button>
            </>
          )}

          <PWAInstallButton compactMobile />
          <button
            type="button"
            onClick={logout}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"
            aria-label="Keluar akun"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 lg:pl-64">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
          {lastSyncError && (
            <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <span className="font-semibold">Kendala Upload Antrean: </span>
                <span>{lastSyncError}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void syncPendingQueue(true)}
                  disabled={isSyncing}
                  className="min-h-[34px] px-3 py-1.5 rounded-lg bg-amber-700 text-white font-semibold hover:bg-amber-800 disabled:opacity-60"
                >
                  Coba Lagi
                </button>
                <button
                  type="button"
                  onClick={clearSyncError}
                  className="min-h-[34px] px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-100"
                >
                  Tutup
                </button>
              </div>
            </div>
          )}
          {effectiveTab === 'dashboard' && isAdmin && (
            <DashboardView onNavigate={setActiveTab} />
          )}
          {effectiveTab === 'sensus' && <PlantEntryForm menuType="SENSUS" />}
          {effectiveTab === 'ippkh' && (
            <PlantEntryForm menuType="MONITORING_IPPKH" />
          )}
          {effectiveTab === 'apl' && (
            <PlantEntryForm menuType="MONITORING_APL" />
          )}
          {effectiveTab === 'map' && <MapViewerView />}
          {effectiveTab === 'data' && <DataExplorerView />}
          {effectiveTab === 'master' && isAdmin && <MasterDataView />}
          {effectiveTab === 'staff' && isAdmin && <StaffManagerView />}
        </div>
      </main>

      {/* Mobile Fixed Bottom Thumb-Zone Tab Bar (h-16) */}
      <nav
        aria-label="Navigasi Utama"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-stone-200 pb-safe"
      >
        <div
          className={`grid items-center h-16 ${
            isAdmin ? 'grid-cols-6' : 'grid-cols-5'
          }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = effectiveTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
                  active
                    ? 'text-[#14532D] font-bold'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DataProvider>
          <MainShell />
        </DataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
