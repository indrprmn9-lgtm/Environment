import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Compass,
  Grid,
  MapPin,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sprout,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import {
  COMPANIES,
  type CompanyName,
  DEFAULT_GNSS_ACCURACY_SETTINGS,
  getCompanyKey,
  type GnssModeKey,
  MAX_GNSS_ACCURACY_M,
  type PlantGroup,
} from '../types/plant';

const GNSS_MODE_FIELDS: Array<{
  key: GnssModeKey;
  label: string;
  hint: string;
}> = [
  {
    key: 'optimal',
    label: 'Optimal (Multi-Sampel)',
    hint: 'Rekomendasi standar HP Android menengah/bawah',
  },
  {
    key: 'precision_static',
    label: 'Kanopi Rapat (Presisi)',
    hint: 'Rata-rata tertimbang di bawah tajuk rapat',
  },
  {
    key: 'continuous',
    label: 'Live Kontinu',
    hint: 'Pelacakan berjalan terus-menerus',
  },
  {
    key: 'fast',
    label: 'Cepat (1 Titik)',
    hint: 'Pengambilan tunggal di area terbuka',
  },
];

export const MasterDataView: React.FC = () => {
  const { profile } = useAuth();
  const {
    masterLocations,
    petaks,
    species,
    gnssSettings,
    getGnssSettingFor,
    adminSaveGnssSetting,
    adminAddLocation,
    adminDeleteLocation,
    adminAddPetak,
    adminDeletePetak,
    adminAddSpecies,
    adminToggleSpecies,
    adminDeleteSpecies,
  } = useData();

  const [selectedCompany, setSelectedCompany] =
    useState<CompanyName>('PT. NBSS');
  const [newLocation, setNewLocation] = useState('');
  const [petakLocation, setPetakLocation] = useState('');
  const [newPetak, setNewPetak] = useState('');
  const [speciesGroup, setSpeciesGroup] = useState<PlantGroup>('FGS');
  const [newSpecies, setNewSpecies] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // GNSS accuracy policy state
  const [gnssScope, setGnssScope] = useState<'ALL' | 'COMPANY'>('COMPANY');
  const [gnssEnforced, setGnssEnforced] = useState<boolean>(true);
  const [gnssDefaultM, setGnssDefaultM] = useState<string>(
    String(MAX_GNSS_ACCURACY_M)
  );
  const [gnssModeInputs, setGnssModeInputs] = useState<
    Record<GnssModeKey, string>
  >({
    optimal: String(MAX_GNSS_ACCURACY_M),
    precision_static: String(MAX_GNSS_ACCURACY_M),
    continuous: String(MAX_GNSS_ACCURACY_M),
    fast: String(MAX_GNSS_ACCURACY_M),
  });
  const [gnssBusy, setGnssBusy] = useState(false);

  const companyKey = useMemo(
    () => getCompanyKey(selectedCompany),
    [selectedCompany]
  );

  const hasCustomCompanyGnss = useMemo(
    () => gnssSettings.some((s) => s.companyKey === companyKey),
    [gnssSettings, companyKey]
  );

  useEffect(() => {
    const activeSetting =
      gnssScope === 'ALL'
        ? gnssSettings.find((s) => s.companyKey === 'ALL') ||
          DEFAULT_GNSS_ACCURACY_SETTINGS
        : getGnssSettingFor(selectedCompany);
    setGnssEnforced(activeSetting.enforced !== false);
    setGnssDefaultM(String(activeSetting.defaultMaxAccuracyM));
    setGnssModeInputs({
      optimal: String(
        activeSetting.modeThresholds?.optimal ??
          activeSetting.defaultMaxAccuracyM
      ),
      precision_static: String(
        activeSetting.modeThresholds?.precision_static ??
          activeSetting.defaultMaxAccuracyM
      ),
      continuous: String(
        activeSetting.modeThresholds?.continuous ??
          activeSetting.defaultMaxAccuracyM
      ),
      fast: String(
        activeSetting.modeThresholds?.fast ?? activeSetting.defaultMaxAccuracyM
      ),
    });
  }, [gnssScope, selectedCompany, gnssSettings, getGnssSettingFor]);

  const companyLocations = useMemo(
    () =>
      masterLocations
        .filter((l) => l.companyKey === companyKey)
        .sort((a, b) =>
          a.name.localeCompare(b.name, 'id', {
            numeric: true,
            sensitivity: 'base',
          })
        ),
    [masterLocations, companyKey]
  );

  useEffect(() => {
    if (companyLocations.length === 0) {
      if (petakLocation) setPetakLocation('');
    } else if (!companyLocations.some((l) => l.name === petakLocation)) {
      setPetakLocation(companyLocations[0].name);
    }
  }, [companyLocations, petakLocation]);

  const companyPetaks = useMemo(
    () =>
      petaks
        .filter((p) => p.companyKey === companyKey)
        .sort((a, b) =>
          `${a.lokasi} ${a.name}`.localeCompare(`${b.lokasi} ${b.name}`, 'id', {
            numeric: true,
            sensitivity: 'base',
          })
        ),
    [petaks, companyKey]
  );

  const companySpecies = useMemo(
    () =>
      species
        .filter((s) => s.companyKey === companyKey)
        .sort((a, b) => a.name.localeCompare(b.name, 'id')),
    [species, companyKey]
  );

  if (profile?.role !== 'admin') {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-sm text-stone-600">
        Menu Data Master hanya dapat diakses oleh Administrator.
      </div>
    );
  }

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocation.trim()) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await adminAddLocation(selectedCompany, newLocation);
      setNotice(
        `Lokasi "${newLocation.trim()}" ditambahkan untuk ${selectedCompany}.`
      );
      setNewLocation('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah lokasi.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddPetak = async (e: React.FormEvent) => {
    e.preventDefault();
    const locName = petakLocation.trim() || companyLocations[0]?.name || '';
    if (!locName || !newPetak.trim()) {
      setError('Pilih atau ketik Nama Lokasi dan Nomor Petak.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await adminAddPetak(selectedCompany, locName, newPetak);
      setNotice(
        `Petak "${newPetak.trim()}" di ${locName} (${selectedCompany}) ditambahkan.`
      );
      setNewPetak('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah petak.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddSpecies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpecies.trim()) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await adminAddSpecies(selectedCompany, speciesGroup, newSpecies);
      setNotice(
        `Jenis "${newSpecies.trim()}" (${
          speciesGroup === 'FGS' ? 'Fast Growing' : 'Lokal / MPTS'
        }) ditambahkan untuk ${selectedCompany}.`
      );
      setNewSpecies('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Gagal menambah jenis tanaman.'
      );
    } finally {
      setBusy(false);
    }
  };

  const parseThreshold = (raw: string, fallback: number): number => {
    const cleaned = raw.trim().replace(',', '.');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(100, Math.max(1, Math.round(num * 10) / 10));
  };

  const handleResetGnss10m = () => {
    setGnssEnforced(true);
    setGnssDefaultM('10');
    setGnssModeInputs({
      optimal: '10',
      precision_static: '10',
      continuous: '10',
      fast: '10',
    });
  };

  const handleSaveGnssPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setGnssBusy(true);
    try {
      const targetKey = gnssScope === 'ALL' ? 'ALL' : companyKey;
      const defVal = parseThreshold(gnssDefaultM, MAX_GNSS_ACCURACY_M);
      const saved = await adminSaveGnssSetting({
        companyKey: targetKey,
        enforced: gnssEnforced,
        defaultMaxAccuracyM: defVal,
        modeThresholds: {
          optimal: parseThreshold(gnssModeInputs.optimal, defVal),
          precision_static: parseThreshold(
            gnssModeInputs.precision_static,
            defVal
          ),
          continuous: parseThreshold(gnssModeInputs.continuous, defVal),
          fast: parseThreshold(gnssModeInputs.fast, defVal),
        },
      });
      setNotice(
        targetKey === 'ALL'
          ? `Kebijakan akurasi GNSS standar (Semua PT) disimpan: default ${saved.defaultMaxAccuracyM} m (${saved.enforced ? 'Wajib isi alasan jika terlampaui' : 'Peringatan lunak'}).`
          : `Kebijakan akurasi GNSS khusus ${selectedCompany} disimpan: default ${saved.defaultMaxAccuracyM} m (${saved.enforced ? 'Wajib isi alasan jika terlampaui' : 'Peringatan lunak'}).`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan kebijakan akurasi GNSS.'
      );
    } finally {
      setGnssBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-24 lg:pb-8">
      <div className="border-b border-stone-200 pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#14532D]">
            Khusus Administrator · Standarisasi Pilihan Input Lapangan
          </p>
          <h1 className="text-2xl font-bold text-[#141A15] font-display tracking-tight mt-0.5">
            Data Master
          </h1>
        </div>
      </div>

      {/* Company Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="grid grid-cols-3 sm:inline-flex gap-1 p-1 bg-white border border-stone-200 rounded-xl w-full sm:w-auto">
          {COMPANIES.map((comp) => (
            <button
              key={comp}
              type="button"
              onClick={() => {
                setSelectedCompany(comp);
                setPetakLocation('');
              }}
              className={`min-h-[44px] sm:min-h-[40px] px-2 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 ${
                selectedCompany === comp
                  ? 'bg-[#14532D] text-white'
                  : 'text-stone-600 hover:text-[#141A15]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
              <span className="truncate">{comp}</span>
            </button>
          ))}
        </div>
        <span className="text-xs text-stone-500">
          Mengelola daftar pilihan resmi untuk <strong>{selectedCompany}</strong>
        </span>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl bg-[#F2F7F3] border border-[#14532D]/25 p-3.5 text-xs text-[#14532D]">
          {notice}
        </div>
      )}

      {/* 3 Master Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* 1. Lokasi / Blok */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
            <h2 className="text-sm font-bold text-[#141A15] font-display flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#14532D]" />
              Penamaan Lokasi / Blok
            </h2>
            <span className="text-xs font-mono tabular-nums text-stone-500">
              {companyLocations.length}
            </span>
          </div>

          <form onSubmit={handleAddLocation} className="flex gap-2">
            <input
              type="text"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder="Misal: Blok A-01"
              maxLength={100}
              className="flex-1 min-w-0 min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs text-[#141A15]"
            />
            <button
              type="submit"
              disabled={busy || !newLocation.trim()}
              className="min-h-[44px] sm:min-h-[42px] px-3.5 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center gap-1 shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Tambah
            </button>
          </form>

          {companyLocations.length === 0 ? (
            <p className="text-xs text-stone-500 py-6 text-center">
              Belum ada lokasi terdaftar untuk {selectedCompany}.
            </p>
          ) : (
            <div className="divide-y divide-stone-100 max-h-72 overflow-y-auto">
              {companyLocations.map((loc) => (
                <div
                  key={loc.id}
                  className="py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-medium text-[#141A15] min-w-0 break-words">
                    {loc.name}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      setError(null);
                      setNotice(null);
                      try {
                        await adminDeleteLocation(loc.id);
                        setNotice(`Lokasi "${loc.name}" berhasil dihapus.`);
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Gagal menghapus lokasi.'
                        );
                      }
                    }}
                    className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700 shrink-0"
                    title="Hapus lokasi"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2. Nomor Petak */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
            <h2 className="text-sm font-bold text-[#141A15] font-display flex items-center gap-2">
              <Grid className="w-4 h-4 text-[#14532D]" />
              Master Nomor Petak
            </h2>
            <span className="text-xs font-mono tabular-nums text-stone-500">
              {companyPetaks.length}
            </span>
          </div>

          <form onSubmit={handleAddPetak} className="space-y-2.5">
            <select
              value={petakLocation || ''}
              onChange={(e) => setPetakLocation(e.target.value)}
              disabled={companyLocations.length === 0}
              required
              className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs text-[#141A15] disabled:bg-[#F6F7F4] disabled:text-stone-400"
            >
              {companyLocations.length === 0 ? (
                <option value="">
                  Daftarkan Lokasi / Blok di kolom kiri dulu
                </option>
              ) : (
                companyLocations.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))
              )}
            </select>
            {companyLocations.length === 0 && (
              <p className="text-[11px] text-amber-700">
                Tambahkan Lokasi / Blok terlebih dahulu agar Petak dapat
                ditautkan ke lokasi resmi.
              </p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={newPetak}
                onChange={(e) => setNewPetak(e.target.value)}
                placeholder="Nomor Petak (mis. P-01)"
                maxLength={50}
                disabled={companyLocations.length === 0}
                className="flex-1 min-w-0 min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs text-[#141A15] disabled:bg-[#F6F7F4]"
              />
              <button
                type="submit"
                disabled={
                  busy || companyLocations.length === 0 || !newPetak.trim()
                }
                className="min-h-[44px] sm:min-h-[42px] px-3.5 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center gap-1 shrink-0 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah
              </button>
            </div>
          </form>

          {companyPetaks.length === 0 ? (
            <p className="text-xs text-stone-500 py-6 text-center">
              Belum ada nomor petak untuk {selectedCompany}.
            </p>
          ) : (
            <div className="divide-y divide-stone-100 max-h-64 overflow-y-auto">
              {companyPetaks.map((pt) => (
                <div
                  key={pt.id}
                  className="py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[#141A15] truncate">
                      {pt.name}
                    </div>
                    <div className="text-[11px] text-stone-500 truncate">
                      {pt.lokasi}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setError(null);
                      setNotice(null);
                      try {
                        await adminDeletePetak(pt.id);
                        setNotice(
                          `Nomor Petak "${pt.name}" (${pt.lokasi}) berhasil dihapus.`
                        );
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Gagal menghapus nomor petak.'
                        );
                      }
                    }}
                    className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700 shrink-0"
                    title="Hapus petak"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Kelompok & Jenis Tanaman (FGS / Lokal MPTS) */}
        <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
            <h2 className="text-sm font-bold text-[#141A15] font-display flex items-center gap-2">
              <Sprout className="w-4 h-4 text-[#14532D]" />
              Jenis Tanaman (FGS & Lokal/MPTS)
            </h2>
            <span className="text-xs font-mono tabular-nums text-stone-500">
              {companySpecies.length}
            </span>
          </div>

          <form onSubmit={handleAddSpecies} className="space-y-2.5">
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F6F7F4] rounded-xl border border-stone-200">
              <button
                type="button"
                onClick={() => setSpeciesGroup('FGS')}
                className={`min-h-[40px] sm:min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  speciesGroup === 'FGS'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-600'
                }`}
              >
                Fast Growing (FGS)
              </button>
              <button
                type="button"
                onClick={() => setSpeciesGroup('LOKAL_MPTS')}
                className={`min-h-[40px] sm:min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
                  speciesGroup === 'LOKAL_MPTS'
                    ? 'bg-[#14532D] text-white'
                    : 'text-stone-600'
                }`}
              >
                Lokal / MPTS
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSpecies}
                onChange={(e) => setNewSpecies(e.target.value)}
                placeholder="Nama jenis baru..."
                maxLength={80}
                className="flex-1 min-w-0 min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs text-[#141A15]"
              />
              <button
                type="submit"
                disabled={busy || !newSpecies.trim()}
                className="min-h-[44px] sm:min-h-[42px] px-3.5 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center gap-1 shrink-0 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Tambah
              </button>
            </div>
          </form>

          <div className="divide-y divide-stone-100 max-h-64 overflow-y-auto">
            {companySpecies
              .filter((s) => s.kelompokTanaman === speciesGroup)
              .map((sp) => (
                <div
                  key={sp.id}
                  className="py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={async () => {
                      setError(null);
                      try {
                        await adminToggleSpecies(sp.id, !sp.active);
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : 'Gagal mengubah status jenis tanaman.'
                        );
                      }
                    }}
                    className={`min-h-[40px] text-left font-medium min-w-0 break-words ${
                      sp.active ? 'text-[#141A15]' : 'text-stone-400 line-through'
                    }`}
                  >
                    {sp.name}
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        try {
                          await adminToggleSpecies(sp.id, !sp.active);
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : 'Gagal mengubah status jenis tanaman.'
                          );
                        }
                      }}
                      className="min-h-[40px] sm:min-h-[30px] px-2.5 sm:px-2 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:bg-[#F6F7F4]"
                    >
                      {sp.active ? 'Aktif' : 'Nonaktif'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setError(null);
                        setNotice(null);
                        try {
                          await adminDeleteSpecies(sp.id);
                          setNotice(`Jenis "${sp.name}" berhasil dihapus.`);
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : 'Gagal menghapus jenis tanaman.'
                          );
                        }
                      }}
                      className="min-h-[40px] min-w-[40px] sm:min-h-[30px] sm:min-w-[30px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700"
                      title="Hapus jenis"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>

      {/* 4. Kebijakan Ambang Batas Akurasi GNSS Per Perusahaan & Mode */}
      <section className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200/80 pb-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#141A15] font-display flex items-center gap-2">
              <Compass className="w-4 h-4 text-[#14532D]" />
              Ambang Batas Akurasi GNSS Wajib (Perusahaan &amp; Mode)
            </h2>
            <p className="text-xs text-stone-500">
              Atur batas akurasi maksimal (meter). Jika akurasi HP petugas
              melebihi ambang batas, titik tidak dapat disimpan kecuali petugas
              mengisi alasan kondisi lapangan.
            </p>
          </div>

          <div className="inline-flex gap-1 p-1 bg-[#F6F7F4] border border-stone-200 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setGnssScope('COMPANY')}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                gnssScope === 'COMPANY'
                  ? 'bg-[#14532D] text-white'
                  : 'text-stone-600 hover:text-[#141A15]'
              }`}
            >
              Khusus {selectedCompany}
            </button>
            <button
              type="button"
              onClick={() => setGnssScope('ALL')}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                gnssScope === 'ALL'
                  ? 'bg-[#14532D] text-white'
                  : 'text-stone-600 hover:text-[#141A15]'
              }`}
            >
              Standar Default (Semua PT)
            </button>
          </div>
        </div>

        <form onSubmit={handleSaveGnssPolicy} className="space-y-4">
          {gnssScope === 'COMPANY' && !hasCustomCompanyGnss && (
            <div className="rounded-xl bg-[#F6F7F4] border border-stone-200 px-3.5 py-2.5 text-[11px] text-stone-600">
              <strong>{selectedCompany}</strong> saat ini mengikuti aturan{' '}
              <strong>Standar Default (Semua PT)</strong>. Simpan di tab ini
              jika ingin menetapkan batas khusus untuk {selectedCompany}.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <label className="flex items-start gap-2.5 p-3.5 rounded-xl border border-stone-200 bg-[#F6F7F4]/70 cursor-pointer">
              <input
                type="checkbox"
                checked={gnssEnforced}
                onChange={(e) => setGnssEnforced(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-stone-300 text-[#14532D] focus:ring-[#14532D]"
              />
              <span className="text-xs text-stone-700 leading-relaxed">
                <strong className="block text-[#141A15]">
                  Wajib penuhi ambang batas akurasi
                </strong>
                Saat aktif, petugas tidak dapat menyimpan titik jika akurasi di
                atas ambang batas (atau GPS gagal terkunci) tanpa mengisi alasan
                tertulis.
              </span>
            </label>

            <div className="p-3.5 rounded-xl border border-stone-200 bg-[#F6F7F4]/70 space-y-1.5">
              <label className="block text-xs font-semibold text-[#141A15]">
                Batas Default Umum (meter)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={0.5}
                  value={gnssDefaultM}
                  onChange={(e) => setGnssDefaultM(e.target.value)}
                  className="w-28 min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-sm font-mono text-[#141A15]"
                />
                <span className="text-xs text-stone-500">
                  meter (standar lapangan: 10 m)
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#141A15]">
              Ambang Batas per Mode GNSS Internal HP
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {GNSS_MODE_FIELDS.map((mode) => (
                <div
                  key={mode.key}
                  className="rounded-xl border border-stone-200 bg-white p-3 space-y-1.5"
                >
                  <label className="block text-xs font-semibold text-[#141A15]">
                    {mode.label}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={0.5}
                      value={gnssModeInputs[mode.key]}
                      onChange={(e) =>
                        setGnssModeInputs((prev) => ({
                          ...prev,
                          [mode.key]: e.target.value,
                        }))
                      }
                      className="w-full min-h-[40px] rounded-lg border border-stone-300 px-2.5 text-sm font-mono text-[#141A15]"
                    />
                    <span className="text-xs font-mono text-stone-500 shrink-0">
                      m
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500 leading-snug">
                    {mode.hint}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={handleResetGnss10m}
              className="min-h-[42px] px-3.5 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-[#F6F7F4] inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Semua ke 10 m
            </button>

            <button
              type="submit"
              disabled={gnssBusy}
              className="min-h-[44px] px-5 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 inline-flex items-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              {gnssBusy
                ? 'Menyimpan Kebijakan...'
                : `Simpan Kebijakan GNSS (${gnssScope === 'ALL' ? 'Semua PT' : selectedCompany})`}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
