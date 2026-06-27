import fs from "fs";
import pc from "polygon-clipping";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const BOUNDARY_PATH = "assets/wilkinsburg_survey_boundary.geojson";
const MIN_GAP_AREA_SQ_M = 1;
const NEARBY_DISTANCE_M = 45;
const MAX_CANDIDATES = 10;
const EARTH_RADIUS_M = 6371008.8;

const blocks = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
const boundary = JSON.parse(fs.readFileSync(BOUNDARY_PATH, "utf8"));
const latitudeOrigin = averageLatitude(blocks);
const records = blocks.features.map(feature => makeRecord(feature));
const blockUnion = pc.union(...records.map(record => geometryToMultiPolygon(record.feature.geometry)));
const gaps = pc.difference(collectionToMultiPolygon(boundary), blockUnion);
const fillLog = [];

for (const gapPolygon of gaps) {
  const gapGeometry = { type: "Polygon", coordinates: gapPolygon };
  const gapRecord = makeRecord({
    type: "Feature",
    properties: {},
    geometry: gapGeometry
  });

  if (gapRecord.area < MIN_GAP_AREA_SQ_M) continue;

  const candidates = neighboringRecords(gapRecord, records);
  if (candidates.length === 0) continue;

  if (candidates.length === 1 || gapRecord.area < 80) {
    addGeometryToRecord(candidates[0], gapGeometry);
    fillLog.push(logRow(gapRecord, [{ id: candidates[0].id, area: gapRecord.area }], "single-neighbor"));
    continue;
  }

  const assignments = distributeGapByNearestSide(gapGeometry, gapRecord, candidates);
  const assignedRows = [];

  for (const assignment of assignments) {
    if (!assignment.geometry || assignment.area < MIN_GAP_AREA_SQ_M) continue;

    addGeometryToRecord(assignment.record, assignment.geometry);
    assignedRows.push({
      id: assignment.record.id,
      area: assignment.area
    });
  }

  if (assignedRows.length > 0) {
    fillLog.push(logRow(gapRecord, assignedRows, "nearest-side-split"));
  }
}

blocks.features = records.map(record => record.feature);
blocks.properties = {
  ...(blocks.properties || {}),
  internal_gap_fill: {
    boundary: BOUNDARY_PATH,
    minimum_gap_area_sq_m: MIN_GAP_AREA_SQ_M,
    nearby_distance_m: NEARBY_DISTANCE_M,
    filled_gap_count: fillLog.length,
    generated_at: new Date().toISOString(),
    fills: fillLog
  }
};

fs.writeFileSync(BLOCKS_PATH, JSON.stringify(blocks));
console.log(`Filled ${fillLog.length} internal gap${fillLog.length === 1 ? "" : "s"} into neighboring blocks.`);

function neighboringRecords(gapRecord, candidates) {
  const scored = candidates
    .map(record => ({
      record,
      shared: sharedBoundaryLength(gapRecord, record),
      distance: geometryDistance(gapRecord, record)
    }))
    .filter(item => item.shared > 0.1 || item.distance <= NEARBY_DISTANCE_M)
    .sort((a, b) => {
      if (Math.abs(b.shared - a.shared) > 0.1) return b.shared - a.shared;
      if (Math.abs(a.distance - b.distance) > 0.1) return a.distance - b.distance;
      return a.record.area - b.record.area;
    });

  return scored.slice(0, MAX_CANDIDATES).map(item => item.record);
}

function distributeGapByNearestSide(gapGeometry, gapRecord, candidates) {
  const assignments = [];

  for (const candidate of candidates) {
    let cell = geometryToMultiPolygon(gapGeometry);

    for (const other of candidates) {
      if (other === candidate) continue;

      const halfPlane = closerHalfPlane(candidate.centroid, other.centroid);
      const clipped = pc.intersection(cell, [halfPlane]);

      if (!clipped || clipped.length === 0) {
        cell = [];
        break;
      }

      cell = clipped;
    }

    if (cell.length === 0) continue;

    const geometry = multiPolygonToGeometry(cell);
    const area = geometryAreaSqM(geometry);
    if (area < MIN_GAP_AREA_SQ_M) continue;

    assignments.push({
      record: candidate,
      geometry,
      area
    });
  }

  if (assignments.length === 0) {
    const fallback = neighboringRecords(gapRecord, candidates)[0] || candidates[0];
    return [{
      record: fallback,
      geometry: gapGeometry,
      area: gapRecord.area
    }];
  }

  return assignments;
}

function closerHalfPlane(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const unit = [dx / length, dy / length];
  const normal = [-unit[1], unit[0]];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const span = 120000;
  const towardA = [-unit[0], -unit[1]];

  const ring = [
    [mid[0] + normal[0] * span, mid[1] + normal[1] * span],
    [mid[0] - normal[0] * span, mid[1] - normal[1] * span],
    [mid[0] - normal[0] * span + towardA[0] * span, mid[1] - normal[1] * span + towardA[1] * span],
    [mid[0] + normal[0] * span + towardA[0] * span, mid[1] + normal[1] * span + towardA[1] * span],
    [mid[0] + normal[0] * span, mid[1] + normal[1] * span]
  ];

  return ring.map(unproject);
}

function addGeometryToRecord(record, geometry) {
  record.feature.geometry = multiPolygonToGeometry(
    pc.union(
      geometryToMultiPolygon(record.feature.geometry),
      geometryToMultiPolygon(geometry)
    )
  );
  record.area = geometryAreaSqM(record.feature.geometry);
  record.centroid = geometryCentroid(record.feature.geometry);
  record.segments = geometrySegments(record.feature.geometry);
}

function logRow(gapRecord, assignments, strategy) {
  return {
    strategy,
    gap_area_sq_m: Math.round(gapRecord.area),
    assigned_to: assignments.map(row => ({
      geoid: row.id,
      area_sq_m: Math.round(row.area)
    }))
  };
}

function makeRecord(feature) {
  const id = feature.properties && feature.properties.GEOID
    ? String(feature.properties.GEOID)
    : "__gap__";

  return {
    id,
    feature,
    area: geometryAreaSqM(feature.geometry),
    centroid: geometryCentroid(feature.geometry),
    segments: geometrySegments(feature.geometry)
  };
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

function unproject(position) {
  return [
    position[0] / (EARTH_RADIUS_M * Math.cos(latitudeOrigin)) * 180 / Math.PI,
    position[1] / EARTH_RADIUS_M * 180 / Math.PI
  ];
}

function geometryAreaSqM(geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;

  return polygons.reduce((sum, polygon) => {
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

function geometryCentroid(geometry) {
  const points = [];
  visitPositions(geometry.coordinates, position => {
    points.push(project(position));
  });

  const total = points.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
    [0, 0]
  );

  return [
    total[0] / Math.max(points.length, 1),
    total[1] / Math.max(points.length, 1)
  ];
}

function geometrySegments(geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
  const segments = [];

  for (const polygon of polygons) {
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
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

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
