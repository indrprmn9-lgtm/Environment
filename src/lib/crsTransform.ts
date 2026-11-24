import proj4 from 'proj4';
import type { CoordCrsCode, CoordFormatType } from '../types/plant';

// Register WGS 84 Geographic, Pseudo-Mercator, and all 120 UTM WGS 1984 zones (1N-60N & 1S-60S)
const CRS_DEFS: Record<string, string> = {
  'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs',
  'EPSG:3857':
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
};

for (let z = 1; z <= 60; z++) {
  const zz = String(z).padStart(2, '0');
  CRS_DEFS[`EPSG:326${zz}`] = `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`;
  CRS_DEFS[`EPSG:327${zz}`] = `+proj=utm +zone=${z} +south +datum=WGS84 +units=m +no_defs`;
}

let defsRegistered = false;
function ensureDefs() {
  if (defsRegistered) return;
  Object.keys(CRS_DEFS).forEach((code) => {
    proj4.defs(code, CRS_DEFS[code]);
  });
  defsRegistered = true;
}

function ensureCrsDef(code: string) {
  ensureDefs();
  if (CRS_DEFS[code]) return;
  const northMatch = /^EPSG:326(\d{2})$/.exec(code);
  if (northMatch) {
    const zone = parseInt(northMatch[1], 10);
    if (zone >= 1 && zone <= 60) {
      const def = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
      CRS_DEFS[code] = def;
      proj4.defs(code, def);
    }
    return;
  }
  const southMatch = /^EPSG:327(\d{2})$/.exec(code);
  if (southMatch) {
    const zone = parseInt(southMatch[1], 10);
    if (zone >= 1 && zone <= 60) {
      const def = `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`;
      CRS_DEFS[code] = def;
      proj4.defs(code, def);
    }
  }
}

export function isUtmCrsCode(code: string): boolean {
  return /^EPSG:32[67](?:0[1-9]|[1-5]\d|60)$/.test(code);
}

export function formatUtmZoneBadge(crsCode: string): string {
  const northMatch = /^EPSG:326(\d{2})$/.exec(crsCode);
  if (northMatch) return `${parseInt(northMatch[1], 10)}N`;
  const southMatch = /^EPSG:327(\d{2})$/.exec(crsCode);
  if (southMatch) return `${parseInt(southMatch[1], 10)}S`;
  return crsCode;
}

export function suggestUtmZoneForLon(lon: number, lat: number): CoordCrsCode {
  const clampedZone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const zz = String(clampedZone).padStart(2, '0');
  return (lat >= 0 ? `EPSG:326${zz}` : `EPSG:327${zz}`) as CoordCrsCode;
}

export function transformWgs84ToCrs(
  lon: number,
  lat: number,
  targetCrs: CoordCrsCode
): { x: number; y: number } {
  ensureCrsDef(targetCrs);
  if (targetCrs === 'EPSG:4326') {
    return { x: lon, y: lat };
  }
  const [x, y] = proj4('EPSG:4326', targetCrs, [lon, lat]);
  return { x, y };
}

export function transformCrsToWgs84(
  x: number,
  y: number,
  sourceCrs: CoordCrsCode
): { lon: number; lat: number } {
  ensureCrsDef(sourceCrs);
  if (sourceCrs === 'EPSG:4326') {
    return { lon: x, lat: y };
  }
  const [lon, lat] = proj4(sourceCrs, 'EPSG:4326', [x, y]);
  return { lon, lat };
}

function toDms(value: number, isLat: boolean): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = ((minFloat - min) * 60).toFixed(2);
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${deg}°${String(min).padStart(2, '0')}'${sec.padStart(5, '0')}"${hemi}`;
}

export function formatCoordinatePair(
  lon: number | null | undefined,
  lat: number | null | undefined,
  crsCode: CoordCrsCode,
  formatType: CoordFormatType
): string {
  if (
    lon === null ||
    lon === undefined ||
    lat === null ||
    lat === undefined ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  ) {
    return 'Belum ada titik';
  }

  if (formatType === 'DMS') {
    return `${toDms(lat, true)}, ${toDms(lon, false)}`;
  }

  if (formatType === 'UTM') {
    const utmCrs: CoordCrsCode = isUtmCrsCode(crsCode)
      ? crsCode
      : suggestUtmZoneForLon(lon, lat);
    const { x, y } = transformWgs84ToCrs(lon, lat, utmCrs);
    const zoneLabel = formatUtmZoneBadge(utmCrs);
    return `Zona ${zoneLabel} · E ${x.toFixed(2)} m · N ${y.toFixed(2)} m`;
  }

  if (crsCode !== 'EPSG:4326') {
    const { x, y } = transformWgs84ToCrs(lon, lat, crsCode);
    return `X: ${x.toFixed(2)} m · Y: ${y.toFixed(2)} m (${crsCode})`;
  }

  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
