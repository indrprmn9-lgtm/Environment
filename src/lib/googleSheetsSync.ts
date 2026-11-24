import {
  type CanopyCover,
  type CompanyName,
  type FieldCondition,
  type PlantRecord,
} from '../types/plant';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface PetakPeriodTrendRow {
  perusahaan: CompanyName;
  menuType: 'MONITORING_IPPKH' | 'MONITORING_APL';
  lokasi: string;
  nomorPetak: string;
  periode: string;
  totalTanaman: number;
  hidup: number;
  mati: number;
  survivalPct: number;
  avgTinggiCm: number;
  avgDiameterMm: number;
  deltaTinggiCm: number | null;
  statusEvaluasi:
    | 'Pertumbuhan Baik'
    | 'Melambat'
    | 'Perlu Penyulaman'
    | 'Evaluasi Nonaktif';
}

export interface TrendEvalThresholds {
  enabled?: boolean;
  minSurvivalPct?: number;
  minDeltaHeightCm?: number;
}

export function buildMonitoringPetakTrends(
  records: PlantRecord[],
  company?: CompanyName,
  thresholds?: TrendEvalThresholds
): PetakPeriodTrendRow[] {
  const scoped = records.filter(
    (r) =>
      r.menuType !== 'SENSUS' &&
      (!company || r.perusahaan === company) &&
      Boolean(r.nomorPetak)
  );

  const grouped = new Map<
    string,
    {
      perusahaan: CompanyName;
      menuType: 'MONITORING_IPPKH' | 'MONITORING_APL';
      lokasi: string;
      nomorPetak: string;
      periode: string;
      total: number;
      hidup: number;
      mati: number;
      sumH: number;
      sumD: number;
      livingCount: number;
    }
  >();

  for (const r of scoped) {
    const key = `${r.companyKey}__${r.menuType}__${r.lokasiKey}__${r.petakKey}__${r.periode}`;
    const cur = grouped.get(key) || {
      perusahaan: r.perusahaan,
      menuType: r.menuType as 'MONITORING_IPPKH' | 'MONITORING_APL',
      lokasi: r.lokasi,
      nomorPetak: r.nomorPetak,
      periode: r.periode,
      total: 0,
      hidup: 0,
      mati: 0,
      sumH: 0,
      sumD: 0,
      livingCount: 0,
    };
    cur.total++;
    if (r.kondisiTanaman === 'Mati') {
      cur.mati++;
    } else {
      cur.hidup++;
      cur.sumH += r.tinggiCm;
      cur.sumD += r.diameterMm;
      cur.livingCount++;
    }
    grouped.set(key, cur);
  }

  // Group by petak series across chronological periods to compute growth delta
  const byPetakSeries = new Map<string, Array<typeof grouped extends Map<string, infer V> ? V : never>>();
  for (const g of grouped.values()) {
    const pk = `${g.perusahaan}__${g.menuType}__${g.lokasi}__${g.nomorPetak}`;
    const list = byPetakSeries.get(pk) || [];
    list.push(g);
    byPetakSeries.set(pk, list);
  }

  const rows: PetakPeriodTrendRow[] = [];
  for (const series of byPetakSeries.values()) {
    series.sort((a, b) => a.periode.localeCompare(b.periode));
    let prevAvgH: number | null = null;
    for (const item of series) {
      const avgTinggiCm = item.livingCount
        ? Math.round((item.sumH / item.livingCount) * 10) / 10
        : 0;
      const avgDiameterMm = item.livingCount
        ? Math.round((item.sumD / item.livingCount) * 10) / 10
        : 0;
      const survivalPct = item.total
        ? Math.round((item.hidup / item.total) * 1000) / 10
        : 0;
      const deltaTinggiCm =
        prevAvgH !== null ? Math.round((avgTinggiCm - prevAvgH) * 10) / 10 : null;

      const evalEnabled = thresholds?.enabled !== false;
      const minSurv = thresholds?.minSurvivalPct ?? 80;
      const minDelta = thresholds?.minDeltaHeightCm ?? 2;

      let statusEvaluasi: PetakPeriodTrendRow['statusEvaluasi'] = evalEnabled
        ? 'Pertumbuhan Baik'
        : 'Evaluasi Nonaktif';
      if (evalEnabled) {
        if (survivalPct < minSurv) {
          statusEvaluasi = 'Perlu Penyulaman';
        } else if (deltaTinggiCm !== null && deltaTinggiCm < minDelta) {
          statusEvaluasi = 'Melambat';
        }
      }

      rows.push({
        perusahaan: item.perusahaan,
        menuType: item.menuType,
        lokasi: item.lokasi,
        nomorPetak: item.nomorPetak,
        periode: item.periode,
        totalTanaman: item.total,
        hidup: item.hidup,
        mati: item.mati,
        survivalPct,
        avgTinggiCm,
        avgDiameterMm,
        deltaTinggiCm,
        statusEvaluasi,
      });
      prevAvgH = avgTinggiCm;
    }
  }

  return rows.sort((a, b) => {
    if (a.periode !== b.periode) return a.periode.localeCompare(b.periode);
    if (a.menuType !== b.menuType) return a.menuType.localeCompare(b.menuType);
    return a.nomorPetak.localeCompare(b.nomorPetak, 'id');
  });
}

async function sheetsFetch<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Google Sheets API error (${res.status})`;
    throw new Error(errMsg);
  }
  return data as T;
}

const SHEET_TABS = [
  'Rekapitulasi_Analisis',
  'Tren_Monitoring_Petak',
  'Data_Sensus',
  'Monitoring_IPPKH',
  'Monitoring_APL',
  'Kondisi_Lapangan_Tajuk',
] as const;

export async function createCompanySpreadsheet(
  accessToken: string,
  perusahaan: CompanyName
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const created = await sheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
  }>(SHEETS_API_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        title: `Environment - ${perusahaan}`,
        locale: 'id_ID',
      },
      sheets: SHEET_TABS.map((title) => ({
        properties: { title },
      })),
    }),
  });
  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
  };
}

export async function syncCompanyDataToSpreadsheet(params: {
  accessToken: string;
  spreadsheetId: string;
  perusahaan: CompanyName;
  records: PlantRecord[];
  fieldConditions: FieldCondition[];
  canopyCovers: CanopyCover[];
  thresholds?: TrendEvalThresholds;
}): Promise<{ syncedCount: number }> {
  const {
    accessToken,
    spreadsheetId,
    perusahaan,
    records,
    fieldConditions,
    canopyCovers,
    thresholds,
  } = params;

  const compRecords = records.filter((r) => r.perusahaan === perusahaan);
  const compConds = fieldConditions.filter((fc) => fc.perusahaan === perusahaan);
  const compCanopies = canopyCovers.filter((cc) => cc.perusahaan === perusahaan);

  // 1. Inspect existing spreadsheet metadata so missing tabs or old charts are managed cleanly
  const meta = await sheetsFetch<{
    sheets: Array<{
      properties: { sheetId: number; title: string };
      charts?: Array<{ chartId: number }>;
    }>;
  }>(`${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}`, accessToken);

  const sheetMap = new Map<
    string,
    { sheetId: number; charts: Array<{ chartId: number }> }
  >();
  for (const s of meta.sheets || []) {
    sheetMap.set(s.properties.title, {
      sheetId: s.properties.sheetId,
      charts: s.charts || [],
    });
  }

  const addSheetReqs = SHEET_TABS.filter((t) => !sheetMap.has(t)).map(
    (title) => ({
      addSheet: { properties: { title } },
    })
  );

  if (addSheetReqs.length > 0) {
    const added = await sheetsFetch<{
      replies: Array<{ addSheet?: { properties: { sheetId: number; title: string } } }>;
    }>(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: addSheetReqs }),
      }
    );
    for (const rep of added.replies || []) {
      if (rep.addSheet?.properties) {
        sheetMap.set(rep.addSheet.properties.title, {
          sheetId: rep.addSheet.properties.sheetId,
          charts: [],
        });
      }
    }
  }

  // Clear all 6 tabs before writing crisp authoritative rows
  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        ranges: SHEET_TABS.map((t) => `${t}!A1:Z10000`),
      }),
    }
  );

  // Build Rekapitulasi_Analisis
  const total = compRecords.length;
  const sehat = compRecords.filter((r) => r.kondisiTanaman === 'Sehat').length;
  const kurangSehat = compRecords.filter(
    (r) => r.kondisiTanaman === 'Kurang Sehat'
  ).length;
  const merana = compRecords.filter((r) => r.kondisiTanaman === 'Merana').length;
  const mati = compRecords.filter((r) => r.kondisiTanaman === 'Mati').length;
  const hidup = total - mati;
  const living = compRecords.filter((r) => r.kondisiTanaman !== 'Mati');
  const avgH = living.length
    ? Math.round((living.reduce((a, r) => a + r.tinggiCm, 0) / living.length) * 10) /
      10
    : 0;
  const avgD = living.length
    ? Math.round(
        (living.reduce((a, r) => a + r.diameterMm, 0) / living.length) * 10
      ) / 10
    : 0;
  const survivalPct = total ? Math.round((hidup / total) * 1000) / 10 : 0;

  const rekapRows: Array<Array<string | number>> = [
    ['REKAPITULASI & ANALISIS DATABASE TANAMAN', perusahaan, '', ''],
    ['Pembaruan Terakhir', new Date().toLocaleString('id-ID'), '', ''],
    ['', '', '', ''],
    ['Indikator Utama', 'Nilai', 'Satuan / Keterangan', ''],
    ['Total Tanaman Terdata', total, 'pohon', ''],
    ['Tanaman Hidup (Sehat + Kurang Sehat + Merana)', hidup, `${survivalPct}%`, ''],
    ['Sehat', sehat, 'pohon', ''],
    ['Kurang Sehat', kurangSehat, 'pohon', ''],
    ['Merana', merana, 'pohon', ''],
    ['Mati (Butuh Sulam)', mati, 'pohon', ''],
    ['Rata-rata Tinggi Tanaman Hidup', avgH, 'cm', ''],
    ['Rata-rata Diameter Tanaman Hidup', avgD, 'mm', ''],
    ['Total Kondisi Lapangan Tercatat', compConds.length, 'lokasi-periode', ''],
    ['Total Penutupan Tajuk APL', compCanopies.length, 'petak-periode', ''],
  ];

  // Build Tren_Monitoring_Petak
  const trends = buildMonitoringPetakTrends(
    compRecords,
    perusahaan,
    thresholds
  );
  const trendRows: Array<Array<string | number>> = [
    [
      'Label Petak & Periode',
      'Menu Monitoring',
      'Lokasi',
      'Nomor Petak',
      'Periode',
      'Total Tanaman',
      'Hidup',
      'Mati',
      '% Hidup',
      'Rata Tinggi (cm)',
      'Rata Diameter (mm)',
      'Delta Tinggi (cm)',
      'Status Evaluasi',
    ],
    ...trends.map((t) => [
      `${t.nomorPetak} (${t.periode})`,
      t.menuType === 'MONITORING_IPPKH' ? 'IPPKH' : 'APL',
      t.lokasi,
      t.nomorPetak,
      t.periode,
      t.totalTanaman,
      t.hidup,
      t.mati,
      t.survivalPct,
      t.avgTinggiCm,
      t.avgDiameterMm,
      t.deltaTinggiCm ?? '-',
      t.statusEvaluasi,
    ]),
  ];

  const plantHeader = [
    'Tanggal Input',
    'Waktu Input',
    'Periode',
    'Perusahaan',
    'Lokasi / Blok',
    'Nomor Petak',
    'No. Tanaman',
    'Kelompok',
    'Jenis Tanaman',
    'Tinggi (cm)',
    'Diameter (mm)',
    'Kondisi Tanaman',
    'Petugas',
    'Latitude',
    'Longitude',
    'Akurasi Horizontal (m)',
    'Akurasi Vertikal (m)',
    'Sumber GNSS',
    'Foto Bukti',
    'Keterangan',
  ];

  const toPlantRow = (r: PlantRecord): Array<string | number> => [
    r.tanggalInput,
    r.waktuInput || '',
    r.periode,
    r.perusahaan,
    r.lokasi,
    r.menuType === 'SENSUS' ? '-' : r.nomorPetak,
    r.nomorTanaman,
    r.kelompokTanaman === 'FGS' ? 'Fast Growing (FGS)' : 'Lokal / MPTS',
    r.jenisTanaman,
    r.kondisiTanaman === 'Mati' ? 0 : r.tinggiCm,
    r.kondisiTanaman === 'Mati' ? 0 : r.diameterMm,
    r.kondisiTanaman,
    r.namaPetugas,
    typeof r.latitude === 'number' ? Number(r.latitude.toFixed(7)) : '',
    typeof r.longitude === 'number' ? Number(r.longitude.toFixed(7)) : '',
    r.horizontalAccuracyM ?? '',
    r.verticalAccuracyM ?? '',
    r.gnssSource || '',
    r.photoDataUrl ? 'Terlampir (<=150KB)' : '-',
    r.keterangan || '',
  ];

  const sensusRows = [
    plantHeader,
    ...compRecords.filter((r) => r.menuType === 'SENSUS').map(toPlantRow),
  ];
  const ippkhRows = [
    plantHeader,
    ...compRecords
      .filter((r) => r.menuType === 'MONITORING_IPPKH')
      .map(toPlantRow),
  ];
  const aplRows = [
    plantHeader,
    ...compRecords
      .filter((r) => r.menuType === 'MONITORING_APL')
      .map(toPlantRow),
  ];

  const condRows: Array<Array<string | number>> = [
    [
      'Tipe Data',
      'Menu',
      'Periode',
      'Lokasi',
      'Nomor Petak',
      'Cover Crop',
      'Bangunan Konservasi',
      'Jumlah Bangunan',
      'Penutupan Tajuk',
      'Petugas',
      'Latitude',
      'Longitude',
      'Foto Bukti',
    ],
    ...compConds.map((fc) => [
      'Kondisi Lapangan',
      fc.menuType === 'MONITORING_IPPKH' ? 'IPPKH' : 'APL',
      fc.periode,
      fc.lokasi,
      '-',
      fc.coverCrop,
      fc.bangunanKonservasi,
      fc.jumlahBangunan,
      '-',
      fc.namaPetugas,
      typeof fc.latitude === 'number' ? Number(fc.latitude.toFixed(7)) : '',
      typeof fc.longitude === 'number' ? Number(fc.longitude.toFixed(7)) : '',
      fc.photoDataUrl ? 'Terlampir (<=150KB)' : '-',
    ]),
    ...compCanopies.map((cc) => [
      'Penutupan Tajuk',
      'APL',
      cc.periode,
      cc.lokasi,
      cc.nomorPetak,
      '-',
      '-',
      0,
      cc.penutupanTajuk,
      cc.namaPetugas,
      '',
      '',
      '-',
    ]),
  ];

  await sheetsFetch(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: 'Rekapitulasi_Analisis!A1', values: rekapRows },
          { range: 'Tren_Monitoring_Petak!A1', values: trendRows },
          { range: 'Data_Sensus!A1', values: sensusRows },
          { range: 'Monitoring_IPPKH!A1', values: ippkhRows },
          { range: 'Monitoring_APL!A1', values: aplRows },
          { range: 'Kondisi_Lapangan_Tajuk!A1', values: condRows },
        ],
      }),
    }
  );

  // Format headers & recreate embedded Growth Trend Chart on Tren_Monitoring_Petak
  const batchRequests: Array<Record<string, unknown>> = [];
  for (const title of SHEET_TABS) {
    const info = sheetMap.get(title);
    if (!info) continue;
    batchRequests.push({
      repeatCell: {
        range: {
          sheetId: info.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.08, green: 0.33, blue: 0.18 },
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });
  }

  const trendSheet = sheetMap.get('Tren_Monitoring_Petak');
  if (trendSheet) {
    for (const ch of trendSheet.charts) {
      batchRequests.push({ deleteEmbeddedObject: { objectId: ch.chartId } });
    }
    if (trends.length > 0) {
      batchRequests.push({
        addChart: {
          chart: {
            spec: {
              title: `Tren Pertumbuhan & Survival Rate per Petak (${perusahaan})`,
              basicChart: {
                chartType: 'COLUMN',
                legendPosition: 'BOTTOM_LEGEND',
                axis: [
                  { position: 'BOTTOM_AXIS', title: 'Petak & Periode' },
                  {
                    position: 'LEFT_AXIS',
                    title: 'Rata Tinggi (cm) / % Hidup',
                  },
                ],
                domains: [
                  {
                    domain: {
                      sourceRange: {
                        sources: [
                          {
                            sheetId: trendSheet.sheetId,
                            startRowIndex: 0,
                            endRowIndex: trends.length + 1,
                            startColumnIndex: 0,
                            endColumnIndex: 1,
                          },
                        ],
                      },
                    },
                  },
                ],
                series: [
                  {
                    series: {
                      sourceRange: {
                        sources: [
                          {
                            sheetId: trendSheet.sheetId,
                            startRowIndex: 0,
                            endRowIndex: trends.length + 1,
                            startColumnIndex: 9,
                            endColumnIndex: 10,
                          },
                        ],
                      },
                    },
                    targetAxis: 'LEFT_AXIS',
                  },
                  {
                    series: {
                      sourceRange: {
                        sources: [
                          {
                            sheetId: trendSheet.sheetId,
                            startRowIndex: 0,
                            endRowIndex: trends.length + 1,
                            startColumnIndex: 8,
                            endColumnIndex: 9,
                          },
                        ],
                      },
                    },
                    targetAxis: 'LEFT_AXIS',
                  },
                ],
                headerCount: 1,
              },
            },
            position: {
              overlayPosition: {
                anchorCell: {
                  sheetId: trendSheet.sheetId,
                  rowIndex: Math.min(trends.length + 3, 25),
                  columnIndex: 0,
                },
                widthPixels: 760,
                heightPixels: 360,
              },
            },
          },
        },
      });
    }
  }

  if (batchRequests.length > 0) {
    await sheetsFetch(
      `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ requests: batchRequests }),
      }
    );
  }

  return { syncedCount: compRecords.length };
}
