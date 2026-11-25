export const COMPANIES = ['PT. NBSS', 'PT. DTSA', 'PT. DTR'] as const;

export type CompanyName = (typeof COMPANIES)[number];

export type AssignedCompany = 'ALL' | CompanyName;

export function getCompanyKey(perusahaan: CompanyName): string {
  switch (perusahaan) {
    case 'PT. NBSS':
      return 'pt_nbss';
    case 'PT. DTSA':
      return 'pt_dtsa';
    case 'PT. DTR':
      return 'pt_dtr';
  }
}

export function resolveCompanyName(raw?: string): CompanyName {
  if (raw === 'PT. DTSA') return 'PT. DTSA';
  if (raw === 'PT. DTR') return 'PT. DTR';
  return 'PT. NBSS';
}

export type MenuType = 'SENSUS' | 'MONITORING_IPPKH' | 'MONITORING_APL';

export type PlantGroup = 'FGS' | 'LOKAL_MPTS';

export type PlantCondition = 'Sehat' | 'Kurang Sehat' | 'Merana' | 'Mati';

export type CoverCropDensity = 'Rapat' | 'Kurang Rapat' | 'Tidak Ada';

export type ConservationStructureStatus = 'Ada' | 'Tidak Ada';

export type CanopyClosure = 'Tertutup' | 'Kurang Tertutup' | 'Tidak Tertutup';

export type UserRole = 'admin' | 'petugas';

export type UtmNorthCrsCode = `EPSG:326${string}`;
export type UtmSouthCrsCode = `EPSG:327${string}`;

export type CoordCrsCode =
  | 'EPSG:4326'
  | 'EPSG:3857'
  | UtmNorthCrsCode
  | UtmSouthCrsCode;

export type CoordFormatType = 'DD' | 'DMS' | 'UTM';

export interface CrsOptionItem {
  code: CoordCrsCode;
  label: string;
}

export interface CrsOptionGroup {
  label: string;
  options: CrsOptionItem[];
}

export const CRS_OPTION_GROUPS: CrsOptionGroup[] = [
  {
    label: 'Sistem Koordinat Resmi (WGS 84 / UTM Zone 50N)',
    options: [
      {
        code: 'EPSG:32650',
        label: 'WGS 84 / UTM Zone 50N (EPSG:32650)',
      },
    ],
  },
];

export const CRS_OPTIONS: CrsOptionItem[] = CRS_OPTION_GROUPS.flatMap(
  (group) => group.options
);

export const COORD_FORMAT_OPTIONS: Array<{
  id: CoordFormatType;
  label: string;
}> = [
  { id: 'DD', label: 'Decimal Degrees (DD)' },
  { id: 'DMS', label: 'Degrees Minutes Seconds (DMS)' },
  { id: 'UTM', label: 'UTM (Easting / Northing)' },
];

export const FGS_SPECIES = [
  'Sengon',
  'Jabon',
  'Eucalyptus',
  'Jati Putih',
  'Trembesi',
  'Waru',
  'Ketapang',
  'Kayu Putih',
  'Johar',
  'Akasia',
] as const;

export const LOKAL_MPTS_SPECIES = [
  'Meranti',
  'Gaharu',
  'Kapur',
  'Trap',
  'Durian',
  'Rambutan',
  'Cempedak',
  'Macaranga',
  'Mahoni',
] as const;

export const PLANT_CONDITIONS: PlantCondition[] = [
  'Sehat',
  'Kurang Sehat',
  'Merana',
  'Mati',
];

export const COVER_CROP_OPTIONS: CoverCropDensity[] = [
  'Rapat',
  'Kurang Rapat',
  'Tidak Ada',
];

export const CONSERVATION_OPTIONS: ConservationStructureStatus[] = [
  'Ada',
  'Tidak Ada',
];

export const CANOPY_OPTIONS: CanopyClosure[] = [
  'Tertutup',
  'Kurang Tertutup',
  'Tidak Tertutup',
];

// Validation thresholds to prevent typos in height (cm) and diameter (mm)
export const DIMENSION_BOUNDS = {
  tinggiCm: {
    hardMin: 0.1,
    hardMax: 15000,
    reasonableMin: 10,
    reasonableMax: 2500,
  },
  diameterMm: {
    hardMin: 0.1,
    hardMax: 5000,
    reasonableMin: 1,
    reasonableMax: 500,
  },
} as const;

export const MAX_PHOTO_BYTES = 150 * 1024;
export const MAX_GNSS_ACCURACY_M = 10;

export type GnssModeKey = 'optimal' | 'precision_static' | 'continuous' | 'fast';

export interface GnssAccuracySettings {
  companyKey: string; // 'ALL' | 'pt_nbss' | 'pt_dtsa' | 'pt_dtr'
  enforced: boolean;
  defaultMaxAccuracyM: number;
  modeThresholds: Record<GnssModeKey, number>;
  updatedByUid?: string;
  updatedAt?: string;
}

export const DEFAULT_GNSS_ACCURACY_SETTINGS: GnssAccuracySettings = {
  companyKey: 'ALL',
  enforced: true,
  defaultMaxAccuracyM: MAX_GNSS_ACCURACY_M,
  modeThresholds: {
    optimal: 10,
    precision_static: 10,
    continuous: 10,
    fast: 10,
  },
};

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  assignedCompany?: AssignedCompany;
  rangeStart?: number | null;
  rangeEnd?: number | null;
  active: boolean;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  assignedCompany: AssignedCompany;
  rangeStart?: number | null;
  rangeEnd?: number | null;
  active: boolean;
  staffId: string;
}

export interface PlantRecord {
  id: string;
  perusahaan: CompanyName;
  companyKey: string;
  menuType: MenuType;
  tanggalInput: string; // YYYY-MM-DD
  waktuInput?: string; // HH:mm:ss (device local time)
  periode: string; // YYYY-MM
  lokasi: string;
  lokasiKey: string;
  namaPetugas: string;
  nomorPetak: string;
  petakKey: string;
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
  sheetSyncedAt?: string | null;
  createdByUid: string;
  createdByEmail: string;
  updatedByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  // Client-only sync metadata
  syncStatus?: 'synced' | 'pending' | 'conflict';
  syncError?: string;
}

export interface FieldCondition {
  id: string;
  perusahaan: CompanyName;
  companyKey: string;
  menuType: 'MONITORING_IPPKH' | 'MONITORING_APL';
  lokasi: string;
  lokasiKey: string;
  periode: string; // YYYY-MM
  coverCrop: CoverCropDensity;
  bangunanKonservasi: ConservationStructureStatus;
  jumlahBangunan: number;
  namaPetugas: string;
  latitude?: number | null;
  longitude?: number | null;
  horizontalAccuracyM?: number | null;
  verticalAccuracyM?: number | null;
  photoDataUrl?: string | null;
  createdByUid: string;
  updatedByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  syncStatus?: 'synced' | 'pending';
}

export interface CanopyCover {
  id: string;
  perusahaan: CompanyName;
  companyKey: string;
  menuType: 'MONITORING_APL';
  lokasi: string;
  lokasiKey: string;
  nomorPetak: string;
  petakKey: string;
  periode: string; // YYYY-MM
  penutupanTajuk: CanopyClosure;
  namaPetugas: string;
  createdByUid: string;
  updatedByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  syncStatus?: 'synced' | 'pending';
}

export interface LocationMaster {
  id: string; // companyKey__lokasiKey
  perusahaan: CompanyName;
  companyKey: string;
  name: string;
  lokasiKey: string;
  createdByUid: string;
  createdAt?: unknown;
  syncStatus?: 'synced' | 'pending';
}

export interface PetakMaster {
  id: string; // companyKey__lokasiKey__petakKey
  perusahaan: CompanyName;
  companyKey: string;
  lokasi: string;
  lokasiKey: string;
  name: string;
  petakKey: string;
  createdByUid: string;
  createdAt?: unknown;
}

export interface SpeciesMaster {
  id: string; // companyKey__kelompok__speciesKey
  perusahaan: CompanyName;
  companyKey: string;
  kelompokTanaman: PlantGroup;
  name: string;
  speciesKey: string;
  active: boolean;
  createdByUid: string;
  createdAt?: unknown;
}

export interface CompanySpreadsheet {
  companyKey: string;
  perusahaan: CompanyName;
  spreadsheetId: string;
  spreadsheetUrl: string;
  ownerEmail: string;
  lastSyncedAt?: string | null;
  syncedRecordCount: number;
  updatedAt?: string;
}

export type BaseMapFileType = 'pdf' | 'shapefile' | 'geojson';

export interface BaseMapLayer {
  id: string;
  perusahaan: CompanyName;
  companyKey: string;
  name: string;
  fileType: BaseMapFileType;
  crsCode: CoordCrsCode;
  fileDataBase64?: string | null;
  geoJsonText?: string | null;
  bboxJson?: string | null;
  chunkCount?: number | null;
  labelEnabled?: boolean;
  labelAttributes?: string[];
  availableAttributes?: string[];
  uploadedByUid: string;
  createdAt?: unknown;
}

export interface GrowthEvalSettings {
  companyKey: string; // 'ALL' | 'pt_nbss' | 'pt_dtsa' | 'pt_dtr'
  enabled: boolean;
  minSurvivalPct: number;
  minDeltaHeightCm: number;
  updatedByUid?: string;
  updatedAt?: string;
}

export const DEFAULT_GROWTH_EVAL_SETTINGS: GrowthEvalSettings = {
  companyKey: 'ALL',
  enabled: true,
  minSurvivalPct: 80,
  minDeltaHeightCm: 2,
};

/**
 * Deterministic short FNV-1a hash + clean ASCII slug so keys like "Blok A-1" vs "Blok A 1"
 * never collide and strictly conform to ^[a-zA-Z0-9_-]+$ within ID size limits.
 */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeDisplayText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function makeSafeKey(raw: string, maxLen = 50): string {
  const normalized = normalizeDisplayText(raw).toUpperCase();
  const slug = normalized
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, Math.max(8, maxLen - 8));
  const suffix = shortHash(normalized);
  return `${slug || 'LOC'}_${suffix}`;
}

export function extractPeriode(tanggalInput: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(tanggalInput)) {
    return tanggalInput.slice(0, 7);
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getCurrentPeriodeString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatPeriodeKey(periode: string): string {
  return periode.replace(/[^0-9]/g, '_');
}

export function buildPlantRecordId(
  companyKey: string,
  menuType: MenuType,
  lokasiKey: string,
  petakKey: string,
  periode: string,
  nomorTanaman: number
): string {
  if (menuType === 'SENSUS') {
    return `sensus__${companyKey}__${lokasiKey}__${nomorTanaman}`;
  }
  const prefix = menuType === 'MONITORING_IPPKH' ? 'ippkh' : 'apl';
  const periodeSlug = formatPeriodeKey(periode);
  return `${prefix}__${companyKey}__${lokasiKey}__${petakKey}__${periodeSlug}__${nomorTanaman}`;
}

export function buildFieldConditionId(
  companyKey: string,
  menuType: 'MONITORING_IPPKH' | 'MONITORING_APL',
  lokasiKey: string,
  periode: string
): string {
  const prefix = menuType === 'MONITORING_IPPKH' ? 'ippkh' : 'apl';
  return `cond__${prefix}__${companyKey}__${lokasiKey}__${formatPeriodeKey(periode)}`;
}

export function buildCanopyCoverId(
  companyKey: string,
  lokasiKey: string,
  petakKey: string,
  periode: string
): string {
  return `canopy__apl__${companyKey}__${lokasiKey}__${petakKey}__${formatPeriodeKey(periode)}`;
}

export function buildLocationDocId(
  companyKey: string,
  lokasiKey: string
): string {
  return `${companyKey}__${lokasiKey}`;
}

export function buildPetakDocId(
  companyKey: string,
  lokasiKey: string,
  petakKey: string
): string {
  return `${companyKey}__${lokasiKey}__${petakKey}`;
}

export function buildSpeciesDocId(
  companyKey: string,
  kelompok: PlantGroup,
  speciesKey: string
): string {
  return `${companyKey}__${kelompok}__${speciesKey}`;
}

export function getMenuLabel(menuType: MenuType): string {
  switch (menuType) {
    case 'SENSUS':
      return 'Sensus Tanaman';
    case 'MONITORING_IPPKH':
      return 'Monitoring IPPKH';
    case 'MONITORING_APL':
      return 'Monitoring APL';
  }
}

export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentTimeString(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function parsePositiveDecimal(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return Math.round(num * 100) / 100;
}

export function parsePositiveInt(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^\d+$/.test(cleaned)) {
    return null;
  }
  const num = parseInt(cleaned, 10);
  if (!Number.isSafeInteger(num) || num < 1) {
    return null;
  }
  return num;
}
