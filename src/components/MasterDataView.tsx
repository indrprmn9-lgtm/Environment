import React, { useMemo, useState } from 'react';
import {
  Building2,
  Grid,
  MapPin,
  Plus,
  Sprout,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import {
  COMPANIES,
  type CompanyName,
  getCompanyKey,
  type PlantGroup,
} from '../types/plant';

export const MasterDataView: React.FC = () => {
  const { profile } = useAuth();
  const {
    locations,
    petaks,
    species,
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

  const companyKey = useMemo(
    () => getCompanyKey(selectedCompany),
    [selectedCompany]
  );

  const companyLocations = useMemo(
    () => locations.filter((l) => l.companyKey === companyKey),
    [locations, companyKey]
  );

  const companyPetaks = useMemo(
    () =>
      petaks
        .filter((p) => p.companyKey === companyKey)
        .sort((a, b) =>
          `${a.lokasi} ${a.name}`.localeCompare(`${b.lokasi} ${b.name}`, 'id')
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 p-1 bg-white border border-stone-200 rounded-xl">
          {COMPANIES.map((comp) => (
            <button
              key={comp}
              type="button"
              onClick={() => {
                setSelectedCompany(comp);
                setPetakLocation('');
              }}
              className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                selectedCompany === comp
                  ? 'bg-[#14532D] text-white'
                  : 'text-stone-600 hover:text-[#141A15]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              {comp}
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
              className="flex-1 min-h-[42px] rounded-xl border border-stone-300 px-3 text-xs text-[#141A15]"
            />
            <button
              type="submit"
              disabled={busy || !newLocation.trim()}
              className="min-h-[42px] px-3.5 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center gap-1 shrink-0"
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
                  className="py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-medium text-[#141A15]">{loc.name}</span>
                  <button
                    type="button"
                    onClick={() => void adminDeleteLocation(loc.id)}
                    className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700"
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
            <input
              type="text"
              list="master-petak-loc-list"
              value={petakLocation}
              onChange={(e) => setPetakLocation(e.target.value)}
              placeholder="Pilih / ketik Lokasi (mis. Blok A-01)"
              maxLength={100}
              className="w-full min-h-[42px] rounded-xl border border-stone-300 px-3 text-xs text-[#141A15]"
            />
            <datalist id="master-petak-loc-list">
              {companyLocations.map((l) => (
                <option key={l.id} value={l.name} />
              ))}
            </datalist>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPetak}
                onChange={(e) => setNewPetak(e.target.value)}
                placeholder="Nomor Petak (mis. P-01)"
                maxLength={50}
                className="flex-1 min-h-[42px] rounded-xl border border-stone-300 px-3 text-xs text-[#141A15]"
              />
              <button
                type="submit"
                disabled={busy || !newPetak.trim()}
                className="min-h-[42px] px-3.5 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center gap-1 shrink-0"
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
                  className="py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-semibold text-[#141A15]">
                      {pt.name}
                    </div>
                    <div className="text-[11px] text-stone-500">{pt.lokasi}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void adminDeletePetak(pt.id)}
                    className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700"
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
                className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
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
                className={`min-h-[36px] rounded-lg text-xs font-semibold transition-colors ${
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
                className="flex-1 min-h-[42px] rounded-xl border border-stone-300 px-3 text-xs text-[#141A15]"
              />
              <button
                type="submit"
                disabled={busy || !newSpecies.trim()}
                className="min-h-[42px] px-3.5 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center gap-1 shrink-0"
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
                    onClick={() => void adminToggleSpecies(sp.id, !sp.active)}
                    className={`text-left font-medium ${
                      sp.active ? 'text-[#141A15]' : 'text-stone-400 line-through'
                    }`}
                  >
                    {sp.name}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void adminToggleSpecies(sp.id, !sp.active)}
                      className="min-h-[30px] px-2 rounded-lg border border-stone-200 text-[11px] font-medium text-stone-600 hover:bg-[#F6F7F4]"
                    >
                      {sp.active ? 'Aktif' : 'Nonaktif'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void adminDeleteSpecies(sp.id)}
                      className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-700"
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
    </div>
  );
};
