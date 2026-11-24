import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Camera,
  CheckCircle2,
  ChevronUp,
  Clock,
  CloudOff,
  Compass,
  Edit3,
  Hash,
  Layers,
  Lock,
  MapPin,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Usb,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { formatCoordinatePair } from '../lib/crsTransform';
import {
  captureBrowserGnssPoint,
  type GnssFixResult,
  parseNmeaGgaSentence,
  readNmeaFromWebSerial,
} from '../lib/gnss';
import { compressImageToMax150KB } from '../lib/photoCompress';
import {
  CANOPY_OPTIONS,
  type CanopyClosure,
  COMPANIES,
  type CompanyName,
  CONSERVATION_OPTIONS,
  type ConservationStructureStatus,
  COORD_FORMAT_OPTIONS,
  type CoordCrsCode,
  type CoordFormatType,
  COVER_CROP_OPTIONS,
  type CoverCropDensity,
  CRS_OPTION_GROUPS,
  DIMENSION_BOUNDS,
  extractPeriode,
  getCompanyKey,
  getCurrentTimeString,
  getMenuLabel,
  getTodayDateString,
  makeSafeKey,
  MAX_GNSS_ACCURACY_M,
  type MenuType,
  normalizeDisplayText,
  parsePositiveDecimal,
  parsePositiveInt,
  PLANT_CONDITIONS,
  type PlantCondition,
  type PlantGroup,
} from '../types/plant';

interface PlantEntryFormProps {
  menuType: MenuType;
}

export const PlantEntryForm: React.FC<PlantEntryFormProps> = ({ menuType }) => {
  const { profile } = useAuth();
  const {
    allRecords,
    locations,
    petaks,
    isOnline,
    getSpeciesForCompanyGroup,
    checkDuplicatePlantNumber,
    getNextSuggestedPlantNumber,
    getFieldConditionFor,
    getCanopyCoverFor,
    savePlantRecord,
    saveFieldCondition,
    saveCanopyCover,
  } = useData();

  const isSensus = menuType === 'SENSUS';
  const isMonitoring = !isSensus;
  const isAPL = menuType === 'MONITORING_APL';

  const isCompanyLocked = Boolean(
    profile?.assignedCompany && profile.assignedCompany !== 'ALL'
  );

  // Automatic live device date & time
  const [tanggalInput, setTanggalInput] = useState<string>(getTodayDateString);
  const [waktuInput, setWaktuInput] = useState<string>(getCurrentTimeString);

  useEffect(() => {
    const syncClock = () => {
      setTanggalInput(getTodayDateString());
      setWaktuInput(getCurrentTimeString());
    };
    syncClock();
    const timer = window.setInterval(syncClock, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Company & Core measurement form state
  const [perusahaan, setPerusahaan] = useState<CompanyName>(() =>
    profile?.assignedCompany && profile.assignedCompany !== 'ALL'
      ? profile.assignedCompany
      : 'PT. NBSS'
  );
  const [lokasi, setLokasi] = useState<string>('');
  const [namaPetugas, setNamaPetugas] = useState<string>(profile?.name || '');
  const [nomorPetak, setNomorPetak] = useState<string>('');
  const [nomorTanamanRaw, setNomorTanamanRaw] = useState<string>('');
  const [manualNomorEdited, setManualNomorEdited] = useState<boolean>(false);
  const [kelompokTanaman, setKelompokTanaman] = useState<PlantGroup>('FGS');
  const [jenisTanaman, setJenisTanaman] = useState<string>('Sengon');
  const [tinggiRaw, setTinggiRaw] = useState<string>('');
  const [diameterRaw, setDiameterRaw] = useState<string>('');
  const [kondisiTanaman, setKondisiTanaman] =
    useState<PlantCondition>('Sehat');
  const [keterangan, setKeterangan] = useState<string>('');

  // GNSS Capture state (auto-capture on submit + manual preview + Trimble/Emlid NMEA)
  const [crsCode, setCrsCode] = useState<CoordCrsCode>('EPSG:4326');
  const [coordFormat, setCoordFormat] = useState<CoordFormatType>('DD');
  const [requireStrict3m, setRequireStrict3m] = useState<boolean>(true);
  const [gnssFix, setGnssFix] = useState<GnssFixResult | null>(null);
  const [gnssLoading, setGnssLoading] = useState<boolean>(false);
  const [gnssStatusNote, setGnssStatusNote] = useState<string | null>(null);
  const [nmeaModalOpen, setNmeaModalOpen] = useState<boolean>(false);
  const [nmeaInputText, setNmeaInputText] = useState<string>('');

  // Optional compressed photo (<= 150 KB)
  const [plantPhotoUrl, setPlantPhotoUrl] = useState<string | null>(null);
  const [plantPhotoSizeKb, setPlantPhotoSizeKb] = useState<number>(0);
  const [condPhotoUrl, setCondPhotoUrl] = useState<string | null>(null);
  const [condPhotoSizeKb, setCondPhotoSizeKb] = useState<number>(0);
  const plantPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const condPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Field Condition state (Monitoring IPPKH & APL)
  const [showFieldCondForm, setShowFieldCondForm] = useState<boolean>(false);
  const [coverCrop, setCoverCrop] = useState<CoverCropDensity>('Rapat');
  const [bangunanKonservasi, setBangunanKonservasi] =
    useState<ConservationStructureStatus>('Tidak Ada');
  const [jumlahBangunanRaw, setJumlahBangunanRaw] = useState<string>('1');
  const lastConfirmedLokasiRef = useRef<string>('');

  // Canopy Cover state (Monitoring APL)
  const [showCanopyForm, setShowCanopyForm] = useState<boolean>(false);
  const [penutupanTajuk, setPenutupanTajuk] =
    useState<CanopyClosure>('Tertutup');
  const lastConfirmedPetakRef = useRef<string>('');

  // UI feedback & modals
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [extremeConfirmModal, setExtremeConfirmModal] = useState<{
    tinggiCm: number;
    diameterMm: number;
    warnings: string[];
  } | null>(null);
  const [gnssOverrideModal, setGnssOverrideModal] = useState<{
    tinggiCm: number;
    diameterMm: number;
    extremeConfirmed: boolean;
    fix: GnssFixResult | null;
    reason: string;
  } | null>(null);

  const isMati = kondisiTanaman === 'Mati';
  const companyKey = useMemo(() => getCompanyKey(perusahaan), [perusahaan]);
  const periode = useMemo(() => extractPeriode(tanggalInput), [tanggalInput]);
  const cleanLokasi = useMemo(() => normalizeDisplayText(lokasi), [lokasi]);
  const cleanPetak = useMemo(
    () => (isSensus ? '' : normalizeDisplayText(nomorPetak)),
    [isSensus, nomorPetak]
  );

  // Assigned officer number range info
  const hasOfficerRange = Boolean(
    profile?.rangeStart &&
      profile?.rangeEnd &&
      profile.rangeEnd >= profile.rangeStart
  );

  // Sync assigned company if staff is locked to a specific company
  useEffect(() => {
    if (profile?.assignedCompany && profile.assignedCompany !== 'ALL') {
      setPerusahaan(profile.assignedCompany);
    }
  }, [profile?.assignedCompany]);

  // Sync default officer name once loaded
  useEffect(() => {
    if (profile?.name && !namaPetugas) {
      setNamaPetugas(profile.name);
    }
  }, [profile?.name, namaPetugas]);

  // Active species list for selected company & group from Admin Master Data
  const activeSpeciesList = useMemo(
    () => getSpeciesForCompanyGroup(perusahaan, kelompokTanaman),
    [perusahaan, kelompokTanaman, getSpeciesForCompanyGroup]
  );

  useEffect(() => {
    if (
      activeSpeciesList.length > 0 &&
      !activeSpeciesList.includes(jenisTanaman)
    ) {
      setJenisTanaman(activeSpeciesList[0]);
    }
  }, [activeSpeciesList, jenisTanaman]);

  // Reset form context cleanly when switching between Sensus / IPPKH / APL tabs or Company
  useEffect(() => {
    setFormError(null);
    setSuccessNotice(null);
    lastConfirmedLokasiRef.current = '';
    lastConfirmedPetakRef.current = '';
    setShowFieldCondForm(false);
    setShowCanopyForm(false);
    setManualNomorEdited(false);
    if (isSensus) {
      setNomorPetak('');
    }
  }, [menuType, companyKey, isSensus]);

  // Reset manualNomorEdited when target scope changes so next plant number auto-fills cleanly
  useEffect(() => {
    setManualNomorEdited(false);
  }, [perusahaan, menuType, cleanLokasi, cleanPetak, periode]);

  const handleSelectCompany = (comp: CompanyName) => {
    if (isCompanyLocked || comp === perusahaan) return;
    setPerusahaan(comp);
    setLokasi('');
    setNomorPetak('');
    setNomorTanamanRaw('');
    setManualNomorEdited(false);
    setFormError(null);
    setSuccessNotice(null);
  };

  // Locations scoped to the selected company
  const companyLocations = useMemo(
    () => locations.filter((loc) => loc.companyKey === companyKey),
    [locations, companyKey]
  );

  // Petaks scoped to company & selected location (union of Admin master petaks & recorded petaks)
  const knownPetaksInLocation = useMemo(() => {
    if (isSensus || !cleanLokasi) return [];
    const lk = makeSafeKey(cleanLokasi);
    const set = new Set<string>();
    petaks
      .filter((p) => p.companyKey === companyKey && p.lokasiKey === lk)
      .forEach((p) => set.add(p.name));
    allRecords
      .filter(
        (r) =>
          r.companyKey === companyKey &&
          r.lokasiKey === lk &&
          r.menuType !== 'SENSUS' &&
          Boolean(r.nomorPetak)
      )
      .forEach((r) => set.add(r.nomorPetak));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'id'));
  }, [isSensus, petaks, allRecords, companyKey, cleanLokasi]);

  const existingFieldCondition = useMemo(() => {
    if (!isMonitoring || !cleanLokasi) return undefined;
    return getFieldConditionFor(
      perusahaan,
      menuType as 'MONITORING_IPPKH' | 'MONITORING_APL',
      cleanLokasi,
      periode
    );
  }, [
    isMonitoring,
    perusahaan,
    menuType,
    cleanLokasi,
    periode,
    getFieldConditionFor,
  ]);

  const existingCanopyCover = useMemo(() => {
    if (!isAPL || !cleanLokasi || !cleanPetak) return undefined;
    return getCanopyCoverFor(perusahaan, cleanLokasi, cleanPetak, periode);
  }, [isAPL, perusahaan, cleanLokasi, cleanPetak, periode, getCanopyCoverFor]);

  useEffect(() => {
    if (!isMonitoring || !cleanLokasi) {
      setShowFieldCondForm(false);
      return;
    }
    const locSessionKey = `${companyKey}__${menuType}__${makeSafeKey(cleanLokasi)}__${periode}`;
    if (existingFieldCondition) {
      setCoverCrop(existingFieldCondition.coverCrop);
      setBangunanKonservasi(existingFieldCondition.bangunanKonservasi);
      setJumlahBangunanRaw(
        existingFieldCondition.jumlahBangunan > 0
          ? String(existingFieldCondition.jumlahBangunan)
          : '1'
      );
      setCondPhotoUrl(existingFieldCondition.photoDataUrl || null);
    }
    if (lastConfirmedLokasiRef.current !== locSessionKey) {
      if (!existingFieldCondition) {
        setShowFieldCondForm(true);
      } else {
        lastConfirmedLokasiRef.current = locSessionKey;
        setShowFieldCondForm(false);
      }
    }
  }, [
    isMonitoring,
    companyKey,
    menuType,
    cleanLokasi,
    periode,
    existingFieldCondition,
  ]);

  useEffect(() => {
    if (!isAPL || !cleanLokasi || !cleanPetak) {
      setShowCanopyForm(false);
      return;
    }
    const petakSessionKey = `${companyKey}__${makeSafeKey(cleanLokasi)}__${makeSafeKey(cleanPetak)}__${periode}`;
    if (existingCanopyCover) {
      setPenutupanTajuk(existingCanopyCover.penutupanTajuk);
    }
    if (lastConfirmedPetakRef.current !== petakSessionKey) {
      if (!existingCanopyCover) {
        setShowCanopyForm(true);
      } else {
        lastConfirmedPetakRef.current = petakSessionKey;
        setShowCanopyForm(false);
      }
    }
  }, [isAPL, companyKey, cleanLokasi, cleanPetak, periode, existingCanopyCover]);

  // Auto-suggested next plant number scoped to company + officer range
  const suggestedPlantNumber = useMemo(() => {
    return getNextSuggestedPlantNumber(
      perusahaan,
      menuType,
      cleanLokasi,
      cleanPetak,
      periode
    );
  }, [
    perusahaan,
    menuType,
    cleanLokasi,
    cleanPetak,
    periode,
    getNextSuggestedPlantNumber,
  ]);

  const canAutoFillNumber = Boolean(
    cleanLokasi && (!isMonitoring || cleanPetak)
  );
  useEffect(() => {
    if (!canAutoFillNumber) {
      if (!manualNomorEdited) {
        setNomorTanamanRaw('');
      }
      return;
    }
    if (!manualNomorEdited) {
      setNomorTanamanRaw(String(suggestedPlantNumber));
    }
  }, [canAutoFillNumber, suggestedPlantNumber, manualNomorEdited]);

  const parsedNomorTanaman = useMemo(
    () => parsePositiveInt(nomorTanamanRaw),
    [nomorTanamanRaw]
  );

  const rangeExceeded = Boolean(
    hasOfficerRange &&
      parsedNomorTanaman &&
      profile?.rangeEnd &&
      (parsedNomorTanaman < (profile.rangeStart || 1) ||
        parsedNomorTanaman > profile.rangeEnd)
  );

  const duplicateCheck = useMemo(() => {
    if (!cleanLokasi || !parsedNomorTanaman) return { isDuplicate: false };
    if (isMonitoring && !cleanPetak) return { isDuplicate: false };
    return checkDuplicatePlantNumber(
      perusahaan,
      menuType,
      cleanLokasi,
      cleanPetak,
      periode,
      parsedNomorTanaman
    );
  }, [
    perusahaan,
    menuType,
    isMonitoring,
    cleanLokasi,
    cleanPetak,
    periode,
    parsedNomorTanaman,
    checkDuplicatePlantNumber,
  ]);

  // Refresh to start with today's active continuation
  const handleRefreshTodayContinuation = () => {
    const today = getTodayDateString();
    const todayMatches = allRecords.filter(
      (r) =>
        r.menuType === menuType &&
        r.companyKey === companyKey &&
        r.tanggalInput === today
    );

    const latestToday =
      todayMatches.find((r) => r.createdByUid === profile?.uid) ||
      todayMatches[0];

    setTinggiRaw('');
    setDiameterRaw('');
    setKondisiTanaman('Sehat');
    setKeterangan('');
    setPlantPhotoUrl(null);
    setPlantPhotoSizeKb(0);
    setFormError(null);
    setManualNomorEdited(false);

    if (latestToday) {
      setLokasi(latestToday.lokasi);
      setNomorPetak(isSensus ? '' : latestToday.nomorPetak);
      const nextNum = getNextSuggestedPlantNumber(
        perusahaan,
        menuType,
        latestToday.lokasi,
        isSensus ? '' : latestToday.nomorPetak,
        extractPeriode(today)
      );
      setNomorTanamanRaw(String(nextNum));
      setSuccessNotice(
        `Tampilan disegarkan · Melanjutkan pekerjaan hari ini di "${latestToday.lokasi}"${
          !isSensus && latestToday.nomorPetak
            ? ` (Petak ${latestToday.nomorPetak})`
            : ''
        } mulai nomor #${nextNum}.`
      );
    } else {
      setLokasi('');
      setNomorPetak('');
      setNomorTanamanRaw('');
      setSuccessNotice(
        'Tampilan disegarkan ke kondisi awal hari ini (belum ada input hari ini untuk menu ini).'
      );
    }
  };

  // GNSS Handlers
  const handleCaptureGnss = async (): Promise<GnssFixResult | null> => {
    setGnssLoading(true);
    setGnssStatusNote(null);
    try {
      const fix = await captureBrowserGnssPoint(10000);
      setGnssFix(fix);
      setGnssStatusNote(fix.accuracyMessage);
      return fix;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal membaca posisi GNSS.';
      setGnssStatusNote(msg);
      return null;
    } finally {
      setGnssLoading(false);
    }
  };

  const handleReadSerialGnss = async () => {
    setGnssLoading(true);
    setGnssStatusNote(null);
    try {
      const fix = await readNmeaFromWebSerial();
      setGnssFix(fix);
      setGnssStatusNote(fix.accuracyMessage);
    } catch (err) {
      setGnssStatusNote(
        err instanceof Error ? err.message : 'Gagal membaca port serial GNSS.'
      );
    } finally {
      setGnssLoading(false);
    }
  };

  const handleParseManualNmea = () => {
    const parsed = parseNmeaGgaSentence(nmeaInputText);
    if (!parsed) {
      setGnssStatusNote(
        'Format kalimat NMEA $GPGGA/$GNGGA tidak dikenali. Pastikan menyalin baris GGA lengkap.'
      );
      return;
    }
    setGnssFix(parsed);
    setGnssStatusNote(parsed.accuracyMessage);
    setNmeaModalOpen(false);
    setNmeaInputText('');
  };

  // Photo upload & compression handlers
  const handlePickPhoto = async (
    file: File | undefined,
    target: 'plant' | 'condition'
  ) => {
    if (!file) return;
    setFormError(null);
    try {
      const { dataUrl, byteSize } = await compressImageToMax150KB(file);
      const kb = Math.round(byteSize / 1024);
      if (target === 'plant') {
        setPlantPhotoUrl(dataUrl);
        setPlantPhotoSizeKb(kb);
      } else {
        setCondPhotoUrl(dataUrl);
        setCondPhotoSizeKb(kb);
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Gagal mengompres foto bukti.'
      );
    }
  };

  const handleGroupSwitch = (group: PlantGroup) => {
    setKelompokTanaman(group);
    const list = getSpeciesForCompanyGroup(perusahaan, group);
    if (list.length > 0) setJenisTanaman(list[0]);
  };

  const handleNomorTanamanChange = (val: string) => {
    const digitsOnly = val.replace(/\D/g, '');
    setManualNomorEdited(true);
    setNomorTanamanRaw(digitsOnly);
  };

  const sanitizeDecimalInput = (val: string): string => {
    const replaced = val.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const parts = replaced.split('.');
    if (parts.length <= 2) return replaced;
    return `${parts[0]}.${parts.slice(1).join('')}`;
  };

  const handleConditionChange = (cond: PlantCondition) => {
    setKondisiTanaman(cond);
    if (cond === 'Mati') {
      setTinggiRaw('');
      setDiameterRaw('');
    }
  };

  const handleSaveFieldConditionOnly = async () => {
    if (!isMonitoring || !cleanLokasi) {
      setFormError(
        'Isi Nama Lokasi terlebih dahulu sebelum menyimpan kondisi lapangan.'
      );
      return;
    }
    if (!namaPetugas.trim()) {
      setFormError('Nama Petugas wajib diisi.');
      return;
    }
    const jml =
      bangunanKonservasi === 'Ada'
        ? parsePositiveInt(jumlahBangunanRaw) || 0
        : 0;
    if (bangunanKonservasi === 'Ada' && jml < 1) {
      setFormError('Masukkan jumlah bangunan konservasi minimal 1 unit.');
      return;
    }
    setFormError(null);
    const res = await saveFieldCondition({
      perusahaan,
      menuType: menuType as 'MONITORING_IPPKH' | 'MONITORING_APL',
      lokasi: cleanLokasi,
      periode,
      coverCrop,
      bangunanKonservasi,
      jumlahBangunan: jml,
      namaPetugas,
      latitude: gnssFix?.latitude ?? null,
      longitude: gnssFix?.longitude ?? null,
      horizontalAccuracyM: gnssFix?.horizontalAccuracyM ?? null,
      verticalAccuracyM: gnssFix?.verticalAccuracyM ?? null,
      photoDataUrl: condPhotoUrl,
    });
    lastConfirmedLokasiRef.current = `${companyKey}__${menuType}__${makeSafeKey(cleanLokasi)}__${periode}`;
    setShowFieldCondForm(false);
    setSuccessNotice(
      res.savedOffline
        ? `Kondisi lapangan "${cleanLokasi}" (${perusahaan}) disimpan ke antrean offline.`
        : `Kondisi lapangan "${cleanLokasi}" (${perusahaan}) tersimpan.`
    );
  };

  const handleSaveCanopyOnly = async () => {
    if (!isAPL || !cleanLokasi || !cleanPetak) {
      setFormError('Isi Lokasi dan Nomor Petak terlebih dahulu.');
      return;
    }
    if (!namaPetugas.trim()) {
      setFormError('Nama Petugas wajib diisi.');
      return;
    }
    setFormError(null);
    const res = await saveCanopyCover({
      perusahaan,
      lokasi: cleanLokasi,
      nomorPetak: cleanPetak,
      periode,
      penutupanTajuk,
      namaPetugas,
    });
    lastConfirmedPetakRef.current = `${companyKey}__${makeSafeKey(cleanLokasi)}__${makeSafeKey(cleanPetak)}__${periode}`;
    setShowCanopyForm(false);
    setSuccessNotice(
      res.savedOffline
        ? `Penutupan tajuk Petak "${cleanPetak}" (${perusahaan}) disimpan ke antrean offline.`
        : `Penutupan tajuk Petak "${cleanPetak}" (${perusahaan}) tersimpan.`
    );
  };

  const finalizePlantSave = async (
    tinggiCm: number,
    diameterMm: number,
    extremeConfirmed: boolean,
    resolvedFix: GnssFixResult | null
  ) => {
    if (!parsedNomorTanaman) return;
    setSaving(true);
    setFormError(null);
    setSuccessNotice(null);

    const exactTanggal = getTodayDateString();
    const exactWaktu = getCurrentTimeString();
    const exactPeriode = extractPeriode(exactTanggal);

    try {
      if (isMonitoring && (showFieldCondForm || !existingFieldCondition)) {
        const jml =
          bangunanKonservasi === 'Ada'
            ? parsePositiveInt(jumlahBangunanRaw) || 0
            : 0;
        if (bangunanKonservasi === 'Ada' && jml < 1) {
          throw new Error(
            'Jumlah bangunan konservasi wajib minimal 1 jika status "Ada".'
          );
        }
        await saveFieldCondition({
          perusahaan,
          menuType: menuType as 'MONITORING_IPPKH' | 'MONITORING_APL',
          lokasi: cleanLokasi,
          periode: exactPeriode,
          coverCrop,
          bangunanKonservasi,
          jumlahBangunan: jml,
          namaPetugas,
          latitude: resolvedFix?.latitude ?? null,
          longitude: resolvedFix?.longitude ?? null,
          horizontalAccuracyM: resolvedFix?.horizontalAccuracyM ?? null,
          verticalAccuracyM: resolvedFix?.verticalAccuracyM ?? null,
          photoDataUrl: condPhotoUrl,
        });
        lastConfirmedLokasiRef.current = `${companyKey}__${menuType}__${makeSafeKey(cleanLokasi)}__${exactPeriode}`;
        setShowFieldCondForm(false);
      }

      if (isAPL && (showCanopyForm || !existingCanopyCover)) {
        await saveCanopyCover({
          perusahaan,
          lokasi: cleanLokasi,
          nomorPetak: cleanPetak,
          periode: exactPeriode,
          penutupanTajuk,
          namaPetugas,
        });
        lastConfirmedPetakRef.current = `${companyKey}__${makeSafeKey(cleanLokasi)}__${makeSafeKey(cleanPetak)}__${exactPeriode}`;
        setShowCanopyForm(false);
      }

      const result = await savePlantRecord({
        perusahaan,
        menuType,
        tanggalInput: exactTanggal,
        waktuInput: exactWaktu,
        lokasi: cleanLokasi,
        namaPetugas,
        nomorPetak: cleanPetak,
        nomorTanaman: parsedNomorTanaman,
        kelompokTanaman,
        jenisTanaman,
        tinggiCm,
        diameterMm,
        kondisiTanaman,
        keterangan,
        extremeConfirmed,
        latitude: resolvedFix?.latitude ?? null,
        longitude: resolvedFix?.longitude ?? null,
        altitudeM: resolvedFix?.altitudeM ?? null,
        horizontalAccuracyM: resolvedFix?.horizontalAccuracyM ?? null,
        verticalAccuracyM: resolvedFix?.verticalAccuracyM ?? null,
        gnssSource: resolvedFix?.gnssSource ?? null,
        coordCrs: crsCode,
        photoDataUrl: plantPhotoUrl,
      });

      const nextAuto = parsedNomorTanaman + 1;
      setManualNomorEdited(false);
      setNomorTanamanRaw(String(nextAuto));
      setTinggiRaw('');
      setDiameterRaw('');
      setKeterangan('');
      setPlantPhotoUrl(null);
      setPlantPhotoSizeKb(0);
      setExtremeConfirmModal(null);
      setGnssOverrideModal(null);

      const coordTag =
        resolvedFix !== null
          ? ` · GNSS (${resolvedFix.latitude.toFixed(5)}, ${resolvedFix.longitude.toFixed(5)})`
          : '';

      setSuccessNotice(
        result.savedOffline
          ? `[${perusahaan}] Tanaman #${parsedNomorTanaman} (${jenisTanaman}) dicatat pukul ${exactWaktu}${coordTag} ke antrean offline.`
          : `[${perusahaan}] Tanaman #${parsedNomorTanaman} (${jenisTanaman}) tersimpan (${exactTanggal} · ${exactWaktu}${coordTag}).`
      );
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Gagal menyimpan data tanaman.'
      );
    } finally {
      setSaving(false);
    }
  };

  const executePlantSubmit = async (
    tinggiCm: number,
    diameterMm: number,
    extremeConfirmed: boolean
  ) => {
    setExtremeConfirmModal(null);
    setSaving(true);
    let currentFix = gnssFix;
    let gnssErr: string | null = null;

    // Automatically read live GNSS point when submitting an entry
    try {
      const fresh = await captureBrowserGnssPoint(8000);
      currentFix = fresh;
      setGnssFix(fresh);
      setGnssStatusNote(fresh.accuracyMessage);
    } catch (err) {
      gnssErr = err instanceof Error ? err.message : 'GNSS tidak terjangkau.';
      if (!currentFix) {
        setGnssStatusNote(gnssErr);
      }
    }

    if (requireStrict3m) {
      if (!currentFix) {
        setSaving(false);
        setGnssOverrideModal({
          tinggiCm,
          diameterMm,
          extremeConfirmed,
          fix: null,
          reason:
            gnssErr ||
            'Titik GNSS belum terkunci. Pastikan GPS/GNSS eksternal aktif atau lanjutkan simpan jika sedang di dalam ruangan.',
        });
        return;
      }
      if (!currentFix.lockedWithin3m) {
        setSaving(false);
        setGnssOverrideModal({
          tinggiCm,
          diameterMm,
          extremeConfirmed,
          fix: currentFix,
          reason: `Akurasi GNSS saat ini (${currentFix.accuracyMessage}) masih melebihi batas kunci <= ${MAX_GNSS_ACCURACY_M} meter.`,
        });
        return;
      }
    }

    await finalizePlantSave(tinggiCm, diameterMm, extremeConfirmed, currentFix);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessNotice(null);

    if (!cleanLokasi) {
      setFormError('Lokasi wajib diisi.');
      return;
    }
    if (!normalizeDisplayText(namaPetugas)) {
      setFormError('Nama Petugas wajib diisi.');
      return;
    }
    if (isMonitoring && !cleanPetak) {
      setFormError('Nomor Petak wajib diisi pada menu Monitoring.');
      return;
    }
    if (!parsedNomorTanaman) {
      setFormError(
        'Nomor Tanaman wajib berupa angka positif (contoh: 1, 2, 15).'
      );
      return;
    }
    if (duplicateCheck.isDuplicate) {
      setFormError(
        duplicateCheck.reason || 'Nomor tanaman sudah terdaftar.'
      );
      return;
    }

    if (isMonitoring && bangunanKonservasi === 'Ada') {
      const jml = parsePositiveInt(jumlahBangunanRaw);
      if (!jml || jml < 1) {
        setFormError('Jumlah bangunan konservasi wajib minimal 1 unit.');
        return;
      }
    }

    if (isMati) {
      await executePlantSubmit(0, 0, false);
      return;
    }

    const tinggiCm = parsePositiveDecimal(tinggiRaw);
    if (
      tinggiCm === null ||
      tinggiCm < DIMENSION_BOUNDS.tinggiCm.hardMin ||
      tinggiCm > DIMENSION_BOUNDS.tinggiCm.hardMax
    ) {
      setFormError(
        `Tinggi (cm) tidak valid. Masukkan angka antara ${DIMENSION_BOUNDS.tinggiCm.hardMin} hingga ${DIMENSION_BOUNDS.tinggiCm.hardMax} cm.`
      );
      return;
    }

    const diameterMm = parsePositiveDecimal(diameterRaw);
    if (
      diameterMm === null ||
      diameterMm < DIMENSION_BOUNDS.diameterMm.hardMin ||
      diameterMm > DIMENSION_BOUNDS.diameterMm.hardMax
    ) {
      setFormError(
        `Diameter (mm) tidak valid. Masukkan angka antara ${DIMENSION_BOUNDS.diameterMm.hardMin} hingga ${DIMENSION_BOUNDS.diameterMm.hardMax} mm.`
      );
      return;
    }

    const warnings: string[] = [];
    if (tinggiCm < DIMENSION_BOUNDS.tinggiCm.reasonableMin) {
      warnings.push(
        `Tinggi ${tinggiCm} cm tergolong sangat pendek (< ${DIMENSION_BOUNDS.tinggiCm.reasonableMin} cm).`
      );
    } else if (tinggiCm > DIMENSION_BOUNDS.tinggiCm.reasonableMax) {
      warnings.push(
        `Tinggi ${tinggiCm} cm (${(tinggiCm / 100).toFixed(1)} meter) tergolong sangat tinggi (> ${DIMENSION_BOUNDS.tinggiCm.reasonableMax} cm). Pastikan tidak kelebihan nol.`
      );
    }

    if (diameterMm < DIMENSION_BOUNDS.diameterMm.reasonableMin) {
      warnings.push(
        `Diameter ${diameterMm} mm sangat kecil (< ${DIMENSION_BOUNDS.diameterMm.reasonableMin} mm).`
      );
    } else if (diameterMm > DIMENSION_BOUNDS.diameterMm.reasonableMax) {
      warnings.push(
        `Diameter ${diameterMm} mm (${(diameterMm / 10).toFixed(1)} cm) tergolong sangat besar (> ${DIMENSION_BOUNDS.diameterMm.reasonableMax} mm). Pastikan tidak salah satuan cm ke mm.`
      );
    }

    if (warnings.length > 0) {
      setExtremeConfirmModal({ tinggiCm, diameterMm, warnings });
      return;
    }

    await executePlantSubmit(tinggiCm, diameterMm, false);
  };

  const recentMenuEntries = useMemo(
    () =>
      allRecords
        .filter(
          (r) => r.menuType === menuType && r.companyKey === companyKey
        )
        .slice(0, 6),
    [allRecords, menuType, companyKey]
  );

  const totalCompanyMenuEntries = useMemo(
    () =>
      allRecords.filter(
        (r) => r.menuType === menuType && r.companyKey === companyKey
      ).length,
    [allRecords, menuType, companyKey]
  );

  return (
    <div className="space-y-6 pb-24 lg:pb-8">
      {/* Page Header + Refresh Hari Ini Button */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <p className="text-xs font-semibold text-[#14532D]">
            {perusahaan} ·{' '}
            {isSensus
              ? 'Aturan Unik: 1 Nomor Sekali Selamanya per Lokasi'
              : `Aturan Unik: 1 Nomor Sekali per Petak per Bulan (${periode})`}
          </p>
          <h1 className="text-2xl font-bold text-[#141A15] font-display tracking-tight mt-0.5">
            {getMenuLabel(menuType)}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefreshTodayContinuation}
            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-[#141A15] hover:bg-[#F6F7F4] flex items-center gap-1.5 transition-colors"
            title="Segarkan ke tampilan awal sambil melanjutkan pekerjaan hari ini"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#14532D]" />
            Refresh Hari Ini
          </button>
          <div className="text-xs text-stone-600 font-mono tabular-nums flex items-center gap-2">
            <span>Tinggi: cm</span>
            <span aria-hidden="true">·</span>
            <span>Diameter: mm</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSubmit}
          className="xl:col-span-8 bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 space-y-6"
        >
          {/* Section 0: Pilih Perusahaan */}
          <div className="space-y-2.5 pb-5 border-b border-stone-200/70">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-stone-800 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#14532D]" />
                Perusahaan Operasional
              </label>
              {isCompanyLocked && (
                <span className="text-[11px] font-medium text-stone-500 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Ditetapkan oleh Administrator
                </span>
              )}
            </div>
            <div
              className={`grid gap-2 ${
                isCompanyLocked ? 'grid-cols-1' : 'grid-cols-3'
              }`}
            >
              {(isCompanyLocked && profile?.assignedCompany && profile.assignedCompany !== 'ALL'
                ? [profile.assignedCompany]
                : COMPANIES
              ).map((comp) => {
                const active = perusahaan === comp;
                return (
                  <button
                    key={comp}
                    type="button"
                    disabled={isCompanyLocked && !active}
                    onClick={() => handleSelectCompany(comp)}
                    className={`min-h-[46px] px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition-all active:scale-[0.98] ${
                      active
                        ? 'bg-[#14532D] text-white border-[#14532D]'
                        : 'bg-white text-stone-800 border-stone-300 hover:bg-[#F6F7F4]'
                    }`}
                  >
                    {comp}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 1: Tanggal & Jam + Nama Petugas + Lokasi */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-stone-800">
                Tanggal & Jam Input (Otomatis Perangkat)
              </label>
              <div className="w-full min-h-[46px] rounded-xl border border-stone-200 bg-[#F6F7F4] px-3.5 flex items-center justify-between gap-2 text-sm font-mono tabular-nums text-[#141A15]">
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#14532D] shrink-0" />
                  <span>{tanggalInput}</span>
                </span>
                <span className="font-semibold text-[#14532D]">
                  {waktuInput}
                </span>
              </div>
              <p className="text-[11px] text-stone-500">
                Mengikuti jam perangkat secara langsung saat data disimpan
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-stone-800">
                Nama Petugas
              </label>
              <input
                type="text"
                value={namaPetugas}
                onChange={(e) => setNamaPetugas(e.target.value)}
                placeholder="Nama lengkap petugas"
                maxLength={100}
                required
                className="w-full min-h-[46px] rounded-xl border border-stone-300 bg-white px-3.5 text-sm text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-800">
                Lokasi / Blok ({perusahaan})
              </label>
              <input
                type="text"
                list="locations-master-list"
                value={lokasi}
                onChange={(e) => setLokasi(e.target.value)}
                placeholder={`Pilih lokasi ${perusahaan} atau ketik lokasi baru (misal: Blok A-1)`}
                maxLength={100}
                required
                className="w-full min-h-[46px] rounded-xl border border-stone-300 bg-white px-3.5 text-sm text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
              />
              <datalist id="locations-master-list">
                {companyLocations.map((loc) => (
                  <option key={loc.id} value={loc.name} />
                ))}
              </datalist>
              {companyLocations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {companyLocations.slice(0, 8).map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => setLokasi(loc.name)}
                      className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        cleanLokasi.toLowerCase() === loc.name.toLowerCase()
                          ? 'bg-[#14532D] text-white border-[#14532D]'
                          : 'bg-[#F6F7F4] text-stone-700 border-stone-200 hover:bg-stone-200/70'
                      }`}
                    >
                      {loc.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Monitoring Field Condition + Photo */}
          {isMonitoring && cleanLokasi && (
            <div className="rounded-xl border border-stone-200 bg-[#F6F7F4] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#141A15]">
                  <MapPin className="w-4 h-4 text-[#14532D] shrink-0" />
                  <span>
                    Kondisi Lapangan ({perusahaan} · {cleanLokasi} · {periode})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFieldCondForm((v) => !v)}
                  className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold text-[#14532D] hover:bg-white flex items-center gap-1 shrink-0"
                >
                  {showFieldCondForm ? (
                    <>
                      Tutup <ChevronUp className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <Edit3 className="w-3.5 h-3.5" /> Ubah
                    </>
                  )}
                </button>
              </div>

              {!showFieldCondForm && existingFieldCondition && (
                <div className="text-xs text-stone-600 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    Cover Crop:{' '}
                    <strong className="text-[#141A15]">
                      {existingFieldCondition.coverCrop}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Bangunan Konservasi Tanah & Air:{' '}
                    <strong className="text-[#141A15]">
                      {existingFieldCondition.bangunanKonservasi === 'Ada'
                        ? `Ada (${existingFieldCondition.jumlahBangunan} unit)`
                        : 'Tidak Ada'}
                    </strong>
                  </span>
                </div>
              )}

              {showFieldCondForm && (
                <div className="space-y-4 pt-2 border-t border-stone-200">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-stone-800">
                      Kerapatan Cover Crop
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {COVER_CROP_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setCoverCrop(opt)}
                          className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-[0.98] ${
                            coverCrop === opt
                              ? 'bg-[#14532D] text-white border-[#14532D]'
                              : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-stone-800">
                        Bangunan Konservasi Tanah & Air
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {CONSERVATION_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setBangunanKonservasi(opt)}
                            className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-[0.98] ${
                              bangunanKonservasi === opt
                                ? 'bg-[#14532D] text-white border-[#14532D]'
                                : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    {bangunanKonservasi === 'Ada' && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-stone-800">
                          Jumlah Bangunan (Unit)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={jumlahBangunanRaw}
                          onChange={(e) =>
                            setJumlahBangunanRaw(
                              e.target.value.replace(/\D/g, '')
                            )
                          }
                          placeholder="Contoh: 3"
                          className="w-full min-h-[44px] rounded-xl border border-stone-300 bg-white px-3.5 text-sm font-mono tabular-nums text-[#141A15] focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
                        />
                      </div>
                    )}
                  </div>

                  {/* Optional Conservation Structure Photo (<= 150 KB) */}
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={condPhotoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) =>
                        void handlePickPhoto(e.target.files?.[0], 'condition')
                      }
                    />
                    <button
                      type="button"
                      onClick={() => condPhotoInputRef.current?.click()}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-50 flex items-center gap-1.5"
                    >
                      <Camera className="w-3.5 h-3.5 text-[#14532D]" />
                      Foto Bangunan Konservasi (Opsional · &lt;= 150 KB)
                    </button>
                    {condPhotoUrl && (
                      <div className="flex items-center gap-2">
                        <img
                          src={condPhotoUrl}
                          alt="Bukti bangunan konservasi"
                          className="w-10 h-10 rounded-lg object-cover border border-stone-300"
                        />
                        <span className="text-[11px] font-mono text-stone-600">
                          {condPhotoSizeKb > 0 ? `${condPhotoSizeKb} KB` : 'Siap'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setCondPhotoUrl(null);
                            setCondPhotoSizeKb(0);
                          }}
                          className="text-red-600 hover:text-red-800"
                          title="Hapus foto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveFieldConditionOnly}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#141A15] text-white text-xs font-semibold hover:bg-stone-800 transition-colors"
                  >
                    Simpan Kondisi Lapangan Lokasi Ini
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Section 3: Nomor Petak (Monitoring Only) + Nomor Tanaman (Otomatis Lanjutan + Range Regu) */}
          <div
            className={`grid grid-cols-1 ${
              isMonitoring ? 'sm:grid-cols-2' : ''
            } gap-4 pt-4 border-t border-stone-200/70`}
          >
            {isMonitoring && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-800">
                  Nomor Petak
                </label>
                <input
                  type="text"
                  list="petaks-master-list"
                  value={nomorPetak}
                  onChange={(e) => setNomorPetak(e.target.value)}
                  placeholder="Contoh: P-01 atau Petak 1"
                  maxLength={50}
                  required
                  className="w-full min-h-[46px] rounded-xl border border-stone-300 bg-white px-3.5 text-sm text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
                />
                <datalist id="petaks-master-list">
                  {knownPetaksInLocation.map((pt) => (
                    <option key={pt} value={pt} />
                  ))}
                </datalist>
                {knownPetaksInLocation.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {knownPetaksInLocation.slice(0, 8).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setNomorPetak(pt)}
                        className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          cleanPetak.toLowerCase() === pt.toLowerCase()
                            ? 'bg-[#14532D] text-white border-[#14532D]'
                            : 'bg-[#F6F7F4] text-stone-700 border-stone-200 hover:bg-stone-200/70'
                        }`}
                      >
                        {pt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-semibold text-stone-800">
                  Nomor Tanaman (Otomatis Lanjutan)
                </label>
                {canAutoFillNumber && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualNomorEdited(false);
                      setNomorTanamanRaw(String(suggestedPlantNumber));
                    }}
                    className="text-xs font-semibold text-[#14532D] hover:underline flex items-center gap-1"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Urut #{suggestedPlantNumber}
                  </button>
                )}
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={nomorTanamanRaw}
                onChange={(e) => handleNomorTanamanChange(e.target.value)}
                placeholder={
                  canAutoFillNumber
                    ? `Otomatis #${suggestedPlantNumber}`
                    : isSensus
                    ? 'Isi Lokasi terlebih dahulu untuk nomor otomatis'
                    : 'Isi Lokasi & Nomor Petak terlebih dahulu'
                }
                required
                className={`w-full min-h-[46px] rounded-xl border px-3.5 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 ${
                  duplicateCheck.isDuplicate
                    ? 'border-red-500 bg-red-50 text-red-900 focus:ring-red-500/30'
                    : 'border-stone-300 bg-white text-[#141A15] focus:ring-[#14532D]/25 focus:border-[#14532D]'
                }`}
              />
              {hasOfficerRange && (
                <p
                  className={`text-[11px] flex items-center gap-1 font-mono ${
                    rangeExceeded ? 'text-amber-800 font-semibold' : 'text-[#14532D]'
                  }`}
                >
                  <Hash className="w-3 h-3" />
                  Jatah Regu Anda: #{profile?.rangeStart}–#{profile?.rangeEnd}
                  {rangeExceeded && ' (Nomor di luar rentang regu)'}
                </p>
              )}
              {duplicateCheck.isDuplicate ? (
                <p className="text-xs font-medium text-red-700 flex items-start gap-1.5 pt-0.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{duplicateCheck.reason}</span>
                </p>
              ) : (
                canAutoFillNumber && (
                  <p className="text-[11px] text-stone-500">
                    Terisi otomatis mengikuti nomor lanjutan terakhir (dapat diubah jika perlu).
                  </p>
                )
              )}
            </div>
          </div>

          {/* APL Canopy Closure Panel */}
          {isAPL && cleanLokasi && cleanPetak && (
            <div className="rounded-xl border border-stone-200 bg-[#F6F7F4] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#141A15]">
                  <Layers className="w-4 h-4 text-[#14532D] shrink-0" />
                  <span>
                    Kriteria Penutupan Tajuk ({perusahaan} · Petak {cleanPetak})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCanopyForm((v) => !v)}
                  className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold text-[#14532D] hover:bg-white flex items-center gap-1 shrink-0"
                >
                  {showCanopyForm ? (
                    <>
                      Tutup <ChevronUp className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <Edit3 className="w-3.5 h-3.5" /> Ubah
                    </>
                  )}
                </button>
              </div>

              {!showCanopyForm && existingCanopyCover && (
                <div className="text-xs text-stone-600">
                  Status Penutupan Tajuk Petak {cleanPetak}:{' '}
                  <strong className="text-[#141A15]">
                    {existingCanopyCover.penutupanTajuk}
                  </strong>
                </div>
              )}

              {showCanopyForm && (
                <div className="space-y-3 pt-2 border-t border-stone-200">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {CANOPY_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setPenutupanTajuk(opt)}
                        className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-[0.98] ${
                          penutupanTajuk === opt
                            ? 'bg-[#14532D] text-white border-[#14532D]'
                            : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveCanopyOnly}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-[#141A15] text-white text-xs font-semibold hover:bg-stone-800 transition-colors"
                  >
                    Simpan Penutupan Tajuk Petak Ini
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Section 4: Kelompok & Jenis Tanaman (Master Data Driven) */}
          <div className="space-y-3 pt-4 border-t border-stone-200/70">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-stone-800">
                Kelompok & Jenis Tanaman ({perusahaan})
              </label>
              <div className="inline-flex p-1 bg-[#F6F7F4] border border-stone-200 rounded-xl self-start">
                <button
                  type="button"
                  onClick={() => handleGroupSwitch('FGS')}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    kelompokTanaman === 'FGS'
                      ? 'bg-[#14532D] text-white'
                      : 'text-stone-700 hover:text-[#141A15]'
                  }`}
                >
                  1. Fast Growing (FGS)
                </button>
                <button
                  type="button"
                  onClick={() => handleGroupSwitch('LOKAL_MPTS')}
                  className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    kelompokTanaman === 'LOKAL_MPTS'
                      ? 'bg-[#14532D] text-white'
                      : 'text-stone-700 hover:text-[#141A15]'
                  }`}
                >
                  2. Lokal / MPTS
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {activeSpeciesList.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setJenisTanaman(sp)}
                  className={`min-h-[46px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center active:scale-[0.98] ${
                    jenisTanaman === sp
                      ? 'bg-[#14532D] text-white border-[#14532D]'
                      : 'bg-white text-stone-800 border-stone-200 hover:bg-[#F6F7F4]'
                  }`}
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>

          {/* Section 5: Kondisi Tanaman */}
          <div className="space-y-2.5 pt-4 border-t border-stone-200/70">
            <label className="block text-xs font-semibold text-stone-800">
              Kondisi Tanaman
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PLANT_CONDITIONS.map((cond) => {
                const active = kondisiTanaman === cond;
                let activeClass = 'bg-[#14532D] text-white border-[#14532D]';
                if (cond === 'Kurang Sehat') {
                  activeClass = 'bg-amber-600 text-white border-amber-600';
                } else if (cond === 'Merana') {
                  activeClass = 'bg-orange-600 text-white border-orange-600';
                } else if (cond === 'Mati') {
                  activeClass = 'bg-red-700 text-white border-red-700';
                }
                return (
                  <button
                    key={cond}
                    type="button"
                    onClick={() => handleConditionChange(cond)}
                    className={`min-h-[48px] px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all active:scale-[0.98] ${
                      active
                        ? activeClass
                        : 'bg-white text-stone-800 border-stone-300 hover:bg-[#F6F7F4]'
                    }`}
                  >
                    {cond}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 6: Tinggi (cm) & Diameter (mm) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-stone-200/70">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-stone-800">
                Tinggi Tanaman{' '}
                <span className="font-mono text-[#14532D]">(cm)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={isMati}
                  value={isMati ? '' : tinggiRaw}
                  onChange={(e) =>
                    setTinggiRaw(sanitizeDecimalInput(e.target.value))
                  }
                  placeholder={
                    isMati ? 'Dinonaktifkan (Tanaman Mati)' : 'Contoh: 145'
                  }
                  required={!isMati}
                  className="w-full min-h-[48px] rounded-xl border border-stone-300 bg-white pl-3.5 pr-12 text-base font-mono tabular-nums text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D] disabled:bg-[#F6F7F4] disabled:text-stone-400 disabled:cursor-not-allowed"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-stone-500">
                  cm
                </span>
              </div>
              <p className="text-[11px] text-stone-500">
                {isMati
                  ? 'Tanaman Mati: pengisian tinggi dinonaktifkan otomatis.'
                  : `Batas wajar: ${DIMENSION_BOUNDS.tinggiCm.reasonableMin}–${DIMENSION_BOUNDS.tinggiCm.reasonableMax} cm`}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-stone-800">
                Diameter Batang{' '}
                <span className="font-mono text-[#14532D]">(mm)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={isMati}
                  value={isMati ? '' : diameterRaw}
                  onChange={(e) =>
                    setDiameterRaw(sanitizeDecimalInput(e.target.value))
                  }
                  placeholder={
                    isMati ? 'Dinonaktifkan (Tanaman Mati)' : 'Contoh: 24.5'
                  }
                  required={!isMati}
                  className="w-full min-h-[48px] rounded-xl border border-stone-300 bg-white pl-3.5 pr-12 text-base font-mono tabular-nums text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D] disabled:bg-[#F6F7F4] disabled:text-stone-400 disabled:cursor-not-allowed"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-stone-500">
                  mm
                </span>
              </div>
              <p className="text-[11px] text-stone-500">
                {isMati
                  ? 'Tanaman Mati: pengisian diameter dinonaktifkan otomatis.'
                  : `Batas wajar: ${DIMENSION_BOUNDS.diameterMm.reasonableMin}–${DIMENSION_BOUNDS.diameterMm.reasonableMax} mm`}
              </p>
            </div>
          </div>

          {/* Section 7: GNSS Otomatis (Trimble / Emlid <= 3m) & Foto Bukti Ringan (<= 150 KB) */}
          <div className="rounded-xl border border-stone-200 bg-[#F6F7F4] p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#141A15]">
                <Compass className="w-4 h-4 text-[#14532D]" />
                <span>
                  Titik Koordinat GNSS Otomatis (Kunci Akurasi &lt;= {MAX_GNSS_ACCURACY_M} m)
                </span>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] font-medium text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireStrict3m}
                  onChange={(e) => setRequireStrict3m(e.target.checked)}
                  className="rounded border-stone-300 text-[#14532D]"
                />
                Kunci wajib H &amp; V &lt;= 3m
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={crsCode}
                onChange={(e) => setCrsCode(e.target.value as CoordCrsCode)}
                className="min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-[#141A15]"
                aria-label="Sistem Referensi Koordinat"
              >
                {CRS_OPTION_GROUPS.map((grp) => (
                  <optgroup key={grp.label} label={grp.label}>
                    {grp.options.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select
                value={coordFormat}
                onChange={(e) =>
                  setCoordFormat(e.target.value as CoordFormatType)
                }
                className="min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-[#141A15]"
                aria-label="Format Koordinat"
              >
                {COORD_FORMAT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCaptureGnss()}
                disabled={gnssLoading}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] disabled:opacity-60 flex items-center gap-1.5"
              >
                <Compass className="w-3.5 h-3.5" />
                {gnssLoading ? 'Mengunci GNSS...' : 'Ambil Titik GNSS Sekarang'}
              </button>

              <button
                type="button"
                onClick={() => void handleReadSerialGnss()}
                disabled={gnssLoading}
                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-50 flex items-center gap-1.5"
              >
                <Usb className="w-3.5 h-3.5 text-[#14532D]" />
                Trimble / Emlid (Serial)
              </button>

              <button
                type="button"
                onClick={() => setNmeaModalOpen(true)}
                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-50"
              >
                Tempel NMEA GGA
              </button>
            </div>

            {gnssFix && (
              <div className="rounded-lg bg-white border border-stone-200 px-3 py-2 text-xs space-y-1">
                <div className="font-mono tabular-nums font-semibold text-[#141A15]">
                  {formatCoordinatePair(
                    gnssFix.longitude,
                    gnssFix.latitude,
                    crsCode,
                    coordFormat
                  )}
                </div>
                <div
                  className={`text-[11px] font-medium ${
                    gnssFix.lockedWithin3m ? 'text-[#14532D]' : 'text-amber-700'
                  }`}
                >
                  {gnssFix.gnssSource} · {gnssFix.accuracyMessage}
                  {gnssFix.altitudeM !== null
                    ? ` · Elevasi ${gnssFix.altitudeM} m`
                    : ''}
                </div>
              </div>
            )}

            {!gnssFix && gnssStatusNote && (
              <p className="text-[11px] text-amber-800">{gnssStatusNote}</p>
            )}
          </div>

          {/* Section 8: Foto Bukti Tanaman (Opsional <= 150 KB) & Keterangan */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-stone-800">
                Foto Bukti Kondisi Tanaman{' '}
                <span className="font-normal text-stone-500">
                  (Opsional untuk kondisi tertentu seperti Merana/Mati · maks 150 KB)
                </span>
              </label>
              <input
                ref={plantPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) =>
                  void handlePickPhoto(e.target.files?.[0], 'plant')
                }
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => plantPhotoInputRef.current?.click()}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-[#F6F7F4] flex items-center gap-2"
                >
                  <Camera className="w-4 h-4 text-[#14532D]" />
                  {plantPhotoUrl ? 'Ganti Foto Bukti' : 'Ambil / Pilih Foto'}
                </button>
                {plantPhotoUrl && (
                  <div className="flex items-center gap-2.5 bg-[#F6F7F4] border border-stone-200 rounded-xl px-2.5 py-1.5">
                    <img
                      src={plantPhotoUrl}
                      alt="Pratinjau foto tanaman"
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <span className="text-xs font-mono tabular-nums text-[#14532D] font-semibold">
                      {plantPhotoSizeKb} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPlantPhotoUrl(null);
                        setPlantPhotoSizeKb(0);
                      }}
                      className="text-red-600 hover:text-red-800 p-1"
                      title="Hapus foto"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-stone-800">
                Keterangan{' '}
                <span className="font-normal text-stone-500">(Opsional)</span>
              </label>
              <textarea
                rows={2}
                maxLength={500}
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Catatan tambahan lapangan, serangan hama, sulaman, dll."
                className="w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-[#141A15] placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#14532D]/25 focus:border-[#14532D]"
              />
            </div>
          </div>

          {formError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-start gap-2.5 text-sm text-red-900">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
              <span>{formError}</span>
            </div>
          )}

          {successNotice && (
            <div className="rounded-xl bg-[#F2F7F3] border border-[#14532D]/25 p-3.5 flex items-start gap-2.5 text-sm text-[#14532D]">
              {isOnline ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-[#14532D]" />
              ) : (
                <CloudOff className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
              )}
              <span>{successNotice}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving || duplicateCheck.isDuplicate}
            className="w-full min-h-[52px] flex items-center justify-center gap-2 rounded-xl bg-[#14532D] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#0F3F22] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.99]"
          >
            <Save className="w-4 h-4" />
            {saving
              ? 'Mengunci GNSS & Menyimpan...'
              : isOnline
              ? `Simpan ${getMenuLabel(menuType)} · ${perusahaan}`
              : `Simpan Offline · ${perusahaan}`}
          </button>
        </form>

        {/* Side Column: Recent Entries */}
        <div className="xl:col-span-4 bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
            <h2 className="text-sm font-bold text-[#141A15] font-display">
              Input Terbaru · {perusahaan}
            </h2>
            <span className="text-xs font-mono tabular-nums text-stone-500">
              {totalCompanyMenuEntries} total
            </span>
          </div>

          {recentMenuEntries.length === 0 ? (
            <p className="text-xs text-stone-500 py-8 text-center">
              Belum ada data {getMenuLabel(menuType)} untuk {perusahaan}.
            </p>
          ) : (
            <div className="divide-y divide-stone-100">
              {recentMenuEntries.map((item) => (
                <div key={item.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#141A15] font-mono tabular-nums">
                      #{item.nomorTanaman} · {item.jenisTanaman}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        item.kondisiTanaman === 'Sehat'
                          ? 'text-[#14532D]'
                          : item.kondisiTanaman === 'Kurang Sehat'
                          ? 'text-amber-700'
                          : item.kondisiTanaman === 'Merana'
                          ? 'text-orange-700'
                          : 'text-red-700'
                      }`}
                    >
                      {item.kondisiTanaman}
                    </span>
                  </div>
                  <div className="text-xs text-stone-500 flex flex-wrap items-center gap-x-2">
                    <span>{item.lokasi}</span>
                    {item.menuType !== 'SENSUS' && item.nomorPetak && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Petak {item.nomorPetak}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {item.kondisiTanaman === 'Mati'
                        ? 'T/D: -'
                        : `T: ${item.tinggiCm} cm / D: ${item.diameterMm} mm`}
                    </span>
                    {item.latitude !== null &&
                      item.latitude !== undefined &&
                      item.longitude !== null &&
                      item.longitude !== undefined && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-[#14532D]">
                            GPS
                          </span>
                        </>
                      )}
                  </div>
                  {item.syncStatus !== 'synced' && (
                    <div className="text-[11px] font-medium text-amber-800">
                      {item.syncStatus === 'conflict'
                        ? 'Konflik Nomor Ganda — Periksa di Data'
                        : 'Tersimpan Offline — Menunggu Sinyal'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Extreme Value Confirmation Modal */}
      {extremeConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#141A15] font-display">
                  Konfirmasi Nilai Ekstrem (Cegah Typo)
                </h3>
                <p className="text-xs text-stone-600">
                  Sistem mendeteksi ukuran yang tidak lazim. Mohon periksa
                  kembali agar tidak terjadi salah ketik satuan atau nol:
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 space-y-1.5 text-xs text-amber-950">
              {extremeConfirmModal.warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
              <div className="pt-2 mt-2 border-t border-amber-200/70 font-mono tabular-nums font-semibold flex justify-between">
                <span>Tinggi: {extremeConfirmModal.tinggiCm} cm</span>
                <span>Diameter: {extremeConfirmModal.diameterMm} mm</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => setExtremeConfirmModal(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-[#F6F7F4]"
              >
                Perbaiki Angka
              </button>
              <button
                type="button"
                onClick={() =>
                  executePlantSubmit(
                    extremeConfirmModal.tinggiCm,
                    extremeConfirmModal.diameterMm,
                    true
                  )
                }
                className="flex-1 min-h-[44px] rounded-xl bg-amber-600 text-sm font-semibold text-white hover:bg-amber-700"
              >
                Ya, Angka Sudah Benar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GNSS 3m Lock Warning Modal */}
      {gnssOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <Compass className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#141A15] font-display">
                  Kunci Akurasi GNSS &lt;= {MAX_GNSS_ACCURACY_M} Meter
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {gnssOverrideModal.reason}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setGnssOverrideModal(null);
                  void handleCaptureGnss();
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-[#14532D] text-xs font-semibold text-white hover:bg-[#0F3F22]"
              >
                Coba Kunci Ulang GNSS
              </button>
              <button
                type="button"
                onClick={() =>
                  void finalizePlantSave(
                    gnssOverrideModal.tinggiCm,
                    gnssOverrideModal.diameterMm,
                    gnssOverrideModal.extremeConfirmed,
                    gnssOverrideModal.fix
                  )
                }
                className="flex-1 min-h-[44px] rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-700 hover:bg-[#F6F7F4]"
              >
                Simpan Tetap
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NMEA GGA Paste Helper Modal */}
      {nmeaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-[#141A15] font-display">
              Tempel Kalimat NMEA GGA (Trimble / Emlid)
            </h3>
            <p className="text-xs text-stone-600">
              Tempel output baris <code>$GPGGA</code> atau <code>$GNGGA</code>{' '}
              dari aplikasi receiver GNSS Anda.
            </p>
            <textarea
              rows={3}
              value={nmeaInputText}
              onChange={(e) => setNmeaInputText(e.target.value)}
              placeholder="$GNGGA,092725.00,0114.12345,S,11632.56789,E,4,18,0.6,45.2,M,12.1,M,,*5C"
              className="w-full rounded-xl border border-stone-300 p-3 text-xs font-mono"
            />
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setNmeaModalOpen(false)}
                className="flex-1 min-h-[42px] rounded-xl border border-stone-300 text-xs font-semibold text-stone-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleParseManualNmea}
                className="flex-1 min-h-[42px] rounded-xl bg-[#14532D] text-xs font-semibold text-white"
              >
                Terapkan Koordinat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
