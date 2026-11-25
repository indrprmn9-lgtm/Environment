import { type GnssModeKey, MAX_GNSS_ACCURACY_M } from '../types/plant';

export type GnssCaptureMode = GnssModeKey;

export interface GnssModeMeta {
  id: GnssCaptureMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const GNSS_CAPTURE_MODES: GnssModeMeta[] = [
  {
    id: 'optimal',
    label: 'Optimal (Multi-Sampel)',
    shortLabel: 'Optimal',
    description:
      'Mengumpulkan beberapa bacaan satelit lalu menghitung rata-rata terbobot akurasi terbaik (dioptimalkan untuk HP Android menengah/bawah).',
  },
  {
    id: 'precision_static',
    label: 'Kanopi Rapat (Statis)',
    shortLabel: 'Kanopi Rapat',
    description:
      'Waktu tunggu lebih panjang (hingga 25 dtk) dengan filter outlier ketat & buang sinyal BTS kasar untuk area bawah tegakan rapat.',
  },
  {
    id: 'continuous',
    label: 'Live Kontinu (Hot-Fix)',
    shortLabel: 'Live Kontinu',
    description:
      'Menjaga chipset GNSS HP tetap hangat saat berjalan antar pohon agar penguncian titik Android kelas menengah/bawah tetap instan.',
  },
  {
    id: 'fast',
    label: 'Cepat (1 Tembakan)',
    shortLabel: 'Cepat',
    description:
      'Membaca titik GNSS tunggal secara cepat (hingga 12 dtk) untuk area terbuka dengan sinyal satelit kuat.',
  },
];

export interface GnssSample {
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  horizontalAccuracyM: number;
  verticalAccuracyM: number | null;
  timestamp: number;
}

export interface GnssProgressInfo {
  sampleCount: number;
  targetSamples: number;
  elapsedMs: number;
  maxWaitMs: number;
  latestAccuracyM: number | null;
  bestAccuracyM: number | null;
  currentEstimate: GnssFixResult | null;
}

export interface GnssFixResult {
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  horizontalAccuracyM: number | null;
  verticalAccuracyM: number | null;
  gnssSource: string;
  mode: GnssCaptureMode;
  sampleCount: number;
  thresholdM: number;
  lockedWithinThreshold: boolean;
  accuracyMessage: string;
  capturedAt: number;
}

export interface GnssCaptureController {
  promise: Promise<GnssFixResult>;
  finishEarly: () => void;
  cancel: () => void;
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function medianValue(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function buildErrorFromPositionError(err: GeolocationPositionError): Error {
  if (err.code === err.PERMISSION_DENIED) {
    return new Error(
      'Izin lokasi ditolak. Aktifkan izin Lokasi Akurat (Precise Location) pada Chrome/browser HP agar GNSS internal dapat membaca koordinat.'
    );
  }
  if (err.code === err.POSITION_UNAVAILABLE) {
    return new Error(
      'Sinyal satelit GNSS belum tersedia. Pastikan GPS perangkat HP aktif (berfungsi offline tanpa kuota) dan jauhkan dari atap logam.'
    );
  }
  return new Error(
    'Waktu tunggu pembacaan satelit GNSS HP habis. Tunggu sebentar di ruang lebih terbuka atau aktifkan Live Kontinu (Hot-Fix) lalu coba lagi.'
  );
}

function toSample(pos: GeolocationPosition): GnssSample {
  const rawAcc =
    typeof pos.coords.accuracy === 'number' &&
    Number.isFinite(pos.coords.accuracy) &&
    pos.coords.accuracy > 0
      ? pos.coords.accuracy
      : 25;
  const vAcc =
    typeof pos.coords.altitudeAccuracy === 'number' &&
    Number.isFinite(pos.coords.altitudeAccuracy) &&
    pos.coords.altitudeAccuracy >= 0
      ? Math.round(pos.coords.altitudeAccuracy * 100) / 100
      : null;
  const alt =
    typeof pos.coords.altitude === 'number' &&
    Number.isFinite(pos.coords.altitude)
      ? Math.round(pos.coords.altitude * 100) / 100
      : null;

  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    altitudeM: alt,
    horizontalAccuracyM: Math.round(rawAcc * 100) / 100,
    verticalAccuracyM: vAcc,
    timestamp: pos.timestamp || Date.now(),
  };
}

/**
 * Compute an outlier-resistant inverse-variance weighted centroid from GNSS samples.
 * Tuned for mid/low-end Android L1 GNSS chipsets:
 * - Purges coarse cell/Wi-Fi network fixes once satellite-grade fixes exist
 * - Discards spatial multipath spikes around median cluster coordinate
 * - Evaluates lock threshold against horizontal accuracy (estHAcc <= thresholdM)
 */
export function computeOptimalGnssFix(
  rawSamples: GnssSample[],
  mode: GnssCaptureMode,
  thresholdM: number = MAX_GNSS_ACCURACY_M
): GnssFixResult | null {
  if (rawSamples.length === 0) return null;

  const cleanThreshold =
    Number.isFinite(thresholdM) && thresholdM >= 1
      ? Math.round(thresholdM * 10) / 10
      : MAX_GNSS_ACCURACY_M;

  // Prefer satellite-grade fixes over coarse network/cell fixes when available
  const sortedByAcc = [...rawSamples].sort(
    (a, b) => a.horizontalAccuracyM - b.horizontalAccuracyM
  );
  const bestAcc = sortedByAcc[0].horizontalAccuracyM;
  const accCutoff = Math.max(bestAcc * 2.3, bestAcc + 6, 18);
  let filtered = rawSamples.filter((s) => s.horizontalAccuracyM <= accCutoff);
  if (filtered.length === 0) {
    filtered = [sortedByAcc[0]];
  }

  // For precision static mode, keep the tightest 75% of samples by accuracy
  if (mode === 'precision_static' && filtered.length >= 4) {
    const keepCount = Math.max(3, Math.ceil(filtered.length * 0.75));
    filtered = [...filtered]
      .sort((a, b) => a.horizontalAccuracyM - b.horizontalAccuracyM)
      .slice(0, keepCount);
  }

  // Spatial multipath outlier rejection around median coordinate
  if (filtered.length >= 3) {
    const medLat = medianValue(filtered.map((s) => s.latitude));
    const medLon = medianValue(filtered.map((s) => s.longitude));
    const dists = filtered.map((s) =>
      haversineMeters(medLat, medLon, s.latitude, s.longitude)
    );
    const medDist = medianValue(dists);
    const distThreshold = Math.max(medDist * 2.5, 6);
    const spatialFiltered = filtered.filter((_, idx) => dists[idx] <= distThreshold);
    if (spatialFiltered.length >= 2) {
      filtered = spatialFiltered;
    }
  }

  let weightSum = 0;
  let latAcc = 0;
  let lonAcc = 0;
  let altWeightSum = 0;
  let altAcc = 0;
  let vAccWeightSum = 0;
  let vAccSum = 0;
  let minHAcc = Infinity;

  for (const s of filtered) {
    const sigma = Math.max(s.horizontalAccuracyM, 0.5);
    const w = 1 / (sigma * sigma);
    weightSum += w;
    latAcc += s.latitude * w;
    lonAcc += s.longitude * w;
    if (s.horizontalAccuracyM < minHAcc) {
      minHAcc = s.horizontalAccuracyM;
    }
    if (s.altitudeM !== null) {
      const vw =
        s.verticalAccuracyM !== null && s.verticalAccuracyM > 0
          ? 1 / (s.verticalAccuracyM * s.verticalAccuracyM)
          : w;
      altWeightSum += vw;
      altAcc += s.altitudeM * vw;
    }
    if (s.verticalAccuracyM !== null) {
      vAccWeightSum += w;
      vAccSum += s.verticalAccuracyM * w;
    }
  }

  const finalLat = latAcc / weightSum;
  const finalLon = lonAcc / weightSum;
  const finalAlt =
    altWeightSum > 0 ? Math.round((altAcc / altWeightSum) * 100) / 100 : null;

  // Combined weighted horizontal accuracy improves modestly with independent converged samples
  const weightedHarmonicRms = Math.sqrt(filtered.length / weightSum);
  const spreadM =
    filtered.length >= 2
      ? Math.max(
          ...filtered.map((s) =>
            haversineMeters(finalLat, finalLon, s.latitude, s.longitude)
          )
        )
      : 0;
  const estHAcc =
    filtered.length >= 2
      ? Math.round(
          Math.max(
            0.5,
            Math.min(
              weightedHarmonicRms,
              Math.max(minHAcc * 0.85, spreadM * 0.65)
            )
          ) * 100
        ) / 100
      : Math.round(minHAcc * 100) / 100;

  const estVAcc =
    vAccWeightSum > 0
      ? Math.round((vAccSum / vAccWeightSum) * 100) / 100
      : null;

  const lockedWithinThreshold = estHAcc <= cleanThreshold;

  const modeLabel =
    mode === 'precision_static'
      ? `GNSS HP Kanopi (${filtered.length} sampel)`
      : mode === 'continuous'
      ? `GNSS HP Live (${filtered.length} sampel)`
      : mode === 'fast'
      ? 'GNSS HP Cepat'
      : `GNSS HP Optimal (${filtered.length} sampel)`;

  const vText = estVAcc !== null ? `V: ±${estVAcc}m` : 'V: N/A';
  const accuracyMessage = lockedWithinThreshold
    ? `Terkunci <= ${cleanThreshold}m (H: ±${estHAcc}m · ${vText})`
    : `Akurasi H: ±${estHAcc}m · ${vText} (batas wajib <= ${cleanThreshold}m)`;

  return {
    latitude: Number(finalLat.toFixed(7)),
    longitude: Number(finalLon.toFixed(7)),
    altitudeM: finalAlt,
    horizontalAccuracyM: estHAcc,
    verticalAccuracyM: estVAcc,
    gnssSource: modeLabel,
    mode,
    sampleCount: filtered.length,
    thresholdM: cleanThreshold,
    lockedWithinThreshold,
    accuracyMessage,
    capturedAt: Date.now(),
  };
}

/**
 * Start an internal phone GNSS capture session with real-time progress and early lock.
 * Extended warm-up & coarse-fix purging tuned specifically for mid/low-end Android devices.
 */
export function startInternalGnssCapture(
  mode: GnssCaptureMode = 'optimal',
  onProgress?: (progress: GnssProgressInfo) => void,
  thresholdM: number = MAX_GNSS_ACCURACY_M
): GnssCaptureController {
  let watchId: number | null = null;
  let timerId: number | null = null;
  let progressTickId: number | null = null;
  let settled = false;
  let samples: GnssSample[] = [];
  const startedAt = Date.now();

  const cleanThreshold =
    Number.isFinite(thresholdM) && thresholdM >= 1
      ? thresholdM
      : MAX_GNSS_ACCURACY_M;

  // Extended timeouts for mid/low-end Android L1 GNSS chipsets (TTFF warm-up)
  const targetSamples =
    mode === 'fast' ? 1 : mode === 'precision_static' ? 10 : 6;
  const maxWaitMs =
    mode === 'fast' ? 12000 : mode === 'precision_static' ? 25000 : 18000;

  let resolveFn!: (res: GnssFixResult) => void;
  let rejectFn!: (err: Error) => void;

  const cleanup = () => {
    if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
    if (progressTickId !== null) {
      window.clearInterval(progressTickId);
      progressTickId = null;
    }
  };

  const emitProgress = () => {
    if (!onProgress) return;
    const latest = samples[samples.length - 1] ?? null;
    const bestAcc =
      samples.length > 0
        ? Math.min(...samples.map((s) => s.horizontalAccuracyM))
        : null;
    onProgress({
      sampleCount: samples.length,
      targetSamples,
      elapsedMs: Date.now() - startedAt,
      maxWaitMs,
      latestAccuracyM: latest?.horizontalAccuracyM ?? null,
      bestAccuracyM: bestAcc,
      currentEstimate: computeOptimalGnssFix(samples, mode, cleanThreshold),
    });
  };

  const finalize = (reason: 'converged' | 'timeout' | 'manual') => {
    if (settled) return;
    settled = true;
    cleanup();
    const fix = computeOptimalGnssFix(samples, mode, cleanThreshold);
    if (fix) {
      resolveFn(fix);
    } else if (reason === 'manual') {
      rejectFn(new Error('Belum ada pembacaan satelit yang diterima dari GPS HP.'));
    } else {
      rejectFn(
        new Error(
          'Waktu tunggu pembacaan satelit GNSS HP habis. Pastikan GPS perangkat aktif lalu coba di area lebih terbuka.'
        )
      );
    }
  };

  const promise = new Promise<GnssFixResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      settled = true;
      reject(new Error('Perangkat tidak mendukung Geolocation API.'));
      return;
    }

    if (mode === 'fast') {
      emitProgress();
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (settled) return;
          samples = [toSample(pos)];
          emitProgress();
          finalize('converged');
        },
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(buildErrorFromPositionError(err));
        },
        {
          enableHighAccuracy: true,
          timeout: maxWaitMs,
          maximumAge: 0,
        }
      );
      return;
    }

    progressTickId = window.setInterval(() => {
      if (!settled) emitProgress();
    }, 350);

    timerId = window.setTimeout(() => {
      finalize('timeout');
    }, maxWaitMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (settled) return;
        const sample = toSample(pos);
        // Ignore obviously stale buffered positions older than 4 seconds before start
        if (sample.timestamp < startedAt - 4000 && samples.length === 0) {
          return;
        }
        // Avoid pushing identical duplicate coordinates with identical timestamp
        const prev = samples[samples.length - 1];
        if (
          prev &&
          prev.timestamp === sample.timestamp &&
          prev.latitude === sample.latitude &&
          prev.longitude === sample.longitude
        ) {
          return;
        }

        // Discard incoming coarse network/cell fix (> 45m) once better satellite fixes exist
        if (samples.length > 0 && sample.horizontalAccuracyM > 45) {
          const minExisting = Math.min(...samples.map((s) => s.horizontalAccuracyM));
          if (minExisting <= 25) return;
        }

        // Purge earlier coarse cell-tower fixes (> 35m) as soon as a true satellite lock arrives
        if (sample.horizontalAccuracyM <= 25) {
          samples = samples.filter((s) => s.horizontalAccuracyM <= 35);
        }

        samples.push(sample);
        emitProgress();

        const qualityCutoff = Math.max(cleanThreshold * 2, 25);
        const qualitySamples = samples.filter(
          (s) => s.horizontalAccuracyM <= qualityCutoff
        );
        const withinThresholdCount = samples.filter(
          (s) => s.horizontalAccuracyM <= cleanThreshold
        ).length;
        const elapsed = Date.now() - startedAt;

        if (qualitySamples.length >= targetSamples) {
          finalize('converged');
        } else if (
          mode === 'optimal' &&
          withinThresholdCount >= 4 &&
          elapsed >= 3500
        ) {
          finalize('converged');
        } else if (
          mode === 'precision_static' &&
          samples.filter(
            (s) => s.horizontalAccuracyM <= Math.min(cleanThreshold, 6)
          ).length >= 6 &&
          elapsed >= 5500
        ) {
          finalize('converged');
        }
      },
      (err) => {
        if (settled) return;
        if (err.code === err.PERMISSION_DENIED) {
          settled = true;
          cleanup();
          reject(buildErrorFromPositionError(err));
        } else if (samples.length === 0 && Date.now() - startedAt > maxWaitMs - 1000) {
          settled = true;
          cleanup();
          reject(buildErrorFromPositionError(err));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: maxWaitMs,
        maximumAge: 0,
      }
    );
  });

  return {
    promise,
    finishEarly: () => finalize('manual'),
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectFn(new Error('Pengambilan titik GNSS dibatalkan.'));
    },
  };
}

/**
 * Convenience promise wrapper for internal phone GNSS capture.
 */
export function captureBrowserGnssPoint(
  timeoutMs = 14000,
  mode: GnssCaptureMode = 'optimal',
  thresholdM: number = MAX_GNSS_ACCURACY_M
): Promise<GnssFixResult> {
  if (mode === 'fast') {
    return startInternalGnssCapture('fast', undefined, thresholdM).promise;
  }
  const controller = startInternalGnssCapture(mode, undefined, thresholdM);
  const guardTimer = window.setTimeout(() => {
    controller.finishEarly();
  }, Math.max(4000, timeoutMs));
  return controller.promise.finally(() => window.clearTimeout(guardTimer));
}

/**
 * Continuous live GNSS watcher for hot-fix field movement (keeps GPS chip locked).
 */
export function startLiveGnssWatcher(
  onFix: (fix: GnssFixResult, sampleCount: number) => void,
  onError?: (err: Error) => void,
  thresholdM: number = MAX_GNSS_ACCURACY_M
): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.(new Error('Perangkat tidak mendukung Geolocation API.'));
    return () => {};
  }

  let recentSamples: GnssSample[] = [];
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const sample = toSample(pos);
      const prev = recentSamples[recentSamples.length - 1];
      if (prev) {
        const movedM = haversineMeters(
          prev.latitude,
          prev.longitude,
          sample.latitude,
          sample.longitude
        );
        // If user moved > 4 meters, start a fresh stationary cluster for the new tree
        if (movedM > 4) {
          recentSamples = [sample];
        } else {
          const base =
            sample.horizontalAccuracyM <= 25
              ? recentSamples.filter((s) => s.horizontalAccuracyM <= 35)
              : recentSamples;
          recentSamples = [...base.slice(-5), sample];
        }
      } else {
        recentSamples = [sample];
      }

      const fix = computeOptimalGnssFix(recentSamples, 'continuous', thresholdM);
      if (fix) {
        onFix(fix, recentSamples.length);
      }
    },
    (err) => {
      onError?.(buildErrorFromPositionError(err));
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    }
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
}
