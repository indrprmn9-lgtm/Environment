import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('petugas'),
  assignedCompany: text('assigned_company').notNull().default('ALL'),
  rangeStart: integer('range_start'),
  rangeEnd: integer('range_end'),
  active: boolean('active').notNull().default(true),
  staffId: text('staff_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const staffWhitelist = pgTable('staff_whitelist', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull().default('petugas'),
  assignedCompany: text('assigned_company').notNull().default('ALL'),
  rangeStart: integer('range_start'),
  rangeEnd: integer('range_end'),
  active: boolean('active').notNull().default(true),
  createdByUid: text('created_by_uid').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const locationsMaster = pgTable(
  'locations_master',
  {
    id: text('id').primaryKey(),
    perusahaan: text('perusahaan').notNull(),
    companyKey: text('company_key').notNull(),
    name: text('name').notNull(),
    lokasiKey: text('lokasi_key').notNull(),
    createdByUid: text('created_by_uid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('locations_company_idx').on(table.companyKey)]
);

export const petaksMaster = pgTable(
  'petaks_master',
  {
    id: text('id').primaryKey(),
    perusahaan: text('perusahaan').notNull(),
    companyKey: text('company_key').notNull(),
    lokasi: text('lokasi').notNull(),
    lokasiKey: text('lokasi_key').notNull(),
    name: text('name').notNull(),
    petakKey: text('petak_key').notNull(),
    createdByUid: text('created_by_uid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('petaks_company_loc_idx').on(table.companyKey, table.lokasiKey),
  ]
);

export const speciesMaster = pgTable(
  'species_master',
  {
    id: text('id').primaryKey(),
    perusahaan: text('perusahaan').notNull(),
    companyKey: text('company_key').notNull(),
    kelompokTanaman: text('kelompok_tanaman').notNull(),
    name: text('name').notNull(),
    speciesKey: text('species_key').notNull(),
    active: boolean('active').notNull().default(true),
    createdByUid: text('created_by_uid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('species_company_group_idx').on(
      table.companyKey,
      table.kelompokTanaman
    ),
  ]
);

export const fieldConditions = pgTable(
  'field_conditions',
  {
    id: text('id').primaryKey(),
    perusahaan: text('perusahaan').notNull(),
    companyKey: text('company_key').notNull(),
    menuType: text('menu_type').notNull(),
    lokasi: text('lokasi').notNull(),
    lokasiKey: text('lokasi_key').notNull(),
    periode: text('periode').notNull(),
    coverCrop: text('cover_crop').notNull(),
    bangunanKonservasi: text('bangunan_konservasi').notNull(),
    jumlahBangunan: integer('jumlah_bangunan').notNull().default(0),
    namaPetugas: text('nama_petugas').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    horizontalAccuracyM: doublePrecision('horizontal_accuracy_m'),
    verticalAccuracyM: doublePrecision('vertical_accuracy_m'),
    photoDataUrl: text('photo_data_url'),
    createdByUid: text('created_by_uid').notNull(),
    updatedByUid: text('updated_by_uid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('field_cond_scope_idx').on(
      table.companyKey,
      table.menuType,
      table.lokasiKey,
      table.periode
    ),
  ]
);

export const canopyCovers = pgTable(
  'canopy_covers',
  {
    id: text('id').primaryKey(),
    perusahaan: text('perusahaan').notNull(),
    companyKey: text('company_key').notNull(),
    menuType: text('menu_type').notNull(),
    lokasi: text('lokasi').notNull(),
    lokasiKey: text('lokasi_key').notNull(),
    nomorPetak: text('nomor_petak').notNull(),
    petakKey: text('petak_key').notNull(),
    periode: text('periode').notNull(),
    penutupanTajuk: text('penutupan_tajuk').notNull(),
    namaPetugas: text('nama_petugas').notNull(),
    createdByUid: text('created_by_uid').notNull(),
    updatedByUid: text('updated_by_uid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('canopy_scope_idx').on(
      table.companyKey,
      table.lokasiKey,
      table.petakKey,
      table.periode
    ),
  ]
);

export const plantRecords = pgTable(
  'plant_records',
  {
    id: text('id').primaryKey(),
    perusahaan: text('perusahaan').notNull(),
    companyKey: text('company_key').notNull(),
    menuType: text('menu_type').notNull(),
    tanggalInput: text('tanggal_input').notNull(),
    waktuInput: text('waktu_input'),
    periode: text('periode').notNull(),
    lokasi: text('lokasi').notNull(),
    lokasiKey: text('lokasi_key').notNull(),
    namaPetugas: text('nama_petugas').notNull(),
    nomorPetak: text('nomor_petak').notNull().default(''),
    petakKey: text('petak_key').notNull(),
    nomorTanaman: integer('nomor_tanaman').notNull(),
    kelompokTanaman: text('kelompok_tanaman').notNull(),
    jenisTanaman: text('jenis_tanaman').notNull(),
    tinggiCm: doublePrecision('tinggi_cm').notNull().default(0),
    diameterMm: doublePrecision('diameter_mm').notNull().default(0),
    kondisiTanaman: text('kondisi_tanaman').notNull(),
    keterangan: text('keterangan').notNull().default(''),
    extremeConfirmed: boolean('extreme_confirmed').notNull().default(false),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    altitudeM: doublePrecision('altitude_m'),
    horizontalAccuracyM: doublePrecision('horizontal_accuracy_m'),
    verticalAccuracyM: doublePrecision('vertical_accuracy_m'),
    gnssSource: text('gnss_source'),
    coordCrs: text('coord_crs').default('EPSG:4326'),
    photoDataUrl: text('photo_data_url'),
    sheetSyncedAt: timestamp('sheet_synced_at'),
    createdByUid: text('created_by_uid').notNull(),
    createdByEmail: text('created_by_email').notNull(),
    updatedByUid: text('updated_by_uid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('plant_scope_idx').on(
      table.companyKey,
      table.menuType,
      table.lokasiKey,
      table.periode
    ),
    index('plant_date_idx').on(table.tanggalInput),
    index('plant_periode_idx').on(table.periode),
  ]
);

export const companySpreadsheets = pgTable('company_spreadsheets', {
  companyKey: text('company_key').primaryKey(),
  perusahaan: text('perusahaan').notNull(),
  spreadsheetId: text('spreadsheet_id').notNull(),
  spreadsheetUrl: text('spreadsheet_url').notNull(),
  ownerEmail: text('owner_email').notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  syncedRecordCount: integer('synced_record_count').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const baseMapLayers = pgTable(
  'base_map_layers',
  {
    id: text('id').primaryKey(),
    perusahaan: text('perusahaan').notNull(),
    companyKey: text('company_key').notNull(),
    name: text('name').notNull(),
    fileType: text('file_type').notNull(),
    crsCode: text('crs_code').notNull().default('EPSG:4326'),
    fileDataBase64: text('file_data_base64'),
    geoJsonText: text('geo_json_text'),
    bboxJson: text('bbox_json'),
    uploadedByUid: text('uploaded_by_uid').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('basemap_company_idx').on(table.companyKey)]
);

export const growthEvalSettings = pgTable('growth_eval_settings', {
  companyKey: text('company_key').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  minSurvivalPct: doublePrecision('min_survival_pct').notNull().default(80),
  minDeltaHeightCm: doublePrecision('min_delta_height_cm').notNull().default(2),
  updatedByUid: text('updated_by_uid').notNull().default('system'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
