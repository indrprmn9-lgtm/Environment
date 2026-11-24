import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Hash,
  RotateCcw,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import {
  type AssignedCompany,
  COMPANIES,
  parsePositiveInt,
  type StaffMember,
  type UserRole,
} from '../types/plant';

export const StaffManagerView: React.FC = () => {
  const { profile } = useAuth();
  const {
    staffList,
    adminAddStaff,
    adminUpdateStaff,
    adminDeleteStaff,
    adminResetAllStaff,
  } = useData();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('petugas');
  const [assignedCompany, setAssignedCompany] =
    useState<AssignedCompany>('PT. NBSS');
  const [rangeStartRaw, setRangeStartRaw] = useState('');
  const [rangeEndRaw, setRangeEndRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-row inline range editing
  const [rangeDrafts, setRangeDrafts] = useState<
    Record<string, { start: string; end: string }>
  >({});

  if (profile?.role !== 'admin') {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-sm text-stone-600">
        Menu ini hanya dapat diakses oleh Administrator.
      </div>
    );
  }

  const parseOptionalRange = (
    sRaw: string,
    eRaw: string
  ): { start: number | null; end: number | null } => {
    const cleanS = sRaw.trim();
    const cleanE = eRaw.trim();
    if (!cleanS && !cleanE) return { start: null, end: null };
    const s = parsePositiveInt(cleanS);
    const e = parsePositiveInt(cleanE);
    if (!s || !e || e < s) {
      throw new Error(
        'Rentang nomor regu harus valid (isi Nomor Awal & Akhir, dengan Akhir >= Awal).'
      );
    }
    return { start: s, end: e };
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const { start, end } = parseOptionalRange(rangeStartRaw, rangeEndRaw);
      await adminAddStaff(email, name, role, assignedCompany, start, end);
      setNotice(`Akun ${email.trim().toLowerCase()} berhasil ditambahkan.`);
      setEmail('');
      setName('');
      setRole('petugas');
      setAssignedCompany('PT. NBSS');
      setRangeStartRaw('');
      setRangeEndRaw('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Gagal menambahkan petugas.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveRowRange = async (staff: StaffMember) => {
    setError(null);
    setNotice(null);
    const draft = rangeDrafts[staff.id];
    if (!draft) return;
    try {
      const { start, end } = parseOptionalRange(draft.start, draft.end);
      await adminUpdateStaff(staff.id, {
        name: staff.name,
        role: staff.role,
        assignedCompany: staff.assignedCompany || 'ALL',
        rangeStart: start,
        rangeEnd: end,
        active: staff.active,
      });
      setNotice(
        start && end
          ? `Alokasi blok nomor #${start}–#${end} disimpan untuk ${staff.name}.`
          : `Alokasi blok nomor ${staff.name} dikosongkan (bebas berurutan).`
      );
      setRangeDrafts((prev) => {
        const copy = { ...prev };
        delete copy[staff.id];
        return copy;
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan rentang nomor regu.'
      );
    }
  };

  return (
    <div className="space-y-6 pb-24 lg:pb-8">
      <div className="border-b border-stone-200 pb-4">
        <p className="text-xs font-semibold text-[#14532D]">
          Khusus Administrator · Kontrol Akses Google, Perusahaan & Rentang
          Nomor Regu
        </p>
        <h1 className="text-2xl font-bold text-[#141A15] font-display tracking-tight mt-0.5">
          Kelola Petugas Lapangan & Admin
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleAdd}
          className="lg:col-span-5 bg-white border border-stone-200 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-[#141A15] font-display">
            <UserPlus className="w-4 h-4 text-[#14532D]" />
            Tambah Email Petugas / Admin
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-800">
              Email Google Petugas
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="petugas@gmail.com"
              required
              className="w-full min-h-[44px] rounded-xl border border-stone-300 px-3.5 text-sm font-mono text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-800">
              Nama Lengkap Petugas
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Budi Santoso"
              required
              className="w-full min-h-[44px] rounded-xl border border-stone-300 px-3.5 text-sm text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-800">
              Perusahaan yang Ditugaskan
            </label>
            <div
              className={`grid gap-2 ${
                role === 'admin' ? 'grid-cols-2' : 'grid-cols-3'
              }`}
            >
              {(role === 'admin' ? (['ALL', ...COMPANIES] as const) : COMPANIES).map(
                (comp) => (
                  <button
                    key={comp}
                    type="button"
                    onClick={() => setAssignedCompany(comp)}
                    className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold border transition-colors ${
                      assignedCompany === comp
                        ? 'bg-[#14532D] text-white border-[#14532D]'
                        : 'bg-white text-stone-700 border-stone-300 hover:bg-[#F6F7F4]'
                    }`}
                  >
                    {comp === 'ALL' ? 'Semua (3 PT)' : comp}
                  </button>
                )
              )}
            </div>
            {role === 'petugas' && (
              <p className="text-[11px] text-stone-500">
                Isolasi data aktif: petugas hanya dapat melihat dan menginput data
                perusahaan yang dipilih.
              </p>
            )}
          </div>

          {/* Officer Number Range Allocation */}
          <div className="rounded-xl bg-[#F6F7F4] border border-stone-200 p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-800">
              <Hash className="w-3.5 h-3.5 text-[#14532D]" />
              Alokasi Rentang Nomor Regu Saat Offline (Opsional)
            </div>
            <p className="text-[11px] text-stone-600">
              Contoh: Petugas A #1–#200, Petugas B #201–#400 agar nol konflik
              nomor ganda jika bekerja bersamaan tanpa sinyal.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <input
                type="text"
                inputMode="numeric"
                value={rangeStartRaw}
                onChange={(e) =>
                  setRangeStartRaw(e.target.value.replace(/\D/g, ''))
                }
                placeholder="Nomor Awal (mis. 1)"
                className="w-full min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-mono tabular-nums"
              />
              <input
                type="text"
                inputMode="numeric"
                value={rangeEndRaw}
                onChange={(e) =>
                  setRangeEndRaw(e.target.value.replace(/\D/g, ''))
                }
                placeholder="Nomor Akhir (mis. 200)"
                className="w-full min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-mono tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-stone-800">
              Peran Akses
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setRole('petugas');
                  if (assignedCompany === 'ALL') {
                    setAssignedCompany('PT. NBSS');
                  }
                }}
                className={`min-h-[44px] rounded-xl text-xs font-semibold border transition-colors ${
                  role === 'petugas'
                    ? 'bg-[#14532D] text-white border-[#14532D]'
                    : 'bg-white text-stone-700 border-stone-300 hover:bg-[#F6F7F4]'
                }`}
              >
                Petugas (Input Data)
              </button>
              <button
                type="button"
                onClick={() => {
                  setRole('admin');
                  setAssignedCompany('ALL');
                }}
                className={`min-h-[44px] rounded-xl text-xs font-semibold border transition-colors ${
                  role === 'admin'
                    ? 'bg-[#141A15] text-white border-[#141A15]'
                    : 'bg-white text-stone-700 border-stone-300 hover:bg-[#F6F7F4]'
                }`}
              >
                Administrator
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-xl bg-[#F2F7F3] border border-[#14532D]/25 p-3 text-xs text-[#14532D]">
              {notice}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] rounded-xl bg-[#14532D] text-white text-sm font-semibold hover:bg-[#0F3F22] disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Menambahkan...' : 'Daftarkan Akun'}
          </button>
        </form>

        <div className="lg:col-span-7 bg-white border border-stone-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/80 pb-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-bold text-[#141A15] font-display">
                Daftar Petugas Terdaftar
              </h2>
              <span className="text-xs font-mono tabular-nums text-stone-500">
                {staffList.length} akun
              </span>
            </div>

            {staffList.length > 1 && !confirmReset && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setConfirmReset(true);
                }}
                className="min-h-[36px] px-3 rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Semua Akun
              </button>
            )}
          </div>

          {confirmReset && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2 text-xs text-red-900">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p>
                  Semua akun petugas dan admin tambahan akan dihapus dari daftar
                  akses. Hanya akun Administrator utama Anda (
                  <span className="font-mono font-semibold">{profile.email}</span>
                  ) yang dipertahankan. Lanjutkan?
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <button
                  type="button"
                  disabled={resetting}
                  onClick={() => setConfirmReset(false)}
                  className="min-h-[36px] px-3 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={async () => {
                    setError(null);
                    setNotice(null);
                    setResetting(true);
                    try {
                      await adminResetAllStaff();
                      setConfirmReset(false);
                      setNotice(
                        'Semua akun petugas dan admin tambahan berhasil direset. Silakan daftarkan ulang akun yang diperlukan.'
                      );
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : 'Gagal mereset daftar akun.'
                      );
                    } finally {
                      setResetting(false);
                    }
                  }}
                  className="min-h-[36px] px-3 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {resetting ? 'Mereset...' : 'Ya, Reset Semua Akun'}
                </button>
              </div>
            </div>
          )}

          {staffList.length === 0 ? (
            <p className="text-xs text-stone-500 py-8 text-center">
              Belum ada petugas lapangan yang ditambahkan. Tambahkan email
              Google petugas di formulir samping agar mereka dapat masuk melalui
              HP masing-masing.
            </p>
          ) : (
            <div className="divide-y divide-stone-100">
              {staffList.map((staff) => {
                const currentCompany: AssignedCompany =
                  staff.assignedCompany || 'ALL';
                const draft = rangeDrafts[staff.id] ?? {
                  start: staff.rangeStart ? String(staff.rangeStart) : '',
                  end: staff.rangeEnd ? String(staff.rangeEnd) : '',
                };
                const draftDirty = Boolean(rangeDrafts[staff.id]);

                return (
                  <div
                    key={staff.id}
                    className="py-4 first:pt-0 last:pb-0 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#141A15]">
                            {staff.name}
                          </span>
                          <span className="text-xs text-stone-400">·</span>
                          <span
                            className={`text-xs font-semibold ${
                              staff.role === 'admin'
                                ? 'text-[#141A15]'
                                : 'text-[#14532D]'
                            }`}
                          >
                            {staff.role === 'admin'
                              ? 'Administrator'
                              : 'Petugas'}
                          </span>
                          <span className="text-xs text-stone-400">·</span>
                          <span className="text-xs font-medium text-stone-700">
                            {currentCompany === 'ALL'
                              ? 'Semua (3 PT)'
                              : currentCompany}
                          </span>
                          <span className="text-xs text-stone-400">·</span>
                          <span
                            className={`text-xs font-medium ${
                              staff.active ? 'text-[#14532D]' : 'text-red-700'
                            }`}
                          >
                            {staff.active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-stone-500">
                          {staff.email}
                          {staff.rangeStart && staff.rangeEnd ? (
                            <span className="ml-2 text-[#14532D] font-semibold">
                              · Blok #{staff.rangeStart}–#{staff.rangeEnd}
                            </span>
                          ) : (
                            <span className="ml-2 text-stone-400">
                              · Blok nomor bebas
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <select
                          value={currentCompany}
                          onChange={(e) =>
                            adminUpdateStaff(staff.id, {
                              name: staff.name,
                              role: staff.role,
                              assignedCompany: e.target.value as AssignedCompany,
                              rangeStart: staff.rangeStart ?? null,
                              rangeEnd: staff.rangeEnd ?? null,
                              active: staff.active,
                            })
                          }
                          aria-label={`Perusahaan untuk ${staff.name}`}
                          className="min-h-[38px] rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-700"
                        >
                          {staff.role === 'admin' ? (
                            <option value="ALL">Semua (3 PT)</option>
                          ) : currentCompany === 'ALL' ? (
                            <option value="ALL" disabled>
                              Pilih Perusahaan (Wajib)
                            </option>
                          ) : null}
                          {COMPANIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => {
                            const nextRole: UserRole =
                              staff.role === 'admin' ? 'petugas' : 'admin';
                            const nextCompany: AssignedCompany =
                              nextRole === 'petugas' && currentCompany === 'ALL'
                                ? 'PT. NBSS'
                                : currentCompany;
                            void adminUpdateStaff(staff.id, {
                              name: staff.name,
                              role: nextRole,
                              assignedCompany: nextCompany,
                              rangeStart: staff.rangeStart ?? null,
                              rangeEnd: staff.rangeEnd ?? null,
                              active: staff.active,
                            });
                          }}
                          className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-700 hover:bg-[#F6F7F4] flex items-center gap-1"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          {staff.role === 'admin'
                            ? 'Jadikan Petugas'
                            : 'Jadikan Admin'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            adminUpdateStaff(staff.id, {
                              name: staff.name,
                              role: staff.role,
                              assignedCompany: currentCompany,
                              rangeStart: staff.rangeStart ?? null,
                              rangeEnd: staff.rangeEnd ?? null,
                              active: !staff.active,
                            })
                          }
                          className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-700 hover:bg-[#F6F7F4] flex items-center gap-1"
                        >
                          {staff.active ? (
                            <>
                              <UserX className="w-3.5 h-3.5 text-amber-700" />
                              Nonaktifkan
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5 text-[#14532D]" />
                              Aktifkan
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => adminDeleteStaff(staff.id)}
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-stone-200 text-red-600 hover:bg-red-50"
                          title="Hapus dari daftar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Inline Number Range Editor */}
                    <div className="flex flex-wrap items-center gap-2 bg-[#F6F7F4] rounded-xl px-3 py-2 text-xs">
                      <span className="font-medium text-stone-600">
                        Rentang Nomor:
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Awal"
                        value={draft.start}
                        onChange={(e) =>
                          setRangeDrafts((prev) => ({
                            ...prev,
                            [staff.id]: {
                              start: e.target.value.replace(/\D/g, ''),
                              end: draft.end,
                            },
                          }))
                        }
                        className="w-20 min-h-[34px] rounded-lg border border-stone-300 bg-white px-2.5 font-mono tabular-nums"
                      />
                      <span className="text-stone-400">s/d</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Akhir"
                        value={draft.end}
                        onChange={(e) =>
                          setRangeDrafts((prev) => ({
                            ...prev,
                            [staff.id]: {
                              start: draft.start,
                              end: e.target.value.replace(/\D/g, ''),
                            },
                          }))
                        }
                        className="w-20 min-h-[34px] rounded-lg border border-stone-300 bg-white px-2.5 font-mono tabular-nums"
                      />
                      {draftDirty && (
                        <button
                          type="button"
                          onClick={() => void handleSaveRowRange(staff)}
                          className="min-h-[34px] px-3 rounded-lg bg-[#14532D] text-white font-semibold hover:bg-[#0F3F22] flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Simpan Blok
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
