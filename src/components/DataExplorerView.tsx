import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit2,
  ExternalLink,
  FileSpreadsheet,
  HardDriveDownload,
  Link2,
  Lock,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData, type PaginatedRecordsResult } from '../contexts/DataContext';
import {
  createCompanySpreadsheet,
} from '../lib/googleSheetsSync';
import {
  COMPANIES,
  type CompanyName,
  DIMENSION_BOUNDS,
  getCompanyKey,
  getCurrentPeriodeString,
  getMenuLabel,
  type MenuType,
  parsePositiveDecimal,
  parsePositiveInt,
  PLANT_CONDITIONS,
  type PlantCondition,
  type PlantGroup,
  type PlantRecord,
} from '../types/plant';

const PAGE_LIMIT = 100;

interface PendingSheetConfirm {
  mode: 'create_and_sync' | 'sync_existing';
  perusahaan: CompanyName;
  spreadsheetId?: string;
}

export const DataExplorerView: React.FC = () => {
  const {
    profile,
    sheetsAccessToken,
    connectGoogleSheets,
    clearSheetsToken,
  } = useAuth();
  const {
    allRecords,
    fieldConditions,
    canopyCovers,
    locations,
    companySpreadsheets,
    isOnline,
    isSyncing,
    pendingCount,
    conflictCount,
    getSpeciesForCompanyGroup,
    syncPendingQueue,
    fetchPaginatedRecords,
    exportOfflineBackup,
    exportTodayBackup,
    resolveConflictChangeNumber,
    discardPendingRecord,
    adminUpdateRecord,
    adminDeleteRecord,
    saveCompanySpreadsheet,
    syncCompanyToGoogleSheets,
  } = useData();

  const isAdmin = profile?.role === 'admin';
  const lockedCompany: CompanyName | null =
    profile?.assignedCompany && profile.assignedCompany !== 'ALL'
      ? profile.assignedCompany
      : null;
  const currentMonth = useMemo(() => getCurrentPeriodeString(), []);

  // Filters (default to current month per field performance optimization)
  const [companyFilter, setCompanyFilter] = useState<'ALL' | CompanyName>(
    () => lockedCompany ?? 'ALL'
  );

  useEffect(() => {
    if (lockedCompany && companyFilter !== lockedCompany) {
      setCompanyFilter(lockedCompany);
      setLokasiFilter('ALL');
      setPage(1);
    }
  }, [lockedCompany, companyFilter]);
  const [menuFilter, setMenuFilter] = useState<'ALL' | MenuType>('ALL');
  const [lokasiFilter, setLokasiFilter] = useState<string>('ALL');
  const [periodeFilter, setPeriodeFilter] = useState<string>(currentMonth);
  const [kondisiFilter, setKondisiFilter] = useState<'ALL' | PlantCondition>(
    'ALL'
  );
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // Server-side paginated state
  const [pageResult, setPageResult] = useState<PaginatedRecordsResult>({
    records: [],
    total: 0,
    page: 1,
    limit: PAGE_LIMIT,
    periodes: [currentMonth],
  });
  const [tableLoading, setTableLoading] = useState<boolean>(false);
  const [tableError, setTableError] = useState<string | null>(null);

  // Google Sheets integration state
  const [sheetBusyCompany, setSheetBusyCompany] = useState<CompanyName | null>(
    null
  );
  const [sheetNotice, setSheetNotice] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingSheetConfirm | null>(null);
  const [linkingCompany, setLinkingCompany] = useState<CompanyName | null>(
    null
  );
  const [linkUrlInput, setLinkUrlInput] = useState<string>('');

  // Backup notice
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  // Photo / GNSS inspection modal
  const [inspectRecord, setInspectRecord] = useState<PlantRecord | null>(null);

  // Admin Edit modal state
  const [editingRecord, setEditingRecord] = useState<PlantRecord | null>(null);
  const [editPerusahaan, setEditPerusahaan] = useState<CompanyName>('PT. NBSS');
  const [editTanggal, setEditTanggal] = useState('');
  const [editLokasi, setEditLokasi] = useState('');
  const [editPetugas, setEditPetugas] = useState('');
  const [editPetak, setEditPetak] = useState('');
  const [editNomor, setEditNomor] = useState('');
  const [editKelompok, setEditKelompok] = useState<PlantGroup>('FGS');
  const [editJenis, setEditJenis] = useState('');
  const [editTinggi, setEditTinggi] = useState('');
  const [editDiameter, setEditDiameter] = useState('');
  const [editKondisi, setEditKondisi] = useState<PlantCondition>('Sehat');
  const [editKet, setEditKet] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Admin Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<PlantRecord | null>(null);

  // Conflict number edit inputs
  const [conflictInputs, setConflictInputs] = useState<Record<string, string>>(
    {}
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchTerm]);

  const loadPage = useCallback(async () => {
    setTableLoading(true);
    setTableError(null);
    try {
      const res = await fetchPaginatedRecords({
        page,
        limit: PAGE_LIMIT,
        company: companyFilter,
        menuType: menuFilter,
        lokasiKey: lokasiFilter,
        periode: periodeFilter,
        kondisi: kondisiFilter,
        search: debouncedSearch,
      });
      setPageResult(res);
    } catch (err) {
      setTableError(
        err instanceof Error
          ? err.message
          : 'Gagal memuat data halaman dari server.'
      );
    } finally {
      setTableLoading(false);
    }
  }, [
    fetchPaginatedRecords,
    page,
    companyFilter,
    menuFilter,
    lokasiFilter,
    periodeFilter,
    kondisiFilter,
    debouncedSearch,
  ]);

  useEffect(() => {
    void loadPage();
  }, [loadPage, allRecords.length]);

  const visibleLocations = useMemo(() => {
    if (companyFilter === 'ALL') return locations;
    const ck = getCompanyKey(companyFilter);
    return locations.filter((l) => l.companyKey === ck);
  }, [locations, companyFilter]);

  const periodOptions = useMemo(() => {
    const set = new Set<string>([currentMonth, ...pageResult.periodes]);
    allRecords.forEach((r) => set.add(r.periode));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [currentMonth, pageResult.periodes, allRecords]);

  // Merge offline pending/conflict records matching active filter onto Page 1 so officers immediately see newly input offline items
  const displayedRecords = useMemo(() => {
    if (!isOnline) return pageResult.records;
    if (page !== 1) return pageResult.records;

    const q = debouncedSearch.trim().toLowerCase();
    const pendingMatches = allRecords.filter((r) => {
      if (r.syncStatus === 'synced') return false;
      if (companyFilter !== 'ALL' && r.perusahaan !== companyFilter)
        return false;
      if (menuFilter !== 'ALL' && r.menuType !== menuFilter) return false;
      if (lokasiFilter !== 'ALL' && r.lokasiKey !== lokasiFilter) return false;
      if (periodeFilter !== 'ALL' && r.periode !== periodeFilter) return false;
      if (kondisiFilter !== 'ALL' && r.kondisiTanaman !== kondisiFilter)
        return false;
      if (q) {
        const hay =
          `${r.perusahaan} ${r.nomorTanaman} ${r.lokasi} ${r.nomorPetak} ${r.jenisTanaman} ${r.namaPetugas} ${r.keterangan}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const serverIds = new Set(pageResult.records.map((r) => r.id));
    const uniquePending = pendingMatches.filter((r) => !serverIds.has(r.id));
    return [...uniquePending, ...pageResult.records];
  }, [
    isOnline,
    page,
    pageResult.records,
    allRecords,
    companyFilter,
    menuFilter,
    lokasiFilter,
    periodeFilter,
    kondisiFilter,
    debouncedSearch,
  ]);

  const totalPages = Math.max(1, Math.ceil(pageResult.total / PAGE_LIMIT));

  const conflicts = useMemo(
    () => allRecords.filter((r) => r.syncStatus === 'conflict'),
    [allRecords]
  );

  const condLookup = useMemo(() => {
    const map = new Map<string, (typeof fieldConditions)[number]>();
    fieldConditions.forEach((fc) =>
      map.set(
        `${fc.companyKey}__${fc.menuType}__${fc.lokasiKey}__${fc.periode}`,
        fc
      )
    );
    return map;
  }, [fieldConditions]);

  const canopyLookup = useMemo(() => {
    const map = new Map<string, (typeof canopyCovers)[number]>();
    canopyCovers.forEach((cc) =>
      map.set(
        `${cc.companyKey}__${cc.lokasiKey}__${cc.petakKey}__${cc.periode}`,
        cc
      )
    );
    return map;
  }, [canopyCovers]);

  const handleConfirmSheetAction = async () => {
    if (!pendingConfirm || !profile) return;
    const { mode, perusahaan } = pendingConfirm;
    setSheetError(null);
    setSheetNotice(null);
    setSheetBusyCompany(perusahaan);

    try {
      let token = sheetsAccessToken;
      if (!token) {
        token = await connectGoogleSheets();
      }
      if (!token) {
        throw new Error(
          'Otorisasi Google Sheets belum diberikan. Silakan hubungkan akun Google Anda.'
        );
      }

      setPendingConfirm(null);

      if (mode === 'create_and_sync') {
        const created = await createCompanySpreadsheet(token, perusahaan);
        await saveCompanySpreadsheet({
          perusahaan,
          spreadsheetId: created.spreadsheetId,
          spreadsheetUrl: created.spreadsheetUrl,
          ownerEmail: profile.email,
          syncedRecordCount: 0,
        });
        // Sync immediately using the newly saved metadata
        const compRecords = allRecords.filter(
          (r) => r.perusahaan === perusahaan
        );
        const { syncCompanyDataToSpreadsheet } = await import(
          '../lib/googleSheetsSync'
        );
        const { syncedCount } = await syncCompanyDataToSpreadsheet({
          accessToken: token,
          spreadsheetId: created.spreadsheetId,
          perusahaan,
          records: allRecords,
          fieldConditions,
          canopyCovers,
        });
        await saveCompanySpreadsheet({
          perusahaan,
          spreadsheetId: created.spreadsheetId,
          spreadsheetUrl: created.spreadsheetUrl,
          ownerEmail: profile.email,
          syncedRecordCount: syncedCount,
        });
        setSheetNotice(
          `Spreadsheet "${perusahaan}" berhasil dibuat dan ${compRecords.length} baris data telah disinkronkan ke 6 tab.`
        );
      } else {
        const res = await syncCompanyToGoogleSheets(perusahaan, token);
        setSheetNotice(
          `Spreadsheet ${perusahaan} diperbarui dengan ${res.syncedCount} data tanaman, analisis pertumbuhan, dan grafik tren monitoring.`
        );
      }
      await loadPage();
    } catch (err) {
      setPendingConfirm(null);
      const rawMsg =
        err instanceof Error
          ? err.message
          : 'Gagal menyinkronkan data ke Google Sheets.';
      const lower = rawMsg.toLowerCase();
      if (
        lower.includes('insufficient authentication scopes') ||
        lower.includes('unauthenticated') ||
        lower.includes('invalid credentials') ||
        lower.includes('(401)') ||
        lower.includes('(403)')
      ) {
        clearSheetsToken();
        setSheetError(
          'Izin akses Google Sheets belum aktif atau kedaluwarsa. Klik tombol "Hubungkan Google Sheets" di kanan atas, lalu pastikan Anda mencentang izin akses Google Sheets pada jendela login Google.'
        );
      } else {
        setSheetError(rawMsg);
      }
    } finally {
      setSheetBusyCompany(null);
    }
  };

  const handleLinkExistingSheet = async (
    e: React.FormEvent,
    perusahaan: CompanyName
  ) => {
    e.preventDefault();
    if (!profile) return;
    setSheetError(null);
    const raw = linkUrlInput.trim();
    const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = idMatch ? idMatch[1] : raw;
    if (!spreadsheetId || spreadsheetId.length < 15) {
      setSheetError(
        'URL atau ID Google Spreadsheet tidak valid. Tempel link lengkap spreadsheet Anda.'
      );
      return;
    }
    const spreadsheetUrl = raw.startsWith('http')
      ? raw
      : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    setSheetBusyCompany(perusahaan);
    try {
      await saveCompanySpreadsheet({
        perusahaan,
        spreadsheetId,
        spreadsheetUrl,
        ownerEmail: profile.email,
        syncedRecordCount: 0,
      });
      setLinkingCompany(null);
      setLinkUrlInput('');
      setSheetNotice(
        `Spreadsheet untuk ${perusahaan} berhasil ditautkan. Klik "Sinkronkan ke Sheets" untuk mengisi data.`
      );
    } catch (err) {
      setSheetError(
        err instanceof Error ? err.message : 'Gagal menautkan spreadsheet.'
      );
    } finally {
      setSheetBusyCompany(null);
    }
  };

  const handleTodayBackup = async () => {
    try {
      const res = await exportTodayBackup();
      setBackupNotice(
        res.savedVia === 'directory'
          ? `Cadangan hari ini tersimpan langsung ke folder HP (${res.fileName}).`
          : `File cadangan hari ini (${res.fileName}) berhasil diunduh ke perangkat.`
      );
    } catch (err) {
      setBackupNotice(
        err instanceof Error ? err.message : 'Gagal mencadangkan data hari ini.'
      );
    }
  };

  const openEditModal = (rec: PlantRecord) => {
    setEditingRecord(rec);
    setEditPerusahaan(rec.perusahaan);
    setEditTanggal(rec.tanggalInput);
    setEditLokasi(rec.lokasi);
    setEditPetugas(rec.namaPetugas);
    setEditPetak(rec.nomorPetak);
    setEditNomor(String(rec.nomorTanaman));
    setEditKelompok(rec.kelompokTanaman);
    setEditJenis(rec.jenisTanaman);
    setEditTinggi(String(rec.tinggiCm));
    setEditDiameter(String(rec.diameterMm));
    setEditKondisi(rec.kondisiTanaman);
    setEditKet(rec.keterangan || '');
    setEditError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;
    setEditError(null);

    const num = parsePositiveInt(editNomor);
    const isEditMati = editKondisi === 'Mati';
    const t = isEditMati ? 0 : parsePositiveDecimal(editTinggi);
    const d = isEditMati ? 0 : parsePositiveDecimal(editDiameter);
    if (!num) {
      setEditError('Nomor tanaman harus berupa bilangan bulat positif.');
      return;
    }
    if (
      !isEditMati &&
      (t === null ||
        t < DIMENSION_BOUNDS.tinggiCm.hardMin ||
        t > DIMENSION_BOUNDS.tinggiCm.hardMax)
    ) {
      setEditError('Tinggi (cm) tidak valid.');
      return;
    }
    if (
      !isEditMati &&
      (d === null ||
        d < DIMENSION_BOUNDS.diameterMm.hardMin ||
        d > DIMENSION_BOUNDS.diameterMm.hardMax)
    ) {
      setEditError('Diameter (mm) tidak valid.');
      return;
    }

    setEditSaving(true);
    try {
      await adminUpdateRecord(editingRecord.id, {
        perusahaan: editPerusahaan,
        tanggalInput: editTanggal,
        lokasi: editLokasi,
        namaPetugas: editPetugas,
        nomorPetak: editingRecord.menuType === 'SENSUS' ? '' : editPetak,
        nomorTanaman: num,
        kelompokTanaman: editKelompok,
        jenisTanaman: editJenis,
        tinggiCm: t ?? 0,
        diameterMm: d ?? 0,
        kondisiTanaman: editKondisi,
        keterangan: editKet,
      });
      setEditingRecord(null);
      await loadPage();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Gagal memperbarui data.'
      );
    } finally {
      setEditSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await adminDeleteRecord(deleteTarget.id);
    setDeleteTarget(null);
    await loadPage();
  };

  const editSpeciesOptions = useMemo(
    () => getSpeciesForCompanyGroup(editPerusahaan, editKelompok),
    [getSpeciesForCompanyGroup, editPerusahaan, editKelompok]
  );

  return (
    <div className="space-y-6 pb-24 lg:pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <p className="text-xs font-medium text-stone-500 font-mono tabular-nums">
            Total {pageResult.total} entri sesuai filter · Halaman {page} dari{' '}
            {totalPages} ({PAGE_LIMIT} baris/hal)
          </p>
          <h1 className="text-2xl font-bold text-[#141A15] font-display tracking-tight mt-0.5">
            {isAdmin
              ? 'Database & Sinkronisasi Google Sheets'
              : 'Riwayat Input & Cadangan Data'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => void syncPendingQueue(true)}
              disabled={isSyncing}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 flex items-center gap-2"
            >
              <RefreshCw
                className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`}
              />
              {isSyncing ? 'Mengunggah...' : `Sinkronkan (${pendingCount})`}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleTodayBackup()}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-stone-300 bg-white text-stone-700 text-xs font-semibold hover:bg-[#F6F7F4] flex items-center gap-2"
            title="Simpan cadangan seluruh data hari ini ke perangkat"
          >
            <HardDriveDownload className="w-4 h-4 text-[#14532D]" />
            Cadangkan Hari Ini
          </button>

          {(pendingCount > 0 || conflictCount > 0) && (
            <button
              type="button"
              onClick={exportOfflineBackup}
              className="min-h-[42px] px-3.5 py-2 rounded-xl border border-stone-300 bg-white text-stone-700 text-xs font-semibold hover:bg-[#F6F7F4] flex items-center gap-2"
            >
              <HardDriveDownload className="w-4 h-4 text-stone-600" />
              Ekspor Antrean (.json)
            </button>
          )}

          {!isAdmin && (
            <div className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white border border-stone-200 text-xs text-stone-600 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-stone-500" />
              Kelola Spreadsheet & Edit Data khusus Administrator
            </div>
          )}
        </div>
      </div>

      {backupNotice && (
        <div className="rounded-xl border border-[#14532D]/25 bg-[#F2F7F3] px-4 py-3 text-xs text-[#14532D] flex items-center justify-between gap-2">
          <span>{backupNotice}</span>
          <button
            type="button"
            onClick={() => setBackupNotice(null)}
            className="font-semibold hover:underline"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Admin Only: Per-Company Google Spreadsheets Hub */}
      {isAdmin && (
        <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200/80 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-[#14532D]" />
                <h2 className="text-base font-bold font-display text-[#141A15]">
                  Google Spreadsheet Otomatis per Perusahaan
                </h2>
              </div>
              <p className="text-xs text-stone-500">
                Hubungkan email Administrator ({profile?.email}) agar data
                Sensus, Monitoring IPPKH/APL, Analisis Rekapitulasi, & Grafik
                Tren tersinkron ke Google Sheets.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {sheetsAccessToken ? (
                <div className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#14532D]/30 bg-[#F2F7F3] text-[#14532D] text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Terhubung ke Google Sheets
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void connectGoogleSheets()}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Hubungkan Google Sheets
                </button>
              )}
            </div>
          </div>

          {sheetError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 flex items-center justify-between gap-2">
              <span>{sheetError}</span>
              <button
                type="button"
                onClick={() => setSheetError(null)}
                className="font-semibold hover:underline"
              >
                Tutup
              </button>
            </div>
          )}

          {sheetNotice && (
            <div className="rounded-xl border border-[#14532D]/25 bg-[#F2F7F3] px-4 py-3 text-xs text-[#14532D] flex items-center justify-between gap-2">
              <span>{sheetNotice}</span>
              <button
                type="button"
                onClick={() => setSheetNotice(null)}
                className="font-semibold hover:underline"
              >
                Tutup
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COMPANIES.map((comp) => {
              const ck = getCompanyKey(comp);
              const meta = companySpreadsheets.find((s) => s.companyKey === ck);
              const compTotal = allRecords.filter(
                (r) => r.perusahaan === comp
              ).length;
              const isBusy = sheetBusyCompany === comp;

              return (
                <div
                  key={comp}
                  className="rounded-xl border border-stone-200 bg-[#F6F7F4] p-4 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-[#141A15] font-display">
                        {comp}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-stone-600">
                        {compTotal} entri
                      </span>
                    </div>

                    {meta ? (
                      <div className="text-[11px] text-stone-600 space-y-0.5">
                        <div>
                          Terkait:{' '}
                          <span className="font-semibold text-[#141A15]">
                            {meta.ownerEmail}
                          </span>
                        </div>
                        <div className="font-mono">
                          Tersinkron: {meta.syncedRecordCount} baris
                          {meta.lastSyncedAt
                            ? ` · ${new Date(meta.lastSyncedAt).toLocaleString('id-ID')}`
                            : ''}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-stone-500">
                        Belum ada Google Spreadsheet tertaut untuk perusahaan ini.
                      </p>
                    )}
                  </div>

                  {linkingCompany === comp ? (
                    <form
                      onSubmit={(e) => void handleLinkExistingSheet(e, comp)}
                      className="space-y-2"
                    >
                      <input
                        type="text"
                        value={linkUrlInput}
                        onChange={(e) => setLinkUrlInput(e.target.value)}
                        placeholder="Tempel URL atau ID Spreadsheet..."
                        required
                        className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-base sm:text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={isBusy}
                          className="flex-1 min-h-[36px] rounded-lg bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22]"
                        >
                          Simpan Link
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLinkingCompany(null);
                            setLinkUrlInput('');
                          }}
                          className="min-h-[36px] px-3 rounded-lg border border-stone-300 bg-white text-xs text-stone-600"
                        >
                          Batal
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-2">
                      {meta ? (
                        <>
                          <div className="flex gap-2">
                            <a
                              href={meta.spreadsheetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 min-h-[40px] px-3 rounded-xl bg-white border border-stone-300 text-xs font-semibold text-[#14532D] hover:bg-stone-50 flex items-center justify-center gap-1.5"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Buka Spreadsheet
                            </a>
                            <button
                              type="button"
                              disabled={isBusy || !isOnline}
                              onClick={() =>
                                setPendingConfirm({
                                  mode: 'sync_existing',
                                  perusahaan: comp,
                                  spreadsheetId: meta.spreadsheetId,
                                })
                              }
                              className="flex-1 min-h-[40px] px-3 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  isBusy ? 'animate-spin' : ''
                                }`}
                              />
                              {isBusy ? 'Menyinkron...' : 'Sinkronkan'}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setLinkingCompany(comp);
                              setLinkUrlInput(meta.spreadsheetUrl);
                            }}
                            className="w-full text-[11px] text-stone-500 hover:text-stone-800 flex items-center justify-center gap-1"
                          >
                            <Link2 className="w-3 h-3" />
                            Ganti Tautan Spreadsheet
                          </button>
                        </>
                      ) : (
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            disabled={isBusy || !isOnline}
                            onClick={() =>
                              setPendingConfirm({
                                mode: 'create_and_sync',
                                perusahaan: comp,
                              })
                            }
                            className="w-full min-h-[40px] px-3 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center justify-center gap-1.5"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" />
                            {isBusy
                              ? 'Memproses...'
                              : 'Buat & Sinkronkan Spreadsheet'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLinkingCompany(comp);
                              setLinkUrlInput('');
                            }}
                            className="w-full min-h-[34px] text-[11px] text-stone-600 hover:text-[#14532D] flex items-center justify-center gap-1"
                          >
                            <Link2 className="w-3 h-3" />
                            Tautkan Spreadsheet yang Sudah Ada
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sync Conflicts Resolver */}
      {conflicts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-red-900">
            <AlertTriangle className="w-5 h-5 text-red-700 shrink-0" />
            <span>
              Konflik Nomor Tanaman Saat Sinkronisasi Offline ({conflicts.length})
            </span>
          </div>
          <p className="text-xs text-red-800">
            Nomor tanaman di bawah ini ternyata sudah diinput petugas lain saat
            Anda sedang offline. Ganti nomor tanaman dengan angka baru agar
            pengukuran tinggi & diameter Anda tetap tersimpan:
          </p>
          <div className="space-y-2">
            {conflicts.map((c) => (
              <div
                key={c.id}
                className="bg-white border border-red-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-[#141A15]">
                    {c.perusahaan} · {getMenuLabel(c.menuType)} · {c.lokasi}
                    {c.menuType !== 'SENSUS' && c.nomorPetak
                      ? ` · Petak ${c.nomorPetak}`
                      : ''}{' '}
                    · #{c.nomorTanaman} ({c.jenisTanaman})
                  </div>
                  <div className="text-red-700">{c.syncError}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Nomor baru"
                    value={conflictInputs[c.id] || ''}
                    onChange={(e) =>
                      setConflictInputs((prev) => ({
                        ...prev,
                        [c.id]: e.target.value.replace(/\D/g, ''),
                      }))
                    }
                    className="w-28 min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 px-2.5 text-base sm:text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const nextNo = parsePositiveInt(
                        conflictInputs[c.id] || ''
                      );
                      if (nextNo) {
                        resolveConflictChangeNumber(c.id, nextNo);
                      }
                    }}
                    className="flex-1 sm:flex-none min-h-[42px] sm:min-h-[38px] px-3 py-1.5 rounded-lg bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] whitespace-nowrap"
                  >
                    Simpan Nomor Baru
                  </button>
                  <button
                    type="button"
                    onClick={() => discardPendingRecord(c.id)}
                    className="min-h-[42px] sm:min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-300 text-xs text-stone-600 hover:bg-[#F6F7F4] whitespace-nowrap"
                  >
                    Hapus Antrean
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 p-1 bg-[#F6F7F4] border border-stone-200/80 rounded-xl w-full sm:w-fit">
            {(lockedCompany ? ([lockedCompany] as const) : (['ALL', ...COMPANIES] as const)).map(
              (comp) => (
                <button
                  key={comp}
                  type="button"
                  onClick={() => {
                    if (lockedCompany && comp !== lockedCompany) return;
                    setCompanyFilter(comp);
                    setLokasiFilter('ALL');
                    setPage(1);
                  }}
                  className={`flex-1 sm:flex-none min-h-[40px] sm:min-h-[38px] px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    companyFilter === comp
                      ? 'bg-[#14532D] text-white'
                      : 'text-stone-600 hover:text-[#141A15]'
                  }`}
                >
                  {comp === 'ALL' ? 'Semua PT' : comp}
                </button>
              )
            )}
          </div>

          <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-1 p-1 bg-[#F6F7F4] border border-stone-200/80 rounded-xl w-full sm:w-fit">
            {(
              [
                { id: 'ALL', label: 'Semua' },
                { id: 'SENSUS', label: 'Sensus' },
                { id: 'MONITORING_IPPKH', label: 'IPPKH' },
                { id: 'MONITORING_APL', label: 'APL' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setMenuFilter(tab.id);
                  setPage(1);
                }}
                className={`min-h-[40px] sm:min-h-[38px] px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-center ${
                  menuFilter === tab.id
                    ? 'bg-white text-[#141A15] border border-stone-200'
                    : 'text-stone-600 hover:text-[#141A15]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari nomor, jenis, petak, petugas..."
              className="w-full min-h-[44px] rounded-xl border border-stone-300 pl-9 pr-3 text-base sm:text-xs text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
            />
          </div>

          <select
            value={lokasiFilter}
            onChange={(e) => {
              setLokasiFilter(e.target.value);
              setPage(1);
            }}
            className="w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs text-[#141A15] focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
          >
            <option value="ALL">Semua Lokasi</option>
            {visibleLocations.map((loc) => (
              <option key={loc.id} value={loc.lokasiKey}>
                {companyFilter === 'ALL'
                  ? `${loc.name} (${loc.perusahaan})`
                  : loc.name}
              </option>
            ))}
          </select>

          <select
            value={periodeFilter}
            onChange={(e) => {
              setPeriodeFilter(e.target.value);
              setPage(1);
            }}
            className="w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs font-mono text-[#141A15] focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
          >
            <option value="ALL">Semua Periode</option>
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                {p === currentMonth ? `${p} (Bulan Berjalan)` : p}
              </option>
            ))}
          </select>

          <select
            value={kondisiFilter}
            onChange={(e) => {
              setKondisiFilter(e.target.value as 'ALL' | PlantCondition);
              setPage(1);
            }}
            className="w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs text-[#141A15] focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
          >
            <option value="ALL">Semua Kondisi</option>
            {PLANT_CONDITIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tableError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {tableError}
        </div>
      )}

      {/* Paginated Data Table */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        {tableLoading ? (
          <div className="p-10 text-center text-sm text-stone-500">
            Memuat data 100 baris/halaman...
          </div>
        ) : displayedRecords.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-stone-500">
              Tidak ada data tanaman pada filter periode{' '}
              <span className="font-mono font-semibold text-stone-700">
                {periodeFilter === 'ALL' ? 'Semua Periode' : periodeFilter}
              </span>
              .
            </p>
            {periodeFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => {
                  setPeriodeFilter('ALL');
                  setPage(1);
                }}
                className="text-xs font-semibold text-[#14532D] hover:underline"
              >
                Tampilkan Semua Periode
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile & Tablet Card List (eliminates 13-col horizontal table scrolling on phones) */}
            <div className="lg:hidden divide-y divide-stone-200/80">
              {displayedRecords.map((rec) => {
                const fc =
                  rec.menuType !== 'SENSUS'
                    ? condLookup.get(
                        `${rec.companyKey}__${rec.menuType}__${rec.lokasiKey}__${rec.periode}`
                      )
                    : undefined;
                const cc =
                  rec.menuType === 'MONITORING_APL'
                    ? canopyLookup.get(
                        `${rec.companyKey}__${rec.lokasiKey}__${rec.petakKey}__${rec.periode}`
                      )
                    : undefined;
                const hasGnss = rec.latitude != null && rec.longitude != null;

                return (
                  <div key={rec.id} className="p-4 space-y-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-mono tabular-nums font-bold text-sm text-[#141A15]">
                            #{rec.nomorTanaman}
                          </span>
                          <span className="font-semibold text-sm text-[#141A15]">
                            {rec.jenisTanaman}
                          </span>
                          <span
                            className={`font-semibold ${
                              rec.kondisiTanaman === 'Sehat'
                                ? 'text-[#14532D]'
                                : rec.kondisiTanaman === 'Kurang Sehat'
                                ? 'text-amber-700'
                                : rec.kondisiTanaman === 'Merana'
                                ? 'text-orange-700'
                                : 'text-red-700'
                            }`}
                          >
                            · {rec.kondisiTanaman}
                          </span>
                        </div>
                        <div className="text-[11px] text-stone-500 mt-0.5">
                          {rec.perusahaan} · {getMenuLabel(rec.menuType)} ·{' '}
                          <span className="font-semibold text-stone-700">
                            {rec.lokasi}
                          </span>
                          {rec.menuType !== 'SENSUS' && rec.nomorPetak
                            ? ` · Petak ${rec.nomorPetak}`
                            : ''}
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums text-[11px] text-stone-500 shrink-0">
                        <div>{rec.tanggalInput}</div>
                        {rec.waktuInput && <div>{rec.waktuInput}</div>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F6F7F4] border border-stone-200/70 px-3 py-2">
                      <div className="font-mono tabular-nums text-[#141A15] font-semibold">
                        {rec.kondisiTanaman === 'Mati'
                          ? 'Tinggi / Diam: -'
                          : `T: ${rec.tinggiCm} cm · D: ${rec.diameterMm} mm`}
                      </div>
                      <div className="text-[11px] text-stone-600">
                        Petugas:{' '}
                        <span className="font-semibold text-[#141A15]">
                          {rec.namaPetugas}
                        </span>
                      </div>
                    </div>

                    {rec.menuType !== 'SENSUS' && (fc || cc) && (
                      <div className="text-[11px] text-stone-600 flex flex-wrap gap-x-3 gap-y-0.5">
                        {fc && (
                          <span>
                            CC: {fc.coverCrop} · Kons:{' '}
                            {fc.bangunanKonservasi === 'Ada'
                              ? `Ada (${fc.jumlahBangunan})`
                              : 'Tidak Ada'}
                          </span>
                        )}
                        {rec.menuType === 'MONITORING_APL' && cc && (
                          <span>Tajuk: {cc.penutupanTajuk}</span>
                        )}
                      </div>
                    )}

                    {rec.keterangan && (
                      <p className="text-[11px] text-stone-500 italic">
                        &ldquo;{rec.keterangan}&rdquo;
                      </p>
                    )}

                    {rec.syncStatus === 'pending' && (
                      <div className="text-[11px] text-amber-800 font-semibold">
                        Offline (Menunggu Sinyal)
                      </div>
                    )}

                    {(hasGnss ||
                      rec.gnssOverrideReason ||
                      rec.photoDataUrl ||
                      (isAdmin && rec.syncStatus === 'synced')) && (
                      <div className="space-y-1.5 pt-1">
                        {rec.gnssOverrideReason && (
                          <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
                            <span className="font-semibold">Alasan GNSS:</span>{' '}
                            {rec.gnssOverrideReason}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            {(hasGnss || rec.photoDataUrl || rec.gnssOverrideReason) && (
                              <button
                                type="button"
                                onClick={() => setInspectRecord(rec)}
                                className={`min-h-[38px] px-3 rounded-lg border bg-white inline-flex items-center gap-2 text-[11px] font-semibold ${
                                  rec.gnssOverrideReason
                                    ? 'border-amber-300 text-amber-800 hover:bg-amber-50'
                                    : 'border-stone-200 text-[#14532D] hover:bg-[#F2F7F3]'
                                }`}
                              >
                                {(hasGnss || rec.gnssOverrideReason) && (
                                  <span className="inline-flex items-center gap-1 font-mono">
                                    <MapPin className="w-3.5 h-3.5" />
                                    {rec.horizontalAccuracyM != null
                                      ? `±${rec.horizontalAccuracyM}m`
                                      : 'GNSS'}
                                  </span>
                                )}
                                {rec.photoDataUrl && (
                                  <span className="inline-flex items-center gap-1">
                                    <Camera className="w-3.5 h-3.5" />
                                    Foto
                                  </span>
                                )}
                              </button>
                            )}
                          </div>

                        {isAdmin && rec.syncStatus === 'synced' && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(rec)}
                              className="min-h-[38px] px-3 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-100 inline-flex items-center gap-1 text-[11px] font-semibold"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(rec)}
                              className="min-h-[38px] min-w-[38px] rounded-lg border border-stone-200 text-red-600 hover:bg-red-50 inline-flex items-center justify-center"
                              title="Hapus data"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F6F7F4] border-b border-stone-200 text-[11px] font-semibold text-stone-600">
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-3">Perusahaan</th>
                    <th className="py-3 px-3">Menu</th>
                    <th className="py-3 px-3">Lokasi & Petak</th>
                    <th className="py-3 px-3 text-right">No. Tan</th>
                    <th className="py-3 px-3">Jenis (Kelompok)</th>
                    <th className="py-3 px-3 text-right">Tinggi</th>
                    <th className="py-3 px-3 text-right">Diam.</th>
                    <th className="py-3 px-3">Kondisi</th>
                    <th className="py-3 px-3">GNSS & Foto</th>
                    <th className="py-3 px-3">Lapangan / Tajuk</th>
                    <th className="py-3 px-3">Petugas</th>
                    {isAdmin && <th className="py-3 px-4 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-xs">
                  {displayedRecords.map((rec) => {
                    const fc =
                      rec.menuType !== 'SENSUS'
                        ? condLookup.get(
                            `${rec.companyKey}__${rec.menuType}__${rec.lokasiKey}__${rec.periode}`
                          )
                        : undefined;
                    const cc =
                      rec.menuType === 'MONITORING_APL'
                        ? canopyLookup.get(
                            `${rec.companyKey}__${rec.lokasiKey}__${rec.petakKey}__${rec.periode}`
                          )
                        : undefined;
                    const hasGnss =
                      rec.latitude != null && rec.longitude != null;

                    return (
                      <tr key={rec.id} className="hover:bg-[#F6F7F4]/70">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-stone-700 whitespace-nowrap">
                          <div>{rec.tanggalInput}</div>
                          {rec.waktuInput && (
                            <div className="text-[11px] text-stone-500">
                              {rec.waktuInput}
                            </div>
                          )}
                          {rec.syncStatus === 'pending' && (
                            <div className="text-[10px] text-amber-800 font-sans font-semibold">
                              Offline (Menunggu Sinyal)
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#141A15] whitespace-nowrap">
                          {rec.perusahaan}
                        </td>
                        <td className="py-2.5 px-3 text-stone-700 whitespace-nowrap">
                          {getMenuLabel(rec.menuType)}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-[#141A15]">
                            {rec.lokasi}
                          </div>
                          {rec.menuType !== 'SENSUS' && rec.nomorPetak && (
                            <div className="text-stone-500">
                              Petak {rec.nomorPetak}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#141A15]">
                          #{rec.nomorTanaman}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-[#141A15]">
                            {rec.jenisTanaman}
                          </div>
                          <div className="text-[11px] text-stone-500">
                            {rec.kelompokTanaman === 'FGS'
                              ? 'Fast Growing'
                              : 'Lokal / MPTS'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#141A15] whitespace-nowrap">
                          {rec.kondisiTanaman === 'Mati' ? (
                            <span className="text-stone-400">-</span>
                          ) : (
                            `${rec.tinggiCm} cm`
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#141A15] whitespace-nowrap">
                          {rec.kondisiTanaman === 'Mati' ? (
                            <span className="text-stone-400">-</span>
                          ) : (
                            `${rec.diameterMm} mm`
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              rec.kondisiTanaman === 'Sehat'
                                ? 'text-[#14532D]'
                                : rec.kondisiTanaman === 'Kurang Sehat'
                                ? 'text-amber-700'
                                : rec.kondisiTanaman === 'Merana'
                                ? 'text-orange-700'
                                : 'text-red-700'
                            }`}
                          >
                            {rec.kondisiTanaman}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {hasGnss || rec.photoDataUrl || rec.gnssOverrideReason ? (
                            <div className="space-y-0.5">
                              <button
                                type="button"
                                onClick={() => setInspectRecord(rec)}
                                className={`inline-flex items-center gap-1.5 text-[11px] font-semibold hover:underline ${
                                  rec.gnssOverrideReason
                                    ? 'text-amber-700'
                                    : 'text-[#14532D]'
                                }`}
                              >
                                {(hasGnss || rec.gnssOverrideReason) && (
                                  <span className="inline-flex items-center gap-0.5 font-mono">
                                    <MapPin className="w-3 h-3" />
                                    {rec.horizontalAccuracyM != null
                                      ? `±${rec.horizontalAccuracyM}m`
                                      : 'GNSS'}
                                  </span>
                                )}
                                {rec.photoDataUrl && (
                                  <span className="inline-flex items-center gap-0.5">
                                    <Camera className="w-3 h-3" />
                                    Foto
                                  </span>
                                )}
                              </button>
                              {rec.gnssOverrideReason && (
                                <div
                                  className="text-[10px] text-amber-800 max-w-[150px] truncate"
                                  title={rec.gnssOverrideReason}
                                >
                                  Alasan: {rec.gnssOverrideReason}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-stone-400">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-stone-600">
                          {rec.menuType === 'SENSUS' ? (
                            <span className="text-stone-400">-</span>
                          ) : (
                            <div className="space-y-0.5">
                              {fc ? (
                                <div>
                                  CC: {fc.coverCrop} · Kons:{' '}
                                  {fc.bangunanKonservasi === 'Ada'
                                    ? `Ada (${fc.jumlahBangunan})`
                                    : 'Tidak Ada'}
                                </div>
                              ) : (
                                <div className="text-stone-400">
                                  Kondisi lokasi belum diisi
                                </div>
                              )}
                              {rec.menuType === 'MONITORING_APL' && (
                                <div>
                                  Tajuk:{' '}
                                  <span className="font-medium text-stone-800">
                                    {cc ? cc.penutupanTajuk : '-'}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-stone-700">
                          <div>{rec.namaPetugas}</div>
                          {rec.keterangan && (
                            <div className="text-[11px] text-stone-400 truncate max-w-[140px]">
                              {rec.keterangan}
                            </div>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            {rec.syncStatus === 'synced' ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditModal(rec)}
                                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 hover:text-[#141A15]"
                                  title="Edit data"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(rec)}
                                  className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-stone-500 hover:bg-red-50 hover:text-red-700"
                                  title="Hapus data"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-stone-400">
                                Antrean
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Pagination Footer */}
        <div className="border-t border-stone-200 px-4 py-3 bg-[#F6F7F4] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="text-stone-600 font-mono tabular-nums">
            Halaman {page} dari {totalPages} · Total {pageResult.total} entri
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || tableLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[38px] px-3 rounded-lg border border-stone-300 bg-white text-stone-700 font-semibold hover:bg-stone-50 disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= totalPages || tableLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-[38px] px-3 rounded-lg border border-stone-300 bg-white text-stone-700 font-semibold hover:bg-stone-50 disabled:opacity-40 flex items-center gap-1"
            >
              Berikutnya
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mandatory Confirmation Modal before Creating / Writing to Google Sheets */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 my-auto">
            <div className="flex items-center gap-2 text-base font-bold text-[#141A15] font-display">
              <FileSpreadsheet className="w-5 h-5 text-[#14532D]" />
              <span>
                {pendingConfirm.mode === 'create_and_sync'
                  ? `Buat Google Spreadsheet ${pendingConfirm.perusahaan}?`
                  : `Sinkronkan Google Spreadsheet ${pendingConfirm.perusahaan}?`}
              </span>
            </div>

            <div className="text-xs text-stone-600 space-y-2 leading-relaxed">
              {pendingConfirm.mode === 'create_and_sync' ? (
                <p>
                  Aplikasi akan membuat Google Spreadsheet baru berjudul{' '}
                  <strong className="text-[#141A15]">
                    Environment - {pendingConfirm.perusahaan}
                  </strong>{' '}
                  di akun Google{' '}
                  <span className="font-mono">{profile?.email}</span> beserta 6
                  tab:
                </p>
              ) : (
                <p>
                  Aplikasi akan memperbarui 6 tab pada Google Spreadsheet
                  tertaut milik{' '}
                  <strong className="text-[#141A15]">
                    {pendingConfirm.perusahaan}
                  </strong>{' '}
                  dengan{' '}
                  <strong className="font-mono">
                    {
                      allRecords.filter(
                        (r) => r.perusahaan === pendingConfirm.perusahaan
                      ).length
                    }
                  </strong>{' '}
                  data tanaman terbaru:
                </p>
              )}
              <ul className="list-disc pl-5 space-y-0.5 text-stone-700">
                <li>Rekapitulasi_Analisis (Survival Rate, Tinggi/Diameter)</li>
                <li>Tren_Monitoring_Petak + Grafik Tren Pertumbuhan</li>
                <li>Data_Sensus, Monitoring_IPPKH, Monitoring_APL (Latitude/Longitude)</li>
                <li>Kondisi_Lapangan_Tajuk (Latitude/Longitude)</li>
              </ul>
              {!sheetsAccessToken && (
                <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  Anda akan diminta memberikan izin akses Google Sheets melalui
                  jendela login Google.
                </p>
              )}
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-[#F6F7F4]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSheetAction()}
                className="flex-1 min-h-[44px] rounded-xl bg-[#14532D] text-xs font-semibold text-white hover:bg-[#0F3F22]"
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GNSS & Photo Inspection Modal */}
      {inspectRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white border border-stone-200 rounded-2xl p-5 shadow-xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#141A15] font-display">
                  Bukti Lapangan #{inspectRecord.nomorTanaman} ·{' '}
                  {inspectRecord.jenisTanaman}
                </h3>
                <p className="text-[11px] text-stone-500">
                  {inspectRecord.perusahaan} · {inspectRecord.lokasi}
                  {inspectRecord.nomorPetak
                    ? ` · Petak ${inspectRecord.nomorPetak}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {inspectRecord.latitude != null &&
              inspectRecord.longitude != null && (
                <div className="rounded-xl bg-[#F6F7F4] border border-stone-200 p-3 text-xs space-y-1">
                  <div className="font-semibold text-[#141A15]">
                    Koordinat GNSS ({inspectRecord.coordCrs || 'EPSG:4326'})
                  </div>
                  <div className="font-mono text-stone-700">
                    Lat {inspectRecord.latitude.toFixed(6)}, Lon{' '}
                    {inspectRecord.longitude.toFixed(6)}
                    {inspectRecord.altitudeM != null
                      ? ` · Elev ${inspectRecord.altitudeM} m`
                      : ''}
                  </div>
                  <div className="text-[11px] text-stone-600">
                    Akurasi H: ±{inspectRecord.horizontalAccuracyM ?? '?'} m · V:
                    ±{inspectRecord.verticalAccuracyM ?? '?'} m ·{' '}
                    {inspectRecord.gnssSource || 'GNSS'}
                  </div>
                </div>
              )}

            {inspectRecord.gnssOverrideReason && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-0.5">
                <div className="font-semibold">
                  Melebihi Ambang Batas Akurasi GNSS
                </div>
                <p className="text-[11px] leading-relaxed">
                  Alasan Petugas: {inspectRecord.gnssOverrideReason}
                </p>
              </div>
            )}

            {inspectRecord.photoDataUrl ? (
              <div className="space-y-1.5">
                <img
                  src={inspectRecord.photoDataUrl}
                  alt={`Foto tanaman #${inspectRecord.nomorTanaman}`}
                  className="w-full max-h-72 object-contain rounded-xl border border-stone-200 bg-stone-50"
                />
                <p className="text-[11px] text-stone-500 text-right font-mono">
                  Foto terkompresi ringan (&lt;= 150 KB)
                </p>
              </div>
            ) : (
              <p className="text-xs text-stone-500 text-center py-4">
                Tidak ada foto terlampir pada entri ini.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Admin Edit Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 my-auto"
          >
            <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
              <h3 className="text-base font-bold text-[#141A15] font-display">
                Edit Data Tanaman #{editingRecord.nomorTanaman}
              </h3>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold text-stone-700">
                  Perusahaan
                </label>
                <select
                  value={editPerusahaan}
                  onChange={(e) =>
                    setEditPerusahaan(e.target.value as CompanyName)
                  }
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs font-semibold"
                >
                  {COMPANIES.map((comp) => (
                    <option key={comp} value={comp}>
                      {comp}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Tanggal Input
                </label>
                <input
                  type="date"
                  value={editTanggal}
                  onChange={(e) => setEditTanggal(e.target.value)}
                  required
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Nama Petugas
                </label>
                <input
                  type="text"
                  value={editPetugas}
                  onChange={(e) => setEditPetugas(e.target.value)}
                  required
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">Lokasi</label>
                <input
                  type="text"
                  value={editLokasi}
                  onChange={(e) => setEditLokasi(e.target.value)}
                  required
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs"
                />
              </div>
              {editingRecord.menuType !== 'SENSUS' && (
                <div className="space-y-1">
                  <label className="font-semibold text-stone-700">
                    Nomor Petak
                  </label>
                  <input
                    type="text"
                    value={editPetak}
                    onChange={(e) => setEditPetak(e.target.value)}
                    required
                    className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Nomor Tanaman
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editNomor}
                  onChange={(e) =>
                    setEditNomor(e.target.value.replace(/\D/g, ''))
                  }
                  required
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Kelompok Tanaman
                </label>
                <select
                  value={editKelompok}
                  onChange={(e) => {
                    const g = e.target.value as PlantGroup;
                    setEditKelompok(g);
                    const nextList = getSpeciesForCompanyGroup(
                      editPerusahaan,
                      g
                    );
                    if (nextList.length > 0) setEditJenis(nextList[0]);
                  }}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs"
                >
                  <option value="FGS">1. Fast Growing (FGS)</option>
                  <option value="LOKAL_MPTS">2. Lokal / MPTS</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Jenis Tanaman
                </label>
                <select
                  value={editJenis}
                  onChange={(e) => setEditJenis(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs"
                >
                  {editSpeciesOptions.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                  {!editSpeciesOptions.includes(editJenis) && editJenis && (
                    <option value={editJenis}>{editJenis}</option>
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">Kondisi</label>
                <select
                  value={editKondisi}
                  onChange={(e) => {
                    const nextCond = e.target.value as PlantCondition;
                    setEditKondisi(nextCond);
                    if (nextCond === 'Mati') {
                      setEditTinggi('0');
                      setEditDiameter('0');
                    } else {
                      if (editTinggi === '0') setEditTinggi('');
                      if (editDiameter === '0') setEditDiameter('');
                    }
                  }}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs"
                >
                  {PLANT_CONDITIONS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Tinggi (cm)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={editKondisi === 'Mati'}
                  value={editKondisi === 'Mati' ? '' : editTinggi}
                  placeholder={editKondisi === 'Mati' ? 'Nonaktif (Mati)' : ''}
                  onChange={(e) =>
                    setEditTinggi(
                      e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '')
                    )
                  }
                  required={editKondisi !== 'Mati'}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs font-mono disabled:bg-[#F6F7F4] disabled:text-stone-400"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Diameter (mm)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={editKondisi === 'Mati'}
                  value={editKondisi === 'Mati' ? '' : editDiameter}
                  placeholder={editKondisi === 'Mati' ? 'Nonaktif (Mati)' : ''}
                  onChange={(e) =>
                    setEditDiameter(
                      e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '')
                    )
                  }
                  required={editKondisi !== 'Mati'}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs font-mono disabled:bg-[#F6F7F4] disabled:text-stone-400"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold text-stone-700">
                  Keterangan
                </label>
                <textarea
                  rows={2}
                  value={editKet}
                  onChange={(e) => setEditKet(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 p-2.5 text-base sm:text-xs"
                />
              </div>
            </div>

            {editError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                {editError}
              </div>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-[#F6F7F4]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="flex-1 min-h-[44px] rounded-xl bg-[#14532D] text-xs font-semibold text-white hover:bg-[#0F3F22] disabled:opacity-50"
              >
                {editSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm bg-white border border-stone-200 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-[#141A15] font-display">
              Hapus Data Tanaman #{deleteTarget.nomorTanaman}?
            </h3>
            <p className="text-xs text-stone-600">
              Data {deleteTarget.perusahaan} · {deleteTarget.jenisTanaman} di{' '}
              {deleteTarget.lokasi}
              {deleteTarget.menuType !== 'SENSUS' && deleteTarget.nomorPetak
                ? ` (Petak ${deleteTarget.nomorPetak})`
                : ''}{' '}
              akan dihapus permanen dari database pusat.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-[#F6F7F4]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="flex-1 min-h-[44px] rounded-xl bg-red-700 text-xs font-semibold text-white hover:bg-red-800"
              >
                Ya, Hapus Data
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
