import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { checkServerReachable } from '../lib/apiClient';
import { auth, firestore } from '../lib/firebase';
import {
  formatFirestoreErrorForUser,
  handleFirestoreError,
  isFirestorePermissionError,
  OperationType,
} from '../lib/firestoreErrors';
import {
  autoWriteDailyBackupToHandle,
  buildTodayBackupPayload,
  exportTodayBackupFile,
} from '../lib/deviceBackup';
import { syncCompanyDataToSpreadsheet } from '../lib/googleSheetsSync';
import {
  EMPTY_QUEUE,
  exportOfflineQueueBackup,
  loadOfflineQueue,
  loadServerSnapshot,
  type OfflineQueueState,
  saveOfflineQueue,
  saveServerSnapshot,
} from '../lib/offlineQueue';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  type AssignedCompany,
  type BaseMapFileType,
  type BaseMapLayer,
  buildCanopyCoverId,
  buildFieldConditionId,
  buildLocationDocId,
  buildPetakDocId,
  buildPlantRecordId,
  buildSpeciesDocId,
  type CanopyClosure,
  type CanopyCover,
  COMPANIES,
  type CompanyName,
  type CompanySpreadsheet,
  type ConservationStructureStatus,
  type CoordCrsCode,
  type CoverCropDensity,
  DEFAULT_GNSS_ACCURACY_SETTINGS,
  DEFAULT_GROWTH_EVAL_SETTINGS,
  extractPeriode,
  FGS_SPECIES,
  type FieldCondition,
  getCompanyKey,
  type GnssAccuracySettings,
  type GnssModeKey,
  type GrowthEvalSettings,
  type LocationMaster,
  LOKAL_MPTS_SPECIES,
  makeSafeKey,
  MAX_GNSS_ACCURACY_M,
  type MenuType,
  normalizeDisplayText,
  type PetakMaster,
  type PlantCondition,
  type PlantGroup,
  type PlantRecord,
  resolveCompanyName,
  type SpeciesMaster,
  type StaffMember,
  type UserRole,
} from '../types/plant';
import { useAuth } from './AuthContext';

const MAX_AUTO_RETRIES = 3;
const BASE_MAP_CHUNK_SIZE = 450000;
const OFFICER_REFRESH_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export interface CreatePlantInput {
  perusahaan: CompanyName;
  menuType: MenuType;
  tanggalInput: string;
  waktuInput: string;
  lokasi: string;
  namaPetugas: string;
  nomorPetak: string;
  nomorTanaman: number;
  kelompokTanaman: PlantGroup;
  jenisTanaman: string;
  tinggiCm: number;
  diameterMm: number;
  kondisiTanaman: PlantCondition;
  keterangan: string;
  extremeConfirmed: boolean;
  latitude?: number | null;
  longitude?: number | null;
  altitudeM?: number | null;
  horizontalAccuracyM?: number | null;
  verticalAccuracyM?: number | null;
  gnssSource?: string | null;
  gnssOverrideReason?: string | null;
  coordCrs?: string | null;
  photoDataUrl?: string | null;
}

export interface UpsertFieldConditionInput {
  perusahaan: CompanyName;
  menuType: 'MONITORING_IPPKH' | 'MONITORING_APL';
  lokasi: string;
  periode: string;
  coverCrop: CoverCropDensity;
  bangunanKonservasi: ConservationStructureStatus;
  jumlahBangunan: number;
  namaPetugas: string;
  latitude?: number | null;
  longitude?: number | null;
  horizontalAccuracyM?: number | null;
  verticalAccuracyM?: number | null;
  photoDataUrl?: string | null;
}

export interface UpsertCanopyInput {
  perusahaan: CompanyName;
  lokasi: string;
  nomorPetak: string;
  periode: string;
  penutupanTajuk: CanopyClosure;
  namaPetugas: string;
}

interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingRecord?: PlantRecord;
  reason?: string;
}

export interface PaginatedRecordsParams {
  page: number;
  limit: number;
  company: 'ALL' | CompanyName;
  menuType: 'ALL' | MenuType;
  lokasiKey: string;
  periode: string;
  kondisi: 'ALL' | PlantCondition;
  search: string;
}

export interface PaginatedRecordsResult {
  records: PlantRecord[];
  total: number;
  page: number;
  limit: number;
  periodes: string[];
}

interface DataContextValue {
  isOnline: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  clearSyncError: () => void;
  allRecords: PlantRecord[];
  fieldConditions: FieldCondition[];
  canopyCovers: CanopyCover[];
  locations: LocationMaster[];
  masterLocations: LocationMaster[];
  petaks: PetakMaster[];
  species: SpeciesMaster[];
  companySpreadsheets: CompanySpreadsheet[];
  baseMaps: BaseMapLayer[];
  evalSettings: GrowthEvalSettings[];
  gnssSettings: GnssAccuracySettings[];
  staffList: StaffMember[];
  pendingCount: number;
  otherCompanyPendingCount: number;
  conflictCount: number;
  getSpeciesForCompanyGroup: (
    perusahaan: CompanyName,
    kelompok: PlantGroup
  ) => string[];
  checkDuplicatePlantNumber: (
    perusahaan: CompanyName,
    menuType: MenuType,
    lokasi: string,
    nomorPetak: string,
    periode: string,
    nomorTanaman: number
  ) => DuplicateCheckResult;
  getNextSuggestedPlantNumber: (
    perusahaan: CompanyName,
    menuType: MenuType,
    lokasi: string,
    nomorPetak: string,
    periode: string
  ) => number;
  getFieldConditionFor: (
    perusahaan: CompanyName,
    menuType: 'MONITORING_IPPKH' | 'MONITORING_APL',
    lokasi: string,
    periode: string
  ) => FieldCondition | undefined;
  getCanopyCoverFor: (
    perusahaan: CompanyName,
    lokasi: string,
    nomorPetak: string,
    periode: string
  ) => CanopyCover | undefined;
  savePlantRecord: (
    input: CreatePlantInput
  ) => Promise<{ savedOffline: boolean; record: PlantRecord }>;
  saveFieldCondition: (
    input: UpsertFieldConditionInput
  ) => Promise<{ savedOffline: boolean }>;
  saveCanopyCover: (
    input: UpsertCanopyInput
  ) => Promise<{ savedOffline: boolean }>;
  syncPendingQueue: (manual?: boolean) => Promise<{
    synced: number;
    conflicts: number;
    error?: string;
  }>;
  refreshData: (force?: boolean) => Promise<void>;
  fetchPaginatedRecords: (
    params: PaginatedRecordsParams
  ) => Promise<PaginatedRecordsResult>;
  exportOfflineBackup: () => void;
  exportTodayBackup: () => Promise<{
    savedVia: 'directory' | 'download';
    fileName: string;
  }>;
  resolveConflictChangeNumber: (oldId: string, newNomor: number) => void;
  discardPendingRecord: (recordId: string) => void;
  adminUpdateRecord: (
    recordId: string,
    updates: Partial<
      Pick<
        PlantRecord,
        | 'perusahaan'
        | 'tanggalInput'
        | 'lokasi'
        | 'namaPetugas'
        | 'nomorPetak'
        | 'nomorTanaman'
        | 'kelompokTanaman'
        | 'jenisTanaman'
        | 'tinggiCm'
        | 'diameterMm'
        | 'kondisiTanaman'
        | 'keterangan'
        | 'extremeConfirmed'
      >
    >
  ) => Promise<void>;
  adminDeleteRecord: (recordId: string) => Promise<void>;
  adminAddStaff: (
    email: string,
    name: string,
    role: UserRole,
    assignedCompany: AssignedCompany,
    rangeStart?: number | null,
    rangeEnd?: number | null
  ) => Promise<void>;
  adminUpdateStaff: (
    staffId: string,
    updates: {
      name: string;
      role: UserRole;
      assignedCompany: AssignedCompany;
      rangeStart?: number | null;
      rangeEnd?: number | null;
      active: boolean;
    }
  ) => Promise<void>;
  adminDeleteStaff: (staffId: string) => Promise<void>;
  adminResetAllStaff: () => Promise<void>;
  adminAddLocation: (perusahaan: CompanyName, name: string) => Promise<void>;
  adminDeleteLocation: (id: string) => Promise<void>;
  adminAddPetak: (
    perusahaan: CompanyName,
    lokasi: string,
    name: string
  ) => Promise<void>;
  adminDeletePetak: (id: string) => Promise<void>;
  adminAddSpecies: (
    perusahaan: CompanyName,
    kelompokTanaman: PlantGroup,
    name: string
  ) => Promise<void>;
  adminToggleSpecies: (id: string, active: boolean) => Promise<void>;
  adminDeleteSpecies: (id: string) => Promise<void>;
  saveCompanySpreadsheet: (params: {
    perusahaan: CompanyName;
    spreadsheetId: string;
    spreadsheetUrl: string;
    ownerEmail: string;
    syncedRecordCount?: number;
  }) => Promise<CompanySpreadsheet>;
  syncCompanyToGoogleSheets: (
    perusahaan: CompanyName,
    accessToken: string
  ) => Promise<{ syncedCount: number }>;
  adminUploadBaseMap: (params: {
    perusahaan: CompanyName;
    name: string;
    fileType: BaseMapFileType;
    crsCode: CoordCrsCode;
    fileDataBase64?: string | null;
    geoJsonText?: string | null;
    bboxJson?: string | null;
    labelEnabled?: boolean;
    labelAttributes?: string[];
    availableAttributes?: string[];
  }) => Promise<BaseMapLayer>;
  adminUpdateBaseMapLabels: (
    id: string,
    labelEnabled: boolean,
    labelAttributes: string[]
  ) => Promise<void>;
  adminDeleteBaseMap: (id: string) => Promise<void>;
  fetchBaseMapDetail: (id: string) => Promise<BaseMapLayer>;
  getEvalSettingFor: (company: 'ALL' | CompanyName) => GrowthEvalSettings;
  adminSaveEvalSetting: (params: {
    companyKey: string;
    enabled: boolean;
    minSurvivalPct: number;
    minDeltaHeightCm: number;
  }) => Promise<GrowthEvalSettings>;
  getGnssSettingFor: (company: 'ALL' | CompanyName) => GnssAccuracySettings;
  adminSaveGnssSetting: (params: {
    companyKey: string;
    enforced: boolean;
    defaultMaxAccuracyM: number;
    modeThresholds: Record<GnssModeKey, number>;
  }) => Promise<GnssAccuracySettings>;
}

const DataContext = createContext<DataContextValue | null>(null);

function serializeTimestamp(val: unknown): string | undefined {
  if (!val) return undefined;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return undefined;
}

function isLikelyOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('timeout')
  );
}

function sliceString(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

function sanitizeOptNum(
  val: number | null | undefined,
  min: number,
  max: number
): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  if (val < min || val > max) return null;
  return val;
}

function sanitizeWaktuInput(val: string | null | undefined): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (/^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function sanitizePhotoUrl(val: string | null | undefined): string | null {
  if (!val || typeof val !== 'string') return null;
  return val.length <= 350000 ? val : null;
}

function clampFiniteMetric(
  val: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  if (val < min) return min;
  if (val > max) return max;
  return Math.round(val * 100) / 100;
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { profile, authStatus, syncProfileSilently } = useAuth();
  const isOnline = useOnlineStatus();

  const [serverRecords, setServerRecords] = useState<PlantRecord[]>([]);
  const [serverFieldConditions, setServerFieldConditions] = useState<
    FieldCondition[]
  >([]);
  const [serverCanopyCovers, setServerCanopyCovers] = useState<CanopyCover[]>(
    []
  );
  const [serverLocations, setServerLocations] = useState<LocationMaster[]>([]);
  const [petaks, setPetaks] = useState<PetakMaster[]>([]);
  const [species, setSpecies] = useState<SpeciesMaster[]>([]);
  const [companySpreadsheets, setCompanySpreadsheets] = useState<
    CompanySpreadsheet[]
  >([]);
  const [baseMaps, setBaseMaps] = useState<BaseMapLayer[]>([]);
  const [evalSettings, setEvalSettings] = useState<GrowthEvalSettings[]>([]);
  const [gnssSettings, setGnssSettings] = useState<GnssAccuracySettings[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  const [offlineQueue, setOfflineQueue] =
    useState<OfflineQueueState>(EMPTY_QUEUE);
  const [queueHydrated, setQueueHydrated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const syncLockRef = useRef(false);
  const queueRef = useRef<OfflineQueueState>(EMPTY_QUEUE);
  const autoRetryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const snapshotMetaRef = useRef<{ ownerUid: string; cachedAt: string }>({
    ownerUid: '',
    cachedAt: '',
  });
  const snapshotDataRef = useRef({
    records: [] as PlantRecord[],
    fieldConditions: [] as FieldCondition[],
    canopyCovers: [] as CanopyCover[],
    locations: [] as LocationMaster[],
    petaks: [] as PetakMaster[],
    species: [] as SpeciesMaster[],
    companySpreadsheets: [] as CompanySpreadsheet[],
    baseMaps: [] as BaseMapLayer[],
    evalSettings: [] as GrowthEvalSettings[],
    gnssSettings: [] as GnssAccuracySettings[],
    staffList: [] as StaffMember[],
  });

  useEffect(() => {
    queueRef.current = offlineQueue;
  }, [offlineQueue]);

  useEffect(() => {
    snapshotDataRef.current = {
      records: serverRecords,
      fieldConditions: serverFieldConditions,
      canopyCovers: serverCanopyCovers,
      locations: serverLocations,
      petaks,
      species,
      companySpreadsheets,
      baseMaps,
      evalSettings,
      gnssSettings,
      staffList,
    };
  }, [
    serverRecords,
    serverFieldConditions,
    serverCanopyCovers,
    serverLocations,
    petaks,
    species,
    companySpreadsheets,
    baseMaps,
    evalSettings,
    gnssSettings,
    staffList,
  ]);

  const lastCompanyRef = useRef<string>('');

  const persistSnapshotPatch = useCallback(
    (
      patch: Partial<{
        records: PlantRecord[];
        fieldConditions: FieldCondition[];
        canopyCovers: CanopyCover[];
        locations: LocationMaster[];
        petaks: PetakMaster[];
        species: SpeciesMaster[];
        baseMaps: BaseMapLayer[];
        evalSettings: GrowthEvalSettings[];
        gnssSettings: GnssAccuracySettings[];
      }>
    ) => {
      if (!profile?.uid) return;
      const cachedAt =
        snapshotMetaRef.current.ownerUid === profile.uid &&
        snapshotMetaRef.current.cachedAt
          ? snapshotMetaRef.current.cachedAt
          : new Date().toISOString();
      snapshotMetaRef.current = { ownerUid: profile.uid, cachedAt };
      const merged = {
        ...snapshotDataRef.current,
        ...patch,
        cachedAt,
        ownerUid: profile.uid,
      };
      snapshotDataRef.current = {
        records: merged.records,
        fieldConditions: merged.fieldConditions,
        canopyCovers: merged.canopyCovers,
        locations: merged.locations,
        petaks: merged.petaks,
        species: merged.species,
        companySpreadsheets: merged.companySpreadsheets,
        baseMaps: merged.baseMaps,
        evalSettings: merged.evalSettings,
        gnssSettings: merged.gnssSettings,
        staffList: merged.staffList,
      };
      void saveServerSnapshot(merged);
    },
    [profile?.uid]
  );

  const mutateQueue = useCallback(
    (updater: (prev: OfflineQueueState) => OfflineQueueState) => {
      const next = updater(queueRef.current);
      queueRef.current = next;
      setOfflineQueue(next);
      void saveOfflineQueue(next).catch((err) => {
        setLastSyncError(
          err instanceof Error
            ? err.message
            : 'Gagal menyimpan antrean offline ke perangkat.'
        );
      });
    },
    []
  );

  // Hydrate IndexedDB queue and cached snapshot immediately on mount
  useEffect(() => {
    let active = true;
    (async () => {
      const [loadedQueue, snapshot] = await Promise.all([
        loadOfflineQueue(),
        loadServerSnapshot(),
      ]);
      if (!active) return;
      queueRef.current = loadedQueue;
      snapshotMetaRef.current = {
        ownerUid: snapshot.ownerUid || '',
        cachedAt: snapshot.cachedAt || '',
      };
      snapshotDataRef.current = {
        records: snapshot.records,
        fieldConditions: snapshot.fieldConditions,
        canopyCovers: snapshot.canopyCovers,
        locations: snapshot.locations,
        petaks: snapshot.petaks,
        species: snapshot.species,
        companySpreadsheets: snapshot.companySpreadsheets,
        baseMaps: snapshot.baseMaps,
        evalSettings: snapshot.evalSettings,
        gnssSettings: snapshot.gnssSettings,
        staffList: snapshot.staffList,
      };
      if (snapshot.cachedAt) {
        const parsedCachedAt = new Date(snapshot.cachedAt);
        if (!Number.isNaN(parsedCachedAt.getTime())) {
          setLastSyncAt(parsedCachedAt);
        }
      }
      setOfflineQueue(loadedQueue);
      setServerRecords(snapshot.records);
      setServerFieldConditions(snapshot.fieldConditions);
      setServerCanopyCovers(snapshot.canopyCovers);
      setServerLocations(snapshot.locations);
      setPetaks(snapshot.petaks);
      setSpecies(snapshot.species);
      setCompanySpreadsheets(snapshot.companySpreadsheets);
      setBaseMaps(snapshot.baseMaps);
      setEvalSettings(snapshot.evalSettings);
      setGnssSettings(snapshot.gnssSettings);
      setStaffList(snapshot.staffList);
      setQueueHydrated(true);
      setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const ensureLocationDoc = useCallback(
    async (perusahaan: CompanyName, cleanLoc: string) => {
      if (!profile) return null;
      const actorUid = auth.currentUser?.uid || profile.uid;
      const safeLoc = cleanLoc.slice(0, 100);
      const companyKey = getCompanyKey(perusahaan);
      const lokasiKey = makeSafeKey(safeLoc);
      const docId = buildLocationDocId(companyKey, lokasiKey);
      const locRef = doc(firestore, 'locations_master', docId);
      let snap;
      try {
        snap = await getDoc(locRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `locations_master/${docId}`);
      }
      if (!snap.exists()) {
        try {
          await setDoc(locRef, {
            perusahaan,
            companyKey,
            name: safeLoc,
            lokasiKey,
            createdByUid: actorUid,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(
            err,
            OperationType.CREATE,
            `locations_master/${docId}`
          );
        }
      }
      return {
        id: docId,
        perusahaan,
        companyKey,
        name: safeLoc,
        lokasiKey,
        createdByUid: profile.uid,
        syncStatus: 'synced' as const,
      };
    },
    [profile]
  );

  const refreshData = useCallback(
    async (force = false) => {
      if (authStatus !== 'authorized' || !profile || !profile.active) return;
      if (!isOnline) return;

      const assignedCompany = profile.assignedCompany || 'ALL';
      const isCompanyScoped =
        profile.role !== 'admin' && assignedCompany !== 'ALL';
      const matchesCompany = (perusahaan: string) =>
        !isCompanyScoped || perusahaan === assignedCompany;
      const scopedQuery = (colName: string) =>
        isCompanyScoped
          ? query(
              collection(firestore, colName),
              where('perusahaan', '==', assignedCompany)
            )
          : collection(firestore, colName);
      const evalQuery = isCompanyScoped
        ? query(
            collection(firestore, 'growth_eval_settings'),
            where('companyKey', 'in', [
              'ALL',
              getCompanyKey(resolveCompanyName(assignedCompany)),
            ])
          )
        : collection(firestore, 'growth_eval_settings');

      const gnssQuery = isCompanyScoped
        ? query(
            collection(firestore, 'gnss_accuracy_settings'),
            where('companyKey', 'in', [
              'ALL',
              getCompanyKey(resolveCompanyName(assignedCompany)),
            ])
          )
        : collection(firestore, 'gnss_accuracy_settings');

      if (!force && profile.role !== 'admin') {
        const meta = snapshotMetaRef.current;
        if (meta.ownerUid === profile.uid && meta.cachedAt) {
          const ageMs = Date.now() - new Date(meta.cachedAt).getTime();
          if (
            Number.isFinite(ageMs) &&
            ageMs >= 0 &&
            ageMs < OFFICER_REFRESH_COOLDOWN_MS
          ) {
            // Lightweight refresh of Admin Master Data, Base Maps & policies so officer views stay current without heavy plant_records reads
            try {
              const [locSnap, petakSnap, speciesSnap, baseMapSnap, evalSnap, gnssSnap] =
                await Promise.all([
                  getDocs(scopedQuery('locations_master')),
                  getDocs(scopedQuery('petaks_master')),
                  getDocs(scopedQuery('species_master')),
                  getDocs(scopedQuery('base_map_layers')),
                  getDocs(evalQuery),
                  getDocs(gnssQuery),
                ]);

              const locs: LocationMaster[] = locSnap.docs
                .map((d) => {
                  const data = d.data();
                  return {
                    id: d.id,
                    perusahaan: resolveCompanyName(String(data.perusahaan || '')),
                    companyKey: String(data.companyKey || ''),
                    name: String(data.name || ''),
                    lokasiKey: String(data.lokasiKey || ''),
                    createdByUid: String(data.createdByUid || ''),
                    createdAt: serializeTimestamp(data.createdAt),
                    syncStatus: 'synced' as const,
                  };
                })
                .filter((l) => matchesCompany(l.perusahaan));

              const petakList: PetakMaster[] = petakSnap.docs
                .map((d) => {
                  const data = d.data();
                  return {
                    id: d.id,
                    perusahaan: resolveCompanyName(String(data.perusahaan || '')),
                    companyKey: String(data.companyKey || ''),
                    lokasi: String(data.lokasi || ''),
                    lokasiKey: String(data.lokasiKey || ''),
                    name: String(data.name || ''),
                    petakKey: String(data.petakKey || ''),
                    createdByUid: String(data.createdByUid || ''),
                    createdAt: serializeTimestamp(data.createdAt),
                  };
                })
                .filter((p) => matchesCompany(p.perusahaan));

              const speciesList: SpeciesMaster[] = speciesSnap.docs
                .map((d) => {
                  const data = d.data();
                  return {
                    id: d.id,
                    perusahaan: resolveCompanyName(String(data.perusahaan || '')),
                    companyKey: String(data.companyKey || ''),
                    kelompokTanaman: data.kelompokTanaman as PlantGroup,
                    name: String(data.name || ''),
                    speciesKey: String(data.speciesKey || ''),
                    active: data.active !== false,
                    createdByUid: String(data.createdByUid || ''),
                    createdAt: serializeTimestamp(data.createdAt),
                  };
                })
                .filter((s) => matchesCompany(s.perusahaan));

              const mapList: BaseMapLayer[] = baseMapSnap.docs
                .map((d) => {
                  const data = d.data();
                  return {
                    id: d.id,
                    perusahaan: resolveCompanyName(String(data.perusahaan || '')),
                    companyKey: String(data.companyKey || ''),
                    name: String(data.name || ''),
                    fileType: data.fileType as BaseMapFileType,
                    crsCode: (data.crsCode || 'EPSG:4326') as CoordCrsCode,
                    fileDataBase64: data.fileDataBase64
                      ? String(data.fileDataBase64)
                      : null,
                    geoJsonText: data.geoJsonText
                      ? String(data.geoJsonText)
                      : null,
                    bboxJson: data.bboxJson ? String(data.bboxJson) : null,
                    chunkCount:
                      typeof data.chunkCount === 'number'
                        ? data.chunkCount
                        : null,
                    labelEnabled: Boolean(data.labelEnabled),
                    labelAttributes: Array.isArray(data.labelAttributes)
                      ? data.labelAttributes
                          .map((v: unknown) => String(v))
                          .filter(Boolean)
                          .slice(0, 15)
                      : [],
                    availableAttributes: Array.isArray(data.availableAttributes)
                      ? data.availableAttributes
                          .map((v: unknown) => String(v))
                          .filter(Boolean)
                          .slice(0, 100)
                      : [],
                    uploadedByUid: String(data.uploadedByUid || ''),
                    createdAt: serializeTimestamp(data.createdAt),
                  };
                })
                .filter((m) => matchesCompany(m.perusahaan))
                .sort((a, b) =>
                  String(b.createdAt || '').localeCompare(
                    String(a.createdAt || '')
                  )
                );

              const evalList: GrowthEvalSettings[] = evalSnap.docs.map((d) => {
                const data = d.data();
                return {
                  companyKey: String(data.companyKey || d.id),
                  enabled: data.enabled !== false,
                  minSurvivalPct: Number(data.minSurvivalPct ?? 80),
                  minDeltaHeightCm: Number(data.minDeltaHeightCm ?? 2),
                  updatedByUid: data.updatedByUid
                    ? String(data.updatedByUid)
                    : undefined,
                  updatedAt: serializeTimestamp(data.updatedAt),
                };
              });

              const gnssList: GnssAccuracySettings[] = gnssSnap.docs.map((d) => {
                const data = d.data();
                const defMax = Number(
                  data.defaultMaxAccuracyM ?? MAX_GNSS_ACCURACY_M
                );
                const mt = (data.modeThresholds || {}) as Record<
                  string,
                  unknown
                >;
                return {
                  companyKey: String(data.companyKey || d.id),
                  enforced: data.enforced !== false,
                  defaultMaxAccuracyM: defMax,
                  modeThresholds: {
                    optimal: Number(mt.optimal ?? defMax),
                    precision_static: Number(mt.precision_static ?? defMax),
                    continuous: Number(mt.continuous ?? defMax),
                    fast: Number(mt.fast ?? defMax),
                  },
                  updatedByUid: data.updatedByUid
                    ? String(data.updatedByUid)
                    : undefined,
                  updatedAt: serializeTimestamp(data.updatedAt),
                };
              });

              setServerLocations(locs);
              setPetaks(petakList);
              setSpecies(speciesList);
              setBaseMaps(mapList);
              setEvalSettings(evalList);
              setGnssSettings(gnssList);
              persistSnapshotPatch({
                locations: locs,
                petaks: petakList,
                species: speciesList,
                baseMaps: mapList,
                evalSettings: evalList,
                gnssSettings: gnssList,
              });
            } catch (lightErr) {
              console.warn('Master/BaseMap refresh warning:', lightErr);
              if (isFirestorePermissionError(lightErr)) {
                await syncProfileSilently();
                setLastSyncError(
                  formatFirestoreErrorForUser(
                    lightErr,
                    'Izin baca database ditolak. Silakan muat ulang atau Keluar lalu Masuk ulang dengan Google.'
                  )
                );
              }
            } finally {
              setIsLoading(false);
            }
            return;
          }
        }
      }

      setIsLoading(true);
      try {
      const [
        plantSnap,
        fcSnap,
        ccSnap,
        locSnap,
        petakSnap,
        speciesSnap,
        baseMapSnap,
        evalSnap,
        gnssSnap,
        sheetSnap,
        staffSnap,
      ] = await Promise.all([
        getDocs(scopedQuery('plant_records')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'plant_records')
        ),
        getDocs(scopedQuery('field_conditions')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'field_conditions')
        ),
        getDocs(scopedQuery('canopy_covers')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'canopy_covers')
        ),
        getDocs(scopedQuery('locations_master')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'locations_master')
        ),
        getDocs(scopedQuery('petaks_master')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'petaks_master')
        ),
        getDocs(scopedQuery('species_master')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'species_master')
        ),
        getDocs(scopedQuery('base_map_layers')).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'base_map_layers')
        ),
        getDocs(evalQuery).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'growth_eval_settings')
        ),
        getDocs(gnssQuery).catch((err) =>
          handleFirestoreError(err, OperationType.LIST, 'gnss_accuracy_settings')
        ),
        profile.role === 'admin'
          ? getDocs(collection(firestore, 'company_spreadsheets')).catch(
              (err) =>
                handleFirestoreError(
                  err,
                  OperationType.LIST,
                  'company_spreadsheets'
                )
            )
          : Promise.resolve(null),
        profile.role === 'admin'
          ? getDocs(collection(firestore, 'staff_whitelist')).catch((err) =>
              handleFirestoreError(err, OperationType.LIST, 'staff_whitelist')
            )
          : Promise.resolve(null),
      ]);

      const records: PlantRecord[] = plantSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            perusahaan: resolveCompanyName(String(data.perusahaan || '')),
            companyKey: String(data.companyKey || ''),
            menuType: data.menuType as MenuType,
            tanggalInput: String(data.tanggalInput || ''),
            waktuInput: data.waktuInput ? String(data.waktuInput) : undefined,
            periode: String(data.periode || ''),
            lokasi: String(data.lokasi || ''),
            lokasiKey: String(data.lokasiKey || ''),
            namaPetugas: String(data.namaPetugas || ''),
            nomorPetak: String(data.nomorPetak || ''),
            petakKey: String(data.petakKey || ''),
            nomorTanaman: Number(data.nomorTanaman || 0),
            kelompokTanaman: data.kelompokTanaman as PlantGroup,
            jenisTanaman: String(data.jenisTanaman || ''),
            tinggiCm: Number(data.tinggiCm || 0),
            diameterMm: Number(data.diameterMm || 0),
            kondisiTanaman: data.kondisiTanaman as PlantCondition,
            keterangan: String(data.keterangan || ''),
            extremeConfirmed: Boolean(data.extremeConfirmed),
            latitude:
              typeof data.latitude === 'number' ? data.latitude : null,
            longitude:
              typeof data.longitude === 'number' ? data.longitude : null,
            altitudeM:
              typeof data.altitudeM === 'number' ? data.altitudeM : null,
            horizontalAccuracyM:
              typeof data.horizontalAccuracyM === 'number'
                ? data.horizontalAccuracyM
                : null,
            verticalAccuracyM:
              typeof data.verticalAccuracyM === 'number'
                ? data.verticalAccuracyM
                : null,
            gnssSource: data.gnssSource ? String(data.gnssSource) : null,
            gnssOverrideReason: data.gnssOverrideReason
              ? String(data.gnssOverrideReason)
              : null,
            coordCrs: data.coordCrs ? String(data.coordCrs) : 'EPSG:4326',
            photoDataUrl: data.photoDataUrl ? String(data.photoDataUrl) : null,
            sheetSyncedAt: data.sheetSyncedAt
              ? String(data.sheetSyncedAt)
              : null,
            createdByUid: String(data.createdByUid || ''),
            createdByEmail: String(data.createdByEmail || ''),
            updatedByUid: String(data.updatedByUid || ''),
            createdAt: serializeTimestamp(data.createdAt),
            updatedAt: serializeTimestamp(data.updatedAt),
            syncStatus: 'synced' as const,
          };
        })
        .filter((r) => matchesCompany(r.perusahaan))
        .sort((a, b) => {
          if (a.tanggalInput !== b.tanggalInput) {
            return b.tanggalInput.localeCompare(a.tanggalInput);
          }
          if ((a.waktuInput || '') !== (b.waktuInput || '')) {
            return (b.waktuInput || '').localeCompare(a.waktuInput || '');
          }
          return b.nomorTanaman - a.nomorTanaman;
        });

      const fieldConds: FieldCondition[] = fcSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            perusahaan: resolveCompanyName(String(data.perusahaan || '')),
            companyKey: String(data.companyKey || ''),
            menuType: data.menuType as 'MONITORING_IPPKH' | 'MONITORING_APL',
            lokasi: String(data.lokasi || ''),
            lokasiKey: String(data.lokasiKey || ''),
            periode: String(data.periode || ''),
            coverCrop: data.coverCrop as CoverCropDensity,
            bangunanKonservasi:
              data.bangunanKonservasi as ConservationStructureStatus,
            jumlahBangunan: Number(data.jumlahBangunan || 0),
            namaPetugas: String(data.namaPetugas || ''),
            latitude:
              typeof data.latitude === 'number' ? data.latitude : null,
            longitude:
              typeof data.longitude === 'number' ? data.longitude : null,
            horizontalAccuracyM:
              typeof data.horizontalAccuracyM === 'number'
                ? data.horizontalAccuracyM
                : null,
            verticalAccuracyM:
              typeof data.verticalAccuracyM === 'number'
                ? data.verticalAccuracyM
                : null,
            photoDataUrl: data.photoDataUrl ? String(data.photoDataUrl) : null,
            createdByUid: String(data.createdByUid || ''),
            updatedByUid: String(data.updatedByUid || ''),
            createdAt: serializeTimestamp(data.createdAt),
            updatedAt: serializeTimestamp(data.updatedAt),
            syncStatus: 'synced' as const,
          };
        })
        .filter((fc) => matchesCompany(fc.perusahaan));

      const canopies: CanopyCover[] = ccSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            perusahaan: resolveCompanyName(String(data.perusahaan || '')),
            companyKey: String(data.companyKey || ''),
            menuType: 'MONITORING_APL' as const,
            lokasi: String(data.lokasi || ''),
            lokasiKey: String(data.lokasiKey || ''),
            nomorPetak: String(data.nomorPetak || ''),
            petakKey: String(data.petakKey || ''),
            periode: String(data.periode || ''),
            penutupanTajuk: data.penutupanTajuk as CanopyClosure,
            namaPetugas: String(data.namaPetugas || ''),
            createdByUid: String(data.createdByUid || ''),
            updatedByUid: String(data.updatedByUid || ''),
            createdAt: serializeTimestamp(data.createdAt),
            updatedAt: serializeTimestamp(data.updatedAt),
            syncStatus: 'synced' as const,
          };
        })
        .filter((cc) => matchesCompany(cc.perusahaan));

      const locs: LocationMaster[] = locSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            perusahaan: resolveCompanyName(String(data.perusahaan || '')),
            companyKey: String(data.companyKey || ''),
            name: String(data.name || ''),
            lokasiKey: String(data.lokasiKey || ''),
            createdByUid: String(data.createdByUid || ''),
            createdAt: serializeTimestamp(data.createdAt),
            syncStatus: 'synced' as const,
          };
        })
        .filter((l) => matchesCompany(l.perusahaan));

      const petakList: PetakMaster[] = petakSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            perusahaan: resolveCompanyName(String(data.perusahaan || '')),
            companyKey: String(data.companyKey || ''),
            lokasi: String(data.lokasi || ''),
            lokasiKey: String(data.lokasiKey || ''),
            name: String(data.name || ''),
            petakKey: String(data.petakKey || ''),
            createdByUid: String(data.createdByUid || ''),
            createdAt: serializeTimestamp(data.createdAt),
          };
        })
        .filter((p) => matchesCompany(p.perusahaan));

      let speciesList: SpeciesMaster[] = speciesSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            perusahaan: resolveCompanyName(String(data.perusahaan || '')),
            companyKey: String(data.companyKey || ''),
            kelompokTanaman: data.kelompokTanaman as PlantGroup,
            name: String(data.name || ''),
            speciesKey: String(data.speciesKey || ''),
            active: data.active !== false,
            createdByUid: String(data.createdByUid || ''),
            createdAt: serializeTimestamp(data.createdAt),
          };
        })
        .filter((s) => matchesCompany(s.perusahaan));

      // Auto-seed default species when Admin loads empty species_master
      if (speciesSnap.empty && profile.role === 'admin') {
        try {
          const batch = writeBatch(firestore);
          const seeded: SpeciesMaster[] = [];
          for (const comp of COMPANIES) {
            const ck = getCompanyKey(comp);
            for (const name of FGS_SPECIES) {
              const sk = makeSafeKey(name);
              const id = buildSpeciesDocId(ck, 'FGS', sk);
              batch.set(doc(firestore, 'species_master', id), {
                perusahaan: comp,
                companyKey: ck,
                kelompokTanaman: 'FGS',
                name,
                speciesKey: sk,
                active: true,
                createdByUid: profile.uid,
                createdAt: serverTimestamp(),
              });
              seeded.push({
                id,
                perusahaan: comp,
                companyKey: ck,
                kelompokTanaman: 'FGS',
                name,
                speciesKey: sk,
                active: true,
                createdByUid: profile.uid,
              });
            }
            for (const name of LOKAL_MPTS_SPECIES) {
              const sk = makeSafeKey(name);
              const id = buildSpeciesDocId(ck, 'LOKAL_MPTS', sk);
              batch.set(doc(firestore, 'species_master', id), {
                perusahaan: comp,
                companyKey: ck,
                kelompokTanaman: 'LOKAL_MPTS',
                name,
                speciesKey: sk,
                active: true,
                createdByUid: profile.uid,
                createdAt: serverTimestamp(),
              });
              seeded.push({
                id,
                perusahaan: comp,
                companyKey: ck,
                kelompokTanaman: 'LOKAL_MPTS',
                name,
                speciesKey: sk,
                active: true,
                createdByUid: profile.uid,
              });
            }
          }
          await batch.commit();
          speciesList = seeded.filter((s) => matchesCompany(s.perusahaan));
        } catch (seedErr) {
          console.warn('Species seeding notice:', seedErr);
        }
      }

      const mapList: BaseMapLayer[] = baseMapSnap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            perusahaan: resolveCompanyName(String(data.perusahaan || '')),
            companyKey: String(data.companyKey || ''),
            name: String(data.name || ''),
            fileType: data.fileType as BaseMapFileType,
            crsCode: (data.crsCode || 'EPSG:4326') as CoordCrsCode,
            fileDataBase64: data.fileDataBase64
              ? String(data.fileDataBase64)
              : null,
            geoJsonText: data.geoJsonText ? String(data.geoJsonText) : null,
            bboxJson: data.bboxJson ? String(data.bboxJson) : null,
            chunkCount:
              typeof data.chunkCount === 'number' ? data.chunkCount : null,
            labelEnabled: Boolean(data.labelEnabled),
            labelAttributes: Array.isArray(data.labelAttributes)
              ? data.labelAttributes
                  .map((v: unknown) => String(v))
                  .filter(Boolean)
                  .slice(0, 15)
              : [],
            availableAttributes: Array.isArray(data.availableAttributes)
              ? data.availableAttributes
                  .map((v: unknown) => String(v))
                  .filter(Boolean)
                  .slice(0, 100)
              : [],
            uploadedByUid: String(data.uploadedByUid || ''),
            createdAt: serializeTimestamp(data.createdAt),
          };
        })
        .filter((m) => matchesCompany(m.perusahaan))
        .sort((a, b) =>
          String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
        );

      const evalList: GrowthEvalSettings[] = evalSnap.docs.map((d) => {
        const data = d.data();
        return {
          companyKey: String(data.companyKey || d.id),
          enabled: data.enabled !== false,
          minSurvivalPct: Number(data.minSurvivalPct ?? 80),
          minDeltaHeightCm: Number(data.minDeltaHeightCm ?? 2),
          updatedByUid: data.updatedByUid
            ? String(data.updatedByUid)
            : undefined,
          updatedAt: serializeTimestamp(data.updatedAt),
        };
      });

      const gnssList: GnssAccuracySettings[] = gnssSnap.docs.map((d) => {
        const data = d.data();
        const defMax = Number(data.defaultMaxAccuracyM ?? MAX_GNSS_ACCURACY_M);
        const mt = (data.modeThresholds || {}) as Record<string, unknown>;
        return {
          companyKey: String(data.companyKey || d.id),
          enforced: data.enforced !== false,
          defaultMaxAccuracyM: defMax,
          modeThresholds: {
            optimal: Number(mt.optimal ?? defMax),
            precision_static: Number(mt.precision_static ?? defMax),
            continuous: Number(mt.continuous ?? defMax),
            fast: Number(mt.fast ?? defMax),
          },
          updatedByUid: data.updatedByUid
            ? String(data.updatedByUid)
            : undefined,
          updatedAt: serializeTimestamp(data.updatedAt),
        };
      });

      const sheetList: CompanySpreadsheet[] = sheetSnap
        ? sheetSnap.docs.map((d) => {
            const data = d.data();
            return {
              companyKey: String(data.companyKey || d.id),
              perusahaan: resolveCompanyName(String(data.perusahaan || '')),
              spreadsheetId: String(data.spreadsheetId || ''),
              spreadsheetUrl: String(data.spreadsheetUrl || ''),
              ownerEmail: String(data.ownerEmail || ''),
              lastSyncedAt: data.lastSyncedAt
                ? String(data.lastSyncedAt)
                : null,
              syncedRecordCount: Number(data.syncedRecordCount || 0),
              updatedAt: serializeTimestamp(data.updatedAt),
            };
          })
        : [];

      const staffItems: StaffMember[] = staffSnap
        ? staffSnap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                email: String(data.email || ''),
                name: String(data.name || ''),
                role: (data.role === 'admin' ? 'admin' : 'petugas') as UserRole,
                assignedCompany: (data.assignedCompany ||
                  'ALL') as AssignedCompany,
                rangeStart:
                  typeof data.rangeStart === 'number' ? data.rangeStart : null,
                rangeEnd:
                  typeof data.rangeEnd === 'number' ? data.rangeEnd : null,
                active: data.active !== false,
                createdByUid: String(data.createdByUid || ''),
                createdAt: serializeTimestamp(data.createdAt),
                updatedAt: serializeTimestamp(data.updatedAt),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'id'))
        : [];

      setServerRecords(records);
      setServerFieldConditions(fieldConds);
      setServerCanopyCovers(canopies);
      setServerLocations(locs);
      setPetaks(petakList);
      setSpecies(speciesList);
      setCompanySpreadsheets(sheetList);
      setBaseMaps(mapList);
      setEvalSettings(evalList);
      setGnssSettings(gnssList);
      setStaffList(staffItems);

      const nowDate = new Date();
      const nowIso = nowDate.toISOString();
      snapshotMetaRef.current = { ownerUid: profile.uid, cachedAt: nowIso };
      setLastSyncAt(nowDate);

      void saveServerSnapshot({
        records,
        fieldConditions: fieldConds,
        canopyCovers: canopies,
        locations: locs,
        petaks: petakList,
        species: speciesList,
        companySpreadsheets: sheetList,
        baseMaps: mapList,
        evalSettings: evalList,
        gnssSettings: gnssList,
        staffList: staffItems,
        cachedAt: nowIso,
        ownerUid: profile.uid,
      });
      setLastSyncError(null);
    } catch (err) {
      console.warn('Firestore bootstrap refresh warning:', err);
      if (isFirestorePermissionError(err)) {
        setLastSyncError(
          formatFirestoreErrorForUser(
            err,
            'Izin baca database ditolak. Silakan muat ulang atau Keluar lalu Masuk ulang dengan Google.'
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [authStatus, profile, isOnline, persistSnapshotPatch]);

  useEffect(() => {
    if (!queueHydrated) return;
    if (authStatus !== 'authorized' || !profile || !profile.active) {
      lastCompanyRef.current = '';
      setServerRecords([]);
      setServerFieldConditions([]);
      setServerCanopyCovers([]);
      setServerLocations([]);
      setPetaks([]);
      setSpecies([]);
      setCompanySpreadsheets([]);
      setBaseMaps([]);
      setEvalSettings([]);
      setGnssSettings([]);
      setStaffList([]);
      setIsLoading(false);
      return;
    }
    const currentCompany = profile.assignedCompany || 'ALL';
    const companyChanged =
      Boolean(lastCompanyRef.current) && lastCompanyRef.current !== currentCompany;
    lastCompanyRef.current = currentCompany;

    const snapshotOwnerMismatch =
      Boolean(snapshotMetaRef.current.ownerUid) &&
      snapshotMetaRef.current.ownerUid !== profile.uid;
    if (snapshotOwnerMismatch || companyChanged) {
      setServerRecords([]);
      setServerFieldConditions([]);
      setServerCanopyCovers([]);
      setServerLocations([]);
      setPetaks([]);
      setSpecies([]);
      setCompanySpreadsheets([]);
      setBaseMaps([]);
      setEvalSettings([]);
      setGnssSettings([]);
      setStaffList([]);
    }
    if (isOnline) {
      void refreshData(snapshotOwnerMismatch || companyChanged);
    } else {
      setIsLoading(false);
    }
  }, [queueHydrated, authStatus, profile, isOnline, refreshData]);

  const matchesUserCompany = useCallback(
    (perusahaan: string) => {
      if (!profile || profile.role === 'admin') return true;
      const assigned = profile.assignedCompany || 'ALL';
      return assigned === 'ALL' || perusahaan === assigned;
    },
    [profile]
  );

  // Merge server data with offline queue (strictly isolated to user's assigned company)
  const allRecords = useMemo(() => {
    const map = new Map<string, PlantRecord>();
    serverRecords.forEach((r) => {
      if (matchesUserCompany(r.perusahaan)) map.set(r.id, r);
    });
    offlineQueue.plantRecords.forEach((q) => {
      const perusahaan = resolveCompanyName(q.perusahaan);
      if (!matchesUserCompany(perusahaan)) return;
      const normalized: PlantRecord = {
        ...q,
        perusahaan,
        companyKey: q.companyKey || getCompanyKey(perusahaan),
      };
      if (!map.has(normalized.id)) {
        map.set(normalized.id, normalized);
      } else if (normalized.syncStatus === 'conflict') {
        map.set(normalized.id, normalized);
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.tanggalInput !== b.tanggalInput) {
        return b.tanggalInput.localeCompare(a.tanggalInput);
      }
      if ((a.waktuInput || '') !== (b.waktuInput || '')) {
        return (b.waktuInput || '').localeCompare(a.waktuInput || '');
      }
      return b.nomorTanaman - a.nomorTanaman;
    });
  }, [serverRecords, offlineQueue.plantRecords, matchesUserCompany]);

  const fieldConditions = useMemo(() => {
    const map = new Map<string, FieldCondition>();
    serverFieldConditions.forEach((fc) => {
      if (matchesUserCompany(fc.perusahaan)) map.set(fc.id, fc);
    });
    offlineQueue.fieldConditions.forEach((q) => {
      const perusahaan = resolveCompanyName(q.perusahaan);
      if (!matchesUserCompany(perusahaan)) return;
      map.set(q.id, {
        ...q,
        perusahaan,
        companyKey: q.companyKey || getCompanyKey(perusahaan),
      });
    });
    return Array.from(map.values());
  }, [serverFieldConditions, offlineQueue.fieldConditions, matchesUserCompany]);

  const canopyCovers = useMemo(() => {
    const map = new Map<string, CanopyCover>();
    serverCanopyCovers.forEach((cc) => {
      if (matchesUserCompany(cc.perusahaan)) map.set(cc.id, cc);
    });
    offlineQueue.canopyCovers.forEach((q) => {
      const perusahaan = resolveCompanyName(q.perusahaan);
      if (!matchesUserCompany(perusahaan)) return;
      map.set(q.id, {
        ...q,
        perusahaan,
        companyKey: q.companyKey || getCompanyKey(perusahaan),
      });
    });
    return Array.from(map.values());
  }, [serverCanopyCovers, offlineQueue.canopyCovers, matchesUserCompany]);

  const masterLocations = useMemo(() => {
    const map = new Map<string, LocationMaster>();
    serverLocations.forEach((loc) => {
      if (!matchesUserCompany(loc.perusahaan)) return;
      const docKey = buildLocationDocId(loc.companyKey, loc.lokasiKey);
      map.set(docKey, { ...loc, id: docKey });
    });
    offlineQueue.locations.forEach((loc) => {
      const perusahaan = resolveCompanyName(loc.perusahaan);
      if (!matchesUserCompany(perusahaan)) return;
      const companyKey = loc.companyKey || getCompanyKey(perusahaan);
      const docKey = buildLocationDocId(companyKey, loc.lokasiKey);
      if (!map.has(docKey)) {
        map.set(docKey, { ...loc, id: docKey, perusahaan, companyKey });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' })
    );
  }, [serverLocations, offlineQueue.locations, matchesUserCompany]);

  const locations = useMemo(() => {
    const map = new Map<string, LocationMaster>();
    masterLocations.forEach((loc) => {
      map.set(loc.id, loc);
    });
    allRecords.forEach((r) => {
      if (!matchesUserCompany(r.perusahaan)) return;
      const docKey = buildLocationDocId(r.companyKey, r.lokasiKey);
      if (!map.has(docKey)) {
        map.set(docKey, {
          id: docKey,
          perusahaan: r.perusahaan,
          companyKey: r.companyKey,
          name: r.lokasi,
          lokasiKey: r.lokasiKey,
          createdByUid: r.createdByUid,
          syncStatus: 'synced',
        });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' })
    );
  }, [masterLocations, allRecords, matchesUserCompany]);

  const scopedPetaks = useMemo(
    () => petaks.filter((p) => matchesUserCompany(p.perusahaan)),
    [petaks, matchesUserCompany]
  );

  const scopedSpecies = useMemo(
    () => species.filter((s) => matchesUserCompany(s.perusahaan)),
    [species, matchesUserCompany]
  );

  const scopedBaseMaps = useMemo(
    () => baseMaps.filter((b) => matchesUserCompany(b.perusahaan)),
    [baseMaps, matchesUserCompany]
  );

  // Silent daily backup trigger whenever today's records change locally
  useEffect(() => {
    if (!profile || allRecords.length === 0) return;
    const payload = buildTodayBackupPayload({
      officerEmail: profile.email,
      allRecords,
      fieldConditions,
      canopyCovers,
    });
    if (payload.totalPlantRecordsToday > 0) {
      void autoWriteDailyBackupToHandle(payload);
    }
  }, [profile, allRecords, fieldConditions, canopyCovers]);

  const pendingCount = useMemo(
    () =>
      offlineQueue.plantRecords.filter(
        (r) =>
          r.syncStatus === 'pending' &&
          matchesUserCompany(resolveCompanyName(r.perusahaan))
      ).length +
      offlineQueue.fieldConditions.filter((fc) =>
        matchesUserCompany(resolveCompanyName(fc.perusahaan))
      ).length +
      offlineQueue.canopyCovers.filter((cc) =>
        matchesUserCompany(resolveCompanyName(cc.perusahaan))
      ).length +
      offlineQueue.locations.filter((l) =>
        matchesUserCompany(resolveCompanyName(l.perusahaan))
      ).length,
    [offlineQueue, matchesUserCompany]
  );

  const otherCompanyPendingCount = useMemo(
    () =>
      offlineQueue.plantRecords.filter(
        (r) =>
          r.syncStatus === 'pending' &&
          !matchesUserCompany(resolveCompanyName(r.perusahaan))
      ).length +
      offlineQueue.fieldConditions.filter(
        (fc) => !matchesUserCompany(resolveCompanyName(fc.perusahaan))
      ).length +
      offlineQueue.canopyCovers.filter(
        (cc) => !matchesUserCompany(resolveCompanyName(cc.perusahaan))
      ).length +
      offlineQueue.locations.filter(
        (l) => !matchesUserCompany(resolveCompanyName(l.perusahaan))
      ).length,
    [offlineQueue, matchesUserCompany]
  );

  const conflictCount = useMemo(
    () =>
      offlineQueue.plantRecords.filter(
        (r) =>
          r.syncStatus === 'conflict' &&
          matchesUserCompany(resolveCompanyName(r.perusahaan))
      ).length,
    [offlineQueue.plantRecords, matchesUserCompany]
  );

  const getSpeciesForCompanyGroup = useCallback(
    (perusahaan: CompanyName, kelompok: PlantGroup): string[] => {
      const ck = getCompanyKey(perusahaan);
      const custom = species
        .filter(
          (s) =>
            s.companyKey === ck &&
            s.kelompokTanaman === kelompok &&
            s.active !== false
        )
        .map((s) => s.name);
      if (custom.length > 0) return custom;
      return kelompok === 'FGS'
        ? [...FGS_SPECIES]
        : [...LOKAL_MPTS_SPECIES];
    },
    [species]
  );

  const syncPendingQueue = useCallback(
    async (
      manual = false
    ): Promise<{ synced: number; conflicts: number; error?: string }> => {
      if (manual) {
        autoRetryCountRef.current = 0;
      }
      if (!profile || syncLockRef.current) {
        return { synced: 0, conflicts: 0 };
      }

      const currentQueue = queueRef.current;
      const scopedLocs = currentQueue.locations.filter((l) =>
        matchesUserCompany(resolveCompanyName(l.perusahaan))
      );
      const scopedConds = currentQueue.fieldConditions.filter((fc) =>
        matchesUserCompany(resolveCompanyName(fc.perusahaan))
      );
      const scopedCanopies = currentQueue.canopyCovers.filter((cc) =>
        matchesUserCompany(resolveCompanyName(cc.perusahaan))
      );
      const pendingPlants = currentQueue.plantRecords.filter(
        (r) =>
          r.syncStatus === 'pending' &&
          matchesUserCompany(resolveCompanyName(r.perusahaan))
      );
      const hasWork =
        scopedLocs.length > 0 ||
        scopedConds.length > 0 ||
        scopedCanopies.length > 0 ||
        pendingPlants.length > 0;

      if (!hasWork) {
        setLastSyncError(null);
        return { synced: 0, conflicts: 0 };
      }

      const reachable = await checkServerReachable();
      if (!reachable) {
        const msg =
          'Jaringan belum dapat dijangkau (sinyal tidak stabil atau masih offline). Antrean tetap aman tersimpan di perangkat.';
        if (manual) setLastSyncError(msg);
        return { synced: 0, conflicts: 0, error: msg };
      }

      syncLockRef.current = true;
      setIsSyncing(true);
      setLastSyncError(null);
      let syncedTotal = 0;
      let conflictsTotal = 0;
      let encounteredError: string | undefined;

      const executeQueueSyncPass = async () => {
        const latestQueue = queueRef.current;
        const passLocs = latestQueue.locations.filter((l) =>
          matchesUserCompany(resolveCompanyName(l.perusahaan))
        );
        const passConds = latestQueue.fieldConditions.filter((fc) =>
          matchesUserCompany(resolveCompanyName(fc.perusahaan))
        );
        const passCanopies = latestQueue.canopyCovers.filter((cc) =>
          matchesUserCompany(resolveCompanyName(cc.perusahaan))
        );
        const passPlants = latestQueue.plantRecords.filter(
          (r) =>
            r.syncStatus === 'pending' &&
            matchesUserCompany(resolveCompanyName(r.perusahaan))
        );

        const syncedLocItems: LocationMaster[] = [];
        const syncedCondItems: FieldCondition[] = [];
        const syncedCanopyItems: CanopyCover[] = [];
        const syncedPlantItems: PlantRecord[] = [];

        // 1. Locations
        const locDone = new Set<string>();
        for (const loc of passLocs) {
          const perusahaan = resolveCompanyName(loc.perusahaan);
          const cleanName = normalizeDisplayText(loc.name);
          const res = await ensureLocationDoc(perusahaan, cleanName);
          if (res) {
            syncedLocItems.push(res);
            locDone.add(loc.id);
            syncedTotal += 1;
          }
        }
        if (locDone.size > 0) {
          mutateQueue((prev) => ({
            ...prev,
            locations: prev.locations.filter((l) => !locDone.has(l.id)),
          }));
        }

        // 2. Field conditions
        const fcDone = new Set<string>();
        for (const fc of passConds) {
          const perusahaan = resolveCompanyName(fc.perusahaan);
          const cleanLoc = normalizeDisplayText(fc.lokasi);
          const companyKey = fc.companyKey || getCompanyKey(perusahaan);
          const lokasiKey = fc.lokasiKey || makeSafeKey(cleanLoc);
          const id = buildFieldConditionId(
            companyKey,
            fc.menuType,
            lokasiKey,
            fc.periode
          );
          const ensuredLoc = await ensureLocationDoc(perusahaan, cleanLoc);
          if (ensuredLoc) syncedLocItems.push(ensuredLoc);
          const fcRef = doc(firestore, 'field_conditions', id);
          const existing = await getDoc(fcRef);
          const jumlahBangunan =
            fc.bangunanKonservasi === 'Ada'
              ? Math.max(1, Math.round(fc.jumlahBangunan))
              : 0;
          const cleanPetugas = (
            normalizeDisplayText(fc.namaPetugas || profile.name || 'Petugas') ||
            'Petugas'
          ).slice(0, 100);
          const actorUid = auth.currentUser?.uid || profile.uid;
          const safeLat = sanitizeOptNum(fc.latitude, -90, 90);
          const safeLon = sanitizeOptNum(fc.longitude, -180, 180);
          const safeHAcc = sanitizeOptNum(fc.horizontalAccuracyM, 0, 100000);
          const safeVAcc = sanitizeOptNum(fc.verticalAccuracyM, 0, 100000);
          const safePhoto = sanitizePhotoUrl(fc.photoDataUrl);
          if (!existing.exists()) {
            await setDoc(fcRef, {
              perusahaan,
              companyKey,
              menuType: fc.menuType,
              lokasi: cleanLoc,
              lokasiKey,
              periode: fc.periode,
              coverCrop: fc.coverCrop,
              bangunanKonservasi: fc.bangunanKonservasi,
              jumlahBangunan,
              namaPetugas: cleanPetugas,
              latitude: safeLat,
              longitude: safeLon,
              horizontalAccuracyM: safeHAcc,
              verticalAccuracyM: safeVAcc,
              photoDataUrl: safePhoto,
              createdByUid: actorUid,
              updatedByUid: actorUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(fcRef, {
              lokasi: cleanLoc,
              coverCrop: fc.coverCrop,
              bangunanKonservasi: fc.bangunanKonservasi,
              jumlahBangunan,
              namaPetugas: cleanPetugas,
              latitude: safeLat,
              longitude: safeLon,
              horizontalAccuracyM: safeHAcc,
              verticalAccuracyM: safeVAcc,
              photoDataUrl: safePhoto,
              updatedByUid: actorUid,
              updatedAt: serverTimestamp(),
            });
          }
          syncedCondItems.push({
            ...fc,
            id,
            perusahaan,
            companyKey,
            lokasi: cleanLoc,
            lokasiKey,
            jumlahBangunan,
            namaPetugas: cleanPetugas,
            latitude: safeLat,
            longitude: safeLon,
            horizontalAccuracyM: safeHAcc,
            verticalAccuracyM: safeVAcc,
            photoDataUrl: safePhoto,
            updatedByUid: actorUid,
            updatedAt: new Date().toISOString(),
            syncStatus: 'synced',
          });
          fcDone.add(fc.id);
          syncedTotal += 1;
        }
        if (fcDone.size > 0) {
          mutateQueue((prev) => ({
            ...prev,
            fieldConditions: prev.fieldConditions.filter(
              (fc) => !fcDone.has(fc.id)
            ),
          }));
        }

        // 3. Canopy covers
        const ccDone = new Set<string>();
        for (const cc of passCanopies) {
          const perusahaan = resolveCompanyName(cc.perusahaan);
          const cleanLoc = normalizeDisplayText(cc.lokasi);
          const cleanPetak = normalizeDisplayText(cc.nomorPetak);
          const companyKey = cc.companyKey || getCompanyKey(perusahaan);
          const lokasiKey = cc.lokasiKey || makeSafeKey(cleanLoc);
          const petakKey = cc.petakKey || makeSafeKey(cleanPetak);
          const id = buildCanopyCoverId(
            companyKey,
            lokasiKey,
            petakKey,
            cc.periode
          );
          const ccRef = doc(firestore, 'canopy_covers', id);
          const existing = await getDoc(ccRef);
          const cleanPetugas = normalizeDisplayText(cc.namaPetugas);
          if (!existing.exists()) {
            await setDoc(ccRef, {
              perusahaan,
              companyKey,
              menuType: 'MONITORING_APL',
              lokasi: cleanLoc,
              lokasiKey,
              nomorPetak: cleanPetak,
              petakKey,
              periode: cc.periode,
              penutupanTajuk: cc.penutupanTajuk,
              namaPetugas: cleanPetugas,
              createdByUid: profile.uid,
              updatedByUid: profile.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(ccRef, {
              lokasi: cleanLoc,
              nomorPetak: cleanPetak,
              penutupanTajuk: cc.penutupanTajuk,
              namaPetugas: cleanPetugas,
              updatedByUid: profile.uid,
              updatedAt: serverTimestamp(),
            });
          }
          syncedCanopyItems.push({
            ...cc,
            id,
            perusahaan,
            companyKey,
            lokasi: cleanLoc,
            lokasiKey,
            nomorPetak: cleanPetak,
            petakKey,
            namaPetugas: cleanPetugas,
            updatedByUid: profile.uid,
            updatedAt: new Date().toISOString(),
            syncStatus: 'synced',
          });
          ccDone.add(cc.id);
          syncedTotal += 1;
        }
        if (ccDone.size > 0) {
          mutateQueue((prev) => ({
            ...prev,
            canopyCovers: prev.canopyCovers.filter((cc) => !ccDone.has(cc.id)),
          }));
        }

        // 4. Plant records (check existence first to guard duplicate numbers)
        const syncedPlantSet = new Set<string>();
        const conflictReasons = new Map<string, string>();
        for (const rec of passPlants) {
          const perusahaan = resolveCompanyName(rec.perusahaan);
          const cleanLoc = normalizeDisplayText(rec.lokasi);
          const cleanPetak =
            rec.menuType === 'SENSUS'
              ? ''
              : normalizeDisplayText(rec.nomorPetak);
          const periode = rec.periode || extractPeriode(rec.tanggalInput);
          const companyKey = rec.companyKey || getCompanyKey(perusahaan);
          const lokasiKey = rec.lokasiKey || makeSafeKey(cleanLoc);
          const petakKey =
            rec.menuType === 'SENSUS'
              ? 'SENSUS'
              : rec.petakKey || makeSafeKey(cleanPetak);
          const id = buildPlantRecordId(
            companyKey,
            rec.menuType,
            lokasiKey,
            petakKey,
            periode,
            rec.nomorTanaman
          );

          const ensuredLoc = await ensureLocationDoc(perusahaan, cleanLoc);
          if (ensuredLoc) syncedLocItems.push(ensuredLoc);
          const recRef = doc(firestore, 'plant_records', id);
          const existingSnap = await getDoc(recRef);
          if (existingSnap.exists()) {
            const existingData = existingSnap.data();
            conflictReasons.set(
              rec.id,
              `Nomor tanaman #${rec.nomorTanaman} sudah lebih dulu diinput oleh ${String(
                existingData.namaPetugas || 'petugas lain'
              )}.`
            );
            conflictsTotal += 1;
            continue;
          }

          const cleanPetugas = (
            normalizeDisplayText(rec.namaPetugas || profile.name || 'Petugas') ||
            'Petugas'
          ).slice(0, 100);
          const cleanJenis = (
            normalizeDisplayText(rec.jenisTanaman) || 'Lainnya'
          ).slice(0, 100);
          const safeNomor = Math.max(
            1,
            Math.min(9999999, Math.round(Number(rec.nomorTanaman) || 1))
          );
          const tinggiCm =
            rec.kondisiTanaman === 'Mati'
              ? 0
              : clampFiniteMetric(rec.tinggiCm, 0.1, 15000, 1);
          const diameterMm =
            rec.kondisiTanaman === 'Mati'
              ? 0
              : clampFiniteMetric(rec.diameterMm, 0.1, 5000, 1);
          const keterangan = (rec.keterangan || '').trim().slice(0, 500);
          const gnssOverrideReason = rec.gnssOverrideReason
            ? rec.gnssOverrideReason.trim().slice(0, 250)
            : null;
          const actorUid = auth.currentUser?.uid || profile.uid;
          const actorEmail =
            (auth.currentUser?.email || profile.email || '')
              .trim()
              .toLowerCase()
              .slice(0, 150) || 'petugas@silvitrack.local';
          const safeLat = sanitizeOptNum(rec.latitude, -90, 90);
          const safeLon = sanitizeOptNum(rec.longitude, -180, 180);
          const safeAlt = sanitizeOptNum(rec.altitudeM, -500, 10000);
          const safeHAcc = sanitizeOptNum(rec.horizontalAccuracyM, 0, 100000);
          const safeVAcc = sanitizeOptNum(rec.verticalAccuracyM, 0, 100000);
          const safeGnssSource = rec.gnssSource
            ? String(rec.gnssSource).trim().slice(0, 120)
            : null;
          const safeCoordCrs = (rec.coordCrs ?? 'EPSG:4326')
            .toString()
            .trim()
            .slice(0, 40);
          const safePhoto = sanitizePhotoUrl(rec.photoDataUrl);
          const safeWaktu = sanitizeWaktuInput(rec.waktuInput);

          await setDoc(recRef, {
            perusahaan,
            companyKey,
            menuType: rec.menuType,
            tanggalInput: rec.tanggalInput,
            waktuInput: safeWaktu,
            periode,
            lokasi: cleanLoc,
            lokasiKey,
            namaPetugas: cleanPetugas,
            nomorPetak: cleanPetak,
            petakKey,
            nomorTanaman: safeNomor,
            kelompokTanaman: rec.kelompokTanaman,
            jenisTanaman: cleanJenis,
            tinggiCm,
            diameterMm,
            kondisiTanaman: rec.kondisiTanaman,
            keterangan,
            extremeConfirmed: Boolean(rec.extremeConfirmed),
            latitude: safeLat,
            longitude: safeLon,
            altitudeM: safeAlt,
            horizontalAccuracyM: safeHAcc,
            verticalAccuracyM: safeVAcc,
            gnssSource: safeGnssSource,
            gnssOverrideReason,
            coordCrs: safeCoordCrs,
            photoDataUrl: safePhoto,
            sheetSyncedAt: null,
            createdByUid: actorUid,
            createdByEmail: actorEmail,
            updatedByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          syncedPlantItems.push({
            ...rec,
            id,
            perusahaan,
            companyKey,
            periode,
            lokasi: cleanLoc,
            lokasiKey,
            namaPetugas: cleanPetugas,
            nomorPetak: cleanPetak,
            petakKey,
            nomorTanaman: safeNomor,
            jenisTanaman: cleanJenis,
            tinggiCm,
            diameterMm,
            keterangan,
            latitude: safeLat,
            longitude: safeLon,
            altitudeM: safeAlt,
            horizontalAccuracyM: safeHAcc,
            verticalAccuracyM: safeVAcc,
            gnssSource: safeGnssSource,
            gnssOverrideReason,
            coordCrs: safeCoordCrs,
            photoDataUrl: safePhoto,
            waktuInput: safeWaktu ?? undefined,
            sheetSyncedAt: null,
            createdByUid: actorUid,
            createdByEmail: actorEmail,
            updatedByUid: actorUid,
            updatedAt: new Date().toISOString(),
            syncStatus: 'synced',
          });
          syncedPlantSet.add(rec.id);
          syncedTotal += 1;
        }

        mutateQueue((prev) => ({
          ...prev,
          plantRecords: prev.plantRecords
            .filter((r) => !syncedPlantSet.has(r.id))
            .map((r) => {
              const reason = conflictReasons.get(r.id);
              if (reason) {
                return {
                  ...r,
                  syncStatus: 'conflict' as const,
                  syncError: reason,
                };
              }
              return r;
            }),
        }));

        // Merge newly synced items directly into local state & IndexedDB snapshot (0 extra Firestore reads)
        const snapshotPatch: Partial<{
          records: PlantRecord[];
          fieldConditions: FieldCondition[];
          canopyCovers: CanopyCover[];
          locations: LocationMaster[];
        }> = {};

        if (syncedLocItems.length > 0) {
          const map = new Map(
            snapshotDataRef.current.locations.map((l) => [l.id, l])
          );
          syncedLocItems.forEach((l) => map.set(l.id, l));
          const mergedLocs = Array.from(map.values());
          setServerLocations(mergedLocs);
          snapshotPatch.locations = mergedLocs;
        }
        if (syncedCondItems.length > 0) {
          const map = new Map(
            snapshotDataRef.current.fieldConditions.map((x) => [x.id, x])
          );
          syncedCondItems.forEach((x) => map.set(x.id, x));
          const mergedConds = Array.from(map.values());
          setServerFieldConditions(mergedConds);
          snapshotPatch.fieldConditions = mergedConds;
        }
        if (syncedCanopyItems.length > 0) {
          const map = new Map(
            snapshotDataRef.current.canopyCovers.map((x) => [x.id, x])
          );
          syncedCanopyItems.forEach((x) => map.set(x.id, x));
          const mergedCanopies = Array.from(map.values());
          setServerCanopyCovers(mergedCanopies);
          snapshotPatch.canopyCovers = mergedCanopies;
        }
        if (syncedPlantItems.length > 0) {
          const map = new Map(
            snapshotDataRef.current.records.map((r) => [r.id, r])
          );
          syncedPlantItems.forEach((r) => map.set(r.id, r));
          const mergedRecs = Array.from(map.values()).sort((a, b) => {
            if (a.tanggalInput !== b.tanggalInput) {
              return b.tanggalInput.localeCompare(a.tanggalInput);
            }
            if ((a.waktuInput || '') !== (b.waktuInput || '')) {
              return (b.waktuInput || '').localeCompare(a.waktuInput || '');
            }
            return b.nomorTanaman - a.nomorTanaman;
          });
          setServerRecords(mergedRecs);
          snapshotPatch.records = mergedRecs;
        }

        if (Object.keys(snapshotPatch).length > 0) {
          persistSnapshotPatch(snapshotPatch);
        }
      };

      try {
        try {
          await executeQueueSyncPass();
        } catch (firstErr) {
          if (isFirestorePermissionError(firstErr)) {
            const syncedProfile = await syncProfileSilently();
            if (syncedProfile && syncedProfile.active) {
              await executeQueueSyncPass();
            } else {
              throw firstErr;
            }
          } else {
            throw firstErr;
          }
        }

        setLastSyncAt(new Date());
        autoRetryCountRef.current = 0;
      } catch (err) {
        encounteredError = formatFirestoreErrorForUser(
          err,
          'Gagal mengunggah antrean offline ke database.'
        );
        setLastSyncError(encounteredError);
      } finally {
        syncLockRef.current = false;
        setIsSyncing(false);
      }

      return {
        synced: syncedTotal,
        conflicts: conflictsTotal,
        error: encounteredError,
      };
    },
    [
      profile,
      mutateQueue,
      ensureLocationDoc,
      matchesUserCompany,
      persistSnapshotPatch,
      syncProfileSilently,
    ]
  );

  // Auto-sync on connectivity return + bounded auto-retry
  useEffect(() => {
    if (!queueHydrated || authStatus !== 'authorized' || !isOnline) {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      return;
    }

    if (pendingCount === 0) {
      autoRetryCountRef.current = 0;
      return;
    }

    if (!isSyncing) {
      if (autoRetryCountRef.current === 0) {
        autoRetryCountRef.current = 1;
        void syncPendingQueue(false);
      } else if (autoRetryCountRef.current < MAX_AUTO_RETRIES) {
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
        }
        retryTimerRef.current = window.setTimeout(() => {
          autoRetryCountRef.current += 1;
          void syncPendingQueue(false);
        }, 15000);
      }
    }

    return () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [
    queueHydrated,
    authStatus,
    isOnline,
    pendingCount,
    isSyncing,
    syncPendingQueue,
  ]);

  const checkDuplicatePlantNumber = useCallback(
    (
      perusahaan: CompanyName,
      menuType: MenuType,
      lokasi: string,
      nomorPetak: string,
      periode: string,
      nomorTanaman: number
    ): DuplicateCheckResult => {
      const cleanLoc = normalizeDisplayText(lokasi);
      const cleanPetak = normalizeDisplayText(nomorPetak);
      if (!cleanLoc || !nomorTanaman || nomorTanaman < 1) {
        return { isDuplicate: false };
      }
      const companyKey = getCompanyKey(perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const petakKey =
        menuType === 'SENSUS' ? 'SENSUS' : makeSafeKey(cleanPetak || 'PETAK');
      const targetId = buildPlantRecordId(
        companyKey,
        menuType,
        lokasiKey,
        petakKey,
        periode,
        nomorTanaman
      );

      const match = allRecords.find((r) => r.id === targetId);
      if (match) {
        const ruleDesc =
          menuType === 'SENSUS'
            ? `di ${perusahaan} · lokasi "${match.lokasi}"`
            : `di ${perusahaan} · lokasi "${match.lokasi}", Petak "${match.nomorPetak}", periode ${match.periode}`;
        return {
          isDuplicate: true,
          existingRecord: match,
          reason: `Nomor tanaman #${nomorTanaman} sudah terdaftar ${ruleDesc} oleh ${match.namaPetugas}.`,
        };
      }
      return { isDuplicate: false };
    },
    [allRecords]
  );

  const getNextSuggestedPlantNumber = useCallback(
    (
      perusahaan: CompanyName,
      menuType: MenuType,
      lokasi: string,
      nomorPetak: string,
      periode: string
    ): number => {
      const rStart = profile?.rangeStart ?? null;
      const rEnd = profile?.rangeEnd ?? null;
      const hasRange =
        typeof rStart === 'number' &&
        typeof rEnd === 'number' &&
        rStart >= 1 &&
        rEnd >= rStart;

      const cleanLoc = normalizeDisplayText(lokasi);
      if (!cleanLoc) return hasRange ? rStart : 1;

      const companyKey = getCompanyKey(perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const cleanPetak = normalizeDisplayText(nomorPetak);
      const petakKey = cleanPetak ? makeSafeKey(cleanPetak) : '';

      const matching = allRecords.filter((r) => {
        if (
          r.companyKey !== companyKey ||
          r.menuType !== menuType ||
          r.lokasiKey !== lokasiKey
        ) {
          return false;
        }
        if (menuType === 'SENSUS') return true;
        if (!petakKey) return false;
        return r.petakKey === petakKey && r.periode === periode;
      });

      if (hasRange) {
        const usedSet = new Set(matching.map((m) => m.nomorTanaman));
        const inRangeMax = matching
          .filter((m) => m.nomorTanaman >= rStart && m.nomorTanaman <= rEnd)
          .reduce((max, r) => (r.nomorTanaman > max ? r.nomorTanaman : max), 0);
        if (inRangeMax === 0) return rStart;
        for (let candidate = inRangeMax + 1; candidate <= rEnd; candidate++) {
          if (!usedSet.has(candidate)) return candidate;
        }
        for (let candidate = rStart; candidate <= rEnd; candidate++) {
          if (!usedSet.has(candidate)) return candidate;
        }
        return rEnd + 1;
      }

      if (matching.length === 0) return 1;
      const maxNum = matching.reduce(
        (max, r) => (r.nomorTanaman > max ? r.nomorTanaman : max),
        0
      );
      return maxNum + 1;
    },
    [allRecords, profile?.rangeStart, profile?.rangeEnd]
  );

  const getFieldConditionFor = useCallback(
    (
      perusahaan: CompanyName,
      menuType: 'MONITORING_IPPKH' | 'MONITORING_APL',
      lokasi: string,
      periode: string
    ) => {
      const cleanLoc = normalizeDisplayText(lokasi);
      if (!cleanLoc) return undefined;
      const companyKey = getCompanyKey(perusahaan);
      const id = buildFieldConditionId(
        companyKey,
        menuType,
        makeSafeKey(cleanLoc),
        periode
      );
      return fieldConditions.find((fc) => fc.id === id);
    },
    [fieldConditions]
  );

  const getCanopyCoverFor = useCallback(
    (
      perusahaan: CompanyName,
      lokasi: string,
      nomorPetak: string,
      periode: string
    ) => {
      const cleanLoc = normalizeDisplayText(lokasi);
      const cleanPetak = normalizeDisplayText(nomorPetak);
      if (!cleanLoc || !cleanPetak) return undefined;
      const companyKey = getCompanyKey(perusahaan);
      const id = buildCanopyCoverId(
        companyKey,
        makeSafeKey(cleanLoc),
        makeSafeKey(cleanPetak),
        periode
      );
      return canopyCovers.find((cc) => cc.id === id);
    },
    [canopyCovers]
  );

  const saveFieldCondition = useCallback(
    async (
      input: UpsertFieldConditionInput
    ): Promise<{ savedOffline: boolean }> => {
      if (!profile) throw new Error('Pengguna belum masuk.');
      if (!matchesUserCompany(input.perusahaan)) {
        throw new Error(
          `Akses dibatasi: akun Anda hanya ditugaskan untuk ${profile.assignedCompany}.`
        );
      }
      const cleanLoc = normalizeDisplayText(input.lokasi).slice(0, 100);
      const companyKey = getCompanyKey(input.perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const id = buildFieldConditionId(
        companyKey,
        input.menuType,
        lokasiKey,
        input.periode
      );
      const jumlahBangunan =
        input.bangunanKonservasi === 'Ada'
          ? Math.max(1, Math.min(10000, Math.round(input.jumlahBangunan)))
          : 0;
      const actorUid = auth.currentUser?.uid || profile.uid;
      const cleanPetugas = (
        normalizeDisplayText(input.namaPetugas || profile.name || 'Petugas') ||
        'Petugas'
      ).slice(0, 100);

      const fcRecord: FieldCondition = {
        id,
        perusahaan: input.perusahaan,
        companyKey,
        menuType: input.menuType,
        lokasi: cleanLoc,
        lokasiKey,
        periode: input.periode,
        coverCrop: input.coverCrop,
        bangunanKonservasi: input.bangunanKonservasi,
        jumlahBangunan,
        namaPetugas: cleanPetugas,
        latitude: sanitizeOptNum(input.latitude, -90, 90),
        longitude: sanitizeOptNum(input.longitude, -180, 180),
        horizontalAccuracyM: sanitizeOptNum(input.horizontalAccuracyM, 0, 100000),
        verticalAccuracyM: sanitizeOptNum(input.verticalAccuracyM, 0, 100000),
        photoDataUrl: sanitizePhotoUrl(input.photoDataUrl),
        createdByUid: actorUid,
        updatedByUid: actorUid,
        syncStatus: 'pending',
      };

      const queueOffline = () => {
        mutateQueue((prev) => ({
          ...prev,
          fieldConditions: [
            ...prev.fieldConditions.filter((x) => x.id !== id),
            fcRecord,
          ],
        }));
      };

      if (!isOnline) {
        queueOffline();
        return { savedOffline: true };
      }

      const writeFieldConditionToFirestore = async (): Promise<{
        savedOffline: boolean;
      }> => {
        await ensureLocationDoc(input.perusahaan, cleanLoc);
        const fcRef = doc(firestore, 'field_conditions', id);
        const existing = await getDoc(fcRef);
        if (!existing.exists()) {
          await setDoc(fcRef, {
            perusahaan: input.perusahaan,
            companyKey,
            menuType: input.menuType,
            lokasi: cleanLoc,
            lokasiKey,
            periode: input.periode,
            coverCrop: input.coverCrop,
            bangunanKonservasi: input.bangunanKonservasi,
            jumlahBangunan,
            namaPetugas: fcRecord.namaPetugas,
            latitude: fcRecord.latitude,
            longitude: fcRecord.longitude,
            horizontalAccuracyM: fcRecord.horizontalAccuracyM,
            verticalAccuracyM: fcRecord.verticalAccuracyM,
            photoDataUrl: fcRecord.photoDataUrl,
            createdByUid: actorUid,
            updatedByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(fcRef, {
            lokasi: cleanLoc,
            coverCrop: input.coverCrop,
            bangunanKonservasi: input.bangunanKonservasi,
            jumlahBangunan,
            namaPetugas: fcRecord.namaPetugas,
            latitude: fcRecord.latitude,
            longitude: fcRecord.longitude,
            horizontalAccuracyM: fcRecord.horizontalAccuracyM,
            verticalAccuracyM: fcRecord.verticalAccuracyM,
            photoDataUrl: fcRecord.photoDataUrl,
            updatedByUid: actorUid,
            updatedAt: serverTimestamp(),
          });
        }

        const nextConds = [
          ...snapshotDataRef.current.fieldConditions.filter((x) => x.id !== id),
          { ...fcRecord, syncStatus: 'synced' as const },
        ];
        setServerFieldConditions(nextConds);
        persistSnapshotPatch({ fieldConditions: nextConds });
        return { savedOffline: false };
      };

      try {
        return await writeFieldConditionToFirestore();
      } catch (err) {
        if (isLikelyOfflineError(err)) {
          queueOffline();
          return { savedOffline: true };
        }
        if (isFirestorePermissionError(err)) {
          await auth.currentUser?.getIdToken(true).catch(() => null);
          const syncedProfile = await syncProfileSilently();
          if (syncedProfile && syncedProfile.active) {
            try {
              return await writeFieldConditionToFirestore();
            } catch (retryErr) {
              if (isLikelyOfflineError(retryErr)) {
                queueOffline();
                return { savedOffline: true };
              }
              handleFirestoreError(
                retryErr,
                OperationType.WRITE,
                `field_conditions/${id}`
              );
            }
          }
        }
        handleFirestoreError(err, OperationType.WRITE, `field_conditions/${id}`);
      }
    },
    [
      profile,
      isOnline,
      mutateQueue,
      ensureLocationDoc,
      matchesUserCompany,
      persistSnapshotPatch,
      syncProfileSilently,
    ]
  );

  const saveCanopyCover = useCallback(
    async (input: UpsertCanopyInput): Promise<{ savedOffline: boolean }> => {
      if (!profile) throw new Error('Pengguna belum masuk.');
      if (!matchesUserCompany(input.perusahaan)) {
        throw new Error(
          `Akses dibatasi: akun Anda hanya ditugaskan untuk ${profile.assignedCompany}.`
        );
      }
      const cleanLoc = normalizeDisplayText(input.lokasi).slice(0, 100);
      const cleanPetak = normalizeDisplayText(input.nomorPetak).slice(0, 50);
      const companyKey = getCompanyKey(input.perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const petakKey = makeSafeKey(cleanPetak);
      const id = buildCanopyCoverId(
        companyKey,
        lokasiKey,
        petakKey,
        input.periode
      );
      const actorUid = auth.currentUser?.uid || profile.uid;
      const cleanPetugas = (
        normalizeDisplayText(input.namaPetugas || profile.name || 'Petugas') ||
        'Petugas'
      ).slice(0, 100);

      const canopyRec: CanopyCover = {
        id,
        perusahaan: input.perusahaan,
        companyKey,
        menuType: 'MONITORING_APL',
        lokasi: cleanLoc,
        lokasiKey,
        nomorPetak: cleanPetak,
        petakKey,
        periode: input.periode,
        penutupanTajuk: input.penutupanTajuk,
        namaPetugas: cleanPetugas,
        createdByUid: actorUid,
        updatedByUid: actorUid,
        syncStatus: 'pending',
      };

      const queueOffline = () => {
        mutateQueue((prev) => ({
          ...prev,
          canopyCovers: [
            ...prev.canopyCovers.filter((x) => x.id !== id),
            canopyRec,
          ],
        }));
      };

      if (!isOnline) {
        queueOffline();
        return { savedOffline: true };
      }

      const writeCanopyToFirestore = async (): Promise<{
        savedOffline: boolean;
      }> => {
        const ccRef = doc(firestore, 'canopy_covers', id);
        const existing = await getDoc(ccRef);
        if (!existing.exists()) {
          await setDoc(ccRef, {
            perusahaan: input.perusahaan,
            companyKey,
            menuType: 'MONITORING_APL',
            lokasi: cleanLoc,
            lokasiKey,
            nomorPetak: cleanPetak,
            petakKey,
            periode: input.periode,
            penutupanTajuk: input.penutupanTajuk,
            namaPetugas: canopyRec.namaPetugas,
            createdByUid: actorUid,
            updatedByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ccRef, {
            lokasi: cleanLoc,
            nomorPetak: cleanPetak,
            penutupanTajuk: input.penutupanTajuk,
            namaPetugas: canopyRec.namaPetugas,
            updatedByUid: actorUid,
            updatedAt: serverTimestamp(),
          });
        }
        const nextCanopies = [
          ...snapshotDataRef.current.canopyCovers.filter((x) => x.id !== id),
          { ...canopyRec, syncStatus: 'synced' as const },
        ];
        setServerCanopyCovers(nextCanopies);
        persistSnapshotPatch({ canopyCovers: nextCanopies });
        return { savedOffline: false };
      };

      try {
        return await writeCanopyToFirestore();
      } catch (err) {
        if (isLikelyOfflineError(err)) {
          queueOffline();
          return { savedOffline: true };
        }
        if (isFirestorePermissionError(err)) {
          await auth.currentUser?.getIdToken(true).catch(() => null);
          const syncedProfile = await syncProfileSilently();
          if (syncedProfile && syncedProfile.active) {
            try {
              return await writeCanopyToFirestore();
            } catch (retryErr) {
              if (isLikelyOfflineError(retryErr)) {
                queueOffline();
                return { savedOffline: true };
              }
              handleFirestoreError(
                retryErr,
                OperationType.WRITE,
                `canopy_covers/${id}`
              );
            }
          }
        }
        handleFirestoreError(err, OperationType.WRITE, `canopy_covers/${id}`);
      }
    },
    [
      profile,
      isOnline,
      mutateQueue,
      matchesUserCompany,
      persistSnapshotPatch,
      syncProfileSilently,
    ]
  );

  const savePlantRecord = useCallback(
    async (
      input: CreatePlantInput
    ): Promise<{ savedOffline: boolean; record: PlantRecord }> => {
      if (!profile) throw new Error('Pengguna belum masuk.');
      if (!matchesUserCompany(input.perusahaan)) {
        throw new Error(
          `Akses dibatasi: akun Anda hanya ditugaskan untuk ${profile.assignedCompany}.`
        );
      }

      const cleanLoc = normalizeDisplayText(input.lokasi).slice(0, 100);
      const cleanPetak =
        input.menuType === 'SENSUS'
          ? ''
          : normalizeDisplayText(input.nomorPetak).slice(0, 50);
      const cleanPetugas = (
        normalizeDisplayText(input.namaPetugas || profile.name || 'Petugas') ||
        'Petugas'
      ).slice(0, 100);
      const cleanJenis = (
        normalizeDisplayText(input.jenisTanaman) || 'Lainnya'
      ).slice(0, 100);
      const cleanGnssSource = input.gnssSource
        ? input.gnssSource.trim().slice(0, 120)
        : null;
      const cleanCoordCrs = (input.coordCrs ?? 'EPSG:4326').trim().slice(0, 40);
      const periode = extractPeriode(input.tanggalInput);
      const companyKey = getCompanyKey(input.perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const petakKey =
        input.menuType === 'SENSUS' ? 'SENSUS' : makeSafeKey(cleanPetak);
      const safeNomor = Math.max(
        1,
        Math.min(9999999, Math.round(Number(input.nomorTanaman) || 1))
      );

      const dup = checkDuplicatePlantNumber(
        input.perusahaan,
        input.menuType,
        cleanLoc,
        cleanPetak,
        periode,
        safeNomor
      );
      if (dup.isDuplicate) {
        throw new Error(dup.reason || 'Nomor tanaman sudah terdaftar.');
      }

      const id = buildPlantRecordId(
        companyKey,
        input.menuType,
        lokasiKey,
        petakKey,
        periode,
        safeNomor
      );

      const tinggiVal =
        input.kondisiTanaman === 'Mati'
          ? 0
          : clampFiniteMetric(input.tinggiCm, 0.1, 15000, 1);
      const diameterVal =
        input.kondisiTanaman === 'Mati'
          ? 0
          : clampFiniteMetric(input.diameterMm, 0.1, 5000, 1);
      const actorUid = auth.currentUser?.uid || profile.uid;
      const actorEmail =
        (auth.currentUser?.email || profile.email || '')
          .trim()
          .toLowerCase()
          .slice(0, 150) || 'petugas@silvitrack.local';
      const safeWaktu = sanitizeWaktuInput(input.waktuInput);

      const record: PlantRecord = {
        id,
        perusahaan: input.perusahaan,
        companyKey,
        menuType: input.menuType,
        tanggalInput: input.tanggalInput,
        waktuInput: safeWaktu ?? undefined,
        periode,
        lokasi: cleanLoc,
        lokasiKey,
        namaPetugas: cleanPetugas,
        nomorPetak: cleanPetak,
        petakKey,
        nomorTanaman: safeNomor,
        kelompokTanaman: input.kelompokTanaman,
        jenisTanaman: cleanJenis,
        tinggiCm: tinggiVal,
        diameterMm: diameterVal,
        kondisiTanaman: input.kondisiTanaman,
        keterangan: input.keterangan.trim().slice(0, 500),
        extremeConfirmed: input.extremeConfirmed,
        latitude: sanitizeOptNum(input.latitude, -90, 90),
        longitude: sanitizeOptNum(input.longitude, -180, 180),
        altitudeM: sanitizeOptNum(input.altitudeM, -500, 10000),
        horizontalAccuracyM: sanitizeOptNum(input.horizontalAccuracyM, 0, 100000),
        verticalAccuracyM: sanitizeOptNum(input.verticalAccuracyM, 0, 100000),
        gnssSource: cleanGnssSource,
        gnssOverrideReason: input.gnssOverrideReason
          ? input.gnssOverrideReason.trim().slice(0, 250)
          : null,
        coordCrs: cleanCoordCrs,
        photoDataUrl: sanitizePhotoUrl(input.photoDataUrl),
        createdByUid: actorUid,
        createdByEmail: actorEmail,
        updatedByUid: actorUid,
        syncStatus: 'pending',
      };

      const queueOffline = () => {
        autoRetryCountRef.current = 0;
        mutateQueue((prev) => ({
          ...prev,
          plantRecords: [
            ...prev.plantRecords.filter((x) => x.id !== id),
            record,
          ],
        }));
      };

      if (!isOnline) {
        queueOffline();
        return { savedOffline: true, record };
      }

      const writeRecordToFirestore = async () => {
        const recRef = doc(firestore, 'plant_records', id);
        let existingSnap;
        try {
          existingSnap = await getDoc(recRef);
        } catch (getErr) {
          handleFirestoreError(getErr, OperationType.GET, `plant_records/${id}`);
        }
        if (existingSnap.exists()) {
          const existingData = existingSnap.data();
          throw new Error(
            `Nomor tanaman #${record.nomorTanaman} sudah lebih dulu diinput oleh ${String(
              existingData.namaPetugas || 'petugas lain'
            )}.`
          );
        }

        const ensuredLoc = await ensureLocationDoc(input.perusahaan, cleanLoc);
        try {
          await setDoc(recRef, {
            perusahaan: record.perusahaan,
            companyKey: record.companyKey,
            menuType: record.menuType,
            tanggalInput: record.tanggalInput,
            waktuInput: safeWaktu,
            periode: record.periode,
            lokasi: record.lokasi,
            lokasiKey: record.lokasiKey,
            namaPetugas: record.namaPetugas,
            nomorPetak: record.nomorPetak,
            petakKey: record.petakKey,
            nomorTanaman: record.nomorTanaman,
            kelompokTanaman: record.kelompokTanaman,
            jenisTanaman: record.jenisTanaman,
            tinggiCm: record.tinggiCm,
            diameterMm: record.diameterMm,
            kondisiTanaman: record.kondisiTanaman,
            keterangan: record.keterangan,
            extremeConfirmed: record.extremeConfirmed,
            latitude: record.latitude,
            longitude: record.longitude,
            altitudeM: record.altitudeM,
            horizontalAccuracyM: record.horizontalAccuracyM,
            verticalAccuracyM: record.verticalAccuracyM,
            gnssSource: record.gnssSource,
            gnssOverrideReason: record.gnssOverrideReason,
            coordCrs: record.coordCrs,
            photoDataUrl: record.photoDataUrl,
            sheetSyncedAt: null,
            createdByUid: actorUid,
            createdByEmail: actorEmail,
            updatedByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (setErr) {
          handleFirestoreError(
            setErr,
            OperationType.CREATE,
            `plant_records/${id}`
          );
        }

        const syncedRec: PlantRecord = { ...record, syncStatus: 'synced' };
        const nextRecords = [
          syncedRec,
          ...snapshotDataRef.current.records.filter((x) => x.id !== id),
        ];
        setServerRecords(nextRecords);
        let nextLocs = snapshotDataRef.current.locations;
        if (
          ensuredLoc &&
          !snapshotDataRef.current.locations.some((l) => l.id === ensuredLoc.id)
        ) {
          nextLocs = [...snapshotDataRef.current.locations, ensuredLoc];
          setServerLocations(nextLocs);
        }
        persistSnapshotPatch({ records: nextRecords, locations: nextLocs });
        return { savedOffline: false, record: syncedRec };
      };

      try {
        return await writeRecordToFirestore();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (
          msg.includes('sudah lebih dulu diinput') ||
          msg.includes('duplikat')
        ) {
          throw err;
        }
        if (isLikelyOfflineError(err)) {
          queueOffline();
          return { savedOffline: true, record };
        }
        // Self-heal if auth token or users/{uid} was out-of-sync, then retry once
        if (isFirestorePermissionError(err)) {
          await auth.currentUser?.getIdToken(true).catch(() => null);
          const syncedProfile = await syncProfileSilently();
          if (syncedProfile && syncedProfile.active) {
            try {
              return await writeRecordToFirestore();
            } catch (retryErr) {
              if (isLikelyOfflineError(retryErr)) {
                queueOffline();
                return { savedOffline: true, record };
              }
              throw retryErr;
            }
          }
        }
        throw err;
      }
    },
    [
      profile,
      isOnline,
      checkDuplicatePlantNumber,
      mutateQueue,
      ensureLocationDoc,
      matchesUserCompany,
      persistSnapshotPatch,
      syncProfileSilently,
    ]
  );

  const fetchPaginatedRecords = useCallback(
    async (params: PaginatedRecordsParams): Promise<PaginatedRecordsResult> => {
      const q = params.search.trim().toLowerCase();
      const filtered = allRecords.filter((r) => {
        if (params.company !== 'ALL' && r.perusahaan !== params.company)
          return false;
        if (params.menuType !== 'ALL' && r.menuType !== params.menuType)
          return false;
        if (params.lokasiKey !== 'ALL' && r.lokasiKey !== params.lokasiKey)
          return false;
        if (params.periode !== 'ALL' && r.periode !== params.periode)
          return false;
        if (params.kondisi !== 'ALL' && r.kondisiTanaman !== params.kondisi)
          return false;
        if (q) {
          const hay =
            `${r.perusahaan} ${r.nomorTanaman} ${r.lokasi} ${r.nomorPetak} ${r.jenisTanaman} ${r.namaPetugas} ${r.keterangan}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const periodes = Array.from(
        new Set(allRecords.map((r) => r.periode))
      ).sort((a, b) => b.localeCompare(a));
      const start = (params.page - 1) * params.limit;
      return {
        records: filtered.slice(start, start + params.limit),
        total: filtered.length,
        page: params.page,
        limit: params.limit,
        periodes,
      };
    },
    [allRecords]
  );

  const resolveConflictChangeNumber = useCallback(
    (oldId: string, newNomor: number) => {
      autoRetryCountRef.current = 0;
      mutateQueue((prev) => {
        const target = prev.plantRecords.find((r) => r.id === oldId);
        if (!target) return prev;
        const perusahaan = resolveCompanyName(target.perusahaan);
        const companyKey = target.companyKey || getCompanyKey(perusahaan);
        const newId = buildPlantRecordId(
          companyKey,
          target.menuType,
          target.lokasiKey,
          target.petakKey,
          target.periode,
          newNomor
        );
        return {
          ...prev,
          plantRecords: prev.plantRecords.map((r) =>
            r.id === oldId
              ? {
                  ...r,
                  id: newId,
                  perusahaan,
                  companyKey,
                  nomorTanaman: newNomor,
                  syncStatus: 'pending',
                  syncError: undefined,
                }
              : r
          ),
        };
      });
    },
    [mutateQueue]
  );

  const discardPendingRecord = useCallback(
    (recordId: string) => {
      mutateQueue((prev) => ({
        ...prev,
        plantRecords: prev.plantRecords.filter((r) => r.id !== recordId),
      }));
    },
    [mutateQueue]
  );

  const exportOfflineBackup = useCallback(() => {
    exportOfflineQueueBackup(queueRef.current);
  }, []);

  const exportTodayBackup = useCallback(async () => {
    const payload = buildTodayBackupPayload({
      officerEmail: profile?.email || '',
      allRecords,
      fieldConditions,
      canopyCovers,
    });
    return exportTodayBackupFile(payload);
  }, [profile?.email, allRecords, fieldConditions, canopyCovers]);

  const adminUpdateRecord = useCallback(
    async (
      recordId: string,
      updates: Partial<
        Pick<
          PlantRecord,
          | 'perusahaan'
          | 'tanggalInput'
          | 'lokasi'
          | 'namaPetugas'
          | 'nomorPetak'
          | 'nomorTanaman'
          | 'kelompokTanaman'
          | 'jenisTanaman'
          | 'tinggiCm'
          | 'diameterMm'
          | 'kondisiTanaman'
          | 'keterangan'
          | 'extremeConfirmed'
        >
      >
    ) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat mengubah data.');
      }
      const recRef = doc(firestore, 'plant_records', recordId);
      try {
        const snap = await getDoc(recRef);
        if (!snap.exists()) {
          throw new Error('Data tanaman tidak ditemukan.');
        }
        const curr = snap.data();
        const perusahaan = resolveCompanyName(
          String(updates.perusahaan ?? curr.perusahaan)
        );
        const companyKey = getCompanyKey(perusahaan);
        const tanggalInput = String(updates.tanggalInput ?? curr.tanggalInput);
        const periode = extractPeriode(tanggalInput);
        const lokasi = normalizeDisplayText(
          String(updates.lokasi ?? curr.lokasi)
        );
        const lokasiKey = makeSafeKey(lokasi);
        const menuType = curr.menuType as MenuType;
        const nomorPetak =
          menuType === 'SENSUS'
            ? ''
            : normalizeDisplayText(
                String(updates.nomorPetak ?? curr.nomorPetak)
              );
        const petakKey =
          menuType === 'SENSUS' ? 'SENSUS' : makeSafeKey(nomorPetak);
        const kondisiTanaman = (updates.kondisiTanaman ??
          curr.kondisiTanaman) as PlantCondition;
        const tinggiCm =
          kondisiTanaman === 'Mati'
            ? 0
            : Number(updates.tinggiCm ?? curr.tinggiCm);
        const diameterMm =
          kondisiTanaman === 'Mati'
            ? 0
            : Number(updates.diameterMm ?? curr.diameterMm);

        const patch = {
          perusahaan,
          companyKey,
          tanggalInput,
          periode,
          lokasi,
          lokasiKey,
          namaPetugas: normalizeDisplayText(
            String(updates.namaPetugas ?? curr.namaPetugas)
          ),
          nomorPetak,
          petakKey,
          nomorTanaman: Number(updates.nomorTanaman ?? curr.nomorTanaman),
          kelompokTanaman: (updates.kelompokTanaman ??
            curr.kelompokTanaman) as PlantGroup,
          jenisTanaman: String(updates.jenisTanaman ?? curr.jenisTanaman),
          tinggiCm,
          diameterMm,
          kondisiTanaman,
          keterangan: String(updates.keterangan ?? curr.keterangan ?? '')
            .trim()
            .slice(0, 500),
          extremeConfirmed: Boolean(
            updates.extremeConfirmed ?? curr.extremeConfirmed
          ),
          updatedByUid: profile.uid,
          updatedAt: serverTimestamp(),
        };

        await updateDoc(recRef, patch);

        const nextRecords = snapshotDataRef.current.records.map((r) =>
          r.id === recordId
            ? {
                ...r,
                ...patch,
                updatedAt: new Date().toISOString(),
              }
            : r
        );
        setServerRecords(nextRecords);
        persistSnapshotPatch({ records: nextRecords });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `plant_records/${recordId}`
        );
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminDeleteRecord = useCallback(
    async (recordId: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat menghapus data.');
      }
      try {
        await deleteDoc(doc(firestore, 'plant_records', recordId));
        const nextRecords = snapshotDataRef.current.records.filter(
          (r) => r.id !== recordId
        );
        setServerRecords(nextRecords);
        persistSnapshotPatch({ records: nextRecords });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.DELETE,
          `plant_records/${recordId}`
        );
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminAddStaff = useCallback(
    async (
      email: string,
      name: string,
      role: UserRole,
      assignedCompany: AssignedCompany,
      rangeStart?: number | null,
      rangeEnd?: number | null
    ) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat menambah petugas.');
      }
      const emailLower = email.trim().toLowerCase();
      const cleanName = normalizeDisplayText(name);
      if (!emailLower || !emailLower.includes('@')) {
        throw new Error('Email Google tidak valid.');
      }
      if (!cleanName) {
        throw new Error('Nama petugas wajib diisi.');
      }
      const targetCompany: AssignedCompany = assignedCompany || 'ALL';
      if (role === 'petugas' && targetCompany === 'ALL') {
        throw new Error(
          'Petugas lapangan wajib ditugaskan ke satu perusahaan tertentu (bukan Semua PT) agar isolasi data terjaga.'
        );
      }
      const duplicate = staffList.find(
        (s) => s.email.toLowerCase() === emailLower
      );
      if (duplicate) {
        throw new Error(`Email ${emailLower} sudah terdaftar.`);
      }

      const staffId = `staff_${makeSafeKey(emailLower, 36)}`;
      const staffRef = doc(firestore, 'staff_whitelist', staffId);
      try {
        await setDoc(staffRef, {
          email: emailLower,
          name: cleanName.slice(0, 100),
          role,
          assignedCompany: targetCompany,
          rangeStart: rangeStart ?? null,
          rangeEnd: rangeEnd ?? null,
          active: true,
          createdByUid: profile.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const added: StaffMember = {
          id: staffId,
          email: emailLower,
          name: cleanName.slice(0, 100),
          role,
          assignedCompany: assignedCompany || 'ALL',
          rangeStart: rangeStart ?? null,
          rangeEnd: rangeEnd ?? null,
          active: true,
          createdByUid: profile.uid,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setStaffList((prev) => [
          ...prev.filter((s) => s.id !== staffId),
          added,
        ]);
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `staff_whitelist/${staffId}`
        );
      }
    },
    [profile, staffList]
  );

  const adminUpdateStaff = useCallback(
    async (
      staffId: string,
      updates: {
        name: string;
        role: UserRole;
        assignedCompany: AssignedCompany;
        rangeStart?: number | null;
        rangeEnd?: number | null;
        active: boolean;
      }
    ) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat memperbarui petugas.');
      }
      if (staffId === 'bootstrap_admin' && (!updates.active || updates.role !== 'admin')) {
        throw new Error(
          'Akun Administrator utama tidak dapat dinonaktifkan atau diturunkan.'
        );
      }
      const targetCompany: AssignedCompany = updates.assignedCompany || 'ALL';
      if (updates.role === 'petugas' && updates.active && targetCompany === 'ALL') {
        throw new Error(
          'Petugas aktif wajib ditugaskan ke satu perusahaan tertentu agar isolasi data terjaga.'
        );
      }
      const cleanName = normalizeDisplayText(updates.name).slice(0, 100);
      const staffRef = doc(firestore, 'staff_whitelist', staffId);
      try {
        const staffSnap = await getDoc(staffRef);
        const staffEmail = String(staffSnap.data()?.email || '')
          .trim()
          .toLowerCase();

        await updateDoc(staffRef, {
          name: cleanName,
          role: updates.role,
          assignedCompany: targetCompany,
          rangeStart: updates.rangeStart ?? null,
          rangeEnd: updates.rangeEnd ?? null,
          active: updates.active,
          updatedAt: serverTimestamp(),
        });

        // Sync linked users & admins documents by BOTH staffId and email so transfers/promotions never go stale
        const byStaffIdSnap = await getDocs(
          query(collection(firestore, 'users'), where('staffId', '==', staffId))
        );
        const userDocsMap = new Map(byStaffIdSnap.docs.map((d) => [d.id, d]));
        if (staffEmail) {
          const byEmailSnap = await getDocs(
            query(
              collection(firestore, 'users'),
              where('email', '==', staffEmail)
            )
          );
          byEmailSnap.docs.forEach((d) => {
            if (!userDocsMap.has(d.id)) {
              userDocsMap.set(d.id, d);
            }
          });
        }

        for (const uDoc of userDocsMap.values()) {
          const uData = uDoc.data();
          await updateDoc(uDoc.ref, {
            name: cleanName,
            role: updates.role,
            assignedCompany: targetCompany,
            rangeStart: updates.rangeStart ?? null,
            rangeEnd: updates.rangeEnd ?? null,
            active: updates.active,
            staffId,
            updatedAt: serverTimestamp(),
          });
          const adminGrantRef = doc(firestore, 'admins', uDoc.id);
          const adminSnap = await getDoc(adminGrantRef);
          if (updates.role === 'admin' && updates.active) {
            if (!adminSnap.exists()) {
              await setDoc(adminGrantRef, {
                uid: uDoc.id,
                email: String(uData.email || staffEmail || ''),
                staffId,
                createdAt: serverTimestamp(),
              });
            }
          } else if (adminSnap.exists() && uDoc.id !== profile.uid) {
            await deleteDoc(adminGrantRef);
          }
        }

        setStaffList((prev) =>
          prev.map((s) =>
            s.id === staffId
              ? {
                  ...s,
                  name: cleanName,
                  role: updates.role,
                  assignedCompany: targetCompany,
                  rangeStart: updates.rangeStart ?? null,
                  rangeEnd: updates.rangeEnd ?? null,
                  active: updates.active,
                  updatedAt: new Date().toISOString(),
                }
              : s
          )
        );
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `staff_whitelist/${staffId}`
        );
      }
    },
    [profile]
  );

  const adminDeleteStaff = useCallback(
    async (staffId: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat menghapus petugas.');
      }
      if (staffId === 'bootstrap_admin' || staffId === profile.staffId) {
        throw new Error(
          'Akun Administrator yang sedang aktif tidak dapat dihapus.'
        );
      }
      try {
        const [linkedUsers, linkedAdmins] = await Promise.all([
          getDocs(
            query(collection(firestore, 'users'), where('staffId', '==', staffId))
          ),
          getDocs(
            query(collection(firestore, 'admins'), where('staffId', '==', staffId))
          ),
        ]);
        const batch = writeBatch(firestore);
        batch.delete(doc(firestore, 'staff_whitelist', staffId));
        linkedUsers.docs.forEach((d) => batch.delete(d.ref));
        linkedAdmins.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        setStaffList((prev) => prev.filter((s) => s.id !== staffId));
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.DELETE,
          `staff_whitelist/${staffId}`
        );
      }
    },
    [profile]
  );

  const adminResetAllStaff = useCallback(async () => {
    if (!profile || profile.role !== 'admin') {
      throw new Error('Hanya Administrator yang dapat mereset akun.');
    }
    try {
      const [wlSnap, usrSnap, admSnap] = await Promise.all([
        getDocs(collection(firestore, 'staff_whitelist')),
        getDocs(collection(firestore, 'users')),
        getDocs(collection(firestore, 'admins')),
      ]);
      const refsToDelete = [
        ...wlSnap.docs
          .filter((d) => d.id !== 'bootstrap_admin' && d.id !== profile.staffId)
          .map((d) => d.ref),
        ...usrSnap.docs
          .filter((d) => d.id !== profile.uid)
          .map((d) => d.ref),
        ...admSnap.docs
          .filter((d) => d.id !== profile.uid)
          .map((d) => d.ref),
      ];
      for (let i = 0; i < refsToDelete.length; i += 400) {
        const batch = writeBatch(firestore);
        refsToDelete.slice(i, i + 400).forEach((r) => batch.delete(r));
        await batch.commit();
      }
      await refreshData(true);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'staff_whitelist');
    }
  }, [profile, refreshData]);

  // Master Data CRUD
  const adminAddLocation = useCallback(
    async (perusahaan: CompanyName, name: string) => {
      if (!profile) throw new Error('Pengguna belum masuk.');
      const cleanName = normalizeDisplayText(name);
      if (!cleanName) throw new Error('Nama lokasi wajib diisi.');
      try {
        const created = await ensureLocationDoc(perusahaan, cleanName);
        if (created) {
          const nextLocs = [
            ...snapshotDataRef.current.locations.filter(
              (l) => l.id !== created.id
            ),
            created,
          ];
          setServerLocations(nextLocs);
          persistSnapshotPatch({ locations: nextLocs });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'locations_master');
      }
    },
    [profile, ensureLocationDoc, persistSnapshotPatch]
  );

  const adminDeleteLocation = useCallback(
    async (id: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat menghapus lokasi.');
      }
      try {
        await deleteDoc(doc(firestore, 'locations_master', id));
        const nextLocs = snapshotDataRef.current.locations.filter(
          (l) => l.id !== id
        );
        setServerLocations(nextLocs);
        persistSnapshotPatch({ locations: nextLocs });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.DELETE,
          `locations_master/${id}`
        );
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminAddPetak = useCallback(
    async (perusahaan: CompanyName, lokasi: string, name: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat menambah petak.');
      }
      const cleanLoc = normalizeDisplayText(lokasi);
      const cleanPetak = normalizeDisplayText(name);
      if (!cleanLoc || !cleanPetak) {
        throw new Error('Lokasi dan nama/nomor petak wajib diisi.');
      }
      const companyKey = getCompanyKey(perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const petakKey = makeSafeKey(cleanPetak);
      const id = buildPetakDocId(companyKey, lokasiKey, petakKey);
      try {
        const ensuredLoc = await ensureLocationDoc(perusahaan, cleanLoc);
        await setDoc(doc(firestore, 'petaks_master', id), {
          perusahaan,
          companyKey,
          lokasi: cleanLoc,
          lokasiKey,
          name: cleanPetak.slice(0, 50),
          petakKey,
          createdByUid: profile.uid,
          createdAt: serverTimestamp(),
        });
        const created: PetakMaster = {
          id,
          perusahaan,
          companyKey,
          lokasi: cleanLoc,
          lokasiKey,
          name: cleanPetak.slice(0, 50),
          petakKey,
          createdByUid: profile.uid,
        };
        const nextPetaks = [
          ...snapshotDataRef.current.petaks.filter((p) => p.id !== id),
          created,
        ];
        setPetaks(nextPetaks);
        let nextLocs = snapshotDataRef.current.locations;
        if (ensuredLoc && !nextLocs.some((l) => l.id === ensuredLoc.id)) {
          nextLocs = [...nextLocs, ensuredLoc];
          setServerLocations(nextLocs);
        }
        persistSnapshotPatch({ petaks: nextPetaks, locations: nextLocs });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `petaks_master/${id}`);
      }
    },
    [profile, ensureLocationDoc, persistSnapshotPatch]
  );

  const adminDeletePetak = useCallback(
    async (id: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat menghapus petak.');
      }
      try {
        await deleteDoc(doc(firestore, 'petaks_master', id));
        const nextPetaks = snapshotDataRef.current.petaks.filter(
          (p) => p.id !== id
        );
        setPetaks(nextPetaks);
        persistSnapshotPatch({ petaks: nextPetaks });
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `petaks_master/${id}`);
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminAddSpecies = useCallback(
    async (
      perusahaan: CompanyName,
      kelompokTanaman: PlantGroup,
      name: string
    ) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat menambah jenis tanaman.'
        );
      }
      const cleanName = normalizeDisplayText(name).slice(0, 100);
      if (!cleanName) throw new Error('Nama jenis tanaman wajib diisi.');
      const companyKey = getCompanyKey(perusahaan);
      const speciesKey = makeSafeKey(cleanName);
      const id = buildSpeciesDocId(companyKey, kelompokTanaman, speciesKey);
      try {
        await setDoc(doc(firestore, 'species_master', id), {
          perusahaan,
          companyKey,
          kelompokTanaman,
          name: cleanName,
          speciesKey,
          active: true,
          createdByUid: profile.uid,
          createdAt: serverTimestamp(),
        });
        const created: SpeciesMaster = {
          id,
          perusahaan,
          companyKey,
          kelompokTanaman,
          name: cleanName,
          speciesKey,
          active: true,
          createdByUid: profile.uid,
        };
        const nextSpecies = [
          ...snapshotDataRef.current.species.filter((s) => s.id !== id),
          created,
        ];
        setSpecies(nextSpecies);
        persistSnapshotPatch({ species: nextSpecies });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `species_master/${id}`);
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminToggleSpecies = useCallback(
    async (id: string, active: boolean) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat mengubah status jenis tanaman.'
        );
      }
      try {
        await updateDoc(doc(firestore, 'species_master', id), { active });
        const nextSpecies = snapshotDataRef.current.species.map((s) =>
          s.id === id ? { ...s, active } : s
        );
        setSpecies(nextSpecies);
        persistSnapshotPatch({ species: nextSpecies });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `species_master/${id}`);
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminDeleteSpecies = useCallback(
    async (id: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat menghapus jenis tanaman.'
        );
      }
      try {
        await deleteDoc(doc(firestore, 'species_master', id));
        const nextSpecies = snapshotDataRef.current.species.filter(
          (s) => s.id !== id
        );
        setSpecies(nextSpecies);
        persistSnapshotPatch({ species: nextSpecies });
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `species_master/${id}`);
      }
    },
    [profile, persistSnapshotPatch]
  );

  // Google Spreadsheets
  const saveCompanySpreadsheet = useCallback(
    async (params: {
      perusahaan: CompanyName;
      spreadsheetId: string;
      spreadsheetUrl: string;
      ownerEmail: string;
      syncedRecordCount?: number;
    }): Promise<CompanySpreadsheet> => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat menautkan Spreadsheet.'
        );
      }
      const companyKey = getCompanyKey(params.perusahaan);
      const sheetRef = doc(firestore, 'company_spreadsheets', companyKey);
      try {
        const existing = await getDoc(sheetRef);
        const nowIso = new Date().toISOString();
        const syncedRecordCount = Number(params.syncedRecordCount || 0);
        if (!existing.exists()) {
          await setDoc(sheetRef, {
            companyKey,
            perusahaan: params.perusahaan,
            spreadsheetId: params.spreadsheetId,
            spreadsheetUrl: params.spreadsheetUrl,
            ownerEmail: params.ownerEmail || profile.email,
            lastSyncedAt: null,
            syncedRecordCount,
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(sheetRef, {
            spreadsheetId: params.spreadsheetId,
            spreadsheetUrl: params.spreadsheetUrl,
            ownerEmail: params.ownerEmail || profile.email,
            syncedRecordCount,
            updatedAt: serverTimestamp(),
          });
        }
        const result: CompanySpreadsheet = {
          companyKey,
          perusahaan: params.perusahaan,
          spreadsheetId: params.spreadsheetId,
          spreadsheetUrl: params.spreadsheetUrl,
          ownerEmail: params.ownerEmail || profile.email,
          lastSyncedAt: existing.exists()
            ? String(existing.data().lastSyncedAt || '') || null
            : null,
          syncedRecordCount,
          updatedAt: nowIso,
        };
        setCompanySpreadsheets((prev) => [
          ...prev.filter((s) => s.companyKey !== companyKey),
          result,
        ]);
        return result;
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.WRITE,
          `company_spreadsheets/${companyKey}`
        );
      }
    },
    [profile]
  );

  const syncCompanyToGoogleSheets = useCallback(
    async (
      perusahaan: CompanyName,
      accessToken: string
    ): Promise<{ syncedCount: number }> => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat menyinkronkan Google Spreadsheet.'
        );
      }
      const ck = getCompanyKey(perusahaan);
      const targetSheet = companySpreadsheets.find(
        (s) => s.companyKey === ck
      );
      if (!targetSheet) {
        throw new Error(
          `Spreadsheet untuk ${perusahaan} belum dibuat atau ditautkan.`
        );
      }

      const getEvalForSync = () => {
        const specific = evalSettings.find((e) => e.companyKey === ck);
        if (specific) return specific;
        const globalSet = evalSettings.find((e) => e.companyKey === 'ALL');
        return globalSet || DEFAULT_GROWTH_EVAL_SETTINGS;
      };
      const th = getEvalForSync();

      const { syncedCount } = await syncCompanyDataToSpreadsheet({
        accessToken,
        spreadsheetId: targetSheet.spreadsheetId,
        perusahaan,
        records: allRecords,
        fieldConditions,
        canopyCovers,
        thresholds: {
          enabled: th.enabled,
          minSurvivalPct: th.minSurvivalPct,
          minDeltaHeightCm: th.minDeltaHeightCm,
        },
      });

      const compRecordIds = allRecords
        .filter((r) => r.perusahaan === perusahaan && r.syncStatus === 'synced')
        .map((r) => r.id);

      const nowIso = new Date().toISOString();
      try {
        for (let i = 0; i < compRecordIds.length; i += 400) {
          const batch = writeBatch(firestore);
          compRecordIds.slice(i, i + 400).forEach((recId) => {
            batch.update(doc(firestore, 'plant_records', recId), {
              sheetSyncedAt: nowIso,
              updatedByUid: profile.uid,
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }

        await updateDoc(doc(firestore, 'company_spreadsheets', ck), {
          lastSyncedAt: nowIso,
          syncedRecordCount: syncedCount,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `company_spreadsheets/${ck}`
        );
      }

      setCompanySpreadsheets((prev) =>
        prev.map((s) =>
          s.companyKey === ck
            ? {
                ...s,
                lastSyncedAt: nowIso,
                syncedRecordCount: syncedCount,
              }
            : s
        )
      );

      return { syncedCount };
    },
    [
      profile,
      companySpreadsheets,
      allRecords,
      fieldConditions,
      canopyCovers,
      evalSettings,
    ]
  );

  // Base Maps (with chunked storage for payloads > 450k chars)
  const adminUploadBaseMap = useCallback(
    async (params: {
      perusahaan: CompanyName;
      name: string;
      fileType: BaseMapFileType;
      crsCode: CoordCrsCode;
      fileDataBase64?: string | null;
      geoJsonText?: string | null;
      bboxJson?: string | null;
      labelEnabled?: boolean;
      labelAttributes?: string[];
      availableAttributes?: string[];
    }): Promise<BaseMapLayer> => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat mengunggah peta dasar.'
        );
      }
      const companyKey = getCompanyKey(params.perusahaan);
      const cleanName = normalizeDisplayText(params.name).slice(0, 120);
      const layerId = `map_${companyKey}_${Date.now().toString(36)}_${makeSafeKey(cleanName, 24)}`;

      const sanitizeAttrList = (list: string[] | undefined, max: number) =>
        Array.from(
          new Set(
            (list || [])
              .map((v) => String(v).trim().slice(0, 100))
              .filter((v) => v.length >= 1)
          )
        ).slice(0, max);

      const cleanAvailableAttrs = sanitizeAttrList(
        params.availableAttributes,
        100
      );
      const cleanLabelAttrs = sanitizeAttrList(params.labelAttributes, 15);
      const cleanLabelEnabled = Boolean(
        params.labelEnabled && cleanLabelAttrs.length > 0
      );

      const rawPayload =
        params.fileType === 'pdf'
          ? params.fileDataBase64 || ''
          : params.geoJsonText || '';
      const shouldChunk = rawPayload.length > BASE_MAP_CHUNK_SIZE;
      const chunks = shouldChunk
        ? sliceString(rawPayload, BASE_MAP_CHUNK_SIZE)
        : [];

      try {
        await setDoc(doc(firestore, 'base_map_layers', layerId), {
          perusahaan: params.perusahaan,
          companyKey,
          name: cleanName,
          fileType: params.fileType,
          crsCode: params.crsCode,
          fileDataBase64:
            params.fileType === 'pdf' && !shouldChunk
              ? params.fileDataBase64 || null
              : null,
          geoJsonText:
            params.fileType !== 'pdf' && !shouldChunk
              ? params.geoJsonText || null
              : null,
          bboxJson: params.bboxJson || null,
          chunkCount: chunks.length,
          labelEnabled: cleanLabelEnabled,
          labelAttributes: cleanLabelAttrs,
          availableAttributes: cleanAvailableAttrs,
          uploadedByUid: profile.uid,
          createdAt: serverTimestamp(),
        });

        for (let i = 0; i < chunks.length; i += 20) {
          const batch = writeBatch(firestore);
          chunks.slice(i, i + 20).forEach((slice, offset) => {
            const idx = i + offset;
            batch.set(
              doc(firestore, 'base_map_layers', layerId, 'chunks', `chunk_${idx}`),
              {
                index: idx,
                data: slice,
              }
            );
          });
          await batch.commit();
        }

        const layer: BaseMapLayer = {
          id: layerId,
          perusahaan: params.perusahaan,
          companyKey,
          name: cleanName,
          fileType: params.fileType,
          crsCode: params.crsCode,
          fileDataBase64: params.fileDataBase64 || null,
          geoJsonText: params.geoJsonText || null,
          bboxJson: params.bboxJson || null,
          chunkCount: chunks.length,
          labelEnabled: cleanLabelEnabled,
          labelAttributes: cleanLabelAttrs,
          availableAttributes: cleanAvailableAttrs,
          uploadedByUid: profile.uid,
          createdAt: new Date().toISOString(),
        };
        const nextBaseMaps = [layer, ...snapshotDataRef.current.baseMaps];
        setBaseMaps(nextBaseMaps);
        persistSnapshotPatch({ baseMaps: nextBaseMaps });
        return layer;
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `base_map_layers/${layerId}`
        );
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminUpdateBaseMapLabels = useCallback(
    async (
      id: string,
      labelEnabled: boolean,
      labelAttributes: string[]
    ): Promise<void> => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat mengubah pengaturan label peta.'
        );
      }
      const cleanLabelAttrs = Array.from(
        new Set(
          labelAttributes
            .map((v) => String(v).trim().slice(0, 100))
            .filter((v) => v.length >= 1)
        )
      ).slice(0, 15);
      const cleanEnabled = Boolean(labelEnabled && cleanLabelAttrs.length > 0);
      try {
        await updateDoc(doc(firestore, 'base_map_layers', id), {
          labelEnabled: cleanEnabled,
          labelAttributes: cleanLabelAttrs,
        });
        const nextBaseMaps = snapshotDataRef.current.baseMaps.map((b) =>
          b.id === id
            ? {
                ...b,
                labelEnabled: cleanEnabled,
                labelAttributes: cleanLabelAttrs,
              }
            : b
        );
        setBaseMaps(nextBaseMaps);
        persistSnapshotPatch({ baseMaps: nextBaseMaps });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `base_map_layers/${id}`
        );
      }
    },
    [profile, persistSnapshotPatch]
  );

  const adminDeleteBaseMap = useCallback(
    async (id: string) => {
      if (!profile || profile.role !== 'admin') {
        throw new Error('Hanya Administrator yang dapat menghapus peta dasar.');
      }
      try {
        const chunksSnap = await getDocs(
          collection(firestore, 'base_map_layers', id, 'chunks')
        );
        for (let i = 0; i < chunksSnap.docs.length; i += 400) {
          const batch = writeBatch(firestore);
          chunksSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        await deleteDoc(doc(firestore, 'base_map_layers', id));
        const nextBaseMaps = snapshotDataRef.current.baseMaps.filter(
          (b) => b.id !== id
        );
        setBaseMaps(nextBaseMaps);
        persistSnapshotPatch({ baseMaps: nextBaseMaps });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.DELETE,
          `base_map_layers/${id}`
        );
      }
    },
    [profile, persistSnapshotPatch]
  );

  const fetchBaseMapDetail = useCallback(async (id: string) => {
    try {
      const layerSnap = await getDoc(doc(firestore, 'base_map_layers', id));
      if (!layerSnap.exists()) {
        throw new Error('Peta dasar tidak ditemukan.');
      }
      const data = layerSnap.data();
      let fileDataBase64 = data.fileDataBase64
        ? String(data.fileDataBase64)
        : null;
      let geoJsonText = data.geoJsonText ? String(data.geoJsonText) : null;
      const chunkCount =
        typeof data.chunkCount === 'number' ? data.chunkCount : 0;

      if (chunkCount > 0) {
        const chunksSnap = await getDocs(
          query(
            collection(firestore, 'base_map_layers', id, 'chunks'),
            orderBy('index', 'asc')
          )
        );
        const reassembled = chunksSnap.docs
          .map((c) => String(c.data().data || ''))
          .join('');
        if (data.fileType === 'pdf') {
          fileDataBase64 = reassembled;
        } else {
          geoJsonText = reassembled;
        }
      }

      return {
        id: layerSnap.id,
        perusahaan: resolveCompanyName(String(data.perusahaan || '')),
        companyKey: String(data.companyKey || ''),
        name: String(data.name || ''),
        fileType: data.fileType as BaseMapFileType,
        crsCode: (data.crsCode || 'EPSG:4326') as CoordCrsCode,
        fileDataBase64,
        geoJsonText,
        bboxJson: data.bboxJson ? String(data.bboxJson) : null,
        chunkCount,
        labelEnabled: Boolean(data.labelEnabled),
        labelAttributes: Array.isArray(data.labelAttributes)
          ? data.labelAttributes
              .map((v: unknown) => String(v))
              .filter(Boolean)
              .slice(0, 15)
          : [],
        availableAttributes: Array.isArray(data.availableAttributes)
          ? data.availableAttributes
              .map((v: unknown) => String(v))
              .filter(Boolean)
              .slice(0, 100)
          : [],
        uploadedByUid: String(data.uploadedByUid || ''),
        createdAt: serializeTimestamp(data.createdAt),
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `base_map_layers/${id}`);
    }
  }, []);

  const getEvalSettingFor = useCallback(
    (company: 'ALL' | CompanyName): GrowthEvalSettings => {
      if (company !== 'ALL') {
        const ck = getCompanyKey(company);
        const exact = evalSettings.find((s) => s.companyKey === ck);
        if (exact) return exact;
      }
      const globalSet = evalSettings.find((s) => s.companyKey === 'ALL');
      return globalSet || DEFAULT_GROWTH_EVAL_SETTINGS;
    },
    [evalSettings]
  );

  const adminSaveEvalSetting = useCallback(
    async (params: {
      companyKey: string;
      enabled: boolean;
      minSurvivalPct: number;
      minDeltaHeightCm: number;
    }): Promise<GrowthEvalSettings> => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat mengatur evaluasi pertumbuhan.'
        );
      }
      const ck = params.companyKey || 'ALL';
      try {
        await setDoc(doc(firestore, 'growth_eval_settings', ck), {
          companyKey: ck,
          enabled: params.enabled !== false,
          minSurvivalPct: Number(params.minSurvivalPct ?? 80),
          minDeltaHeightCm: Number(params.minDeltaHeightCm ?? 2),
          updatedByUid: profile.uid,
          updatedAt: serverTimestamp(),
        });
        const setting: GrowthEvalSettings = {
          companyKey: ck,
          enabled: params.enabled !== false,
          minSurvivalPct: Number(params.minSurvivalPct ?? 80),
          minDeltaHeightCm: Number(params.minDeltaHeightCm ?? 2),
          updatedByUid: profile.uid,
          updatedAt: new Date().toISOString(),
        };
        setEvalSettings((prev) => [
          ...prev.filter((s) => s.companyKey !== ck),
          setting,
        ]);
        return setting;
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.WRITE,
          `growth_eval_settings/${ck}`
        );
      }
    },
    [profile]
  );

  const getGnssSettingFor = useCallback(
    (company: 'ALL' | CompanyName): GnssAccuracySettings => {
      if (company !== 'ALL') {
        const ck = getCompanyKey(company);
        const exact = gnssSettings.find((s) => s.companyKey === ck);
        if (exact) return exact;
      }
      const globalSet = gnssSettings.find((s) => s.companyKey === 'ALL');
      return globalSet || DEFAULT_GNSS_ACCURACY_SETTINGS;
    },
    [gnssSettings]
  );

  const adminSaveGnssSetting = useCallback(
    async (params: {
      companyKey: string;
      enforced: boolean;
      defaultMaxAccuracyM: number;
      modeThresholds: Record<GnssModeKey, number>;
    }): Promise<GnssAccuracySettings> => {
      if (!profile || profile.role !== 'admin') {
        throw new Error(
          'Hanya Administrator yang dapat mengatur ambang batas akurasi GNSS.'
        );
      }
      const ck = params.companyKey || 'ALL';
      const clampM = (v: number, fallback: number) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(100, Math.max(1, Math.round(n * 10) / 10));
      };
      const defM = clampM(params.defaultMaxAccuracyM, MAX_GNSS_ACCURACY_M);
      const cleanModes: Record<GnssModeKey, number> = {
        optimal: clampM(params.modeThresholds.optimal, defM),
        precision_static: clampM(params.modeThresholds.precision_static, defM),
        continuous: clampM(params.modeThresholds.continuous, defM),
        fast: clampM(params.modeThresholds.fast, defM),
      };
      try {
        await setDoc(doc(firestore, 'gnss_accuracy_settings', ck), {
          companyKey: ck,
          enforced: params.enforced !== false,
          defaultMaxAccuracyM: defM,
          modeThresholds: cleanModes,
          updatedByUid: profile.uid,
          updatedAt: serverTimestamp(),
        });
        const setting: GnssAccuracySettings = {
          companyKey: ck,
          enforced: params.enforced !== false,
          defaultMaxAccuracyM: defM,
          modeThresholds: cleanModes,
          updatedByUid: profile.uid,
          updatedAt: new Date().toISOString(),
        };
        setGnssSettings((prev) => [
          ...prev.filter((s) => s.companyKey !== ck),
          setting,
        ]);
        return setting;
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.WRITE,
          `gnss_accuracy_settings/${ck}`
        );
      }
    },
    [profile]
  );

  const clearSyncError = useCallback(() => setLastSyncError(null), []);

  const value: DataContextValue = {
    isOnline,
    isLoading,
    isSyncing,
    lastSyncAt,
    lastSyncError,
    clearSyncError,
    allRecords,
    fieldConditions,
    canopyCovers,
    locations,
    masterLocations,
    petaks: scopedPetaks,
    species: scopedSpecies,
    companySpreadsheets,
    baseMaps: scopedBaseMaps,
    evalSettings,
    gnssSettings,
    staffList,
    pendingCount,
    otherCompanyPendingCount,
    conflictCount,
    getSpeciesForCompanyGroup,
    checkDuplicatePlantNumber,
    getNextSuggestedPlantNumber,
    getFieldConditionFor,
    getCanopyCoverFor,
    savePlantRecord,
    saveFieldCondition,
    saveCanopyCover,
    syncPendingQueue,
    refreshData,
    fetchPaginatedRecords,
    exportOfflineBackup,
    exportTodayBackup,
    resolveConflictChangeNumber,
    discardPendingRecord,
    adminUpdateRecord,
    adminDeleteRecord,
    adminAddStaff,
    adminUpdateStaff,
    adminDeleteStaff,
    adminResetAllStaff,
    adminAddLocation,
    adminDeleteLocation,
    adminAddPetak,
    adminDeletePetak,
    adminAddSpecies,
    adminToggleSpecies,
    adminDeleteSpecies,
    saveCompanySpreadsheet,
    syncCompanyToGoogleSheets,
    adminUploadBaseMap,
    adminUpdateBaseMapLabels,
    adminDeleteBaseMap,
    fetchBaseMapDetail,
    getEvalSettingFor,
    adminSaveEvalSetting,
    getGnssSettingFor,
    adminSaveGnssSetting,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useAuth/Data must be used within DataProvider');
  return ctx;
}
