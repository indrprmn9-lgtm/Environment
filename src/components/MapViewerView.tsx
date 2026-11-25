import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import shp from 'shpjs';
import {
  Camera,
  Check,
  Compass,
  Crosshair,
  Layers,
  LocateFixed,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
  Radio,
  Tag,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import {
  formatCoordinatePair,
  transformCrsToWgs84,
} from '../lib/crsTransform';
import { extractGeoPdfBoundsFromBuffer } from '../lib/geoPdf';
import {
  captureBrowserGnssPoint,
  type GnssFixResult,
  startLiveGnssWatcher,
} from '../lib/gnss';
import {
  type BaseMapFileType,
  type BaseMapLayer,
  COMPANIES,
  type CompanyName,
  COORD_FORMAT_OPTIONS,
  type CoordCrsCode,
  type CoordFormatType,
  CRS_OPTION_GROUPS,
  getCompanyKey,
  getMenuLabel,
  type MenuType,
  type PlantRecord,
} from '../types/plant';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface GeoBBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

interface SimpleGeometry {
  type:
    | 'Point'
    | 'MultiPoint'
    | 'LineString'
    | 'MultiLineString'
    | 'Polygon'
    | 'MultiPolygon';
  coordinates: unknown;
}

interface SimpleFeature {
  type: 'Feature';
  properties?: Record<string, unknown> | null;
  geometry: SimpleGeometry | null;
}

interface SimpleFeatureCollection {
  type: 'FeatureCollection';
  features: SimpleFeature[];
}

const SVG_W = 1000;
const SVG_H = 680;
const SVG_PAD = 42;

function reprojectCoordTuple(
  coord: unknown,
  sourceCrs: CoordCrsCode
): [number, number] | null {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const x = Number(coord[0]);
  const y = Number(coord[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (sourceCrs !== 'EPSG:4326' && (Math.abs(x) > 180 || Math.abs(y) > 90)) {
    const res = transformCrsToWgs84(x, y, sourceCrs);
    return [res.lon, res.lat];
  }
  return [x, y];
}

function walkAndReprojectCoords(
  coords: unknown,
  sourceCrs: CoordCrsCode,
  bboxAcc: { minLon: number; minLat: number; maxLon: number; maxLat: number }
): unknown {
  if (!Array.isArray(coords)) return coords;
  if (coords.length >= 2 && typeof coords[0] === 'number') {
    const pt = reprojectCoordTuple(coords, sourceCrs);
    if (!pt) return coords;
    const [lon, lat] = pt;
    if (lon < bboxAcc.minLon) bboxAcc.minLon = lon;
    if (lon > bboxAcc.maxLon) bboxAcc.maxLon = lon;
    if (lat < bboxAcc.minLat) bboxAcc.minLat = lat;
    if (lat > bboxAcc.maxLat) bboxAcc.maxLat = lat;
    return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
  }
  return coords.map((item) =>
    walkAndReprojectCoords(item, sourceCrs, bboxAcc)
  );
}

function normalizeToFeatureCollection(
  raw: unknown,
  sourceCrs: CoordCrsCode
): { fc: SimpleFeatureCollection; bbox: GeoBBox | null } {
  const rawCollections = Array.isArray(raw) ? raw : [raw];
  const mergedFeatures: SimpleFeature[] = [];
  const bboxAcc = {
    minLon: Infinity,
    minLat: Infinity,
    maxLon: -Infinity,
    maxLat: -Infinity,
  };

  for (const item of rawCollections) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as { type?: string; features?: unknown[]; geometry?: SimpleGeometry; properties?: Record<string, unknown> };
    if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
      for (const f of obj.features) {
        if (!f || typeof f !== 'object') continue;
        const feat = f as SimpleFeature;
        if (!feat.geometry) continue;
        mergedFeatures.push({
          type: 'Feature',
          properties: feat.properties || {},
          geometry: {
            type: feat.geometry.type,
            coordinates: walkAndReprojectCoords(
              feat.geometry.coordinates,
              sourceCrs,
              bboxAcc
            ),
          },
        });
      }
    } else if (obj.type === 'Feature' && obj.geometry) {
      mergedFeatures.push({
        type: 'Feature',
        properties: obj.properties || {},
        geometry: {
          type: obj.geometry.type,
          coordinates: walkAndReprojectCoords(
            obj.geometry.coordinates,
            sourceCrs,
            bboxAcc
          ),
        },
      });
    }
  }

  const hasBbox =
    Number.isFinite(bboxAcc.minLon) &&
    Number.isFinite(bboxAcc.minLat) &&
    Number.isFinite(bboxAcc.maxLon) &&
    Number.isFinite(bboxAcc.maxLat);

  return {
    fc: { type: 'FeatureCollection', features: mergedFeatures },
    bbox: hasBbox ? bboxAcc : null,
  };
}

interface AttributeSample {
  key: string;
  sample: string;
}

function extractLayerAttributes(
  fc: SimpleFeatureCollection
): AttributeSample[] {
  const orderedKeys: string[] = [];
  const sampleMap = new Map<string, string>();
  const seen = new Set<string>();

  for (const feat of fc.features) {
    const props = feat.properties;
    if (!props || typeof props !== 'object') continue;
    for (const rawKey of Object.keys(props)) {
      const key = rawKey.trim();
      if (!key) continue;
      if (!seen.has(key) && orderedKeys.length < 100) {
        seen.add(key);
        orderedKeys.push(key);
      }
      if (!sampleMap.has(key)) {
        const val = props[rawKey];
        if (val !== null && val !== undefined) {
          const txt = String(val).trim();
          if (txt.length > 0) {
            sampleMap.set(key, txt.length > 28 ? `${txt.slice(0, 27)}…` : txt);
          }
        }
      }
    }
  }

  return orderedKeys.map((key) => ({
    key,
    sample: sampleMap.get(key) || '-',
  }));
}

function pickDefaultLabelAttribute(attrs: AttributeSample[]): string | null {
  if (attrs.length === 0) return null;
  const preferred = attrs.find((a) =>
    /^(petak|blok|nama|name|kode|code|label|id_petak|no_petak|kompartemen|jenis)$/i.test(
      a.key
    )
  );
  if (preferred) return preferred.key;
  const partial = attrs.find((a) =>
    /(petak|blok|nama|name|kode|label)/i.test(a.key)
  );
  return partial ? partial.key : attrs[0].key;
}

function computeRingCentroid(
  ring: number[][]
): { lon: number; lat: number; bboxArea: number } | null {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let twiceArea = 0;
  let cxAcc = 0;
  let cyAcc = 0;

  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % ring.length];
    if (
      !Array.isArray(p1) ||
      p1.length < 2 ||
      !Number.isFinite(p1[0]) ||
      !Number.isFinite(p1[1])
    ) {
      continue;
    }
    if (p1[0] < minLon) minLon = p1[0];
    if (p1[0] > maxLon) maxLon = p1[0];
    if (p1[1] < minLat) minLat = p1[1];
    if (p1[1] > maxLat) maxLat = p1[1];

    if (
      Array.isArray(p2) &&
      p2.length >= 2 &&
      Number.isFinite(p2[0]) &&
      Number.isFinite(p2[1])
    ) {
      const cross = p1[0] * p2[1] - p2[0] * p1[1];
      twiceArea += cross;
      cxAcc += (p1[0] + p2[0]) * cross;
      cyAcc += (p1[1] + p2[1]) * cross;
    }
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  const bboxArea = Math.max(0, (maxLon - minLon) * (maxLat - minLat));
  if (Math.abs(twiceArea) > 1e-12) {
    const cx = cxAcc / (3 * twiceArea);
    const cy = cyAcc / (3 * twiceArea);
    if (
      Number.isFinite(cx) &&
      Number.isFinite(cy) &&
      cx >= minLon &&
      cx <= maxLon &&
      cy >= minLat &&
      cy <= maxLat
    ) {
      return { lon: cx, lat: cy, bboxArea };
    }
  }

  return {
    lon: (minLon + maxLon) / 2,
    lat: (minLat + maxLat) / 2,
    bboxArea,
  };
}

function getFeatureLabelAnchor(
  geom: SimpleGeometry
): { lon: number; lat: number; area: number } | null {
  if (geom.type === 'Point') {
    const c = geom.coordinates as number[];
    if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      return { lon: c[0], lat: c[1], area: 0 };
    }
    return null;
  }
  if (geom.type === 'MultiPoint') {
    const pts = geom.coordinates as number[][];
    const first = pts?.[0];
    if (
      Array.isArray(first) &&
      Number.isFinite(first[0]) &&
      Number.isFinite(first[1])
    ) {
      return { lon: first[0], lat: first[1], area: 0 };
    }
    return null;
  }
  if (geom.type === 'LineString') {
    const coords = geom.coordinates as number[][];
    if (!Array.isArray(coords) || coords.length === 0) return null;
    const mid = coords[Math.floor(coords.length / 2)];
    if (Array.isArray(mid) && Number.isFinite(mid[0]) && Number.isFinite(mid[1])) {
      return { lon: mid[0], lat: mid[1], area: 0 };
    }
    return null;
  }
  if (geom.type === 'MultiLineString') {
    const lines = geom.coordinates as number[][][];
    if (!Array.isArray(lines) || lines.length === 0) return null;
    let longest = lines[0];
    for (const line of lines) {
      if (Array.isArray(line) && line.length > (longest?.length || 0)) {
        longest = line;
      }
    }
    if (!Array.isArray(longest) || longest.length === 0) return null;
    const mid = longest[Math.floor(longest.length / 2)];
    if (Array.isArray(mid) && Number.isFinite(mid[0]) && Number.isFinite(mid[1])) {
      return { lon: mid[0], lat: mid[1], area: 0 };
    }
    return null;
  }
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates as number[][][];
    if (!Array.isArray(rings) || rings.length === 0) return null;
    const c = computeRingCentroid(rings[0]);
    return c ? { lon: c.lon, lat: c.lat, area: c.bboxArea } : null;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates as number[][][][];
    if (!Array.isArray(polys) || polys.length === 0) return null;
    let best: { lon: number; lat: number; bboxArea: number } | null = null;
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const c = computeRingCentroid(poly[0]);
      if (c && (!best || c.bboxArea > best.bboxArea)) {
        best = c;
      }
    }
    return best ? { lon: best.lon, lat: best.lat, area: best.bboxArea } : null;
  }
  return null;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const MapViewerView: React.FC = () => {
  const { profile } = useAuth();
  const {
    allRecords,
    baseMaps,
    adminUploadBaseMap,
    adminUpdateBaseMapLabels,
    adminDeleteBaseMap,
    fetchBaseMapDetail,
  } = useData();

  const isAdmin = profile?.role === 'admin';
  const lockedCompany: CompanyName | null =
    profile?.assignedCompany && profile.assignedCompany !== 'ALL'
      ? profile.assignedCompany
      : null;

  // Map Filter & Display Controls
  const [selectedCompany, setSelectedCompany] = useState<CompanyName>(
    () => lockedCompany ?? 'PT. NBSS'
  );

  useEffect(() => {
    if (lockedCompany && selectedCompany !== lockedCompany) {
      setSelectedCompany(lockedCompany);
      setSelectedPoint(null);
    }
  }, [lockedCompany, selectedCompany]);
  const [activityFilter, setActivityFilter] = useState<'ALL' | MenuType>('ALL');
  const [selectedLayerId, setSelectedLayerId] = useState<string>('NONE');
  const [loadedLayerDetail, setLoadedLayerDetail] =
    useState<BaseMapLayer | null>(null);
  const [layerLoading, setLayerLoading] = useState(false);

  const [displayCrs, setDisplayCrs] = useState<CoordCrsCode>('EPSG:4326');
  const [coordFormat, setCoordFormat] = useState<CoordFormatType>('DD');

  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  // Live Officer GNSS location
  const [myLocation, setMyLocation] = useState<GnssFixResult | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [liveTrackActive, setLiveTrackActive] = useState(false);
  const liveTrackStopRef = useRef<(() => void) | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  // Selected Point Inspector
  const [selectedPoint, setSelectedPoint] = useState<PlantRecord | null>(null);

  // Hover coordinates
  const [hoverLonLat, setHoverLonLat] = useState<{
    lon: number;
    lat: number;
  } | null>(null);

  // Admin Upload Base Map modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadCompany, setUploadCompany] = useState<CompanyName>('PT. NBSS');
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState<BaseMapFileType>('shapefile');
  const [uploadCrs, setUploadCrs] = useState<CoordCrsCode>('EPSG:32750');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pdfBoundsMinLon, setPdfBoundsMinLon] = useState('');
  const [pdfBoundsMinLat, setPdfBoundsMinLat] = useState('');
  const [pdfBoundsMaxLon, setPdfBoundsMaxLon] = useState('');
  const [pdfBoundsMaxLat, setPdfBoundsMaxLat] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pdfGeoDetectedNotice, setPdfGeoDetectedNotice] = useState<
    string | null
  >(null);
  const [uploadLabelEnabled, setUploadLabelEnabled] = useState(false);
  const [uploadLabelAttributes, setUploadLabelAttributes] = useState<string[]>(
    []
  );
  const [uploadDetectedAttrs, setUploadDetectedAttrs] = useState<
    AttributeSample[]
  >([]);
  const [uploadFeatureCount, setUploadFeatureCount] = useState(0);
  const [uploadInspectBusy, setUploadInspectBusy] = useState(false);
  const [mapNotice, setMapNotice] = useState<string | null>(null);

  // Active layer label display & typography sizing state
  const [layerLabelEnabled, setLayerLabelEnabled] = useState(false);
  const [layerLabelAttrs, setLayerLabelAttrs] = useState<string[]>([]);
  const [layerLabelSize, setLayerLabelSize] = useState<number>(10);
  const [layerLabelAvoidOverlap, setLayerLabelAvoidOverlap] =
    useState<boolean>(true);
  const [savingLabels, setSavingLabels] = useState(false);

  // PDF Canvas & Stage refs
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 900,
    height: 540,
  });
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfRenderSize, setPdfRenderSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const companyLayers = useMemo(() => {
    const ck = getCompanyKey(selectedCompany);
    return baseMaps.filter((b) => b.companyKey === ck);
  }, [baseMaps, selectedCompany]);

  // Reset selected layer if company changes
  useEffect(() => {
    if (
      selectedLayerId !== 'NONE' &&
      !companyLayers.some((l) => l.id === selectedLayerId)
    ) {
      setSelectedLayerId(companyLayers[0]?.id || 'NONE');
    }
  }, [companyLayers, selectedLayerId]);

  // Load saved local label font size & anti-overlap preference per layer
  useEffect(() => {
    if (selectedLayerId === 'NONE') {
      setLayerLabelSize(10);
      setLayerLabelAvoidOverlap(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(
        `env_basemap_label_style_${selectedLayerId}`
      );
      if (raw) {
        const parsed = JSON.parse(raw) as {
          fontSize?: number;
          avoidOverlap?: boolean;
        };
        if (
          typeof parsed.fontSize === 'number' &&
          parsed.fontSize >= 5 &&
          parsed.fontSize <= 22
        ) {
          setLayerLabelSize(parsed.fontSize);
        }
        if (typeof parsed.avoidOverlap === 'boolean') {
          setLayerLabelAvoidOverlap(parsed.avoidOverlap);
        }
      } else {
        setLayerLabelSize(10);
        setLayerLabelAvoidOverlap(true);
      }
    } catch {
      // ignore storage errors
    }
  }, [selectedLayerId]);

  useEffect(() => {
    if (selectedLayerId === 'NONE') return;
    try {
      window.localStorage.setItem(
        `env_basemap_label_style_${selectedLayerId}`,
        JSON.stringify({
          fontSize: layerLabelSize,
          avoidOverlap: layerLabelAvoidOverlap,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [selectedLayerId, layerLabelSize, layerLabelAvoidOverlap]);

  // Cleanup live GNSS watcher on unmount
  useEffect(() => {
    return () => {
      liveTrackStopRef.current?.();
    };
  }, []);

  // Fetch heavy base map payload on demand
  useEffect(() => {
    if (selectedLayerId === 'NONE') {
      setLoadedLayerDetail(null);
      setPdfRenderSize(null);
      setLayerLabelEnabled(false);
      setLayerLabelAttrs([]);
      return;
    }
    let active = true;
    setLayerLoading(true);
    fetchBaseMapDetail(selectedLayerId)
      .then((detail) => {
        if (active) {
          setLoadedLayerDetail(detail);
          setLayerLabelEnabled(Boolean(detail.labelEnabled));
          setLayerLabelAttrs(detail.labelAttributes || []);
        }
      })
      .catch((err) => {
        if (active) {
          setLocError(
            err instanceof Error
              ? err.message
              : 'Gagal memuat detail layer base map.'
          );
        }
      })
      .finally(() => {
        if (active) setLayerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedLayerId, fetchBaseMapDetail]);

  // Render PDF onto canvas when loadedLayerDetail is PDF
  useEffect(() => {
    if (
      !loadedLayerDetail ||
      loadedLayerDetail.fileType !== 'pdf' ||
      !loadedLayerDetail.fileDataBase64
    ) {
      setPdfRenderSize(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const bytes = base64ToUint8Array(loadedLayerDetail.fileDataBase64!);
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = pdfCanvasRef.current;
        if (!canvas || cancelled) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setPdfRenderSize({ width: viewport.width, height: viewport.height });
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        }).promise;
      } catch (err) {
        if (!cancelled) {
          setLocError(
            err instanceof Error
              ? `Gagal merender PDF peta: ${err.message}`
              : 'Gagal merender base map PDF.'
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadedLayerDetail]);

  // Measure interactive stage container for exact PDF canvas + SVG alignment
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Collected GNSS points for selected company + activity
  const geoPoints = useMemo(() => {
    return allRecords.filter((r) => {
      if (r.perusahaan !== selectedCompany) return false;
      if (activityFilter !== 'ALL' && r.menuType !== activityFilter)
        return false;
      return (
        r.latitude !== null &&
        r.latitude !== undefined &&
        r.longitude !== null &&
        r.longitude !== undefined &&
        Number.isFinite(r.latitude) &&
        Number.isFinite(r.longitude)
      );
    });
  }, [allRecords, selectedCompany, activityFilter]);

  const parsedVectorLayer = useMemo<SimpleFeatureCollection | null>(() => {
    if (
      !loadedLayerDetail ||
      loadedLayerDetail.fileType === 'pdf' ||
      !loadedLayerDetail.geoJsonText
    ) {
      return null;
    }
    try {
      const parsed = JSON.parse(loadedLayerDetail.geoJsonText);
      if (parsed?.type === 'FeatureCollection') {
        return parsed as SimpleFeatureCollection;
      }
      return null;
    } catch {
      return null;
    }
  }, [loadedLayerDetail]);

  const layerAvailableAttrs = useMemo<AttributeSample[]>(() => {
    if (!loadedLayerDetail || loadedLayerDetail.fileType === 'pdf') return [];
    const fromLayer = loadedLayerDetail.availableAttributes || [];
    const fromFeatures = parsedVectorLayer
      ? extractLayerAttributes(parsedVectorLayer)
      : [];
    if (fromFeatures.length > 0) {
      const featureMap = new Map(fromFeatures.map((a) => [a.key, a.sample]));
      const merged: AttributeSample[] = [...fromFeatures];
      for (const k of fromLayer) {
        if (!featureMap.has(k)) {
          merged.push({ key: k, sample: '-' });
        }
      }
      return merged;
    }
    return fromLayer.map((key) => ({ key, sample: '-' }));
  }, [loadedLayerDetail, parsedVectorLayer]);

  const layerBbox = useMemo<GeoBBox | null>(() => {
    if (!loadedLayerDetail?.bboxJson) return null;
    try {
      const b = JSON.parse(loadedLayerDetail.bboxJson) as GeoBBox;
      if (
        Number.isFinite(b.minLon) &&
        Number.isFinite(b.minLat) &&
        Number.isFinite(b.maxLon) &&
        Number.isFinite(b.maxLat)
      ) {
        return b;
      }
      return null;
    } catch {
      return null;
    }
  }, [loadedLayerDetail]);

  // Compute combined geographic viewport bounding box
  const viewBbox = useMemo<GeoBBox>(() => {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    if (layerBbox) {
      minLon = Math.min(minLon, layerBbox.minLon);
      minLat = Math.min(minLat, layerBbox.minLat);
      maxLon = Math.max(maxLon, layerBbox.maxLon);
      maxLat = Math.max(maxLat, layerBbox.maxLat);
    }

    for (const pt of geoPoints) {
      if (pt.longitude! < minLon) minLon = pt.longitude!;
      if (pt.longitude! > maxLon) maxLon = pt.longitude!;
      if (pt.latitude! < minLat) minLat = pt.latitude!;
      if (pt.latitude! > maxLat) maxLat = pt.latitude!;
    }

    if (myLocation) {
      minLon = Math.min(minLon, myLocation.longitude);
      maxLon = Math.max(maxLon, myLocation.longitude);
      minLat = Math.min(minLat, myLocation.latitude);
      maxLat = Math.max(maxLat, myLocation.latitude);
    }

    if (!Number.isFinite(minLon)) {
      // Default centered in Kalimantan / Nusantara forest belt
      return {
        minLon: 116.5,
        minLat: -1.4,
        maxLon: 116.7,
        maxLat: -1.2,
      };
    }

    const spanLon = Math.max(0.002, maxLon - minLon);
    const spanLat = Math.max(0.002, maxLat - minLat);
    const padLon = spanLon * 0.12;
    const padLat = spanLat * 0.12;
    return {
      minLon: minLon - padLon,
      maxLon: maxLon + padLon,
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
    };
  }, [layerBbox, geoPoints, myLocation]);

  const isCalibratedGeoPdf =
    loadedLayerDetail?.fileType === 'pdf' &&
    Boolean(layerBbox) &&
    Boolean(pdfRenderSize);

  const activeSvgW =
    isCalibratedGeoPdf && pdfRenderSize ? pdfRenderSize.width : SVG_W;
  const activeSvgH =
    isCalibratedGeoPdf && pdfRenderSize ? pdfRenderSize.height : SVG_H;

  const pdfBoxSize = useMemo(() => {
    if (!pdfRenderSize || stageSize.width <= 0 || stageSize.height <= 0) {
      return null;
    }
    const availW = Math.max(120, stageSize.width - 16);
    const availH = Math.max(120, stageSize.height - 16);
    const fitScale = Math.min(
      availW / pdfRenderSize.width,
      availH / pdfRenderSize.height
    );
    return {
      width: Math.max(120, Math.floor(pdfRenderSize.width * fitScale)),
      height: Math.max(120, Math.floor(pdfRenderSize.height * fitScale)),
    };
  }, [pdfRenderSize, stageSize]);

  // Equirectangular projection (or exact GeoPDF corner-to-pixel alignment)
  const projectPoint = useMemo(() => {
    if (isCalibratedGeoPdf && layerBbox && pdfRenderSize) {
      const lonSpan = Math.max(1e-7, layerBbox.maxLon - layerBbox.minLon);
      const latSpan = Math.max(1e-7, layerBbox.maxLat - layerBbox.minLat);
      const w = pdfRenderSize.width;
      const h = pdfRenderSize.height;

      const toSvg = (lon: number, lat: number): [number, number] => {
        const x = ((lon - layerBbox.minLon) / lonSpan) * w;
        const y = ((layerBbox.maxLat - lat) / latSpan) * h;
        return [x, y];
      };

      const toLonLat = (
        svgX: number,
        svgY: number
      ): { lon: number; lat: number } => {
        const lon = layerBbox.minLon + (svgX / w) * lonSpan;
        const lat = layerBbox.maxLat - (svgY / h) * latSpan;
        return { lon, lat };
      };

      return { toSvg, toLonLat };
    }

    const midLat = (viewBbox.minLat + viewBbox.maxLat) / 2;
    const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
    const geoW = (viewBbox.maxLon - viewBbox.minLon) * cosLat;
    const geoH = viewBbox.maxLat - viewBbox.minLat;
    const innerW = SVG_W - SVG_PAD * 2;
    const innerH = SVG_H - SVG_PAD * 2;
    const scale = Math.min(innerW / geoW, innerH / geoH);
    const drawW = geoW * scale;
    const drawH = geoH * scale;
    const offsetX = (SVG_W - drawW) / 2;
    const offsetY = (SVG_H - drawH) / 2;

    const toSvg = (lon: number, lat: number): [number, number] => {
      const x = offsetX + (lon - viewBbox.minLon) * cosLat * scale;
      const y = offsetY + (viewBbox.maxLat - lat) * scale;
      return [x, y];
    };

    const toLonLat = (svgX: number, svgY: number): { lon: number; lat: number } => {
      const lon = viewBbox.minLon + (svgX - offsetX) / (cosLat * scale);
      const lat = viewBbox.maxLat - (svgY - offsetY) / scale;
      return { lon, lat };
    };

    return { toSvg, toLonLat };
  }, [isCalibratedGeoPdf, layerBbox, pdfRenderSize, viewBbox]);

  const handleCaptureMyLocation = async () => {
    setLocError(null);
    setLocBusy(true);
    try {
      const fix = await captureBrowserGnssPoint(15000, 'optimal');
      setMyLocation(fix);
      setMapNotice(
        `Posisi GNSS internal HP terdeteksi · ${fix.gnssSource} (${fix.accuracyMessage}).`
      );
    } catch (err) {
      setLocError(
        err instanceof Error ? err.message : 'Gagal membaca posisi GNSS HP.'
      );
    } finally {
      setLocBusy(false);
    }
  };

  const handleToggleLiveTracking = () => {
    if (liveTrackActive) {
      liveTrackStopRef.current?.();
      liveTrackStopRef.current = null;
      setLiveTrackActive(false);
      setMapNotice('Pelacakan lokasi live dihentikan.');
      return;
    }
    setLocError(null);
    setLiveTrackActive(true);
    setMapNotice('Pelacakan GPS internal HP aktif secara kontinu (berfungsi offline & online).');
    liveTrackStopRef.current = startLiveGnssWatcher(
      (fix) => {
        setMyLocation(fix);
      },
      (err) => {
        setLocError(err.message);
      }
    );
  };

  const handleSelectUploadFile = async (file: File | null) => {
    setUploadFile(file);
    setPdfGeoDetectedNotice(null);
    setUploadError(null);
    setUploadDetectedAttrs([]);
    setUploadLabelAttributes([]);
    setUploadFeatureCount(0);
    if (!file) return;

    if (uploadType === 'pdf') {
      try {
        const buf = await file.arrayBuffer();
        const detected = extractGeoPdfBoundsFromBuffer(buf);
        if (detected) {
          setUploadCrs('EPSG:4326');
          setPdfBoundsMinLon(String(detected.minLon));
          setPdfBoundsMinLat(String(detected.minLat));
          setPdfBoundsMaxLon(String(detected.maxLon));
          setPdfBoundsMaxLat(String(detected.maxLat));
          setPdfGeoDetectedNotice(
            `Koordinat sudut ArcGIS GeoPDF terdeteksi otomatis (${detected.sourceTag}).`
          );
        }
      } catch {
        // Ignore inspection errors; admin can still enter bounds manually
      }
      return;
    }

    setUploadInspectBusy(true);
    try {
      let rawParsed: unknown;
      if (uploadType === 'shapefile') {
        const buf = await file.arrayBuffer();
        rawParsed = await shp(buf);
      } else {
        const text = await file.text();
        rawParsed = JSON.parse(text);
      }

      const rawCollections = Array.isArray(rawParsed) ? rawParsed : [rawParsed];
      const featuresOnly: SimpleFeature[] = [];
      for (const col of rawCollections) {
        if (!col || typeof col !== 'object') continue;
        const obj = col as {
          type?: string;
          features?: SimpleFeature[];
          geometry?: SimpleGeometry;
          properties?: Record<string, unknown>;
        };
        if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
          for (const f of obj.features) {
            if (f && f.geometry) featuresOnly.push(f);
          }
        } else if (obj.type === 'Feature' && obj.geometry) {
          featuresOnly.push(obj as SimpleFeature);
        }
      }

      setUploadFeatureCount(featuresOnly.length);
      const attrs = extractLayerAttributes({
        type: 'FeatureCollection',
        features: featuresOnly,
      });
      setUploadDetectedAttrs(attrs);
      const suggested = pickDefaultLabelAttribute(attrs);
      if (suggested && uploadLabelEnabled) {
        setUploadLabelAttributes([suggested]);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? `Gagal membaca atribut file: ${err.message}`
          : 'Gagal membaca atribut Shapefile/GeoJSON.'
      );
    } finally {
      setUploadInspectBusy(false);
    }
  };

  const handleToggleUploadLabel = (nextEnabled: boolean) => {
    setUploadLabelEnabled(nextEnabled);
    if (
      nextEnabled &&
      uploadLabelAttributes.length === 0 &&
      uploadDetectedAttrs.length > 0
    ) {
      const suggested = pickDefaultLabelAttribute(uploadDetectedAttrs);
      if (suggested) {
        setUploadLabelAttributes([suggested]);
      }
    }
  };

  const handleToggleUploadAttr = (attrKey: string) => {
    const exists = uploadLabelAttributes.includes(attrKey);
    const next = exists
      ? uploadLabelAttributes.filter((k) => k !== attrKey)
      : uploadLabelAttributes.length < 15
      ? [...uploadLabelAttributes, attrKey]
      : uploadLabelAttributes;
    setUploadLabelAttributes(next);
    if (!exists && next.length > 0 && !uploadLabelEnabled) {
      setUploadLabelEnabled(true);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadName.trim()) return;
    setUploadError(null);
    setUploadBusy(true);

    try {
      if (uploadType === 'pdf') {
        if (uploadFile.size > 12 * 1024 * 1024) {
          throw new Error(
            'Ukuran file PDF maksimal 12 MB agar tetap ringan dimuat di HP lapangan.'
          );
        }
        const buf = await uploadFile.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        let bboxJson: string | null = null;
        if (
          pdfBoundsMinLon.trim() &&
          pdfBoundsMinLat.trim() &&
          pdfBoundsMaxLon.trim() &&
          pdfBoundsMaxLat.trim()
        ) {
          const rawMinX = Number(pdfBoundsMinLon.replace(',', '.'));
          const rawMinY = Number(pdfBoundsMinLat.replace(',', '.'));
          const rawMaxX = Number(pdfBoundsMaxLon.replace(',', '.'));
          const rawMaxY = Number(pdfBoundsMaxLat.replace(',', '.'));
          if (
            !Number.isFinite(rawMinX) ||
            !Number.isFinite(rawMinY) ||
            !Number.isFinite(rawMaxX) ||
            !Number.isFinite(rawMaxY) ||
            rawMaxX <= rawMinX ||
            rawMaxY <= rawMinY
          ) {
            throw new Error(
              'Batas koordinat sudut PDF tidak valid. Pastikan Nilai Max > Nilai Min.'
            );
          }

          const sw =
            uploadCrs === 'EPSG:4326'
              ? { lon: rawMinX, lat: rawMinY }
              : transformCrsToWgs84(rawMinX, rawMinY, uploadCrs);
          const ne =
            uploadCrs === 'EPSG:4326'
              ? { lon: rawMaxX, lat: rawMaxY }
              : transformCrsToWgs84(rawMaxX, rawMaxY, uploadCrs);

          if (
            Number.isFinite(sw.lon) &&
            Number.isFinite(sw.lat) &&
            Number.isFinite(ne.lon) &&
            Number.isFinite(ne.lat) &&
            ne.lon > sw.lon &&
            ne.lat > sw.lat
          ) {
            bboxJson = JSON.stringify({
              minLon: Number(sw.lon.toFixed(7)),
              minLat: Number(sw.lat.toFixed(7)),
              maxLon: Number(ne.lon.toFixed(7)),
              maxLat: Number(ne.lat.toFixed(7)),
            });
          }
        }
        const created = await adminUploadBaseMap({
          perusahaan: uploadCompany,
          name: uploadName.trim(),
          fileType: 'pdf',
          crsCode: uploadCrs,
          fileDataBase64: b64,
          bboxJson,
        });
        setSelectedCompany(uploadCompany);
        setSelectedLayerId(created.id);
      } else if (uploadType === 'shapefile') {
        const buf = await uploadFile.arrayBuffer();
        const parsed = await shp(buf);
        const { fc, bbox } = normalizeToFeatureCollection(parsed, uploadCrs);
        if (fc.features.length === 0) {
          throw new Error(
            'File ZIP Shapefile tidak memiliki fitur geometri valid.'
          );
        }
        if (uploadLabelEnabled && uploadLabelAttributes.length === 0) {
          throw new Error(
            'Pilih minimal satu atribut label SHP atau nonaktifkan opsi label.'
          );
        }
        const geoJsonText = JSON.stringify(fc);
        if (geoJsonText.length > 15 * 1024 * 1024) {
          throw new Error(
            'Geometri Shapefile terlalu besar (> 15 MB). Sederhanakan poligon sebelum mengunggah.'
          );
        }
        const attrs = extractLayerAttributes(fc).map((a) => a.key);
        const created = await adminUploadBaseMap({
          perusahaan: uploadCompany,
          name: uploadName.trim(),
          fileType: 'shapefile',
          crsCode: uploadCrs,
          geoJsonText,
          bboxJson: bbox ? JSON.stringify(bbox) : null,
          labelEnabled: uploadLabelEnabled,
          labelAttributes: uploadLabelEnabled ? uploadLabelAttributes : [],
          availableAttributes: attrs,
        });
        setSelectedCompany(uploadCompany);
        setSelectedLayerId(created.id);
      } else {
        const text = await uploadFile.text();
        const parsed = JSON.parse(text);
        const { fc, bbox } = normalizeToFeatureCollection(parsed, uploadCrs);
        if (fc.features.length === 0) {
          throw new Error('File GeoJSON tidak memiliki fitur geometri valid.');
        }
        if (uploadLabelEnabled && uploadLabelAttributes.length === 0) {
          throw new Error(
            'Pilih minimal satu atribut label GeoJSON atau nonaktifkan opsi label.'
          );
        }
        const attrs = extractLayerAttributes(fc).map((a) => a.key);
        const created = await adminUploadBaseMap({
          perusahaan: uploadCompany,
          name: uploadName.trim(),
          fileType: 'geojson',
          crsCode: uploadCrs,
          geoJsonText: JSON.stringify(fc),
          bboxJson: bbox ? JSON.stringify(bbox) : null,
          labelEnabled: uploadLabelEnabled,
          labelAttributes: uploadLabelEnabled ? uploadLabelAttributes : [],
          availableAttributes: attrs,
        });
        setSelectedCompany(uploadCompany);
        setSelectedLayerId(created.id);
      }

      setShowUploadModal(false);
      setUploadName('');
      setUploadFile(null);
      setPdfBoundsMinLon('');
      setPdfBoundsMinLat('');
      setPdfBoundsMaxLon('');
      setPdfBoundsMaxLat('');
      setUploadLabelEnabled(false);
      setUploadLabelAttributes([]);
      setUploadDetectedAttrs([]);
      setUploadFeatureCount(0);
      setMapNotice('Base map berhasil disimpan dan siap digunakan di lapangan.');
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : 'Gagal memproses file base map. Pastikan format sesuai (.zip Shapefile / .pdf / .geojson).'
      );
    } finally {
      setUploadBusy(false);
    }
  };

  const renderGeoJsonSvgFeatures = () => {
    if (!parsedVectorLayer) return null;
    const paths: React.ReactNode[] = [];
    const showLabels = layerLabelEnabled && layerLabelAttrs.length > 0;
    const candidateLabels: Array<{
      idx: number;
      lx: number;
      ly: number;
      area: number;
      text: string;
    }> = [];

    parsedVectorLayer.features.forEach((feat, idx) => {
      const geom = feat.geometry;
      if (!geom) return;

      const buildRingPath = (ring: number[][]) => {
        if (!Array.isArray(ring) || ring.length === 0) return '';
        return ring
          .map((coord, i) => {
            const [x, y] = projectPoint.toSvg(coord[0], coord[1]);
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
      };

      if (geom.type === 'Polygon') {
        const rings = geom.coordinates as number[][][];
        const d = rings.map(buildRingPath).join(' Z ') + ' Z';
        paths.push(
          <path
            key={`poly-${idx}`}
            d={d}
            fill="#14532D"
            fillOpacity={0.12}
            stroke="#14532D"
            strokeWidth={1.4 / Math.sqrt(zoom)}
          />
        );
      } else if (geom.type === 'MultiPolygon') {
        const polys = geom.coordinates as number[][][][];
        const d = polys
          .map((rings) => rings.map(buildRingPath).join(' Z ') + ' Z')
          .join(' ');
        paths.push(
          <path
            key={`mpoly-${idx}`}
            d={d}
            fill="#14532D"
            fillOpacity={0.12}
            stroke="#14532D"
            strokeWidth={1.4 / Math.sqrt(zoom)}
          />
        );
      } else if (geom.type === 'LineString') {
        const coords = geom.coordinates as number[][];
        const d = buildRingPath(coords);
        paths.push(
          <path
            key={`line-${idx}`}
            d={d}
            fill="none"
            stroke="#57534E"
            strokeWidth={1.6 / Math.sqrt(zoom)}
          />
        );
      } else if (geom.type === 'MultiLineString') {
        const lines = geom.coordinates as number[][][];
        const d = lines.map(buildRingPath).join(' ');
        paths.push(
          <path
            key={`mline-${idx}`}
            d={d}
            fill="none"
            stroke="#57534E"
            strokeWidth={1.6 / Math.sqrt(zoom)}
          />
        );
      } else if (geom.type === 'Point') {
        const c = geom.coordinates as number[];
        const [x, y] = projectPoint.toSvg(c[0], c[1]);
        paths.push(
          <circle
            key={`gpt-${idx}`}
            cx={x}
            cy={y}
            r={3.5 / Math.sqrt(zoom)}
            fill="#78716C"
          />
        );
      }

      if (showLabels && feat.properties) {
        const rawText = layerLabelAttrs
          .map((key) => {
            const val = feat.properties?.[key];
            return val !== null && val !== undefined ? String(val).trim() : '';
          })
          .filter((v) => v.length > 0)
          .join(' · ');

        if (rawText) {
          const anchor = getFeatureLabelAnchor(geom);
          if (anchor) {
            const [lx, rawLy] = projectPoint.toSvg(anchor.lon, anchor.lat);
            const isPoint = geom.type === 'Point' || geom.type === 'MultiPoint';
            const ly = isPoint ? rawLy - 7 / Math.sqrt(zoom) : rawLy;
            const displayText =
              rawText.length > 42 ? `${rawText.slice(0, 41)}…` : rawText;
            candidateLabels.push({
              idx,
              lx,
              ly,
              area: anchor.area,
              text: displayText,
            });
          }
        }
      }
    });

    const labels: React.ReactNode[] = [];
    if (candidateLabels.length > 0) {
      // Prioritize larger polygons/features so major blok/petak labels win if crowded
      const ordered = [...candidateLabels].sort((a, b) => b.area - a.area);
      const effectiveFontSize = layerLabelSize / Math.sqrt(zoom);
      const strokeHalo = Math.max(1.2, (layerLabelSize * 0.3) / Math.sqrt(zoom));
      const placedBoxes: Array<{
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
      }> = [];

      for (const item of ordered) {
        const boxW =
          Math.max(item.text.length, 2) * effectiveFontSize * 0.62 +
          6 / Math.sqrt(zoom);
        const boxH = effectiveFontSize * 1.35 + 4 / Math.sqrt(zoom);
        const box = {
          minX: item.lx - boxW / 2,
          maxX: item.lx + boxW / 2,
          minY: item.ly - boxH / 2,
          maxY: item.ly + boxH / 2,
        };

        if (layerLabelAvoidOverlap) {
          const overlaps = placedBoxes.some(
            (b) =>
              box.minX < b.maxX &&
              box.maxX > b.minX &&
              box.minY < b.maxY &&
              box.maxY > b.minY
          );
          if (overlaps) continue;
          placedBoxes.push(box);
        }

        labels.push(
          <text
            key={`lbl-${item.idx}`}
            x={item.lx}
            y={item.ly}
            fontSize={effectiveFontSize}
            fontWeight="700"
            fontFamily="sans-serif"
            fill="#0F3F22"
            stroke="#FFFFFF"
            strokeWidth={strokeHalo}
            strokeLinejoin="round"
            paintOrder="stroke"
            textAnchor="middle"
            dominantBaseline="central"
            pointerEvents="none"
          >
            {item.text}
          </text>
        );
      }
    }

    return (
      <>
        {paths}
        {labels}
      </>
    );
  };

  const isPdfWithoutGeoBounds =
    loadedLayerDetail?.fileType === 'pdf' && !layerBbox;

  return (
    <div className="space-y-5 pb-24 lg:pb-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-stone-200 pb-4">
        <div>
          <p className="text-xs font-medium text-stone-500">
            Visualisasi Spasial GNSS, Base Map PDF/Shapefile & Sebaran Titik
          </p>
          <h1 className="text-2xl font-bold text-[#141A15] font-display tracking-tight mt-0.5">
            Peta Sebaran Lapangan
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCaptureMyLocation()}
            disabled={locBusy}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#1D4ED8] text-white text-xs font-semibold hover:bg-[#1E40AF] disabled:opacity-60 flex items-center gap-2"
          >
            <LocateFixed className="w-4 h-4" />
            {locBusy ? 'Mengunci GNSS HP...' : 'Posisi Saya Saat Ini'}
          </button>

          <button
            type="button"
            onClick={handleToggleLiveTracking}
            className={`min-h-[42px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              liveTrackActive
                ? 'bg-blue-50 border-[#1D4ED8] text-[#1D4ED8]'
                : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-50'
            }`}
          >
            <Radio className="w-4 h-4" />
            {liveTrackActive ? 'Live GPS Aktif' : 'Lacak Live'}
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setUploadCompany(selectedCompany);
                setUploadError(null);
                setPdfGeoDetectedNotice(null);
                setUploadLabelEnabled(false);
                setUploadLabelAttributes([]);
                setUploadDetectedAttrs([]);
                setUploadFeatureCount(0);
                setShowUploadModal(true);
              }}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#14532D] text-white text-xs font-semibold hover:bg-[#0F3F22] flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Tambah Base Map (PDF / SHP)
            </button>
          )}
        </div>
      </div>

      {mapNotice && (
        <div className="rounded-xl border border-[#14532D]/25 bg-[#F2F7F3] px-4 py-3 text-xs text-[#14532D] flex items-center justify-between gap-2">
          <span>{mapNotice}</span>
          <button
            type="button"
            onClick={() => setMapNotice(null)}
            className="font-semibold hover:underline"
          >
            Tutup
          </button>
        </div>
      )}

      {locError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 flex items-center justify-between gap-2">
          <span>{locError}</span>
          <button
            type="button"
            onClick={() => setLocError(null)}
            className="font-semibold hover:underline"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Map Control Bar */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2">
          <div
            className={`grid gap-1 p-1 bg-[#F6F7F4] border border-stone-200/80 rounded-xl w-full sm:w-fit ${
              lockedCompany ? 'grid-cols-1' : 'grid-cols-3 sm:flex sm:flex-wrap'
            }`}
          >
            {(lockedCompany ? ([lockedCompany] as const) : COMPANIES).map(
              (comp) => (
                <button
                  key={comp}
                  type="button"
                  onClick={() => {
                    if (lockedCompany && comp !== lockedCompany) return;
                    setSelectedCompany(comp);
                    setSelectedPoint(null);
                  }}
                  className={`min-h-[40px] sm:min-h-[38px] px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-center truncate ${
                    selectedCompany === comp
                      ? 'bg-[#14532D] text-white'
                      : 'text-stone-600 hover:text-[#141A15]'
                  }`}
                >
                  {comp}
                </button>
              )
            )}
          </div>

          <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-1 p-1 bg-[#F6F7F4] border border-stone-200/80 rounded-xl w-full sm:w-fit">
            {(
              [
                { id: 'ALL', label: 'Semua' },
                { id: 'SENSUS', label: 'Sensus' },
                { id: 'MONITORING_IPPKH', label: 'IPPKH' },
                { id: 'MONITORING_APL', label: 'APL' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActivityFilter(tab.id);
                  setSelectedPoint(null);
                }}
                className={`min-h-[40px] sm:min-h-[38px] px-2 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap text-center ${
                  activityFilter === tab.id
                    ? 'bg-white text-[#141A15] border border-stone-200'
                    : 'text-stone-600 hover:text-[#141A15]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="space-y-1 min-w-0">
            <label className="font-semibold text-stone-700 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-stone-500" />
              Base Map ({selectedCompany})
            </label>
            <div className="flex gap-1.5">
              <select
                value={selectedLayerId}
                onChange={(e) => setSelectedLayerId(e.target.value)}
                className="flex-1 min-w-0 min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs text-[#141A15]"
              >
                <option value="NONE">
                  Grid Koordinat Standar (Tanpa Base Map)
                </option>
                {companyLayers.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name} ({layer.fileType.toUpperCase()} ·{' '}
                    {layer.crsCode})
                  </option>
                ))}
              </select>
              {isAdmin && selectedLayerId !== 'NONE' && (
                <button
                  type="button"
                  onClick={async () => {
                    await adminDeleteBaseMap(selectedLayerId);
                    setSelectedLayerId('NONE');
                    setMapNotice('Base map dihapus.');
                  }}
                  className="min-h-[44px] min-w-[44px] sm:min-h-[42px] sm:min-w-[42px] rounded-xl border border-stone-300 text-stone-500 hover:bg-red-50 hover:text-red-700 flex items-center justify-center shrink-0"
                  title="Hapus Base Map terpilih"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1 min-w-0">
            <label className="font-semibold text-stone-700 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-stone-500" />
              Coordinate Reference System (CRS)
            </label>
            <select
              value={displayCrs}
              onChange={(e) => setDisplayCrs(e.target.value as CoordCrsCode)}
              className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs text-[#141A15] font-mono"
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
          </div>

          <div className="space-y-1 min-w-0">
            <label className="font-semibold text-stone-700 flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-stone-500" />
              Type of Coordinate
            </label>
            <select
              value={coordFormat}
              onChange={(e) =>
                setCoordFormat(e.target.value as CoordFormatType)
              }
              className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs text-[#141A15]"
            >
              {COORD_FORMAT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Base Map Vector Attribute Label Bar */}
        {loadedLayerDetail &&
          loadedLayerDetail.fileType !== 'pdf' &&
          layerAvailableAttrs.length > 0 && (
            <div className="pt-3 border-t border-stone-200/80 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !layerLabelEnabled;
                      setLayerLabelEnabled(next);
                      if (
                        next &&
                        layerLabelAttrs.length === 0 &&
                        layerAvailableAttrs.length > 0
                      ) {
                        const suggested =
                          pickDefaultLabelAttribute(layerAvailableAttrs);
                        if (suggested) setLayerLabelAttrs([suggested]);
                      }
                    }}
                    className={`min-h-[36px] px-3 py-1.5 rounded-xl border font-semibold flex items-center gap-1.5 transition-colors ${
                      layerLabelEnabled
                        ? 'bg-[#14532D] text-white border-[#14532D]'
                        : 'bg-white text-stone-700 border-stone-300 hover:bg-[#F6F7F4]'
                    }`}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    {layerLabelEnabled ? 'Label Peta: Aktif' : 'Label Peta: Nonaktif'}
                  </button>
                  <span className="text-[11px] text-stone-500">
                    Pilih atribut SHP/GeoJSON yang ditampilkan di peta:
                  </span>
                </div>

                {isAdmin &&
                  (Boolean(loadedLayerDetail.labelEnabled) !==
                    layerLabelEnabled ||
                    JSON.stringify(loadedLayerDetail.labelAttributes || []) !==
                      JSON.stringify(layerLabelAttrs)) && (
                    <button
                      type="button"
                      disabled={savingLabels}
                      onClick={async () => {
                        setSavingLabels(true);
                        try {
                          await adminUpdateBaseMapLabels(
                            loadedLayerDetail.id,
                            layerLabelEnabled,
                            layerLabelAttrs
                          );
                          setLoadedLayerDetail((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  labelEnabled:
                                    layerLabelEnabled &&
                                    layerLabelAttrs.length > 0,
                                  labelAttributes: layerLabelEnabled
                                    ? layerLabelAttrs
                                    : [],
                                }
                              : prev
                          );
                          setMapNotice(
                            'Pengaturan label atribut base map disimpan.'
                          );
                        } catch (err) {
                          setLocError(
                            err instanceof Error
                              ? err.message
                              : 'Gagal menyimpan pengaturan label.'
                          );
                        } finally {
                          setSavingLabels(false);
                        }
                      }}
                      className="min-h-[34px] px-3 rounded-lg bg-[#14532D] text-white text-[11px] font-semibold hover:bg-[#0F3F22] disabled:opacity-50 flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {savingLabels ? 'Menyimpan...' : 'Simpan Pengaturan Label'}
                    </button>
                  )}
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {layerAvailableAttrs.map((attr) => {
                  const selected = layerLabelAttrs.includes(attr.key);
                  return (
                    <button
                      key={attr.key}
                      type="button"
                      onClick={() => {
                        const exists = layerLabelAttrs.includes(attr.key);
                        const next = exists
                          ? layerLabelAttrs.filter((k) => k !== attr.key)
                          : layerLabelAttrs.length < 15
                          ? [...layerLabelAttrs, attr.key]
                          : layerLabelAttrs;
                        setLayerLabelAttrs(next);
                        if (!exists && !layerLabelEnabled) {
                          setLayerLabelEnabled(true);
                        }
                      }}
                      className={`min-h-[32px] px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                        selected
                          ? 'bg-[#E8F3EB] text-[#14532D] border-[#14532D]/40 font-semibold'
                          : 'bg-[#F6F7F4] text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                          selected
                            ? 'bg-[#14532D] border-[#14532D] text-white'
                            : 'bg-white border-stone-300'
                        }`}
                      >
                        {selected && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="font-mono">{attr.key}</span>
                    </button>
                  );
                })}
              </div>

              {/* Label Size & Anti-Overlap Adjustment Bar */}
              {layerLabelEnabled && layerLabelAttrs.length > 0 && (
                <div className="pt-2.5 mt-1 border-t border-stone-200/70 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-stone-700 whitespace-nowrap">
                      Ukuran Label:
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setLayerLabelSize((s) =>
                            Math.max(5, Number((s - 1).toFixed(1)))
                          )
                        }
                        className="min-h-[34px] min-w-[34px] rounded-lg border border-stone-300 bg-white flex items-center justify-center text-stone-700 hover:bg-stone-50"
                        aria-label="Perkecil ukuran label"
                        title="Perkecil Label"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="range"
                        min={5}
                        max={20}
                        step={0.5}
                        value={layerLabelSize}
                        onChange={(e) =>
                          setLayerLabelSize(Number(e.target.value))
                        }
                        aria-label="Geser ukuran label peta"
                        className="w-28 sm:w-36 accent-[#14532D] cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setLayerLabelSize((s) =>
                            Math.min(20, Number((s + 1).toFixed(1)))
                          )
                        }
                        className="min-h-[34px] min-w-[34px] rounded-lg border border-stone-300 bg-white flex items-center justify-center text-stone-700 hover:bg-stone-50"
                        aria-label="Perbesar ukuran label"
                        title="Perbesar Label"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[11px] font-mono tabular-nums font-semibold text-[#14532D] min-w-[42px] text-center">
                        {layerLabelSize} px
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {(
                        [
                          { label: 'Kecil', size: 7 },
                          { label: 'Sedang', size: 10 },
                          { label: 'Besar', size: 14 },
                        ] as const
                      ).map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setLayerLabelSize(preset.size)}
                          className={`min-h-[32px] px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                            Math.abs(layerLabelSize - preset.size) < 0.6
                              ? 'bg-[#14532D] text-white border-[#14532D]'
                              : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 text-[11px] font-medium text-stone-700 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={layerLabelAvoidOverlap}
                      onChange={(e) =>
                        setLayerLabelAvoidOverlap(e.target.checked)
                      }
                      className="rounded border-stone-300 text-[#14532D]"
                    />
                    <span>Cegah label tumpang tindih (otomatis rapi)</span>
                  </label>
                </div>
              )}
            </div>
          )}
      </div>

      {/* Interactive Map Canvas */}
      <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
        <div
          ref={stageRef}
          className="relative h-[54dvh] min-h-[340px] max-h-[680px] lg:h-[600px] xl:h-[640px] bg-[#F2F4EF] select-none overflow-hidden touch-none"
        >
          {/* Zoom Toolbar */}
          <div className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-20 flex flex-col gap-1 bg-white/95 border border-stone-200 rounded-xl p-1 sm:p-1.5 shadow-sm">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(12, Number((z * 1.35).toFixed(2))))}
              className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg hover:bg-stone-100 flex items-center justify-center text-[#141A15]"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z / 1.35).toFixed(2))))}
              className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg hover:bg-stone-100 flex items-center justify-center text-[#141A15]"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg hover:bg-stone-100 flex items-center justify-center text-stone-700"
              title="Reset Tampilan"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <div className="text-[10px] font-mono text-center text-stone-500 py-0.5 border-t border-stone-100">
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Floating Legend */}
          <div className="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 z-20 bg-white/95 border border-stone-200 rounded-xl px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-[11px] space-y-1 shadow-sm max-w-[168px] sm:max-w-[230px]">
            <div className="font-bold text-[#141A15] flex items-center justify-between gap-2">
              <span className="truncate">Titik ({geoPoints.length})</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 sm:gap-x-3 gap-y-0.5 sm:gap-y-1 text-stone-700">
              <span className="flex items-center gap-1 sm:gap-1.5">
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#14532D] inline-block shrink-0" />
                Sensus
              </span>
              <span className="flex items-center gap-1 sm:gap-1.5">
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#B45309] inline-block shrink-0" />
                IPPKH
              </span>
              <span className="flex items-center gap-1 sm:gap-1.5">
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#0369A1] inline-block shrink-0" />
                APL
              </span>
              <span className="flex items-center gap-1 sm:gap-1.5">
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-[#DC2626] inline-block shrink-0" />
                Mati
              </span>
            </div>
            {myLocation && (
              <div className="pt-1 border-t border-stone-100 flex items-center gap-1 text-[#1D4ED8] font-semibold truncate">
                <span className="w-2 h-2 rounded-full bg-[#1D4ED8] inline-block shrink-0" />
                <span className="truncate">
                  Saya (±{myLocation.horizontalAccuracyM ?? '?'}m)
                </span>
              </div>
            )}
          </div>

          {layerLoading && (
            <div className="absolute inset-0 z-30 bg-white/70 flex items-center justify-center text-xs font-semibold text-stone-700">
              Memuat layer base map...
            </div>
          )}

          {/* Pan & Zoom Interactive Layer */}
          <div
            className="w-full h-full cursor-grab active:cursor-grabbing flex items-center justify-center"
            onWheel={(e) => {
              e.preventDefault();
              const factor = e.deltaY < 0 ? 1.15 : 0.87;
              setZoom((z) =>
                Math.min(12, Math.max(0.5, Number((z * factor).toFixed(2))))
              );
            }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button, circle')) return;
              dragRef.current = {
                dragging: true,
                startX: e.clientX,
                startY: e.clientY,
                origX: pan.x,
                origY: pan.y,
              };
            }}
            onPointerMove={(e) => {
              if (dragRef.current.dragging) {
                const dx = e.clientX - dragRef.current.startX;
                const dy = e.clientY - dragRef.current.startY;
                setPan({
                  x: dragRef.current.origX + dx,
                  y: dragRef.current.origY + dy,
                });
              }
            }}
            onPointerUp={() => {
              dragRef.current.dragging = false;
            }}
            onPointerLeave={() => {
              dragRef.current.dragging = false;
            }}
          >
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
              className="relative w-full h-full flex items-center justify-center transition-transform duration-75"
            >
              {loadedLayerDetail?.fileType === 'pdf' ? (
                <div
                  style={
                    pdfBoxSize
                      ? { width: pdfBoxSize.width, height: pdfBoxSize.height }
                      : undefined
                  }
                  className="relative shadow-md border border-stone-300 bg-white flex items-center justify-center"
                >
                  <canvas
                    ref={pdfCanvasRef}
                    className="block w-full h-full"
                  />
                  {!isPdfWithoutGeoBounds && pdfRenderSize && (
                    <svg
                      viewBox={`0 0 ${activeSvgW} ${activeSvgH}`}
                      className="absolute inset-0 w-full h-full pointer-events-auto"
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const sx =
                          ((e.clientX - rect.left) / rect.width) * activeSvgW;
                        const sy =
                          ((e.clientY - rect.top) / rect.height) * activeSvgH;
                        setHoverLonLat(projectPoint.toLonLat(sx, sy));
                      }}
                    >
                      {geoPoints.map((pt) => {
                        const [cx, cy] = projectPoint.toSvg(
                          pt.longitude!,
                          pt.latitude!
                        );
                        const isSelected = selectedPoint?.id === pt.id;
                        const fill =
                          pt.kondisiTanaman === 'Mati'
                            ? '#DC2626'
                            : pt.menuType === 'SENSUS'
                            ? '#14532D'
                            : pt.menuType === 'MONITORING_IPPKH'
                            ? '#B45309'
                            : '#0369A1';
                        const uiScale = activeSvgW / SVG_W / Math.sqrt(zoom);
                        const r = (isSelected ? 7.5 : 5) * uiScale;
                        return (
                          <g
                            key={pt.id}
                            className="cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPoint(pt);
                            }}
                          >
                            <circle
                              cx={cx}
                              cy={cy}
                              r={r}
                              fill={fill}
                              stroke="#FFFFFF"
                              strokeWidth={(isSelected ? 2.5 : 1.5) * uiScale}
                            />
                            {zoom >= 2.2 && (
                              <text
                                x={cx + 7 * uiScale}
                                y={cy + 3 * uiScale}
                                fontSize={10 * uiScale}
                                fill="#141A15"
                                fontFamily="monospace"
                                fontWeight="600"
                              >
                                #{pt.nomorTanaman}
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {myLocation &&
                        (() => {
                          const [mx, my] = projectPoint.toSvg(
                            myLocation.longitude,
                            myLocation.latitude
                          );
                          const s = activeSvgW / SVG_W / Math.sqrt(zoom);
                          return (
                            <g>
                              <circle
                                cx={mx}
                                cy={my}
                                r={14 * s}
                                fill="#1D4ED8"
                                fillOpacity={0.18}
                                stroke="#1D4ED8"
                                strokeWidth={1.2 * s}
                              />
                              <circle
                                cx={mx}
                                cy={my}
                                r={5.5 * s}
                                fill="#1D4ED8"
                                stroke="#FFFFFF"
                                strokeWidth={2 * s}
                              />
                            </g>
                          );
                        })()}
                    </svg>
                  )}
                </div>
              ) : (
                <svg
                  viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                  className="w-full h-full"
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const sx = ((e.clientX - rect.left) / rect.width) * SVG_W;
                    const sy = ((e.clientY - rect.top) / rect.height) * SVG_H;
                    setHoverLonLat(projectPoint.toLonLat(sx, sy));
                  }}
                >
                  {/* Subtle Coordinate Grid */}
                  {!loadedLayerDetail && (
                    <g stroke="#DCE0D6" strokeWidth={0.8}>
                      {[0.2, 0.4, 0.6, 0.8].map((t) => (
                        <React.Fragment key={t}>
                          <line
                            x1={SVG_W * t}
                            y1={0}
                            x2={SVG_W * t}
                            y2={SVG_H}
                          />
                          <line
                            x1={0}
                            y1={SVG_H * t}
                            x2={SVG_W}
                            y2={SVG_H * t}
                          />
                        </React.Fragment>
                      ))}
                    </g>
                  )}

                  {/* Shapefile / GeoJSON Vector Geometries */}
                  {renderGeoJsonSvgFeatures()}

                  {/* Plant GNSS Points */}
                  {geoPoints.map((pt) => {
                    const [cx, cy] = projectPoint.toSvg(
                      pt.longitude!,
                      pt.latitude!
                    );
                    const isSelected = selectedPoint?.id === pt.id;
                    const fill =
                      pt.kondisiTanaman === 'Mati'
                        ? '#DC2626'
                        : pt.menuType === 'SENSUS'
                        ? '#14532D'
                        : pt.menuType === 'MONITORING_IPPKH'
                        ? '#B45309'
                        : '#0369A1';
                    const r = (isSelected ? 7.5 : 5) / Math.sqrt(zoom);
                    return (
                      <g
                        key={pt.id}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPoint(pt);
                        }}
                      >
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill={fill}
                          stroke="#FFFFFF"
                          strokeWidth={(isSelected ? 2.5 : 1.5) / Math.sqrt(zoom)}
                        />
                        {zoom >= 2.2 && (
                          <text
                            x={cx + 7 / Math.sqrt(zoom)}
                            y={cy + 3 / Math.sqrt(zoom)}
                            fontSize={10 / Math.sqrt(zoom)}
                            fill="#141A15"
                            fontFamily="monospace"
                            fontWeight="600"
                          >
                            #{pt.nomorTanaman}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Current Officer Position */}
                  {myLocation && (() => {
                    const [mx, my] = projectPoint.toSvg(
                      myLocation.longitude,
                      myLocation.latitude
                    );
                    const s = 1 / Math.sqrt(zoom);
                    return (
                      <g>
                        <circle
                          cx={mx}
                          cy={my}
                          r={14 * s}
                          fill="#1D4ED8"
                          fillOpacity={0.18}
                          stroke="#1D4ED8"
                          strokeWidth={1.2 * s}
                        />
                        <circle
                          cx={mx}
                          cy={my}
                          r={5.5 * s}
                          fill="#1D4ED8"
                          stroke="#FFFFFF"
                          strokeWidth={2 * s}
                        />
                      </g>
                    );
                  })()}
                </svg>
              )}
            </div>
          </div>

          {/* Floating Selected Point Inspector (Desktop/Tablet) */}
          {selectedPoint && (
            <div className="hidden sm:block absolute bottom-3 left-3 z-20 w-80 bg-white border border-stone-200 rounded-xl p-3.5 shadow-lg text-xs space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-[#141A15]">
                    #{selectedPoint.nomorTanaman} · {selectedPoint.jenisTanaman}
                  </div>
                  <div className="text-[11px] text-stone-500">
                    {selectedPoint.perusahaan} ·{' '}
                    {getMenuLabel(selectedPoint.menuType)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPoint(null)}
                  className="text-stone-400 hover:text-stone-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[11px] text-stone-700">
                <div>
                  Lokasi:{' '}
                  <span className="font-semibold">{selectedPoint.lokasi}</span>
                </div>
                <div>
                  Kondisi:{' '}
                  <span className="font-semibold">
                    {selectedPoint.kondisiTanaman}
                  </span>
                </div>
                {selectedPoint.menuType !== 'SENSUS' && (
                  <div>
                    Petak:{' '}
                    <span className="font-semibold">
                      {selectedPoint.nomorPetak || '-'}
                    </span>
                  </div>
                )}
                <div>
                  Dimensi:{' '}
                  <span className="font-mono">
                    {selectedPoint.kondisiTanaman === 'Mati'
                      ? '-'
                      : `${selectedPoint.tinggiCm}cm / ${selectedPoint.diameterMm}mm`}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-[#F6F7F4] border border-stone-200 px-2.5 py-2 space-y-0.5">
                <div className="font-mono text-[11px] text-[#141A15]">
                  {formatCoordinatePair(
                    selectedPoint.longitude,
                    selectedPoint.latitude,
                    displayCrs,
                    coordFormat
                  )}
                </div>
                <div className="text-[10px] text-stone-500">
                  Akurasi H: ±{selectedPoint.horizontalAccuracyM ?? '?'}m · V: ±
                  {selectedPoint.verticalAccuracyM ?? '?'}m ·{' '}
                  {selectedPoint.namaPetugas}
                </div>
              </div>

              {selectedPoint.photoDataUrl && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-stone-600">
                    <Camera className="w-3 h-3" />
                    Bukti Foto Lapangan
                  </div>
                  <img
                    src={selectedPoint.photoDataUrl}
                    alt={`Foto tanaman #${selectedPoint.nomorTanaman}`}
                    className="w-full h-32 object-cover rounded-lg border border-stone-200"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Selected Point Inspector (Docked below canvas so map stays clear) */}
        {selectedPoint && (
          <div className="sm:hidden border-t border-stone-200 bg-white p-3.5 text-xs space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-[#141A15]">
                  #{selectedPoint.nomorTanaman} · {selectedPoint.jenisTanaman}
                </div>
                <div className="text-[11px] text-stone-500">
                  {selectedPoint.perusahaan} ·{' '}
                  {getMenuLabel(selectedPoint.menuType)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPoint(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 shrink-0"
                aria-label="Tutup detail titik"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[11px] text-stone-700">
              <div>
                Lokasi:{' '}
                <span className="font-semibold">{selectedPoint.lokasi}</span>
              </div>
              <div>
                Kondisi:{' '}
                <span className="font-semibold">
                  {selectedPoint.kondisiTanaman}
                </span>
              </div>
              {selectedPoint.menuType !== 'SENSUS' && (
                <div>
                  Petak:{' '}
                  <span className="font-semibold">
                    {selectedPoint.nomorPetak || '-'}
                  </span>
                </div>
              )}
              <div>
                Dimensi:{' '}
                <span className="font-mono">
                  {selectedPoint.kondisiTanaman === 'Mati'
                    ? '-'
                    : `${selectedPoint.tinggiCm}cm / ${selectedPoint.diameterMm}mm`}
                </span>
              </div>
            </div>

            <div className="rounded-lg bg-[#F6F7F4] border border-stone-200 px-2.5 py-2 space-y-0.5">
              <div className="font-mono text-[11px] text-[#141A15] break-all">
                {formatCoordinatePair(
                  selectedPoint.longitude,
                  selectedPoint.latitude,
                  displayCrs,
                  coordFormat
                )}
              </div>
              <div className="text-[10px] text-stone-500">
                Akurasi H: ±{selectedPoint.horizontalAccuracyM ?? '?'}m · V: ±
                {selectedPoint.verticalAccuracyM ?? '?'}m ·{' '}
                {selectedPoint.namaPetugas}
              </div>
            </div>

            {selectedPoint.photoDataUrl && (
              <img
                src={selectedPoint.photoDataUrl}
                alt={`Foto tanaman #${selectedPoint.nomorTanaman}`}
                className="w-full h-36 object-cover rounded-lg border border-stone-200"
              />
            )}
          </div>
        )}

        {/* Bottom Coordinate & Status Bar */}
        <div className="border-t border-stone-200 bg-[#F6F7F4] px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
          <div className="font-mono text-stone-700">
            <span className="font-semibold text-stone-500 font-sans mr-1.5">
              Kursor ({displayCrs} · {coordFormat}):
            </span>
            {hoverLonLat
              ? formatCoordinatePair(
                  hoverLonLat.lon,
                  hoverLonLat.lat,
                  displayCrs,
                  coordFormat
                )
              : 'Arahkan kursor ke area peta'}
          </div>
          <div className="font-mono text-[#1D4ED8]">
            {myLocation ? (
              <>
                <span className="font-sans font-semibold mr-1.5">
                  Posisi Saya:
                </span>
                {formatCoordinatePair(
                  myLocation.longitude,
                  myLocation.latitude,
                  displayCrs,
                  coordFormat
                )}
              </>
            ) : isPdfWithoutGeoBounds ? (
              <span className="font-sans text-amber-800">
                Mode PDF Lembar Penuh (tambahkan batas koordinat saat unggah
                untuk overlay GNSS)
              </span>
            ) : (
              <span className="font-sans text-stone-500">
                Klik &ldquo;Posisi Saya Saat Ini&rdquo; untuk menampilkan
                posisi GNSS Anda
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Points Summary Strip */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#141A15] font-display flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-[#14532D]" />
            Titik Data Terambil ({selectedCompany} · {geoPoints.length} titik
            GNSS)
          </h2>
          <span className="text-[11px] font-mono text-stone-500">
            {displayCrs} · {coordFormat}
          </span>
        </div>

        {geoPoints.length === 0 ? (
          <p className="text-xs text-stone-500 py-3">
            Belum ada entri dengan koordinat GNSS untuk filter perusahaan dan
            kegiatan ini. Koordinat terekam otomatis saat petugas menginput data
            tanaman dengan GNSS aktif.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto">
            {geoPoints.slice(0, 30).map((pt) => (
              <button
                key={pt.id}
                type="button"
                onClick={() => setSelectedPoint(pt)}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  selectedPoint?.id === pt.id
                    ? 'border-[#14532D] bg-[#F2F7F3]'
                    : 'border-stone-200 bg-[#F6F7F4] hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold text-[#141A15]">
                  <span>
                    #{pt.nomorTanaman} · {pt.jenisTanaman}
                  </span>
                  <span className="text-[10px] font-mono text-stone-500">
                    {pt.menuType === 'SENSUS'
                      ? 'Sensus'
                      : pt.menuType === 'MONITORING_IPPKH'
                      ? 'IPPKH'
                      : 'APL'}
                  </span>
                </div>
                <div className="text-[11px] text-stone-600 truncate">
                  {pt.lokasi}
                  {pt.nomorPetak ? ` · Petak ${pt.nomorPetak}` : ''} ·{' '}
                  {pt.kondisiTanaman}
                </div>
                <div className="text-[10px] font-mono text-stone-500 mt-1 truncate">
                  {formatCoordinatePair(
                    pt.longitude,
                    pt.latitude,
                    displayCrs,
                    coordFormat
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Admin Upload Base Map Modal */}
      {showUploadModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleUploadSubmit}
            className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 my-auto"
          >
            <div className="flex items-center justify-between border-b border-stone-200/80 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#14532D] shrink-0" />
                <h3 className="text-base font-bold text-[#141A15] font-display">
                  Tambah Base Map Lapangan (PDF / Shapefile)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Perusahaan
                </label>
                <select
                  value={uploadCompany}
                  onChange={(e) =>
                    setUploadCompany(e.target.value as CompanyName)
                  }
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs font-semibold"
                >
                  {COMPANIES.map((comp) => (
                    <option key={comp} value={comp}>
                      {comp}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-stone-700">
                  Format File Peta
                </label>
                <select
                  value={uploadType}
                  onChange={(e) => {
                    setUploadType(e.target.value as BaseMapFileType);
                    setUploadFile(null);
                    setPdfGeoDetectedNotice(null);
                    setUploadLabelEnabled(false);
                    setUploadLabelAttributes([]);
                    setUploadDetectedAttrs([]);
                    setUploadFeatureCount(0);
                  }}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs"
                >
                  <option value="shapefile">Shapefile (.zip)</option>
                  <option value="geojson">GeoJSON (.geojson / .json)</option>
                  <option value="pdf">Peta Georeferensi PDF (.pdf)</option>
                </select>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold text-stone-700">
                  Nama Layer Peta
                </label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="Misal: Batas Blok IPPKH 2026"
                  required
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 px-3 text-base sm:text-xs"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold text-stone-700">
                  Coordinate Reference System (CRS) Asal File
                </label>
                <select
                  value={uploadCrs}
                  onChange={(e) => setUploadCrs(e.target.value as CoordCrsCode)}
                  className="w-full min-h-[44px] sm:min-h-[42px] rounded-xl border border-stone-300 bg-white px-3 text-base sm:text-xs font-mono"
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
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="font-semibold text-stone-700">
                  Pilih File Peta
                </label>
                <input
                  type="file"
                  accept={
                    uploadType === 'pdf'
                      ? '.pdf,application/pdf'
                      : uploadType === 'shapefile'
                      ? '.zip,application/zip'
                      : '.geojson,.json,application/geo+json,application/json'
                  }
                  onChange={(e) =>
                    void handleSelectUploadFile(e.target.files?.[0] || null)
                  }
                  required
                  className="w-full rounded-xl border border-stone-300 p-2 text-xs"
                />
                <p className="text-[11px] text-stone-500">
                  {uploadType === 'shapefile'
                    ? 'Kompres .shp, .shx, .dbf (dan .prj jika ada) ke dalam satu file .zip.'
                    : uploadType === 'pdf'
                    ? 'Mendukung GeoPDF export ArcGIS (koordinat sudut terbaca otomatis, maks 12 MB).'
                    : 'File GeoJSON FeatureCollection standar.'}
                </p>
              </div>

              {(uploadType === 'shapefile' || uploadType === 'geojson') && (
                <div className="sm:col-span-2 rounded-xl bg-[#F6F7F4] border border-stone-200 p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-stone-800 flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-[#14532D]" />
                        Label Atribut di Peta
                      </div>
                      <p className="text-[11px] text-stone-500">
                        Aktifkan untuk menampilkan teks atribut (misal nama blok
                        atau petak) langsung di atas peta.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={uploadLabelEnabled}
                      onClick={() =>
                        handleToggleUploadLabel(!uploadLabelEnabled)
                      }
                      className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold border shrink-0 transition-colors ${
                        uploadLabelEnabled
                          ? 'bg-[#14532D] text-white border-[#14532D]'
                          : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
                      }`}
                    >
                      {uploadLabelEnabled ? 'Label Aktif' : 'Nonaktif'}
                    </button>
                  </div>

                  {uploadInspectBusy ? (
                    <div className="text-[11px] text-stone-500">
                      Membaca daftar atribut dari file...
                    </div>
                  ) : !uploadFile ? (
                    <div className="text-[11px] text-stone-500">
                      Pilih file {uploadType === 'shapefile' ? '.zip Shapefile' : 'GeoJSON'}{' '}
                      terlebih dahulu untuk memilih atribut yang akan dijadikan
                      label.
                    </div>
                  ) : uploadDetectedAttrs.length === 0 ? (
                    <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                      File terbaca ({uploadFeatureCount} fitur), namun tidak
                      memiliki kolom atribut (.dbf) untuk label.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-stone-700">
                          Pilih Atribut Aktif ({uploadFeatureCount} fitur ·{' '}
                          {uploadDetectedAttrs.length} atribut terdeteksi):
                        </span>
                        {uploadLabelAttributes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setUploadLabelAttributes([])}
                            className="text-stone-500 hover:text-stone-800 underline"
                          >
                            Kosongkan Pilihan
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                        {uploadDetectedAttrs.map((attr) => {
                          const checked = uploadLabelAttributes.includes(
                            attr.key
                          );
                          return (
                            <button
                              key={attr.key}
                              type="button"
                              onClick={() => handleToggleUploadAttr(attr.key)}
                              className={`text-left px-2.5 py-2 rounded-lg border text-[11px] flex items-start gap-2 transition-colors ${
                                checked
                                  ? 'bg-[#E8F3EB] border-[#14532D] text-[#14532D]'
                                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                              }`}
                            >
                              <span
                                className={`mt-0.5 w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                                  checked
                                    ? 'bg-[#14532D] border-[#14532D] text-white'
                                    : 'bg-white border-stone-300'
                                }`}
                              >
                                {checked && <Check className="w-2.5 h-2.5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="font-mono font-semibold block truncate">
                                  {attr.key}
                                </span>
                                <span className="text-[10px] text-stone-500 block truncate">
                                  Contoh: {attr.sample}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {uploadLabelEnabled && uploadLabelAttributes.length > 0 && (
                        <div className="rounded-lg bg-white border border-stone-200 px-2.5 py-1.5 text-[11px] text-stone-700">
                          <span className="font-semibold text-[#14532D]">
                            Pratinjau Label:{' '}
                          </span>
                          <span className="font-mono">
                            {uploadLabelAttributes
                              .map(
                                (k) =>
                                  uploadDetectedAttrs.find((a) => a.key === k)
                                    ?.sample || k
                              )
                              .join(' · ')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {uploadType === 'pdf' && (
                <div className="sm:col-span-2 rounded-xl bg-[#F6F7F4] border border-stone-200 p-3 space-y-2">
                  <div className="font-semibold text-stone-700">
                    Batas Koordinat Sudut GeoPDF ({uploadCrs})
                  </div>
                  {pdfGeoDetectedNotice && (
                    <div className="rounded-lg bg-[#E8F3EB] border border-[#14532D]/25 px-2.5 py-1.5 text-[11px] font-medium text-[#14532D]">
                      {pdfGeoDetectedNotice}
                    </div>
                  )}
                  <p className="text-[11px] text-stone-500">
                    {uploadCrs === 'EPSG:4326'
                      ? 'Terisi otomatis dari metadata GeoPDF ArcGIS atau isi manual koordinat sudut (Decimal Degrees):'
                      : `Isi koordinat sudut pojok peta dalam satuan meter (${uploadCrs}), otomatis dikonversi ke WGS 84:`}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-medium text-stone-500">
                        {uploadCrs === 'EPSG:4326'
                          ? 'Min Lon (Batas Kiri)'
                          : 'Min X / Easting Kiri'}
                      </span>
                      <input
                        type="text"
                        value={pdfBoundsMinLon}
                        onChange={(e) => setPdfBoundsMinLon(e.target.value)}
                        placeholder={
                          uploadCrs === 'EPSG:4326'
                            ? 'mis. 116.50'
                            : 'mis. 444320'
                        }
                        className="w-full min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-base sm:text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-medium text-stone-500">
                        {uploadCrs === 'EPSG:4326'
                          ? 'Max Lon (Batas Kanan)'
                          : 'Max X / Easting Kanan'}
                      </span>
                      <input
                        type="text"
                        value={pdfBoundsMaxLon}
                        onChange={(e) => setPdfBoundsMaxLon(e.target.value)}
                        placeholder={
                          uploadCrs === 'EPSG:4326'
                            ? 'mis. 116.70'
                            : 'mis. 466580'
                        }
                        className="w-full min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-base sm:text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-medium text-stone-500">
                        {uploadCrs === 'EPSG:4326'
                          ? 'Min Lat (Batas Bawah)'
                          : 'Min Y / Northing Bawah'}
                      </span>
                      <input
                        type="text"
                        value={pdfBoundsMinLat}
                        onChange={(e) => setPdfBoundsMinLat(e.target.value)}
                        placeholder={
                          uploadCrs === 'EPSG:4326'
                            ? 'mis. -1.40'
                            : uploadCrs.startsWith('EPSG:326')
                            ? 'mis. 155200'
                            : 'mis. 9845200'
                        }
                        className="w-full min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-base sm:text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-medium text-stone-500">
                        {uploadCrs === 'EPSG:4326'
                          ? 'Max Lat (Batas Atas)'
                          : 'Max Y / Northing Atas'}
                      </span>
                      <input
                        type="text"
                        value={pdfBoundsMaxLat}
                        onChange={(e) => setPdfBoundsMaxLat(e.target.value)}
                        placeholder={
                          uploadCrs === 'EPSG:4326'
                            ? 'mis. -1.20'
                            : uploadCrs.startsWith('EPSG:326')
                            ? 'mis. 177300'
                            : 'mis. 9867300'
                        }
                        className="w-full min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 bg-white px-2.5 text-base sm:text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                {uploadError}
              </div>
            )}

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-[#F6F7F4]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={uploadBusy}
                className="flex-1 min-h-[44px] rounded-xl bg-[#14532D] text-xs font-semibold text-white hover:bg-[#0F3F22] disabled:opacity-50"
              >
                {uploadBusy ? 'Mengunggah...' : 'Simpan Base Map'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
