import fs from "fs";
import pc from "polygon-clipping";

const TIGERWEB_TRACTS_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/7/query";
const BOUNDARY_PATH = "assets/wilkinsburg_survey_boundary.geojson";
const TRACTS_PATH = "assets/wilkinsburg_census_tracts.geojson";
const MIN_TRACT_AREA_SQ_M = 1;
const SLIVER_TRACT_AREA_SQ_M = 1000;
const EARTH_RADIUS_M = 6371008.8;

const boundary = readJson(BOUNDARY_PATH);
const latitudeOrigin = averageLatitude(boundary);
const boundaryMultiPolygon = collectionToMultiPolygon(boundary);
const tractCollection = await fetchAlleghenyTracts();

const clippedFeatures = tractCollection.features
  .map(feature => clippedTractFeature(feature))
  .filter(Boolean)
  .sort((a, b) => String(a.properties.GEOID).localeCompare(String(b.properties.GEOID)));
const features = mergeTinyTractSlivers(clippedFeatures);

fs.writeFileSync(TRACTS_PATH, JSON.stringify({
  type: "FeatureCollection",
  properties: {
    source: "U.S. Census Bureau TIGERweb Tracts_Blocks MapServer layer 7",
    source_url: TIGERWEB_TRACTS_URL,
    source_where: "STATE='42' AND COUNTY='003'",
    clipped_to: BOUNDARY_PATH,
    sliver_tract_area_sq_m: SLIVER_TRACT_AREA_SQ_M,
    feature_count: features.length
  },
  features
}));

console.log(`Generated ${TRACTS_PATH} with ${features.length} clipped census tract area${features.length === 1 ? "" : "s"}.`);

async function fetchAlleghenyTracts() {
  const params = new URLSearchParams({
    where: "STATE='42' AND COUNTY='003'",
    outFields: "GEOID,STATE,COUNTY,TRACT,NAME,BASENAME",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson"
  });
  const response = await fetch(`${TIGERWEB_TRACTS_URL}?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch Census tracts: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function clippedTractFeature(feature) {
  const clipped = pc.intersection(geometryToMultiPolygon(feature.geometry), boundaryMultiPolygon);
  if (!clipped || clipped.length === 0) return null;

  const area = multiPolygonAreaSqM(clipped);
  if (area < MIN_TRACT_AREA_SQ_M) return null;

  return {
    type: "Feature",
    properties: {
      GEOID: String(feature.properties.GEOID),
      STATE: String(feature.properties.STATE),
      COUNTY: String(feature.properties.COUNTY),
      TRACT: String(feature.properties.TRACT),
      NAME: String(feature.properties.NAME || ""),
      BASENAME: String(feature.properties.BASENAME || ""),
      area_sq_m: Math.round(area)
    },
    geometry: multiPolygonToGeometry(clipped)
  };
}

function mergeTinyTractSlivers(features) {
  const records = features.map(feature => makeRecord(feature));

  while (true) {
    const sliver = records
      .filter(record => record.area < SLIVER_TRACT_AREA_SQ_M)
      .sort((a, b) => a.area - b.area)[0];

    if (!sliver || records.length === 1) break;

    const target = records
      .filter(record => record !== sliver)
      .map(record => ({
        record,
        shared: sharedBoundaryLength(sliver, record),
        distance: geometryDistance(sliver, record)
      }))
      .sort((a, b) => {
        if (Math.abs(b.shared - a.shared) > 0.001) return b.shared - a.shared;
        if (Math.abs(a.distance - b.distance) > 0.001) return a.distance - b.distance;
        return b.record.area - a.record.area;
      })[0]?.record;

    if (!target) break;

    target.feature.geometry = multiPolygonToGeometry(pc.union(
      geometryToMultiPolygon(target.feature.geometry),
      geometryToMultiPolygon(sliver.feature.geometry)
    ));
    target.feature.properties.absorbed_sliver_tract_geoids = [
      ...(target.feature.properties.absorbed_sliver_tract_geoids || []),
      sliver.id
    ];
    target.area = geometryAreaSqM(target.feature.geometry);
    target.feature.properties.area_sq_m = Math.round(target.area);
    target.segments = geometrySegments(target.feature.geometry);

    records.splice(records.indexOf(sliver), 1);
  }

  return records
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(record => record.feature);
}

function makeRecord(feature) {
  return {
    id: String(feature.properties.GEOID),
    feature,
    area: geometryAreaSqM(feature.geometry),
    segments: geometrySegments(feature.geometry)
  };
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function collectionToMultiPolygon(collection) {
  return collection.features.flatMap(feature => geometryToMultiPolygon(feature.geometry));
}

function geometryToMultiPolygon(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

function multiPolygonToGeometry(multiPolygon) {
  return multiPolygon.length === 1
    ? { type: "Polygon", coordinates: multiPolygon[0] }
    : { type: "MultiPolygon", coordinates: multiPolygon };
}

function geometryAreaSqM(geometry) {
  return multiPolygonAreaSqM(geometryToMultiPolygon(geometry));
}

function averageLatitude(collection) {
  let total = 0;
  let count = 0;

  for (const feature of collection.features) {
    visitPositions(feature.geometry.coordinates, position => {
      total += position[1];
      count++;
    });
  }

  return (total / Math.max(count, 1)) * Math.PI / 180;
}

function visitPositions(coordinates, callback) {
  if (typeof coordinates[0] === "number") {
    callback(coordinates);
    return;
  }

  for (const child of coordinates) {
    visitPositions(child, callback);
  }
}

function project(position) {
  const lon = position[0] * Math.PI / 180;
  const lat = position[1] * Math.PI / 180;

  return [
    EARTH_RADIUS_M * lon * Math.cos(latitudeOrigin),
    EARTH_RADIUS_M * lat
  ];
}

function multiPolygonAreaSqM(multiPolygon) {
  return multiPolygon.reduce((sum, polygon) => {
    const exterior = Math.abs(ringAreaSqM(polygon[0] || []));
    const holes = polygon
      .slice(1)
      .reduce((holeSum, ring) => holeSum + Math.abs(ringAreaSqM(ring)), 0);

    return sum + exterior - holes;
  }, 0);
}

function ringAreaSqM(ring) {
  let area = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = project(ring[i]);
    const [x2, y2] = project(ring[i + 1]);
    area += x1 * y2 - x2 * y1;
  }

  return area / 2;
}

function geometrySegments(geometry) {
  const segments = [];

  for (const polygon of geometryToMultiPolygon(geometry)) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        segments.push([project(ring[i]), project(ring[i + 1])]);
      }
    }
  }

  return segments;
}

function sharedBoundaryLength(a, b) {
  let sharedLength = 0;

  for (const segmentA of a.segments) {
    for (const segmentB of b.segments) {
      sharedLength += segmentOverlapLength(segmentA, segmentB);
    }
  }

  return sharedLength;
}

function segmentOverlapLength([a1, a2], [b1, b2]) {
  const collinear =
    Math.abs(cross(a1, a2, b1)) < 0.15 &&
    Math.abs(cross(a1, a2, b2)) < 0.15;

  if (!collinear) return 0;

  const dx = a2[0] - a1[0];
  const dy = a2[1] - a1[1];
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return 0;

  const t1 = projectionT(a1, a2, b1);
  const t2 = projectionT(a1, a2, b2);
  const overlapStart = Math.max(0, Math.min(t1, t2));
  const overlapEnd = Math.min(1, Math.max(t1, t2));

  if (overlapEnd <= overlapStart) return 0;

  return Math.sqrt(lengthSq) * (overlapEnd - overlapStart);
}

function projectionT(start, end, point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return 0;

  return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSq;
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function geometryDistance(a, b) {
  let distance = Infinity;

  for (const segmentA of a.segments) {
    for (const segmentB of b.segments) {
      distance = Math.min(distance, segmentDistance(segmentA, segmentB));
      if (distance === 0) return 0;
    }
  }

  return distance;
}

function segmentDistance([a1, a2], [b1, b2]) {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;

  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2)
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  return o1 * o2 <= 0 && o3 * o4 <= 0;
}

function orientation(a, b, c) {
  const value = cross(a, b, c);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function pointSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }

  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSq)
  );
  const projected = [start[0] + t * dx, start[1] + t * dy];

  return Math.hypot(point[0] - projected[0], point[1] - projected[1]);
}
