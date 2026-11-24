import { MAX_GNSS_ACCURACY_M } from '../types/plant';

export interface GnssFixResult {
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  horizontalAccuracyM: number | null;
  verticalAccuracyM: number | null;
  gnssSource: string;
  lockedWithin3m: boolean;
  accuracyMessage: string;
}

function parseNmeaLatLon(raw: string, hemi: string): number | null {
  const num = Number(raw);
  if (!Number.isFinite(num) || !raw) return null;
  const degDigits = raw.indexOf('.') >= 5 ? 3 : 2;
  const deg = Number(raw.slice(0, degDigits));
  const min = Number(raw.slice(degDigits));
  let decimal = deg + min / 60;
  if (hemi === 'S' || hemi === 'W') decimal = -decimal;
  return Number.isFinite(decimal) ? decimal : null;
}

/**
 * Parse a NMEA-0183 GGA sentence from external GNSS receivers (Trimble / Emlid)
 * Example: $GNGGA,092725.00,0114.12345,S,11632.56789,E,4,18,0.6,45.2,M,12.1,M,,*5C
 */
export function parseNmeaGgaSentence(sentence: string): GnssFixResult | null {
  const line = sentence.trim();
  if (!line.startsWith('$') || !line.includes('GGA')) return null;
  const parts = line.split('*')[0].split(',');
  if (parts.length < 10) return null;

  const lat = parseNmeaLatLon(parts[2], parts[3]);
  const lon = parseNmeaLatLon(parts[4], parts[5]);
  if (lat === null || lon === null) return null;

  const fixQuality = Number(parts[6] || 0);
  const hdop = Number(parts[8] || 1.5);
  const alt = parts[9] ? Number(parts[9]) : null;

  // Estimate horizontal & vertical accuracy from fix quality & HDOP when NMEA GST isn't paired
  let estHAcc = 2.5;
  let estVAcc = 3.0;
  let sourceLabel = 'GNSS Eksternal (NMEA)';
  if (fixQuality === 4) {
    estHAcc = Math.max(0.02, Math.round(hdop * 0.03 * 100) / 100);
    estVAcc = Math.max(0.04, Math.round(hdop * 0.05 * 100) / 100);
    sourceLabel = 'GNSS RTK Fixed (Trimble/Emlid)';
  } else if (fixQuality === 5) {
    estHAcc = Math.max(0.3, Math.round(hdop * 0.4 * 100) / 100);
    estVAcc = Math.max(0.5, Math.round(hdop * 0.7 * 100) / 100);
    sourceLabel = 'GNSS RTK Float (Trimble/Emlid)';
  } else if (fixQuality === 2) {
    estHAcc = Math.round(hdop * 1.1 * 100) / 100;
    estVAcc = Math.round(hdop * 1.6 * 100) / 100;
    sourceLabel = 'GNSS DGPS/SBAS';
  } else {
    estHAcc = Math.round(hdop * 2.5 * 100) / 100;
    estVAcc = Math.round(hdop * 3.5 * 100) / 100;
  }

  const lockedWithin3m =
    estHAcc <= MAX_GNSS_ACCURACY_M && estVAcc <= MAX_GNSS_ACCURACY_M;

  return {
    latitude: Number(lat.toFixed(7)),
    longitude: Number(lon.toFixed(7)),
    altitudeM: alt !== null && Number.isFinite(alt) ? Number(alt.toFixed(2)) : null,
    horizontalAccuracyM: estHAcc,
    verticalAccuracyM: estVAcc,
    gnssSource: sourceLabel,
    lockedWithin3m,
    accuracyMessage: lockedWithin3m
      ? `Terkunci <= ${MAX_GNSS_ACCURACY_M} m (H: ±${estHAcc}m, V: ±${estVAcc}m)`
      : `Akurasi belum mencapai <= ${MAX_GNSS_ACCURACY_M} m (H: ±${estHAcc}m, V: ±${estVAcc}m)`,
  };
}

export async function readNmeaFromWebSerial(): Promise<GnssFixResult> {
  const navSerial = (navigator as unknown as {
    serial?: {
      requestPort: () => Promise<{
        open: (opts: { baudRate: number }) => Promise<void>;
        close: () => Promise<void>;
        readable: ReadableStream<Uint8Array> | null;
      }>;
    };
  }).serial;

  if (!navSerial) {
    throw new Error(
      'Web Serial tidak didukung di browser ini. Gunakan Mock Location Android (Trimble Mobile Manager / Emlid Flow) untuk menyalurkan GNSS otomatis.'
    );
  }

  const port = await navSerial.requestPort();
  await port.open({ baudRate: 9600 });
  const reader = port.readable?.getReader();
  if (!reader) {
    await port.close();
    throw new Error('Port serial GNSS tidak terbaca.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt < 7000) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const parsed = parseNmeaGgaSentence(line);
        if (parsed) {
          return parsed;
        }
      }
    }
    throw new Error(
      'Timeout membaca kalimat NMEA GGA dari GNSS eksternal. Pastikan output NMEA aktif.'
    );
  } finally {
    try {
      await reader.cancel();
      await port.close();
    } catch {
      // ignore close errors
    }
  }
}

export function captureBrowserGnssPoint(
  timeoutMs = 10000
): Promise<GnssFixResult> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Perangkat tidak mendukung Geolocation API.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const hAcc =
          typeof pos.coords.accuracy === 'number' &&
          Number.isFinite(pos.coords.accuracy)
            ? Math.round(pos.coords.accuracy * 100) / 100
            : null;
        const vAcc =
          typeof pos.coords.altitudeAccuracy === 'number' &&
          Number.isFinite(pos.coords.altitudeAccuracy)
            ? Math.round(pos.coords.altitudeAccuracy * 100) / 100
            : null;

        const hOk = hAcc !== null && hAcc <= MAX_GNSS_ACCURACY_M;
        const vOk = vAcc === null ? hOk : vAcc <= MAX_GNSS_ACCURACY_M;
        const lockedWithin3m = hOk && vOk;

        const vText = vAcc !== null ? `V: ±${vAcc}m` : 'V: N/A';
        const accuracyMessage = lockedWithin3m
          ? `Terkunci <= ${MAX_GNSS_ACCURACY_M}m (H: ±${hAcc ?? '?'}m · ${vText})`
          : `Akurasi saat ini H: ±${hAcc ?? '?'}m · ${vText} (target <= ${MAX_GNSS_ACCURACY_M}m)`;

        resolve({
          latitude: Number(pos.coords.latitude.toFixed(7)),
          longitude: Number(pos.coords.longitude.toFixed(7)),
          altitudeM:
            typeof pos.coords.altitude === 'number' &&
            Number.isFinite(pos.coords.altitude)
              ? Math.round(pos.coords.altitude * 100) / 100
              : null,
          horizontalAccuracyM: hAcc,
          verticalAccuracyM: vAcc,
          gnssSource:
            hAcc !== null && hAcc <= 1.5
              ? 'GNSS Presisi / Mock Location'
              : 'GPS Perangkat / Mock Location',
          lockedWithin3m,
          accuracyMessage,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              'Izin lokasi ditolak. Aktifkan izin lokasi browser agar titik koordinat dapat diambil otomatis.'
            )
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(
            new Error(
              'Sinyal GPS/GNSS belum tersedia. Pastikan GPS aktif atau aplikasi Mock Location Trimble/Emlid berjalan.'
            )
          );
        } else {
          reject(
            new Error(
              'Waktu tunggu pembacaan koordinat GNSS habis. Coba lagi di ruang terbuka.'
            )
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}
