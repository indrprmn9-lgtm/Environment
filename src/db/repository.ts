import { and, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  baseMapLayers,
  canopyCovers,
  companySpreadsheets,
  fieldConditions,
  growthEvalSettings,
  locationsMaster,
  petaksMaster,
  plantRecords,
  speciesMaster,
  staffWhitelist,
  users,
} from './schema.ts';
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
  CANOPY_OPTIONS,
  type CanopyClosure,
  type CanopyCover,
  COMPANIES,
  type CompanyName,
  type CompanySpreadsheet,
  CONSERVATION_OPTIONS,
  type ConservationStructureStatus,
  type CoordCrsCode,
  COVER_CROP_OPTIONS,
  type CoverCropDensity,
  DIMENSION_BOUNDS,
  extractPeriode,
  FGS_SPECIES,
  type FieldCondition,
  getCompanyKey,
  type GrowthEvalSettings,
  type LocationMaster,
  LOKAL_MPTS_SPECIES,
  makeSafeKey,
  type MenuType,
  normalizeDisplayText,
  type PetakMaster,
  PLANT_CONDITIONS,
  type PlantCondition,
  type PlantGroup,
  type PlantRecord,
  resolveCompanyName,
  type SpeciesMaster,
  type StaffMember,
  type UserProfile,
  type UserRole,
} from '../types/plant.ts';

function isValidCompanyName(val: unknown): val is CompanyName {
  return typeof val === 'string' && (COMPANIES as readonly string[]).includes(val);
}

function isValidMenuType(val: unknown): val is MenuType {
  return (
    val === 'SENSUS' ||
    val === 'MONITORING_IPPKH' ||
    val === 'MONITORING_APL'
  );
}

function validatePhotoDataUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^data:image\/(jpeg|jpg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    throw new Error('Format foto bukti harus JPEG/WebP/PNG yang valid.');
  }
  const base64Part = trimmed.split(',')[1] || '';
  const estimatedBytes = Math.ceil((base64Part.length * 3) / 4);
  if (estimatedBytes > 165 * 1024) {
    throw new Error('Ukuran foto melebihi batas maksimum 150 KB.');
  }
  return trimmed;
}

function sanitizeFiniteNumber(
  val: unknown,
  min: number,
  max: number
): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

async function ensureDefaultSpeciesSeeded(actorUid: string): Promise<void> {
  const existingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(speciesMaster);
  if ((existingCount[0]?.count || 0) > 0) return;

  const seedRows: Array<typeof speciesMaster.$inferInsert> = [];
  for (const comp of COMPANIES) {
    const ck = getCompanyKey(comp);
    for (const sp of FGS_SPECIES) {
      const sk = makeSafeKey(sp);
      seedRows.push({
        id: buildSpeciesDocId(ck, 'FGS', sk),
        perusahaan: comp,
        companyKey: ck,
        kelompokTanaman: 'FGS',
        name: sp,
        speciesKey: sk,
        active: true,
        createdByUid: actorUid,
      });
    }
    for (const sp of LOKAL_MPTS_SPECIES) {
      const sk = makeSafeKey(sp);
      seedRows.push({
        id: buildSpeciesDocId(ck, 'LOKAL_MPTS', sk),
        perusahaan: comp,
        companyKey: ck,
        kelompokTanaman: 'LOKAL_MPTS',
        name: sp,
        speciesKey: sk,
        active: true,
        createdByUid: actorUid,
      });
    }
  }
  if (seedRows.length > 0) {
    await db
      .insert(speciesMaster)
      .values(seedRows)
      .onConflictDoNothing({ target: speciesMaster.id });
  }
}

export interface IncomingLocationSync {
  perusahaan: CompanyName;
  name: string;
}

export interface IncomingFieldCondSync {
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

export interface IncomingCanopySync {
  perusahaan: CompanyName;
  lokasi: string;
  nomorPetak: string;
  periode: string;
  penutupanTajuk: CanopyClosure;
  namaPetugas: string;
}

export interface IncomingPlantSync {
  id?: string;
  perusahaan: CompanyName;
  menuType: MenuType;
  tanggalInput: string;
  waktuInput?: string;
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
  coordCrs?: string | null;
  photoDataUrl?: string | null;
}

export interface SyncBatchResult {
  syncedLocationIds: string[];
  syncedFieldConditionIds: string[];
  syncedCanopyIds: string[];
  syncedPlantIds: string[];
  conflicts: Array<{
    id: string;
    reason: string;
  }>;
  rejected: Array<{
    id: string;
    reason: string;
  }>;
}

function mapPlantRow(r: typeof plantRecords.$inferSelect): PlantRecord {
  return {
    id: r.id,
    perusahaan: resolveCompanyName(r.perusahaan),
    companyKey: r.companyKey,
    menuType: r.menuType as MenuType,
    tanggalInput: r.tanggalInput,
    waktuInput: r.waktuInput || undefined,
    periode: r.periode,
    lokasi: r.lokasi,
    lokasiKey: r.lokasiKey,
    namaPetugas: r.namaPetugas,
    nomorPetak: r.nomorPetak,
    petakKey: r.petakKey,
    nomorTanaman: r.nomorTanaman,
    kelompokTanaman: r.kelompokTanaman as PlantGroup,
    jenisTanaman: r.jenisTanaman,
    tinggiCm: r.tinggiCm,
    diameterMm: r.diameterMm,
    kondisiTanaman: r.kondisiTanaman as PlantCondition,
    keterangan: r.keterangan,
    extremeConfirmed: r.extremeConfirmed,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    altitudeM: r.altitudeM ?? null,
    horizontalAccuracyM: r.horizontalAccuracyM ?? null,
    verticalAccuracyM: r.verticalAccuracyM ?? null,
    gnssSource: r.gnssSource ?? null,
    coordCrs: r.coordCrs ?? 'EPSG:4326',
    photoDataUrl: r.photoDataUrl ?? null,
    sheetSyncedAt: r.sheetSyncedAt ? r.sheetSyncedAt.toISOString() : null,
    createdByUid: r.createdByUid,
    createdByEmail: r.createdByEmail,
    updatedByUid: r.updatedByUid,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    syncStatus: 'synced',
  };
}

export async function getBootstrapData(
  profile: UserProfile
): Promise<{
  records: PlantRecord[];
  fieldConditions: FieldCondition[];
  canopyCovers: CanopyCover[];
  locations: LocationMaster[];
  petaks: PetakMaster[];
  species: SpeciesMaster[];
  companySpreadsheets: CompanySpreadsheet[];
  baseMaps: BaseMapLayer[];
  evalSettings: GrowthEvalSettings[];
  staffList: StaffMember[];
}> {
  try {
    await ensureDefaultSpeciesSeeded(profile.uid);

    const isAdmin = profile.role === 'admin';
    const companyFilterKey =
      profile.assignedCompany !== 'ALL'
        ? getCompanyKey(profile.assignedCompany)
        : null;

    const [
      recRows,
      condRows,
      canopyRows,
      locRows,
      petakRows,
      speciesRows,
      sheetRows,
      mapMetaRows,
      staffRows,
    ] = await Promise.all([
      companyFilterKey
        ? db
            .select()
            .from(plantRecords)
            .where(eq(plantRecords.companyKey, companyFilterKey))
            .orderBy(
              desc(plantRecords.tanggalInput),
              desc(plantRecords.waktuInput),
              desc(plantRecords.nomorTanaman)
            )
        : db
            .select()
            .from(plantRecords)
            .orderBy(
              desc(plantRecords.tanggalInput),
              desc(plantRecords.waktuInput),
              desc(plantRecords.nomorTanaman)
            ),
      companyFilterKey
        ? db
            .select()
            .from(fieldConditions)
            .where(eq(fieldConditions.companyKey, companyFilterKey))
        : db.select().from(fieldConditions),
      companyFilterKey
        ? db
            .select()
            .from(canopyCovers)
            .where(eq(canopyCovers.companyKey, companyFilterKey))
        : db.select().from(canopyCovers),
      companyFilterKey
        ? db
            .select()
            .from(locationsMaster)
            .where(eq(locationsMaster.companyKey, companyFilterKey))
        : db.select().from(locationsMaster),
      companyFilterKey
        ? db
            .select()
            .from(petaksMaster)
            .where(eq(petaksMaster.companyKey, companyFilterKey))
        : db.select().from(petaksMaster),
      companyFilterKey
        ? db
            .select()
            .from(speciesMaster)
            .where(eq(speciesMaster.companyKey, companyFilterKey))
        : db.select().from(speciesMaster),
      isAdmin ? db.select().from(companySpreadsheets) : Promise.resolve([]),
      companyFilterKey
        ? db
            .select({
              id: baseMapLayers.id,
              perusahaan: baseMapLayers.perusahaan,
              companyKey: baseMapLayers.companyKey,
              name: baseMapLayers.name,
              fileType: baseMapLayers.fileType,
              crsCode: baseMapLayers.crsCode,
              bboxJson: baseMapLayers.bboxJson,
              uploadedByUid: baseMapLayers.uploadedByUid,
              createdAt: baseMapLayers.createdAt,
            })
            .from(baseMapLayers)
            .where(eq(baseMapLayers.companyKey, companyFilterKey))
            .orderBy(desc(baseMapLayers.createdAt))
        : db
            .select({
              id: baseMapLayers.id,
              perusahaan: baseMapLayers.perusahaan,
              companyKey: baseMapLayers.companyKey,
              name: baseMapLayers.name,
              fileType: baseMapLayers.fileType,
              crsCode: baseMapLayers.crsCode,
              bboxJson: baseMapLayers.bboxJson,
              uploadedByUid: baseMapLayers.uploadedByUid,
              createdAt: baseMapLayers.createdAt,
            })
            .from(baseMapLayers)
            .orderBy(desc(baseMapLayers.createdAt)),
      isAdmin ? db.select().from(staffWhitelist) : Promise.resolve([]),
    ]);

    return {
      records: recRows.map(mapPlantRow),
      fieldConditions: condRows.map((fc) => ({
        id: fc.id,
        perusahaan: resolveCompanyName(fc.perusahaan),
        companyKey: fc.companyKey,
        menuType: fc.menuType as 'MONITORING_IPPKH' | 'MONITORING_APL',
        lokasi: fc.lokasi,
        lokasiKey: fc.lokasiKey,
        periode: fc.periode,
        coverCrop: fc.coverCrop as CoverCropDensity,
        bangunanKonservasi:
          fc.bangunanKonservasi as ConservationStructureStatus,
        jumlahBangunan: fc.jumlahBangunan,
        namaPetugas: fc.namaPetugas,
        latitude: fc.latitude ?? null,
        longitude: fc.longitude ?? null,
        horizontalAccuracyM: fc.horizontalAccuracyM ?? null,
        verticalAccuracyM: fc.verticalAccuracyM ?? null,
        photoDataUrl: fc.photoDataUrl ?? null,
        createdByUid: fc.createdByUid,
        updatedByUid: fc.updatedByUid,
        createdAt: fc.createdAt,
        updatedAt: fc.updatedAt,
        syncStatus: 'synced',
      })),
      canopyCovers: canopyRows.map((cc) => ({
        id: cc.id,
        perusahaan: resolveCompanyName(cc.perusahaan),
        companyKey: cc.companyKey,
        menuType: 'MONITORING_APL',
        lokasi: cc.lokasi,
        lokasiKey: cc.lokasiKey,
        nomorPetak: cc.nomorPetak,
        petakKey: cc.petakKey,
        periode: cc.periode,
        penutupanTajuk: cc.penutupanTajuk as CanopyClosure,
        namaPetugas: cc.namaPetugas,
        createdByUid: cc.createdByUid,
        updatedByUid: cc.updatedByUid,
        createdAt: cc.createdAt,
        updatedAt: cc.updatedAt,
        syncStatus: 'synced',
      })),
      locations: locRows.map((loc) => ({
        id: loc.id,
        perusahaan: resolveCompanyName(loc.perusahaan),
        companyKey: loc.companyKey,
        name: loc.name,
        lokasiKey: loc.lokasiKey,
        createdByUid: loc.createdByUid,
        createdAt: loc.createdAt,
        syncStatus: 'synced',
      })),
      petaks: petakRows.map((pt) => ({
        id: pt.id,
        perusahaan: resolveCompanyName(pt.perusahaan),
        companyKey: pt.companyKey,
        lokasi: pt.lokasi,
        lokasiKey: pt.lokasiKey,
        name: pt.name,
        petakKey: pt.petakKey,
        createdByUid: pt.createdByUid,
        createdAt: pt.createdAt,
      })),
      species: speciesRows.map((sp) => ({
        id: sp.id,
        perusahaan: resolveCompanyName(sp.perusahaan),
        companyKey: sp.companyKey,
        kelompokTanaman: sp.kelompokTanaman as PlantGroup,
        name: sp.name,
        speciesKey: sp.speciesKey,
        active: sp.active,
        createdByUid: sp.createdByUid,
        createdAt: sp.createdAt,
      })),
      companySpreadsheets: sheetRows.map((cs) => ({
        companyKey: cs.companyKey,
        perusahaan: resolveCompanyName(cs.perusahaan),
        spreadsheetId: cs.spreadsheetId,
        spreadsheetUrl: cs.spreadsheetUrl,
        ownerEmail: cs.ownerEmail,
        lastSyncedAt: cs.lastSyncedAt ? cs.lastSyncedAt.toISOString() : null,
        syncedRecordCount: cs.syncedRecordCount,
        updatedAt: cs.updatedAt.toISOString(),
      })),
      baseMaps: mapMetaRows.map((m) => ({
        id: m.id,
        perusahaan: resolveCompanyName(m.perusahaan),
        companyKey: m.companyKey,
        name: m.name,
        fileType: m.fileType as BaseMapFileType,
        crsCode: m.crsCode as CoordCrsCode,
        bboxJson: m.bboxJson,
        uploadedByUid: m.uploadedByUid,
        createdAt: m.createdAt,
      })),
      staffList: staffRows.map((s) => ({
        id: s.id,
        email: s.email,
        name: s.name,
        role: (s.role === 'admin' ? 'admin' : 'petugas') as UserRole,
        assignedCompany: (s.assignedCompany || 'ALL') as AssignedCompany,
        rangeStart: s.rangeStart ?? null,
        rangeEnd: s.rangeEnd ?? null,
        active: s.active,
        createdByUid: s.createdByUid,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      evalSettings: await (async (): Promise<GrowthEvalSettings[]> => {
        try {
          const rows = await db.select().from(growthEvalSettings);
          return rows.map((r) => ({
            companyKey: r.companyKey,
            enabled: r.enabled,
            minSurvivalPct: r.minSurvivalPct,
            minDeltaHeightCm: r.minDeltaHeightCm,
            updatedByUid: r.updatedByUid,
            updatedAt: r.updatedAt.toISOString(),
          }));
        } catch {
          return [];
        }
      })(),
    };
  } catch (error) {
    console.error('Failed to load bootstrap data:', error);
    throw new Error('Gagal memuat data dari server database.', {
      cause: error,
    });
  }
}

export async function getPlantRecordsPaginated(
  profile: UserProfile,
  params: {
    page?: number;
    limit?: number;
    company?: string;
    menuType?: string;
    lokasiKey?: string;
    periode?: string;
    kondisi?: string;
    search?: string;
  }
): Promise<{
  records: PlantRecord[];
  total: number;
  page: number;
  limit: number;
  periodes: string[];
}> {
  const page = Math.max(1, Math.round(Number(params.page) || 1));
  const limit = Math.min(200, Math.max(10, Math.round(Number(params.limit) || 100)));
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];

  if (profile.assignedCompany !== 'ALL') {
    conditions.push(
      eq(plantRecords.companyKey, getCompanyKey(profile.assignedCompany))
    );
  } else if (params.company && params.company !== 'ALL' && isValidCompanyName(params.company)) {
    conditions.push(eq(plantRecords.companyKey, getCompanyKey(params.company)));
  }

  if (params.menuType && params.menuType !== 'ALL' && isValidMenuType(params.menuType)) {
    conditions.push(eq(plantRecords.menuType, params.menuType));
  }
  if (params.lokasiKey && params.lokasiKey !== 'ALL') {
    conditions.push(eq(plantRecords.lokasiKey, String(params.lokasiKey)));
  }
  if (params.periode && params.periode !== 'ALL' && /^\d{4}-\d{2}$/.test(params.periode)) {
    conditions.push(eq(plantRecords.periode, params.periode));
  }
  if (
    params.kondisi &&
    params.kondisi !== 'ALL' &&
    (PLANT_CONDITIONS as readonly string[]).includes(params.kondisi)
  ) {
    conditions.push(eq(plantRecords.kondisiTanaman, params.kondisi));
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    const searchCond = or(
      ilike(plantRecords.lokasi, q),
      ilike(plantRecords.nomorPetak, q),
      ilike(plantRecords.jenisTanaman, q),
      ilike(plantRecords.namaPetugas, q),
      ilike(plantRecords.keterangan, q),
      sql`CAST(${plantRecords.nomorTanaman} AS TEXT) ILIKE ${q}`
    );
    if (searchCond) conditions.push(searchCond);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRes, periodeRows] = await Promise.all([
    whereClause
      ? db
          .select()
          .from(plantRecords)
          .where(whereClause)
          .orderBy(
            desc(plantRecords.tanggalInput),
            desc(plantRecords.waktuInput),
            desc(plantRecords.nomorTanaman)
          )
          .limit(limit)
          .offset(offset)
      : db
          .select()
          .from(plantRecords)
          .orderBy(
            desc(plantRecords.tanggalInput),
            desc(plantRecords.waktuInput),
            desc(plantRecords.nomorTanaman)
          )
          .limit(limit)
          .offset(offset),
    whereClause
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(plantRecords)
          .where(whereClause)
      : db.select({ count: sql<number>`count(*)::int` }).from(plantRecords),
    profile.assignedCompany !== 'ALL'
      ? db
          .selectDistinct({ periode: plantRecords.periode })
          .from(plantRecords)
          .where(
            eq(plantRecords.companyKey, getCompanyKey(profile.assignedCompany))
          )
      : db.selectDistinct({ periode: plantRecords.periode }).from(plantRecords),
  ]);

  const periodes = periodeRows
    .map((p) => p.periode)
    .sort((a, b) => b.localeCompare(a));

  return {
    records: rows.map(mapPlantRow),
    total: countRes[0]?.count || 0,
    page,
    limit,
    periodes,
  };
}

export async function processSyncBatch(
  profile: UserProfile,
  payload: {
    locations?: IncomingLocationSync[];
    fieldConditions?: IncomingFieldCondSync[];
    canopyCovers?: IncomingCanopySync[];
    plantRecords?: IncomingPlantSync[];
  }
): Promise<SyncBatchResult> {
  const result: SyncBatchResult = {
    syncedLocationIds: [],
    syncedFieldConditionIds: [],
    syncedCanopyIds: [],
    syncedPlantIds: [],
    conflicts: [],
    rejected: [],
  };

  const enforceCompanyAccess = (comp: CompanyName): boolean => {
    return (
      profile.role === 'admin' ||
      profile.assignedCompany === 'ALL' ||
      profile.assignedCompany === comp
    );
  };

  try {
    await ensureDefaultSpeciesSeeded(profile.uid);
    const allSpecies = await db.select().from(speciesMaster);
    const speciesByCompanyGroup = new Map<string, Set<string>>();
    for (const sp of allSpecies) {
      const k = `${sp.companyKey}__${sp.kelompokTanaman}`;
      const set = speciesByCompanyGroup.get(k) || new Set<string>();
      set.add(sp.name.toLowerCase());
      speciesByCompanyGroup.set(k, set);
    }

    const isSpeciesAllowed = (
      companyKey: string,
      group: PlantGroup,
      name: string
    ): boolean => {
      const set = speciesByCompanyGroup.get(`${companyKey}__${group}`);
      if (set && set.size > 0) {
        return set.has(name.trim().toLowerCase());
      }
      if (group === 'FGS') {
        return (FGS_SPECIES as readonly string[]).some(
          (s) => s.toLowerCase() === name.trim().toLowerCase()
        );
      }
      return (LOKAL_MPTS_SPECIES as readonly string[]).some(
        (s) => s.toLowerCase() === name.trim().toLowerCase()
      );
    };

    // 1. Batch locations
    const locValues: Array<typeof locationsMaster.$inferInsert> = [];
    const autoLocationMap = new Map<string, typeof locationsMaster.$inferInsert>();

    for (const loc of payload.locations || []) {
      if (!isValidCompanyName(loc.perusahaan)) continue;
      if (!enforceCompanyAccess(loc.perusahaan)) continue;
      const cleanName = normalizeDisplayText(String(loc.name || '')).slice(0, 100);
      if (!cleanName) continue;
      const companyKey = getCompanyKey(loc.perusahaan);
      const lokasiKey = makeSafeKey(cleanName);
      const id = buildLocationDocId(companyKey, lokasiKey);
      autoLocationMap.set(id, {
        id,
        perusahaan: loc.perusahaan,
        companyKey,
        name: cleanName,
        lokasiKey,
        createdByUid: profile.uid,
      });
    }

    for (const pr of payload.plantRecords || []) {
      if (!isValidCompanyName(pr.perusahaan) || !enforceCompanyAccess(pr.perusahaan))
        continue;
      const cleanLoc = normalizeDisplayText(String(pr.lokasi || '')).slice(0, 100);
      if (!cleanLoc) continue;
      const companyKey = getCompanyKey(pr.perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const id = buildLocationDocId(companyKey, lokasiKey);
      if (!autoLocationMap.has(id)) {
        autoLocationMap.set(id, {
          id,
          perusahaan: pr.perusahaan,
          companyKey,
          name: cleanLoc,
          lokasiKey,
          createdByUid: profile.uid,
        });
      }
    }

    locValues.push(...autoLocationMap.values());
    if (locValues.length > 0) {
      await db
        .insert(locationsMaster)
        .values(locValues)
        .onConflictDoNothing({ target: locationsMaster.id });
      result.syncedLocationIds = locValues.map((l) => l.id);
    }

    // 2. Batch field conditions
    for (const fc of payload.fieldConditions || []) {
      if (!isValidCompanyName(fc.perusahaan)) continue;
      if (!enforceCompanyAccess(fc.perusahaan)) continue;
      if (fc.menuType !== 'MONITORING_IPPKH' && fc.menuType !== 'MONITORING_APL')
        continue;
      const cleanLoc = normalizeDisplayText(String(fc.lokasi || '')).slice(0, 100);
      const cleanPetugas = normalizeDisplayText(
        String(fc.namaPetugas || profile.name)
      ).slice(0, 100);
      if (!cleanLoc || !/^\d{4}-\d{2}$/.test(String(fc.periode || ''))) continue;
      if (!(COVER_CROP_OPTIONS as readonly string[]).includes(fc.coverCrop))
        continue;
      if (
        !(CONSERVATION_OPTIONS as readonly string[]).includes(
          fc.bangunanKonservasi
        )
      )
        continue;
      const jml =
        fc.bangunanKonservasi === 'Ada'
          ? Math.max(1, Math.min(10000, Math.round(Number(fc.jumlahBangunan) || 1)))
          : 0;
      let photoDataUrl: string | null = null;
      try {
        photoDataUrl = validatePhotoDataUrl(fc.photoDataUrl);
      } catch {
        photoDataUrl = null;
      }

      const lat = sanitizeFiniteNumber(fc.latitude, -90, 90);
      const lon = sanitizeFiniteNumber(fc.longitude, -180, 180);
      const hAcc = sanitizeFiniteNumber(fc.horizontalAccuracyM, 0, 10000);
      const vAcc = sanitizeFiniteNumber(fc.verticalAccuracyM, 0, 10000);

      const companyKey = getCompanyKey(fc.perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const id = buildFieldConditionId(
        companyKey,
        fc.menuType,
        lokasiKey,
        fc.periode
      );

      await db
        .insert(fieldConditions)
        .values({
          id,
          perusahaan: fc.perusahaan,
          companyKey,
          menuType: fc.menuType,
          lokasi: cleanLoc,
          lokasiKey,
          periode: fc.periode,
          coverCrop: fc.coverCrop,
          bangunanKonservasi: fc.bangunanKonservasi,
          jumlahBangunan: jml,
          namaPetugas: cleanPetugas,
          latitude: lat,
          longitude: lon,
          horizontalAccuracyM: hAcc,
          verticalAccuracyM: vAcc,
          photoDataUrl,
          createdByUid: profile.uid,
          updatedByUid: profile.uid,
        })
        .onConflictDoUpdate({
          target: fieldConditions.id,
          set: {
            lokasi: cleanLoc,
            coverCrop: fc.coverCrop,
            bangunanKonservasi: fc.bangunanKonservasi,
            jumlahBangunan: jml,
            namaPetugas: cleanPetugas,
            ...(lat !== null && lon !== null
              ? {
                  latitude: lat,
                  longitude: lon,
                  horizontalAccuracyM: hAcc,
                  verticalAccuracyM: vAcc,
                }
              : {}),
            ...(photoDataUrl ? { photoDataUrl } : {}),
            updatedByUid: profile.uid,
            updatedAt: new Date(),
          },
        });
      result.syncedFieldConditionIds.push(id);
    }

    // 3. Batch canopy covers
    for (const cc of payload.canopyCovers || []) {
      if (!isValidCompanyName(cc.perusahaan)) continue;
      if (!enforceCompanyAccess(cc.perusahaan)) continue;
      const cleanLoc = normalizeDisplayText(String(cc.lokasi || '')).slice(0, 100);
      const cleanPetak = normalizeDisplayText(String(cc.nomorPetak || '')).slice(
        0,
        50
      );
      const cleanPetugas = normalizeDisplayText(
        String(cc.namaPetugas || profile.name)
      ).slice(0, 100);
      if (
        !cleanLoc ||
        !cleanPetak ||
        !/^\d{4}-\d{2}$/.test(String(cc.periode || ''))
      )
        continue;
      if (!(CANOPY_OPTIONS as readonly string[]).includes(cc.penutupanTajuk))
        continue;
      const companyKey = getCompanyKey(cc.perusahaan);
      const lokasiKey = makeSafeKey(cleanLoc);
      const petakKey = makeSafeKey(cleanPetak);
      const id = buildCanopyCoverId(companyKey, lokasiKey, petakKey, cc.periode);

      await db
        .insert(canopyCovers)
        .values({
          id,
          perusahaan: cc.perusahaan,
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
        })
        .onConflictDoUpdate({
          target: canopyCovers.id,
          set: {
            lokasi: cleanLoc,
            nomorPetak: cleanPetak,
            penutupanTajuk: cc.penutupanTajuk,
            namaPetugas: cleanPetugas,
            updatedByUid: profile.uid,
            updatedAt: new Date(),
          },
        });
      result.syncedCanopyIds.push(id);
    }

    // 4. Validate and batch-insert plant records
    const normalizedPlants: Array<{
      clientId: string;
      row: typeof plantRecords.$inferInsert;
    }> = [];

    for (const pr of payload.plantRecords || []) {
      const clientId = String(pr.id || '');
      if (!isValidCompanyName(pr.perusahaan)) {
        result.rejected.push({ id: clientId, reason: 'Perusahaan tidak valid.' });
        continue;
      }
      if (!enforceCompanyAccess(pr.perusahaan)) {
        result.rejected.push({
          id: clientId,
          reason: `Akun Anda hanya ditugaskan untuk ${profile.assignedCompany}.`,
        });
        continue;
      }
      if (!isValidMenuType(pr.menuType)) {
        result.rejected.push({ id: clientId, reason: 'Menu input tidak valid.' });
        continue;
      }
      const tanggalInput = String(pr.tanggalInput || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalInput)) {
        result.rejected.push({
          id: clientId,
          reason: 'Format tanggal tidak valid (harus YYYY-MM-DD).',
        });
        continue;
      }
      const waktuInput =
        pr.waktuInput && /^\d{2}:\d{2}(:\d{2})?$/.test(String(pr.waktuInput))
          ? String(pr.waktuInput)
          : null;
      const cleanLoc = normalizeDisplayText(String(pr.lokasi || '')).slice(0, 100);
      const cleanPetugas = normalizeDisplayText(
        String(pr.namaPetugas || profile.name)
      ).slice(0, 100);
      const cleanPetak =
        pr.menuType === 'SENSUS'
          ? ''
          : normalizeDisplayText(String(pr.nomorPetak || '')).slice(0, 50);

      if (!cleanLoc || !cleanPetugas) {
        result.rejected.push({
          id: clientId,
          reason: 'Lokasi dan nama petugas wajib diisi.',
        });
        continue;
      }
      if (pr.menuType !== 'SENSUS' && !cleanPetak) {
        result.rejected.push({
          id: clientId,
          reason: 'Nomor petak wajib diisi pada menu Monitoring.',
        });
        continue;
      }

      const nomorTanaman = Math.round(Number(pr.nomorTanaman));
      if (
        !Number.isSafeInteger(nomorTanaman) ||
        nomorTanaman < 1 ||
        nomorTanaman > 9999999
      ) {
        result.rejected.push({
          id: clientId,
          reason: 'Nomor tanaman harus bilangan bulat positif.',
        });
        continue;
      }

      const companyKey = getCompanyKey(pr.perusahaan);
      const kelompok =
        pr.kelompokTanaman === 'LOKAL_MPTS' ? 'LOKAL_MPTS' : 'FGS';
      const cleanJenis = normalizeDisplayText(String(pr.jenisTanaman || ''));
      if (!isSpeciesAllowed(companyKey, kelompok, cleanJenis)) {
        result.rejected.push({
          id: clientId,
          reason: `Jenis tanaman "${pr.jenisTanaman}" tidak terdaftar pada ${pr.perusahaan}.`,
        });
        continue;
      }
      if (!(PLANT_CONDITIONS as readonly string[]).includes(pr.kondisiTanaman)) {
        result.rejected.push({
          id: clientId,
          reason: 'Kondisi tanaman tidak valid.',
        });
        continue;
      }

      const isMati = pr.kondisiTanaman === 'Mati';
      const tinggiCm = isMati ? 0 : Number(pr.tinggiCm);
      const diameterMm = isMati ? 0 : Number(pr.diameterMm);

      if (
        !isMati &&
        (!Number.isFinite(tinggiCm) ||
          tinggiCm < DIMENSION_BOUNDS.tinggiCm.hardMin ||
          tinggiCm > DIMENSION_BOUNDS.tinggiCm.hardMax)
      ) {
        result.rejected.push({
          id: clientId,
          reason: 'Nilai tinggi tanaman (cm) di luar batas wajar.',
        });
        continue;
      }
      if (
        !isMati &&
        (!Number.isFinite(diameterMm) ||
          diameterMm < DIMENSION_BOUNDS.diameterMm.hardMin ||
          diameterMm > DIMENSION_BOUNDS.diameterMm.hardMax)
      ) {
        result.rejected.push({
          id: clientId,
          reason: 'Nilai diameter tanaman (mm) di luar batas wajar.',
        });
        continue;
      }

      let photoDataUrl: string | null = null;
      try {
        photoDataUrl = validatePhotoDataUrl(pr.photoDataUrl);
      } catch (photoErr) {
        result.rejected.push({
          id: clientId,
          reason:
            photoErr instanceof Error
              ? photoErr.message
              : 'Lampiran foto tidak valid.',
        });
        continue;
      }

      const lat = sanitizeFiniteNumber(pr.latitude, -90, 90);
      const lon = sanitizeFiniteNumber(pr.longitude, -180, 180);
      const alt = sanitizeFiniteNumber(pr.altitudeM, -1000, 10000);
      const hAcc = sanitizeFiniteNumber(pr.horizontalAccuracyM, 0, 10000);
      const vAcc = sanitizeFiniteNumber(pr.verticalAccuracyM, 0, 10000);

      const periode = extractPeriode(tanggalInput);
      const lokasiKey = makeSafeKey(cleanLoc);
      const petakKey =
        pr.menuType === 'SENSUS' ? 'SENSUS' : makeSafeKey(cleanPetak);
      const canonicalId = buildPlantRecordId(
        companyKey,
        pr.menuType,
        lokasiKey,
        petakKey,
        periode,
        nomorTanaman
      );

      normalizedPlants.push({
        clientId: clientId || canonicalId,
        row: {
          id: canonicalId,
          perusahaan: pr.perusahaan,
          companyKey,
          menuType: pr.menuType,
          tanggalInput,
          waktuInput,
          periode,
          lokasi: cleanLoc,
          lokasiKey,
          namaPetugas: cleanPetugas,
          nomorPetak: cleanPetak,
          petakKey,
          nomorTanaman,
          kelompokTanaman: kelompok,
          jenisTanaman: cleanJenis,
          tinggiCm,
          diameterMm,
          kondisiTanaman: pr.kondisiTanaman,
          keterangan: String(pr.keterangan || '').trim().slice(0, 500),
          extremeConfirmed: Boolean(pr.extremeConfirmed),
          latitude: lat,
          longitude: lon,
          altitudeM: alt,
          horizontalAccuracyM: hAcc,
          verticalAccuracyM: vAcc,
          gnssSource: pr.gnssSource ? String(pr.gnssSource).slice(0, 60) : null,
          coordCrs: pr.coordCrs ? String(pr.coordCrs).slice(0, 30) : 'EPSG:4326',
          photoDataUrl,
          createdByUid: profile.uid,
          createdByEmail: profile.email,
          updatedByUid: profile.uid,
        },
      });
    }

    if (normalizedPlants.length > 0) {
      const seenBatch = new Map<string, (typeof normalizedPlants)[number]>();
      for (const item of normalizedPlants) {
        if (!seenBatch.has(item.row.id)) {
          seenBatch.set(item.row.id, item);
        } else {
          result.conflicts.push({
            id: item.clientId,
            reason: `Nomor #${item.row.nomorTanaman} di ${item.row.perusahaan} duplikat dalam antrean yang sama.`,
          });
        }
      }

      const uniqueItems = Array.from(seenBatch.values());
      const idsToCheck = uniqueItems.map((x) => x.row.id);

      const existingRows = await db
        .select()
        .from(plantRecords)
        .where(inArray(plantRecords.id, idsToCheck));

      const existingMap = new Map(existingRows.map((r) => [r.id, r]));
      const toInsert: Array<typeof plantRecords.$inferInsert> = [];

      for (const item of uniqueItems) {
        const existing = existingMap.get(item.row.id);
        if (existing) {
          const sameSubmission =
            existing.createdByUid === profile.uid &&
            existing.tanggalInput === item.row.tanggalInput &&
            (existing.waktuInput || null) === (item.row.waktuInput || null) &&
            existing.jenisTanaman === item.row.jenisTanaman &&
            existing.kondisiTanaman === item.row.kondisiTanaman;

          if (sameSubmission) {
            result.syncedPlantIds.push(item.clientId);
          } else {
            result.conflicts.push({
              id: item.clientId,
              reason: `Nomor #${item.row.nomorTanaman} di ${item.row.perusahaan} sudah lebih dulu diinput oleh ${existing.namaPetugas} (${existing.tanggalInput}).`,
            });
          }
        } else {
          toInsert.push(item.row);
        }
      }

      if (toInsert.length > 0) {
        const inserted = await db
          .insert(plantRecords)
          .values(toInsert)
          .onConflictDoNothing({ target: plantRecords.id })
          .returning({ id: plantRecords.id });

        const insertedSet = new Set(inserted.map((r) => r.id));
        for (const item of uniqueItems) {
          if (insertedSet.has(item.row.id)) {
            result.syncedPlantIds.push(item.clientId);
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.error('Batch sync failed:', error);
    throw new Error('Gagal menyimpan paket data ke server PostgreSQL.', {
      cause: error,
    });
  }
}

export async function updatePlantRecordAdmin(
  adminUid: string,
  recordId: string,
  updates: Partial<{
    perusahaan: CompanyName;
    tanggalInput: string;
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
  }>
): Promise<PlantRecord> {
  try {
    const rows = await db
      .select()
      .from(plantRecords)
      .where(eq(plantRecords.id, recordId))
      .limit(1);

    if (rows.length === 0) {
      throw new Error('Data tanaman tidak ditemukan di server.');
    }

    const existing = rows[0];
    const nextPerusahaan = resolveCompanyName(
      updates.perusahaan ?? existing.perusahaan
    );
    const nextCompanyKey = getCompanyKey(nextPerusahaan);
    const nextTanggal = updates.tanggalInput ?? existing.tanggalInput;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextTanggal)) {
      throw new Error('Format tanggal harus YYYY-MM-DD.');
    }
    const nextLokasi = normalizeDisplayText(
      updates.lokasi ?? existing.lokasi
    ).slice(0, 100);
    const nextPetugas = normalizeDisplayText(
      updates.namaPetugas ?? existing.namaPetugas
    ).slice(0, 100);
    const isSensus = existing.menuType === 'SENSUS';
    const nextPetak = isSensus
      ? ''
      : normalizeDisplayText(updates.nomorPetak ?? existing.nomorPetak).slice(
          0,
          50
        );
    const nextNomor = Math.round(
      Number(updates.nomorTanaman ?? existing.nomorTanaman)
    );
    const nextKelompok = (updates.kelompokTanaman ??
      existing.kelompokTanaman) as PlantGroup;
    const nextJenis = normalizeDisplayText(
      updates.jenisTanaman ?? existing.jenisTanaman
    );
    const nextKondisi = (updates.kondisiTanaman ??
      existing.kondisiTanaman) as PlantCondition;

    if (!nextLokasi || !nextPetugas || (!isSensus && !nextPetak)) {
      throw new Error('Lokasi, nama petugas, dan petak wajib diisi.');
    }
    if (!nextJenis) {
      throw new Error('Jenis tanaman wajib diisi.');
    }
    if (!(PLANT_CONDITIONS as readonly string[]).includes(nextKondisi)) {
      throw new Error('Kondisi tanaman tidak valid.');
    }

    const isMati = nextKondisi === 'Mati';
    const nextTinggi = isMati
      ? 0
      : Number(updates.tinggiCm ?? existing.tinggiCm);
    const nextDiameter = isMati
      ? 0
      : Number(updates.diameterMm ?? existing.diameterMm);

    if (
      !isMati &&
      (!Number.isFinite(nextTinggi) ||
        nextTinggi < DIMENSION_BOUNDS.tinggiCm.hardMin ||
        nextTinggi > DIMENSION_BOUNDS.tinggiCm.hardMax)
    ) {
      throw new Error('Tinggi (cm) tidak valid.');
    }
    if (
      !isMati &&
      (!Number.isFinite(nextDiameter) ||
        nextDiameter < DIMENSION_BOUNDS.diameterMm.hardMin ||
        nextDiameter > DIMENSION_BOUNDS.diameterMm.hardMax)
    ) {
      throw new Error('Diameter (mm) tidak valid.');
    }

    const updated = await db
      .update(plantRecords)
      .set({
        perusahaan: nextPerusahaan,
        companyKey: nextCompanyKey,
        tanggalInput: nextTanggal,
        periode: extractPeriode(nextTanggal),
        lokasi: nextLokasi,
        lokasiKey: makeSafeKey(nextLokasi),
        namaPetugas: nextPetugas,
        nomorPetak: nextPetak,
        petakKey: isSensus ? 'SENSUS' : makeSafeKey(nextPetak),
        nomorTanaman: nextNomor,
        kelompokTanaman: nextKelompok,
        jenisTanaman: nextJenis,
        tinggiCm: nextTinggi,
        diameterMm: nextDiameter,
        kondisiTanaman: nextKondisi,
        keterangan: String(updates.keterangan ?? existing.keterangan)
          .trim()
          .slice(0, 500),
        extremeConfirmed:
          updates.extremeConfirmed ?? existing.extremeConfirmed,
        updatedByUid: adminUid,
        updatedAt: new Date(),
      })
      .where(eq(plantRecords.id, recordId))
      .returning();

    return mapPlantRow(updated[0]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('tidak')) {
      throw error;
    }
    console.error('Admin update plant failed:', error);
    throw new Error('Gagal memperbarui data tanaman.', { cause: error });
  }
}

export async function deletePlantRecordAdmin(recordId: string): Promise<void> {
  try {
    await db.delete(plantRecords).where(eq(plantRecords.id, recordId));
  } catch (error) {
    console.error('Admin delete plant failed:', error);
    throw new Error('Gagal menghapus data tanaman.', { cause: error });
  }
}

function normalizeNumberRange(
  startRaw: unknown,
  endRaw: unknown
): { rangeStart: number | null; rangeEnd: number | null } {
  if (
    startRaw === null ||
    startRaw === undefined ||
    startRaw === '' ||
    endRaw === null ||
    endRaw === undefined ||
    endRaw === ''
  ) {
    return { rangeStart: null, rangeEnd: null };
  }
  const s = Math.round(Number(startRaw));
  const e = Math.round(Number(endRaw));
  if (!Number.isSafeInteger(s) || !Number.isSafeInteger(e) || s < 1 || e < s) {
    throw new Error(
      'Rentang nomor regu tidak valid (batas awal >= 1 dan batas akhir >= batas awal).'
    );
  }
  return { rangeStart: s, rangeEnd: e };
}

export async function addStaffAdmin(params: {
  adminUid: string;
  email: string;
  name: string;
  role: UserRole;
  assignedCompany: AssignedCompany;
  rangeStart?: number | null;
  rangeEnd?: number | null;
}): Promise<StaffMember> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = normalizeDisplayText(params.name).slice(0, 100);
  if (!cleanEmail.includes('@') || !cleanName) {
    throw new Error('Email dan nama petugas wajib diisi.');
  }
  const { rangeStart, rangeEnd } = normalizeNumberRange(
    params.rangeStart,
    params.rangeEnd
  );
  const staffId = makeSafeKey(cleanEmail, 80);

  try {
    const inserted = await db
      .insert(staffWhitelist)
      .values({
        id: staffId,
        email: cleanEmail,
        name: cleanName,
        role: params.role === 'admin' ? 'admin' : 'petugas',
        assignedCompany: params.assignedCompany || 'ALL',
        rangeStart,
        rangeEnd,
        active: true,
        createdByUid: params.adminUid,
      })
      .onConflictDoUpdate({
        target: staffWhitelist.email,
        set: {
          name: cleanName,
          role: params.role === 'admin' ? 'admin' : 'petugas',
          assignedCompany: params.assignedCompany || 'ALL',
          rangeStart,
          rangeEnd,
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    const s = inserted[0];
    return {
      id: s.id,
      email: s.email,
      name: s.name,
      role: (s.role === 'admin' ? 'admin' : 'petugas') as UserRole,
      assignedCompany: (s.assignedCompany || 'ALL') as AssignedCompany,
      rangeStart: s.rangeStart ?? null,
      rangeEnd: s.rangeEnd ?? null,
      active: s.active,
      createdByUid: s.createdByUid,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  } catch (error) {
    console.error('Add staff failed:', error);
    throw new Error('Gagal menambahkan akun petugas.', { cause: error });
  }
}

export async function updateStaffAdmin(
  staffId: string,
  updates: {
    name: string;
    role: UserRole;
    assignedCompany: AssignedCompany;
    rangeStart?: number | null;
    rangeEnd?: number | null;
    active: boolean;
  }
): Promise<StaffMember> {
  const cleanName = normalizeDisplayText(updates.name).slice(0, 100);
  const role: UserRole = updates.role === 'admin' ? 'admin' : 'petugas';
  const assignedCompany: AssignedCompany = updates.assignedCompany || 'ALL';
  const { rangeStart, rangeEnd } = normalizeNumberRange(
    updates.rangeStart,
    updates.rangeEnd
  );

  try {
    const rows = await db
      .update(staffWhitelist)
      .set({
        name: cleanName,
        role,
        assignedCompany,
        rangeStart,
        rangeEnd,
        active: updates.active,
        updatedAt: new Date(),
      })
      .where(eq(staffWhitelist.id, staffId))
      .returning();

    if (rows.length === 0) {
      throw new Error('Akun petugas tidak ditemukan.');
    }

    const s = rows[0];
    await db
      .update(users)
      .set({
        name: cleanName,
        role,
        assignedCompany,
        rangeStart,
        rangeEnd,
        active: updates.active,
        updatedAt: new Date(),
      })
      .where(eq(users.staffId, staffId));

    return {
      id: s.id,
      email: s.email,
      name: s.name,
      role: (s.role === 'admin' ? 'admin' : 'petugas') as UserRole,
      assignedCompany: (s.assignedCompany || 'ALL') as AssignedCompany,
      rangeStart: s.rangeStart ?? null,
      rangeEnd: s.rangeEnd ?? null,
      active: s.active,
      createdByUid: s.createdByUid,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  } catch (error) {
    console.error('Update staff failed:', error);
    throw new Error('Gagal memperbarui data petugas.', { cause: error });
  }
}

export async function deleteStaffAdmin(staffId: string): Promise<void> {
  if (staffId === 'bootstrap_admin') {
    throw new Error('Akun Administrator utama tidak dapat dihapus.');
  }
  try {
    await db.delete(staffWhitelist).where(eq(staffWhitelist.id, staffId));
    await db
      .update(users)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(users.staffId, staffId));
  } catch (error) {
    console.error('Delete staff failed:', error);
    throw new Error('Gagal menghapus akun petugas.', { cause: error });
  }
}

// ==========================================
// Admin Master Data (Locations, Petaks, Species)
// ==========================================

export async function addLocationAdmin(params: {
  adminUid: string;
  perusahaan: CompanyName;
  name: string;
}): Promise<LocationMaster> {
  if (!isValidCompanyName(params.perusahaan)) {
    throw new Error('Perusahaan tidak valid.');
  }
  const cleanName = normalizeDisplayText(params.name).slice(0, 100);
  if (!cleanName) throw new Error('Nama lokasi wajib diisi.');
  const companyKey = getCompanyKey(params.perusahaan);
  const lokasiKey = makeSafeKey(cleanName);
  const id = buildLocationDocId(companyKey, lokasiKey);

  const rows = await db
    .insert(locationsMaster)
    .values({
      id,
      perusahaan: params.perusahaan,
      companyKey,
      name: cleanName,
      lokasiKey,
      createdByUid: params.adminUid,
    })
    .onConflictDoUpdate({
      target: locationsMaster.id,
      set: { name: cleanName },
    })
    .returning();

  const l = rows[0];
  return {
    id: l.id,
    perusahaan: resolveCompanyName(l.perusahaan),
    companyKey: l.companyKey,
    name: l.name,
    lokasiKey: l.lokasiKey,
    createdByUid: l.createdByUid,
    createdAt: l.createdAt,
    syncStatus: 'synced',
  };
}

export async function deleteLocationAdmin(id: string): Promise<void> {
  await db.delete(locationsMaster).where(eq(locationsMaster.id, id));
}

export async function addPetakAdmin(params: {
  adminUid: string;
  perusahaan: CompanyName;
  lokasi: string;
  name: string;
}): Promise<PetakMaster> {
  if (!isValidCompanyName(params.perusahaan)) {
    throw new Error('Perusahaan tidak valid.');
  }
  const cleanLoc = normalizeDisplayText(params.lokasi).slice(0, 100);
  const cleanName = normalizeDisplayText(params.name).slice(0, 50);
  if (!cleanLoc || !cleanName) {
    throw new Error('Lokasi dan nomor petak wajib diisi.');
  }
  const companyKey = getCompanyKey(params.perusahaan);
  const lokasiKey = makeSafeKey(cleanLoc);
  const petakKey = makeSafeKey(cleanName);
  const id = buildPetakDocId(companyKey, lokasiKey, petakKey);

  // Also ensure location exists in locationsMaster
  const locId = buildLocationDocId(companyKey, lokasiKey);
  await db
    .insert(locationsMaster)
    .values({
      id: locId,
      perusahaan: params.perusahaan,
      companyKey,
      name: cleanLoc,
      lokasiKey,
      createdByUid: params.adminUid,
    })
    .onConflictDoNothing({ target: locationsMaster.id });

  const rows = await db
    .insert(petaksMaster)
    .values({
      id,
      perusahaan: params.perusahaan,
      companyKey,
      lokasi: cleanLoc,
      lokasiKey,
      name: cleanName,
      petakKey,
      createdByUid: params.adminUid,
    })
    .onConflictDoUpdate({
      target: petaksMaster.id,
      set: { lokasi: cleanLoc, name: cleanName },
    })
    .returning();

  const p = rows[0];
  return {
    id: p.id,
    perusahaan: resolveCompanyName(p.perusahaan),
    companyKey: p.companyKey,
    lokasi: p.lokasi,
    lokasiKey: p.lokasiKey,
    name: p.name,
    petakKey: p.petakKey,
    createdByUid: p.createdByUid,
    createdAt: p.createdAt,
  };
}

export async function deletePetakAdmin(id: string): Promise<void> {
  await db.delete(petaksMaster).where(eq(petaksMaster.id, id));
}

export async function addSpeciesAdmin(params: {
  adminUid: string;
  perusahaan: CompanyName;
  kelompokTanaman: PlantGroup;
  name: string;
}): Promise<SpeciesMaster> {
  if (!isValidCompanyName(params.perusahaan)) {
    throw new Error('Perusahaan tidak valid.');
  }
  const kelompok: PlantGroup =
    params.kelompokTanaman === 'LOKAL_MPTS' ? 'LOKAL_MPTS' : 'FGS';
  const cleanName = normalizeDisplayText(params.name).slice(0, 80);
  if (!cleanName) throw new Error('Nama jenis tanaman wajib diisi.');

  const companyKey = getCompanyKey(params.perusahaan);
  const speciesKey = makeSafeKey(cleanName);
  const id = buildSpeciesDocId(companyKey, kelompok, speciesKey);

  const rows = await db
    .insert(speciesMaster)
    .values({
      id,
      perusahaan: params.perusahaan,
      companyKey,
      kelompokTanaman: kelompok,
      name: cleanName,
      speciesKey,
      active: true,
      createdByUid: params.adminUid,
    })
    .onConflictDoUpdate({
      target: speciesMaster.id,
      set: { name: cleanName, active: true },
    })
    .returning();

  const s = rows[0];
  return {
    id: s.id,
    perusahaan: resolveCompanyName(s.perusahaan),
    companyKey: s.companyKey,
    kelompokTanaman: s.kelompokTanaman as PlantGroup,
    name: s.name,
    speciesKey: s.speciesKey,
    active: s.active,
    createdByUid: s.createdByUid,
    createdAt: s.createdAt,
  };
}

export async function toggleSpeciesAdmin(
  id: string,
  active: boolean
): Promise<SpeciesMaster> {
  const rows = await db
    .update(speciesMaster)
    .set({ active })
    .where(eq(speciesMaster.id, id))
    .returning();
  if (rows.length === 0) throw new Error('Jenis tanaman tidak ditemukan.');
  const s = rows[0];
  return {
    id: s.id,
    perusahaan: resolveCompanyName(s.perusahaan),
    companyKey: s.companyKey,
    kelompokTanaman: s.kelompokTanaman as PlantGroup,
    name: s.name,
    speciesKey: s.speciesKey,
    active: s.active,
    createdByUid: s.createdByUid,
    createdAt: s.createdAt,
  };
}

export async function deleteSpeciesAdmin(id: string): Promise<void> {
  await db.delete(speciesMaster).where(eq(speciesMaster.id, id));
}

// ==========================================
// Company Google Spreadsheets
// ==========================================

export async function upsertCompanySpreadsheetAdmin(params: {
  perusahaan: CompanyName;
  spreadsheetId: string;
  spreadsheetUrl: string;
  ownerEmail: string;
  syncedRecordCount?: number;
}): Promise<CompanySpreadsheet> {
  if (!isValidCompanyName(params.perusahaan)) {
    throw new Error('Perusahaan tidak valid.');
  }
  const companyKey = getCompanyKey(params.perusahaan);
  const rows = await db
    .insert(companySpreadsheets)
    .values({
      companyKey,
      perusahaan: params.perusahaan,
      spreadsheetId: params.spreadsheetId.trim(),
      spreadsheetUrl: params.spreadsheetUrl.trim(),
      ownerEmail: params.ownerEmail.trim().toLowerCase(),
      lastSyncedAt: new Date(),
      syncedRecordCount: Math.max(0, Math.round(params.syncedRecordCount || 0)),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: companySpreadsheets.companyKey,
      set: {
        spreadsheetId: params.spreadsheetId.trim(),
        spreadsheetUrl: params.spreadsheetUrl.trim(),
        ownerEmail: params.ownerEmail.trim().toLowerCase(),
        lastSyncedAt: new Date(),
        syncedRecordCount: Math.max(
          0,
          Math.round(params.syncedRecordCount || 0)
        ),
        updatedAt: new Date(),
      },
    })
    .returning();

  const r = rows[0];
  return {
    companyKey: r.companyKey,
    perusahaan: resolveCompanyName(r.perusahaan),
    spreadsheetId: r.spreadsheetId,
    spreadsheetUrl: r.spreadsheetUrl,
    ownerEmail: r.ownerEmail,
    lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
    syncedRecordCount: r.syncedRecordCount,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function markCompanyRecordsSheetSyncedAdmin(params: {
  perusahaan: CompanyName;
  recordIds?: string[];
  syncedCount: number;
}): Promise<void> {
  const companyKey = getCompanyKey(params.perusahaan);
  const now = new Date();
  if (params.recordIds && params.recordIds.length > 0) {
    await db
      .update(plantRecords)
      .set({ sheetSyncedAt: now })
      .where(inArray(plantRecords.id, params.recordIds));
  } else {
    await db
      .update(plantRecords)
      .set({ sheetSyncedAt: now })
      .where(eq(plantRecords.companyKey, companyKey));
  }
  await db
    .update(companySpreadsheets)
    .set({
      lastSyncedAt: now,
      syncedRecordCount: Math.max(0, Math.round(params.syncedCount)),
      updatedAt: now,
    })
    .where(eq(companySpreadsheets.companyKey, companyKey));
}

// ==========================================
// Base Map Layers (PDF / Shapefile / GeoJSON)
// ==========================================

export async function addBaseMapAdmin(params: {
  adminUid: string;
  perusahaan: CompanyName;
  name: string;
  fileType: BaseMapFileType;
  crsCode: CoordCrsCode;
  fileDataBase64?: string | null;
  geoJsonText?: string | null;
  bboxJson?: string | null;
}): Promise<BaseMapLayer> {
  if (!isValidCompanyName(params.perusahaan)) {
    throw new Error('Perusahaan tidak valid.');
  }
  const cleanName = normalizeDisplayText(params.name).slice(0, 120);
  if (!cleanName) throw new Error('Nama layer peta wajib diisi.');
  if (
    params.fileType !== 'pdf' &&
    params.fileType !== 'shapefile' &&
    params.fileType !== 'geojson'
  ) {
    throw new Error('Tipe file peta harus PDF, Shapefile, atau GeoJSON.');
  }
  if (params.fileDataBase64 && params.fileDataBase64.length > 22 * 1024 * 1024) {
    throw new Error('Ukuran file peta terlalu besar (maksimal ~15 MB).');
  }
  if (params.geoJsonText && params.geoJsonText.length > 15 * 1024 * 1024) {
    throw new Error('Ukuran data vektor terlalu besar.');
  }

  const companyKey = getCompanyKey(params.perusahaan);
  const id = `map__${companyKey}__${makeSafeKey(cleanName)}__${Date.now().toString(36)}`;

  const rows = await db
    .insert(baseMapLayers)
    .values({
      id,
      perusahaan: params.perusahaan,
      companyKey,
      name: cleanName,
      fileType: params.fileType,
      crsCode: params.crsCode || 'EPSG:4326',
      fileDataBase64: params.fileDataBase64 ?? null,
      geoJsonText: params.geoJsonText ?? null,
      bboxJson: params.bboxJson ?? null,
      uploadedByUid: params.adminUid,
    })
    .returning();

  const m = rows[0];
  return {
    id: m.id,
    perusahaan: resolveCompanyName(m.perusahaan),
    companyKey: m.companyKey,
    name: m.name,
    fileType: m.fileType as BaseMapFileType,
    crsCode: m.crsCode as CoordCrsCode,
    bboxJson: m.bboxJson,
    uploadedByUid: m.uploadedByUid,
    createdAt: m.createdAt,
  };
}

export async function getBaseMapById(
  id: string,
  profile: UserProfile
): Promise<BaseMapLayer | null> {
  const rows = await db
    .select()
    .from(baseMapLayers)
    .where(eq(baseMapLayers.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const m = rows[0];
  if (
    profile.role !== 'admin' &&
    profile.assignedCompany !== 'ALL' &&
    getCompanyKey(profile.assignedCompany) !== m.companyKey
  ) {
    throw new Error('Tidak memiliki akses ke peta perusahaan ini.');
  }
  return {
    id: m.id,
    perusahaan: resolveCompanyName(m.perusahaan),
    companyKey: m.companyKey,
    name: m.name,
    fileType: m.fileType as BaseMapFileType,
    crsCode: m.crsCode as CoordCrsCode,
    fileDataBase64: m.fileDataBase64,
    geoJsonText: m.geoJsonText,
    bboxJson: m.bboxJson,
    uploadedByUid: m.uploadedByUid,
    createdAt: m.createdAt,
  };
}

export async function deleteBaseMapAdmin(id: string): Promise<void> {
  await db.delete(baseMapLayers).where(eq(baseMapLayers.id, id));
}

export async function upsertEvalSettingsAdmin(params: {
  adminUid: string;
  companyKey: string;
  enabled: boolean;
  minSurvivalPct: number;
  minDeltaHeightCm: number;
}): Promise<GrowthEvalSettings> {
  const validKeys = new Set(['ALL', 'pt_nbss', 'pt_dtsa', 'pt_dtr']);
  const ck = validKeys.has(params.companyKey) ? params.companyKey : 'ALL';
  const minSurvivalPct = Math.min(
    100,
    Math.max(10, Number(params.minSurvivalPct) || 80)
  );
  const minDeltaHeightCm = Math.min(
    100,
    Math.max(0, Number(params.minDeltaHeightCm) || 0)
  );

  const rows = await db
    .insert(growthEvalSettings)
    .values({
      companyKey: ck,
      enabled: Boolean(params.enabled),
      minSurvivalPct,
      minDeltaHeightCm,
      updatedByUid: params.adminUid,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: growthEvalSettings.companyKey,
      set: {
        enabled: Boolean(params.enabled),
        minSurvivalPct,
        minDeltaHeightCm,
        updatedByUid: params.adminUid,
        updatedAt: new Date(),
      },
    })
    .returning();

  const r = rows[0];
  return {
    companyKey: r.companyKey,
    enabled: r.enabled,
    minSurvivalPct: r.minSurvivalPct,
    minDeltaHeightCm: r.minDeltaHeightCm,
    updatedByUid: r.updatedByUid,
    updatedAt: r.updatedAt.toISOString(),
  };
}
