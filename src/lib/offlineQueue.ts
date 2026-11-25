import { openDB, type IDBPDatabase } from 'idb';
import type {
  BaseMapLayer,
  CanopyCover,
  CompanySpreadsheet,
  FieldCondition,
  GnssAccuracySettings,
  GrowthEvalSettings,
  LocationMaster,
  PetakMaster,
  PlantRecord,
  SpeciesMaster,
  StaffMember,
  UserProfile,
} from '../types/plant';

const LEGACY_QUEUE_STORAGE_KEY = 'silvitrack_offline_queue_v1';
const CACHED_USER_KEY = 'silvitrack_cached_profile_v1';
const IDB_NAME = 'silvitrack_storage_v2';
const IDB_VERSION = 1;
const STORE_KV = 'kv';
const KEY_QUEUE = 'offline_queue';
const KEY_SNAPSHOT = 'server_snapshot';

export interface OfflineQueueState {
  plantRecords: PlantRecord[];
  fieldConditions: FieldCondition[];
  canopyCovers: CanopyCover[];
  locations: LocationMaster[];
}

export interface CachedServerSnapshot {
  records: PlantRecord[];
  fieldConditions: FieldCondition[];
  canopyCovers: CanopyCover[];
  locations: LocationMaster[];
  petaks: PetakMaster[];
  species: SpeciesMaster[];
  companySpreadsheets: CompanySpreadsheet[];
  baseMaps: BaseMapLayer[];
  evalSettings: GrowthEvalSettings[];
  gnssSettings: GnssAccuracySettings[];
  staffList: StaffMember[];
  cachedAt: string;
  ownerUid?: string;
}

export const EMPTY_QUEUE: OfflineQueueState = {
  plantRecords: [],
  fieldConditions: [],
  canopyCovers: [],
  locations: [],
};

export const EMPTY_SNAPSHOT: CachedServerSnapshot = {
  records: [],
  fieldConditions: [],
  canopyCovers: [],
  locations: [],
  petaks: [],
  species: [],
  companySpreadsheets: [],
  baseMaps: [],
  evalSettings: [],
  gnssSettings: [],
  staffList: [],
  cachedAt: '',
  ownerUid: '',
};

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getSilviIdb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(IDB_NAME, IDB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
      },
    });
  }
  return dbPromise;
}

function normalizeQueue(
  raw: Partial<OfflineQueueState> | null | undefined
): OfflineQueueState {
  return {
    plantRecords: Array.isArray(raw?.plantRecords) ? raw.plantRecords : [],
    fieldConditions: Array.isArray(raw?.fieldConditions)
      ? raw.fieldConditions
      : [],
    canopyCovers: Array.isArray(raw?.canopyCovers) ? raw.canopyCovers : [],
    locations: Array.isArray(raw?.locations) ? raw.locations : [],
  };
}

function mergeQueues(
  a: OfflineQueueState,
  b: OfflineQueueState
): OfflineQueueState {
  const recMap = new Map<string, PlantRecord>();
  for (const r of a.plantRecords) recMap.set(r.id, r);
  for (const r of b.plantRecords) {
    if (!recMap.has(r.id)) recMap.set(r.id, r);
  }

  const condMap = new Map<string, FieldCondition>();
  for (const fc of a.fieldConditions) condMap.set(fc.id, fc);
  for (const fc of b.fieldConditions) {
    if (!condMap.has(fc.id)) condMap.set(fc.id, fc);
  }

  const canopyMap = new Map<string, CanopyCover>();
  for (const cc of a.canopyCovers) canopyMap.set(cc.id, cc);
  for (const cc of b.canopyCovers) {
    if (!canopyMap.has(cc.id)) canopyMap.set(cc.id, cc);
  }

  const locMap = new Map<string, LocationMaster>();
  for (const l of a.locations) locMap.set(l.id, l);
  for (const l of b.locations) {
    if (!locMap.has(l.id)) locMap.set(l.id, l);
  }

  return {
    plantRecords: Array.from(recMap.values()),
    fieldConditions: Array.from(condMap.values()),
    canopyCovers: Array.from(canopyMap.values()),
    locations: Array.from(locMap.values()),
  };
}

export async function loadOfflineQueue(): Promise<OfflineQueueState> {
  try {
    const db = await getSilviIdb();
    const idbData = (await db.get(STORE_KV, KEY_QUEUE)) as
      | Partial<OfflineQueueState>
      | undefined;
    let queue = normalizeQueue(idbData);

    try {
      const legacyRaw = localStorage.getItem(LEGACY_QUEUE_STORAGE_KEY);
      if (legacyRaw) {
        const legacyParsed = normalizeQueue(
          JSON.parse(legacyRaw) as Partial<OfflineQueueState>
        );
        const hasLegacyItems =
          legacyParsed.plantRecords.length > 0 ||
          legacyParsed.fieldConditions.length > 0 ||
          legacyParsed.canopyCovers.length > 0 ||
          legacyParsed.locations.length > 0;
        if (hasLegacyItems) {
          queue = mergeQueues(queue, legacyParsed);
          await db.put(STORE_KV, queue, KEY_QUEUE);
        }
        localStorage.removeItem(LEGACY_QUEUE_STORAGE_KEY);
      }
    } catch {
      // ignore legacy cleanup issues
    }

    return queue;
  } catch (err) {
    console.error('Failed to load IndexedDB queue:', err);
    return { ...EMPTY_QUEUE };
  }
}

export async function saveOfflineQueue(queue: OfflineQueueState): Promise<void> {
  try {
    const db = await getSilviIdb();
    await db.put(STORE_KV, queue, KEY_QUEUE);
  } catch (err) {
    console.error('Failed to persist offline queue to IndexedDB:', err);
    throw new Error(
      'Gagal menyimpan antrean offline ke penyimpanan perangkat.'
    );
  }
}

export async function loadServerSnapshot(): Promise<CachedServerSnapshot> {
  try {
    const db = await getSilviIdb();
    const data = (await db.get(STORE_KV, KEY_SNAPSHOT)) as
      | Partial<CachedServerSnapshot>
      | undefined;
    if (!data) return { ...EMPTY_SNAPSHOT };
    return {
      records: Array.isArray(data.records) ? data.records : [],
      fieldConditions: Array.isArray(data.fieldConditions)
        ? data.fieldConditions
        : [],
      canopyCovers: Array.isArray(data.canopyCovers) ? data.canopyCovers : [],
      locations: Array.isArray(data.locations) ? data.locations : [],
      petaks: Array.isArray(data.petaks) ? data.petaks : [],
      species: Array.isArray(data.species) ? data.species : [],
      companySpreadsheets: Array.isArray(data.companySpreadsheets)
        ? data.companySpreadsheets
        : [],
      baseMaps: Array.isArray(data.baseMaps) ? data.baseMaps : [],
      evalSettings: Array.isArray(data.evalSettings) ? data.evalSettings : [],
      gnssSettings: Array.isArray(data.gnssSettings) ? data.gnssSettings : [],
      staffList: Array.isArray(data.staffList) ? data.staffList : [],
      cachedAt: typeof data.cachedAt === 'string' ? data.cachedAt : '',
      ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : '',
    };
  } catch {
    return { ...EMPTY_SNAPSHOT };
  }
}

export async function saveServerSnapshot(
  snapshot: CachedServerSnapshot
): Promise<void> {
  try {
    const db = await getSilviIdb();
    await db.put(STORE_KV, snapshot, KEY_SNAPSHOT);
  } catch (err) {
    console.warn('Failed to cache server snapshot in IndexedDB:', err);
  }
}

export function exportOfflineQueueBackup(queue: OfflineQueueState): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'Environment',
    ...queue,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `Cadangan_Offline_Environment_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function saveCachedUserProfile(profile: UserProfile | null): void {
  try {
    if (!profile) {
      localStorage.removeItem(CACHED_USER_KEY);
      return;
    }
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage quota failures
  }
}

export function loadCachedUserProfile(uid: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    if (parsed && parsed.uid === uid && parsed.active) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
