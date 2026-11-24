export interface ExtractedGeoPdfBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  sourceTag: string;
}

/**
 * Extracts ISO 32000 (/GPTS) or TerraGo (/LGIDict) georeference corner bounds
 * embedded inside ArcGIS GeoPDF exports directly in the browser.
 */
export function extractGeoPdfBoundsFromBuffer(
  buffer: ArrayBuffer
): ExtractedGeoPdfBounds | null {
  try {
    const bytes = new Uint8Array(buffer);
    // Decode as Latin-1 so byte offsets preserve ASCII PDF dictionary keywords
    const decoder = new TextDecoder('latin1');
    const text = decoder.decode(bytes);

    // 1. ISO 32000 Geospatial PDF (/Measure /Subtype /GEO /GPTS [lat1 lon1 ...])
    const gptsRegex = /\/GPTS\s*\[\s*([0-9eE.+\-\s]+?)\s*\]/g;
    let match: RegExpExecArray | null;
    while ((match = gptsRegex.exec(text)) !== null) {
      const nums = match[1]
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (nums.length >= 4) {
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLon = Infinity;
        let maxLon = -Infinity;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const lat = nums[i];
          const lon = nums[i + 1];
          if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
          }
        }
        if (
          Number.isFinite(minLon) &&
          Number.isFinite(minLat) &&
          maxLon > minLon &&
          maxLat > minLat
        ) {
          return {
            minLon: Number(minLon.toFixed(7)),
            minLat: Number(minLat.toFixed(7)),
            maxLon: Number(maxLon.toFixed(7)),
            maxLat: Number(maxLat.toFixed(7)),
            sourceTag: 'ISO 32000 GeoPDF (/GPTS)',
          };
        }
      }
    }

    // 2. TerraGo / ArcGIS LGIDict /Registration [ [px py lon lat] ... ]
    const lgiMatch = /\/Registration\s*\[\s*((?:\[[^\]]+\]\s*)+)\]/m.exec(text);
    if (lgiMatch) {
      const tuples = lgiMatch[1].match(/\[\s*([0-9eE.+\-\s]+?)\s*\]/g) || [];
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLon = Infinity;
      let maxLon = -Infinity;
      for (const tup of tuples) {
        const vals = tup
          .replace(/[[\]]/g, '')
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter((n) => Number.isFinite(n));
        if (vals.length >= 4) {
          const lon = vals[2];
          const lat = vals[3];
          if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
          }
        }
      }
      if (
        Number.isFinite(minLon) &&
        Number.isFinite(minLat) &&
        maxLon > minLon &&
        maxLat > minLat
      ) {
        return {
          minLon: Number(minLon.toFixed(7)),
          minLat: Number(minLat.toFixed(7)),
          maxLon: Number(maxLon.toFixed(7)),
          maxLat: Number(maxLat.toFixed(7)),
          sourceTag: 'ArcGIS GeoPDF (/LGIDict)',
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
