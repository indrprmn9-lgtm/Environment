import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CloudOff,
  FileSpreadsheet,
  Layers,
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Trees,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { buildMonitoringPetakTrends } from '../lib/googleSheetsSync';
import {
  COMPANIES,
  type CompanyName,
  getCompanyKey,
  getMenuLabel,
  type MenuType,
} from '../types/plant';

export type AppTab =
  | 'dashboard'
  | 'sensus'
  | 'ippkh'
  | 'apl'
  | 'map'
  | 'data'
  | 'master'
  | 'staff';

interface DashboardViewProps {
  onNavigate: (tab: AppTab) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { profile } = useAuth();
  const {
    allRecords,
    fieldConditions,
    canopyCovers,
    companySpreadsheets,
    pendingCount,
    conflictCount,
    isOnline,
    isSyncing,
    syncPendingQueue,
    getEvalSettingFor,
    adminSaveEvalSetting,
  } = useData();

  const [companyFilter, setCompanyFilter] = useState<'ALL' | CompanyName>('ALL');
  const [trendMenu, setTrendMenu] = useState<
    'MONITORING_IPPKH' | 'MONITORING_APL'
  >('MONITORING_IPPKH');
  const [trendPetakFilter, setTrendPetakFilter] = useState<string>('ALL');
  const [showEvalConfig, setShowEvalConfig] = useState<boolean>(false);

  const activeEvalSetting = useMemo(
    () => getEvalSettingFor(companyFilter),
    [getEvalSettingFor, companyFilter]
  );

  const [evalEnabledInput, setEvalEnabledInput] = useState<boolean>(
    activeEvalSetting.enabled
  );
  const [minSurvivalInput, setMinSurvivalInput] = useState<string>(
    String(activeEvalSetting.minSurvivalPct)
  );
  const [minDeltaInput, setMinDeltaInput] = useState<string>(
    String(activeEvalSetting.minDeltaHeightCm)
  );
  const [evalSaving, setEvalSaving] = useState<boolean>(false);
  const [evalNotice, setEvalNotice] = useState<string | null>(null);

  React.useEffect(() => {
    setEvalEnabledInput(activeEvalSetting.enabled);
    setMinSurvivalInput(String(activeEvalSetting.minSurvivalPct));
    setMinDeltaInput(String(activeEvalSetting.minDeltaHeightCm));
  }, [activeEvalSetting]);

  const filteredRecords = useMemo(() => {
    if (companyFilter === 'ALL') return allRecords;
    return allRecords.filter((r) => r.perusahaan === companyFilter);
  }, [allRecords, companyFilter]);

  const filteredFieldConditions = useMemo(() => {
    if (companyFilter === 'ALL') return fieldConditions;
    return fieldConditions.filter((fc) => fc.perusahaan === companyFilter);
  }, [fieldConditions, companyFilter]);

  const filteredCanopyCovers = useMemo(() => {
    if (companyFilter === 'ALL') return canopyCovers;
    return canopyCovers.filter((cc) => cc.perusahaan === companyFilter);
  }, [canopyCovers, companyFilter]);

  const companyBreakdown = useMemo(() => {
    return COMPANIES.map((comp) => {
      const sub = allRecords.filter((r) => r.perusahaan === comp);
      const total = sub.length;
      const sehat = sub.filter((r) => r.kondisiTanaman === 'Sehat').length;
      const hidup = sub.filter((r) => r.kondisiTanaman !== 'Mati').length;
      const sensus = sub.filter((r) => r.menuType === 'SENSUS').length;
      const ippkh = sub.filter((r) => r.menuType === 'MONITORING_IPPKH').length;
      const apl = sub.filter((r) => r.menuType === 'MONITORING_APL').length;
      const livingSub = sub.filter((r) => r.kondisiTanaman !== 'Mati');
      const survivalPct = total ? Math.round((hidup / total) * 1000) / 10 : 0;
      const avgHeight = livingSub.length
        ? Math.round(
            (livingSub.reduce((a, r) => a + r.tinggiCm, 0) / livingSub.length) *
              10
          ) / 10
        : 0;
      const avgDiam = livingSub.length
        ? Math.round(
            (livingSub.reduce((a, r) => a + r.diameterMm, 0) /
              livingSub.length) *
              10
          ) / 10
        : 0;

      const sheetMeta = companySpreadsheets.find((s) => s.perusahaan === comp);

      return {
        comp,
        total,
        sehat,
        hidup,
        sensus,
        ippkh,
        apl,
        survivalPct,
        avgHeight,
        avgDiam,
        sheetUrl: sheetMeta?.spreadsheetUrl || null,
      };
    });
  }, [allRecords, companySpreadsheets]);

  const stats = useMemo(() => {
    const total = filteredRecords.length;
    const sehat = filteredRecords.filter(
      (r) => r.kondisiTanaman === 'Sehat'
    ).length;
    const kurangSehat = filteredRecords.filter(
      (r) => r.kondisiTanaman === 'Kurang Sehat'
    ).length;
    const merana = filteredRecords.filter(
      (r) => r.kondisiTanaman === 'Merana'
    ).length;
    const mati = filteredRecords.filter(
      (r) => r.kondisiTanaman === 'Mati'
    ).length;
    const hidup = sehat + kurangSehat + merana;
    const livingRecords = filteredRecords.filter(
      (r) => r.kondisiTanaman !== 'Mati'
    );
    const survivalPct = total ? Math.round((hidup / total) * 1000) / 10 : 0;
    const healthyPct = total ? Math.round((sehat / total) * 1000) / 10 : 0;
    const avgHeight = livingRecords.length
      ? Math.round(
          (livingRecords.reduce((a, r) => a + r.tinggiCm, 0) /
            livingRecords.length) *
            10
        ) / 10
      : 0;
    const avgDiam = livingRecords.length
      ? Math.round(
          (livingRecords.reduce((a, r) => a + r.diameterMm, 0) /
            livingRecords.length) *
            10
        ) / 10
      : 0;
    const fgs = filteredRecords.filter(
      (r) => r.kelompokTanaman === 'FGS'
    ).length;
    const lokal = filteredRecords.filter(
      (r) => r.kelompokTanaman === 'LOKAL_MPTS'
    ).length;

    const sensusCount = filteredRecords.filter(
      (r) => r.menuType === 'SENSUS'
    ).length;
    const ippkhCount = filteredRecords.filter(
      (r) => r.menuType === 'MONITORING_IPPKH'
    ).length;
    const aplCount = filteredRecords.filter(
      (r) => r.menuType === 'MONITORING_APL'
    ).length;

    return {
      total,
      sehat,
      kurangSehat,
      merana,
      mati,
      hidup,
      survivalPct,
      healthyPct,
      avgHeight,
      avgDiam,
      fgs,
      lokal,
      sensusCount,
      ippkhCount,
      aplCount,
    };
  }, [filteredRecords]);

  // Growth Trend Rows per Period & Petak for IPPKH and APL
  const allTrendRows = useMemo(() => {
    const targetCompany = companyFilter === 'ALL' ? undefined : companyFilter;
    return buildMonitoringPetakTrends(allRecords, targetCompany, {
      enabled: activeEvalSetting.enabled,
      minSurvivalPct: activeEvalSetting.minSurvivalPct,
      minDeltaHeightCm: activeEvalSetting.minDeltaHeightCm,
    }).filter((t) => t.menuType === trendMenu);
  }, [allRecords, companyFilter, trendMenu, activeEvalSetting]);

  const trendPetakOptions = useMemo(() => {
    const set = new Set<string>();
    allTrendRows.forEach((t) => set.add(t.nomorPetak));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [allTrendRows]);

  const visibleTrends = useMemo(() => {
    if (trendPetakFilter === 'ALL') return allTrendRows;
    return allTrendRows.filter((t) => t.nomorPetak === trendPetakFilter);
  }, [allTrendRows, trendPetakFilter]);

  // Aggregate by period for clean chart curve
  const periodChartSeries = useMemo(() => {
    const byPeriod = new Map<
      string,
      { periode: string; sumH: number; sumD: number; sumSurv: number; n: number }
    >();
    for (const row of visibleTrends) {
      const cur = byPeriod.get(row.periode) || {
        periode: row.periode,
        sumH: 0,
        sumD: 0,
        sumSurv: 0,
        n: 0,
      };
      cur.sumH += row.avgTinggiCm;
      cur.sumD += row.avgDiameterMm;
      cur.sumSurv += row.survivalPct;
      cur.n += 1;
      byPeriod.set(row.periode, cur);
    }
    return Array.from(byPeriod.values())
      .sort((a, b) => a.periode.localeCompare(b.periode))
      .map((p) => ({
        periode: p.periode,
        avgHeight: Math.round((p.sumH / p.n) * 10) / 10,
        avgDiam: Math.round((p.sumD / p.n) * 10) / 10,
        avgSurvival: Math.round((p.sumSurv / p.n) * 10) / 10,
      }));
  }, [visibleTrends]);

  const flaggedPetaks = useMemo(
    () =>
      activeEvalSetting.enabled
        ? allTrendRows.filter(
            (t) =>
              t.statusEvaluasi === 'Perlu Penyulaman' ||
              t.statusEvaluasi === 'Melambat'
          )
        : [],
    [allTrendRows, activeEvalSetting.enabled]
  );

  const locationSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        perusahaan: CompanyName;
        lokasi: string;
        lokasiKey: string;
        menuType: MenuType;
        total: number;
        sehat: number;
        mati: number;
        sumH: number;
        sumD: number;
        livingCount: number;
        petaks: Set<string>;
      }
    >();

    filteredRecords.forEach((r) => {
      const k = `${r.companyKey}__${r.menuType}__${r.lokasiKey}`;
      const cur = map.get(k) || {
        perusahaan: r.perusahaan,
        lokasi: r.lokasi,
        lokasiKey: r.lokasiKey,
        menuType: r.menuType,
        total: 0,
        sehat: 0,
        mati: 0,
        sumH: 0,
        sumD: 0,
        livingCount: 0,
        petaks: new Set<string>(),
      };
      cur.total++;
      if (r.kondisiTanaman === 'Sehat') cur.sehat++;
      if (r.kondisiTanaman === 'Mati') {
        cur.mati++;
      } else {
        cur.sumH += r.tinggiCm;
        cur.sumD += r.diameterMm;
        cur.livingCount++;
      }
      if (r.menuType !== 'SENSUS' && r.nomorPetak) {
        cur.petaks.add(r.nomorPetak);
      }
      map.set(k, cur);
    });

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredRecords]);

  if (profile?.role !== 'admin') {
    return null;
  }

  const maxChartHeight = Math.max(
    10,
    ...periodChartSeries.map((p) => p.avgHeight)
  );

  return (
    <div className="space-y-6 pb-24 lg:pb-8">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-[#14532D] p-5 sm:p-6 shadow-xs">
        <img
          src="/assets/aistudio/thick-forest-5120x2880-14776_2cf69776.jpg"
          alt="Area hutan dengan cahaya matahari pagi"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-[#091A10]/88 via-[#0F2A1A]/75 to-[#091A10]/60 pointer-events-none"
        />
        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-emerald-200">
              Khusus Administrator
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span>{profile?.name}</span>
            </p>
            <h1 className="text-2xl font-bold text-white font-display tracking-tight mt-0.5 drop-shadow-xs">
              Dasbor Analisis & Monitoring Pertumbuhan
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() => void syncPendingQueue(true)}
                disabled={isSyncing}
                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 flex items-center gap-2 transition-colors"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
                {isSyncing
                  ? 'Menyinkronkan...'
                  : `Kirim ${pendingCount} Data Offline`}
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('staff')}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-white/60 bg-white/95 text-[#141A15] text-xs font-semibold hover:bg-white flex items-center gap-2 transition-colors"
            >
              <Users className="w-4 h-4 text-[#14532D]" />
              Kelola Petugas
            </button>
          </div>
        </div>
      </div>

      {/* Filter Perusahaan */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 p-1 bg-white border border-stone-200 rounded-xl">
          {(['ALL', ...COMPANIES] as const).map((comp) => (
            <button
              key={comp}
              type="button"
              onClick={() => {
                setCompanyFilter(comp);
                setTrendPetakFilter('ALL');
              }}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                companyFilter === comp
                  ? 'bg-[#14532D] text-white'
                  : 'text-stone-600 hover:text-[#141A15]'
              }`}
            >
              {comp === 'ALL' ? 'Semua Perusahaan' : comp}
            </button>
          ))}
        </div>
        <span className="text-xs text-stone-500 font-mono tabular-nums">
          {companyFilter === 'ALL'
            ? 'Menampilkan gabungan 3 perusahaan'
            : `Filter aktif: ${companyFilter}`}
        </span>
      </div>

      {/* 3-Company Database Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {companyBreakdown.map((item) => {
          const isSelected = companyFilter === item.comp;
          return (
            <div
              key={item.comp}
              className={`rounded-2xl p-4 border transition-colors space-y-2.5 ${
                isSelected
                  ? 'bg-[#F2F7F3] border-[#14532D]'
                  : 'bg-white border-stone-200 hover:border-stone-300'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setCompanyFilter((prev) =>
                    prev === item.comp ? 'ALL' : item.comp
                  )
                }
                className="w-full text-left space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2
                      className={`w-4 h-4 ${
                        isSelected ? 'text-[#14532D]' : 'text-stone-500'
                      }`}
                    />
                    <span className="text-sm font-bold text-[#141A15] font-display">
                      {item.comp}
                    </span>
                  </div>
                  <span className="text-xs font-mono tabular-nums font-semibold text-[#14532D]">
                    {item.survivalPct}% hidup
                  </span>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-[#141A15]">
                    {item.total.toLocaleString('id-ID')}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-stone-500">
                    T {item.avgHeight} cm · D {item.avgDiam} mm
                  </span>
                </div>

                <div className="text-[11px] text-stone-600 font-mono tabular-nums flex items-center gap-2 border-t border-stone-200/70 pt-2">
                  <span>Sensus {item.sensus}</span>
                  <span aria-hidden="true">·</span>
                  <span>IPPKH {item.ippkh}</span>
                  <span aria-hidden="true">·</span>
                  <span>APL {item.apl}</span>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Offline / Conflict Alerts */}
      {(!isOnline || conflictCount > 0) && (
        <div className="space-y-2">
          {!isOnline && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 flex items-center gap-3 text-xs text-amber-950">
              <CloudOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Mode Offline aktif (tanpa sinyal). Semua input tetap tersimpan
                aman di perangkat dan akan dikirim otomatis begitu sinyal
                tersedia.
              </span>
            </div>
          )}
          {conflictCount > 0 && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-center justify-between gap-3 text-xs text-red-900">
              <span>
                Terdapat <strong>{conflictCount}</strong> data offline yang nomor
                tanamannya bentrok dengan input petugas lain.
              </span>
              <button
                type="button"
                onClick={() => onNavigate('data')}
                className="min-h-[34px] px-3 py-1.5 rounded-lg bg-red-700 text-white font-semibold shrink-0"
              >
                Perbaiki
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quick Action Cards (Replaced .xlsx with Google Spreadsheet & Map) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => onNavigate('sensus')}
          className="text-left bg-white border border-stone-200 hover:border-[#14532D] rounded-2xl p-4 transition-colors flex flex-col justify-between gap-3 min-h-[112px]"
        >
          <div className="flex items-center justify-between">
            <Sprout className="w-5 h-5 text-[#14532D]" />
            <span className="text-xs font-mono tabular-nums text-stone-500">
              {stats.sensusCount} entri
            </span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-[#141A15] font-display">
                Sensus Tanaman
              </div>
              <div className="text-xs text-stone-500">
                1 nomor sekali per lokasi
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('ippkh')}
          className="text-left bg-white border border-stone-200 hover:border-[#14532D] rounded-2xl p-4 transition-colors flex flex-col justify-between gap-3 min-h-[112px]"
        >
          <div className="flex items-center justify-between">
            <Trees className="w-5 h-5 text-[#14532D]" />
            <span className="text-xs font-mono tabular-nums text-stone-500">
              {stats.ippkhCount} entri
            </span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-[#141A15] font-display">
                Monitoring IPPKH
              </div>
              <div className="text-xs text-stone-500">
                Cover crop &amp; konservasi
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('map')}
          className="text-left bg-white border border-stone-200 hover:border-[#14532D] rounded-2xl p-4 transition-colors flex flex-col justify-between gap-3 min-h-[112px]"
        >
          <div className="flex items-center justify-between">
            <MapIcon className="w-5 h-5 text-[#14532D]" />
            <span className="text-xs font-mono tabular-nums text-stone-500">
              GIS · CRS
            </span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-[#141A15] font-display">
                Peta Lapangan
              </div>
              <div className="text-xs text-stone-500">
                Base map PDF / Shapefile
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('data')}
          className="text-left bg-white border border-stone-200 hover:border-[#14532D] rounded-2xl p-4 transition-colors flex flex-col justify-between gap-3 min-h-[112px]"
        >
          <div className="flex items-center justify-between">
            <FileSpreadsheet className="w-5 h-5 text-[#14532D]" />
            <span className="text-xs font-mono tabular-nums text-stone-500">
              Google Sheets
            </span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-[#141A15] font-display">
                Rekap &amp; Spreadsheet
              </div>
              <div className="text-xs text-stone-500">
                Sinkronisasi otomatis 3 PT
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 shrink-0" />
          </div>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-1">
          <div className="text-xs font-medium text-stone-500">
            Total Tanaman Terdata
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#141A15]">
            {stats.total.toLocaleString('id-ID')}
          </div>
          <div className="text-xs text-stone-500 font-mono tabular-nums">
            FGS {stats.fgs} · Lokal/MPTS {stats.lokal}
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-1">
          <div className="text-xs font-medium text-stone-500">
            Persentase Hidup
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#14532D]">
            {stats.survivalPct}%
          </div>
          <div className="text-xs text-stone-500 font-mono tabular-nums">
            Sehat {stats.healthyPct}% ({stats.sehat} pohon)
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-1">
          <div className="text-xs font-medium text-stone-500">
            Rata-rata Tinggi
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#141A15]">
            {stats.avgHeight} <span className="text-sm font-normal">cm</span>
          </div>
          <div className="text-xs text-stone-500">
            {companyFilter === 'ALL' ? 'Gabungan 3 Perusahaan' : companyFilter}
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-1">
          <div className="text-xs font-medium text-stone-500">
            Rata-rata Diameter
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#141A15]">
            {stats.avgDiam} <span className="text-sm font-normal">mm</span>
          </div>
          <div className="text-xs text-stone-500">
            {filteredFieldConditions.length} kondisi lokasi ·{' '}
            {filteredCanopyCovers.length} tajuk
          </div>
        </div>
      </div>

      {/* NEW: Growth Trend Chart per Period & Petak (IPPKH & APL) + Infill Planting Detection */}
      <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-stone-200/80 pb-3">
          <div>
            <h2 className="text-base font-bold text-[#141A15] font-display flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#14532D]" />
              Grafik Tren Pertumbuhan &amp; Deteksi Penyulaman per Petak
            </h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Pantau laju tinggi rata-rata (cm) &amp; % hidup antar periode
              untuk mendeteksi petak yang melambat atau membutuhkan penyulaman.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 bg-[#F6F7F4] border border-stone-200 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setTrendMenu('MONITORING_IPPKH');
                  setTrendPetakFilter('ALL');
                }}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                  trendMenu === 'MONITORING_IPPKH'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-600'
                }`}
              >
                IPPKH
              </button>
              <button
                type="button"
                onClick={() => {
                  setTrendMenu('MONITORING_APL');
                  setTrendPetakFilter('ALL');
                }}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                  trendMenu === 'MONITORING_APL'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-600'
                }`}
              >
                APL
              </button>
            </div>

            <select
              value={trendPetakFilter}
              onChange={(e) => setTrendPetakFilter(e.target.value)}
              className="min-h-[38px] rounded-xl border border-stone-300 bg-white px-3 text-xs text-[#141A15]"
            >
              <option value="ALL">Semua Petak</option>
              {trendPetakOptions.map((pt) => (
                <option key={pt} value={pt}>
                  Petak {pt}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setShowEvalConfig((v) => !v)}
              className={`min-h-[38px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                showEvalConfig
                  ? 'bg-[#14532D] text-white border-[#14532D]'
                  : 'bg-white text-stone-700 border-stone-300 hover:bg-[#F6F7F4]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Atur Ambang
            </button>
          </div>
        </div>

        {/* Optional Admin Threshold Configurator */}
        {showEvalConfig && (
          <div className="rounded-xl border border-stone-200 bg-[#F6F7F4] p-4 space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="font-semibold text-[#141A15]">
                Pengaturan Evaluasi Pertumbuhan &amp; Penyulaman (
                {companyFilter === 'ALL' ? 'Default Semua PT' : companyFilter})
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-stone-700">
                <input
                  type="checkbox"
                  checked={evalEnabledInput}
                  onChange={(e) => setEvalEnabledInput(e.target.checked)}
                  className="rounded border-stone-300 text-[#14532D]"
                />
                Aktifkan Deteksi Otomatis (Opsional)
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <label className="block font-medium text-stone-700">
                  Batas Minimal % Hidup (Penyulaman)
                </label>
                <input
                  type="number"
                  min={10}
                  max={100}
                  step={1}
                  disabled={!evalEnabledInput}
                  value={minSurvivalInput}
                  onChange={(e) => setMinSurvivalInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 font-mono disabled:bg-stone-100 disabled:text-stone-400"
                />
              </div>
              <div className="space-y-1">
                <label className="block font-medium text-stone-700">
                  Batas Kenaikan Tinggi (cm/periode)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  disabled={!evalEnabledInput}
                  value={minDeltaInput}
                  onChange={(e) => setMinDeltaInput(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 font-mono disabled:bg-stone-100 disabled:text-stone-400"
                />
              </div>
              <button
                type="button"
                disabled={evalSaving}
                onClick={async () => {
                  setEvalSaving(true);
                  setEvalNotice(null);
                  try {
                    const ck =
                      companyFilter === 'ALL'
                        ? 'ALL'
                        : getCompanyKey(companyFilter);
                    await adminSaveEvalSetting({
                      companyKey: ck,
                      enabled: evalEnabledInput,
                      minSurvivalPct: Number(minSurvivalInput) || 80,
                      minDeltaHeightCm: Number(minDeltaInput) || 0,
                    });
                    setEvalNotice(
                      'Pengaturan ambang evaluasi berhasil disimpan.'
                    );
                  } catch (err) {
                    setEvalNotice(
                      err instanceof Error
                        ? err.message
                        : 'Gagal menyimpan pengaturan evaluasi.'
                    );
                  } finally {
                    setEvalSaving(false);
                  }
                }}
                className="min-h-[40px] px-4 rounded-lg bg-[#14532D] text-white font-semibold hover:bg-[#0F3F22] disabled:opacity-50"
              >
                {evalSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>
            {evalNotice && (
              <p className="text-[11px] font-semibold text-[#14532D]">
                {evalNotice}
              </p>
            )}
          </div>
        )}

        {periodChartSeries.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-sm text-stone-500">
              Belum ada data {getMenuLabel(trendMenu)} untuk menampilkan grafik
              tren pertumbuhan per periode.
            </p>
            <button
              type="button"
              onClick={() =>
                onNavigate(trendMenu === 'MONITORING_IPPKH' ? 'ippkh' : 'apl')
              }
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22]"
            >
              Input {getMenuLabel(trendMenu)}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* SVG Column + Survival Trend Visualization */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between text-xs text-stone-600">
                <span className="font-semibold text-[#141A15]">
                  Rata-rata Tinggi (cm) &amp; Survival (%) per Periode
                </span>
                <span className="font-mono tabular-nums">
                  {periodChartSeries.length} periode
                </span>
              </div>

              <div className="rounded-xl border border-stone-200 bg-[#F6F7F4] p-4 overflow-x-auto">
                <div className="min-w-[360px] flex items-end gap-4 h-48 pt-6 pb-2 border-b border-stone-300">
                  {periodChartSeries.map((pt) => {
                    const heightPct = Math.max(
                      8,
                      Math.round((pt.avgHeight / maxChartHeight) * 100)
                    );
                    const needsAttention =
                      activeEvalSetting.enabled &&
                      pt.avgSurvival < activeEvalSetting.minSurvivalPct;
                    return (
                      <div
                        key={pt.periode}
                        className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end"
                      >
                        <div className="text-[11px] font-mono tabular-nums font-semibold text-[#141A15]">
                          {pt.avgHeight} cm
                        </div>
                        <div
                          className={`w-full max-w-[44px] rounded-t-lg transition-all ${
                            needsAttention ? 'bg-amber-600' : 'bg-[#14532D]'
                          }`}
                          style={{ height: `${heightPct}%` }}
                          title={`${pt.periode}: Tinggi ${pt.avgHeight} cm · Hidup ${pt.avgSurvival}%`}
                        />
                        <div className="text-[10px] font-mono tabular-nums text-stone-600">
                          {pt.avgSurvival}%
                        </div>
                        <div className="text-[11px] font-mono tabular-nums font-semibold text-stone-800">
                          {pt.periode}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-4 pt-2.5 text-[11px] text-stone-600">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-[#14532D]" />
                    Pertumbuhan Normal (
                    {activeEvalSetting.enabled
                      ? `>= ${activeEvalSetting.minSurvivalPct}% hidup`
                      : 'Evaluasi Opsional Nonaktif'}
                    )
                  </span>
                  {activeEvalSetting.enabled && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-xs bg-amber-600" />
                      Perlu Penyulaman (&lt; {activeEvalSetting.minSurvivalPct}%
                      hidup)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Petak Evaluation & Infill Alert Table */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#141A15] flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Deteksi Petak Melambat / Penyulaman
                </span>
                <span className="font-mono tabular-nums text-stone-500">
                  {activeEvalSetting.enabled
                    ? `${flaggedPetaks.length} temuan`
                    : 'Nonaktif'}
                </span>
              </div>

              {!activeEvalSetting.enabled ? (
                <div className="rounded-xl border border-stone-200 bg-[#F6F7F4] p-4 text-xs text-stone-600">
                  Deteksi otomatis sedang dinonaktifkan oleh Administrator. Klik
                  &ldquo;Atur Ambang&rdquo; untuk mengaktifkan kembali sesuai SOP.
                </div>
              ) : flaggedPetaks.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-[#F2F7F3] p-4 text-xs text-[#14532D]">
                  Seluruh petak pada {getMenuLabel(trendMenu)} berada dalam
                  kondisi baik (&gt;= {activeEvalSetting.minSurvivalPct}% hidup,
                  delta tinggi &gt;= {activeEvalSetting.minDeltaHeightCm} cm).
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 divide-y divide-stone-100 max-h-60 overflow-y-auto">
                  {flaggedPetaks.map((fp) => (
                    <div
                      key={`${fp.perusahaan}_${fp.lokasi}_${fp.nomorPetak}_${fp.periode}`}
                      className="p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#141A15]">
                          {fp.perusahaan} · Petak {fp.nomorPetak}
                        </span>
                        <span
                          className={`font-semibold ${
                            fp.statusEvaluasi === 'Perlu Penyulaman'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {fp.statusEvaluasi}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-stone-600">
                        {fp.lokasi} · {fp.periode} · Hidup {fp.survivalPct}% ·
                        Tinggi {fp.avgTinggiCm} cm
                        {fp.deltaTinggiCm !== null
                          ? ` (Delta ${fp.deltaTinggiCm >= 0 ? '+' : ''}${fp.deltaTinggiCm} cm)`
                          : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Condition Breakdown & Location Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
            <h2 className="text-sm font-bold text-[#141A15] font-display flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#14532D]" />
              Distribusi Kondisi Tanaman
            </h2>
            <span className="text-xs text-stone-500 font-mono tabular-nums">
              {stats.total} pohon
            </span>
          </div>

          <div className="space-y-3">
            {[
              { label: 'Sehat', count: stats.sehat, bar: 'bg-[#14532D]' },
              {
                label: 'Kurang Sehat',
                count: stats.kurangSehat,
                bar: 'bg-amber-500',
              },
              { label: 'Merana', count: stats.merana, bar: 'bg-orange-500' },
              { label: 'Mati', count: stats.mati, bar: 'bg-red-600' },
            ].map((row) => {
              const pct = stats.total
                ? Math.round((row.count / stats.total) * 1000) / 10
                : 0;
              return (
                <div key={row.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-800">
                      {row.label}
                    </span>
                    <span className="font-mono tabular-nums text-stone-600">
                      {row.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-[#F6F7F4] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${row.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-stone-200/80 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-[#F6F7F4] p-3">
              <div className="text-stone-500">Fast Growing (FGS)</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#141A15] mt-0.5">
                {stats.fgs}
              </div>
            </div>
            <div className="rounded-xl bg-[#F6F7F4] p-3">
              <div className="text-stone-500">Lokal / MPTS</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#141A15] mt-0.5">
                {stats.lokal}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
            <h2 className="text-sm font-bold text-[#141A15] font-display flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#14532D]" />
              Rekapitulasi per Lokasi &amp; Kawasan
            </h2>
            <span className="text-xs text-stone-500 font-mono tabular-nums">
              {locationSummary.length} kelompok
            </span>
          </div>

          {locationSummary.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-sm text-stone-500">
                Belum ada data tanaman pada filter perusahaan ini.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('sensus')}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22]"
              >
                Mulai Input Sensus
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-[11px] font-semibold text-stone-500">
                    <th className="py-2.5 pr-3">Perusahaan &amp; Lokasi</th>
                    <th className="py-2.5 px-3">Menu</th>
                    <th className="py-2.5 px-3 text-right">Petak</th>
                    <th className="py-2.5 px-3 text-right">Total</th>
                    <th className="py-2.5 px-3 text-right">% Hidup</th>
                    <th className="py-2.5 pl-3 text-right">Rata T / D</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-xs">
                  {locationSummary.slice(0, 10).map((row) => {
                    const hidupPct = Math.round(
                      ((row.total - row.mati) / row.total) * 100
                    );
                    const avgH = row.livingCount
                      ? Math.round((row.sumH / row.livingCount) * 10) / 10
                      : 0;
                    const avgD = row.livingCount
                      ? Math.round((row.sumD / row.livingCount) * 10) / 10
                      : 0;
                    return (
                      <tr
                        key={`${row.perusahaan}__${row.menuType}__${row.lokasiKey}`}
                        className="hover:bg-[#F6F7F4]/70"
                      >
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-[#141A15]">
                            {row.lokasi}
                          </div>
                          <div className="text-[11px] text-stone-500">
                            {row.perusahaan}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-stone-600 whitespace-nowrap">
                          {getMenuLabel(row.menuType)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-stone-700">
                          {row.menuType === 'SENSUS' ? '-' : row.petaks.size}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#141A15]">
                          {row.total}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#14532D] font-semibold">
                          {hidupPct}%
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-stone-600 whitespace-nowrap">
                          {avgH} cm / {avgD} mm
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
