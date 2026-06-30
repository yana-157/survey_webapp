import fs from "fs";
import pc from "polygon-clipping";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const GRAPH_PATH = "assets/wilkinsburg_graph.json";
const EDGES_PATH = "assets/wilkinsburg_boundary_edges.geojson";
const TINY_SLIVER_AREA_SQ_M = 2000;
const SLIVER_AREA_SQ_M = 3000;
const ROAD_ARTIFACT_COMPACTNESS = 0.16;
const SKINNY_FEATURE_AREA_SQ_M = 20000;
const SKINNY_FEATURE_COMPACTNESS = 0.22;
const THIN_FEATURE_AREA_SQ_M = 20000;
const THIN_FEATURE_WIDTH_M = 25;
const ELONGATED_FEATURE_AREA_SQ_M = 40000;
const ELONGATED_FEATURE_WIDTH_M = 140;
const ELONGATED_FEATURE_RATIO = 3.8;
const COMPLEX_ARTIFACT_AREA_SQ_M = 60000;
const COMPLEX_ARTIFACT_COMPACTNESS = 0.28;
const SPLIT_PART_AREA_SQ_M = 5000;
const EARTH_RADIUS_M = 6371008.8;

const blocks = readJson(BLOCKS_PATH);
const graph = readJson(GRAPH_PATH);
const edges = readJson(EDGES_PATH);
const latitudeOrigin = averageLatitude(blocks);

const records = blocks.features.map(feature => {
  const id = String(feature.properties.GEOID);

  return {
    id,
    feature,
    area: geometryAreaSqM(feature.geometry),
    compactness: geometryCompactness(feature.geometry),
    dimensions: geometryDimensionsM(feature.geometry),
    holeCount: geometryHoleCount(feature.geometry),
    centroid: geometryCentroid(feature.geometry),
    segments: geometrySegments(feature.geometry)
  };
});

const roadArtifacts = records
  .filter(isRoadArtifact)
  .sort((a, b) => a.area - b.area);

if (roadArtifacts.length === 0) {
  console.log("No road-like artifacts found.");
  process.exit(0);
}

const kept = records.filter(record => !roadArtifacts.includes(record));
const keptById = new Map(kept.map(record => [record.id, record]));
const mergeTargets = new Map();
const droppedArtifacts = [];
const mergeLog = [];

for (const artifact of roadArtifacts) {
  const touchingTarget = touchingSmallBlock(artifact, kept);
  const target = touchingTarget || nearestSmallBlock(artifact, kept);

  if (!target) {
    droppedArtifacts.push({
      artifact_geoid: artifact.id,
      artifact_area_sq_m: Math.round(artifact.area),
      artifact_compactness: Number(artifact.compactness.toFixed(3))
    });
    continue;
  }

  target.feature.geometry = multiPolygonToGeometry(
    pc.union(
      geometryToMultiPolygon(target.feature.geometry),
      geometryToMultiPolygon(artifact.feature.geometry)
    )
  );
  target.area += artifact.area;
  target.compactness = geometryCompactness(target.feature.geometry);
  target.dimensions = geometryDimensionsM(target.feature.geometry);
  target.segments = geometrySegments(target.feature.geometry);
  target.centroid = geometryCentroid(target.feature.geometry);
  target.feature.properties.merged_road_artifact_geoids = [
    ...(target.feature.properties.merged_road_artifact_geoids || []),
    artifact.id
  ];

  mergeTargets.set(artifact.id, target.id);
  mergeLog.push({
    artifact_geoid: artifact.id,
    merged_into_geoid: target.id,
    artifact_area_sq_m: Math.round(artifact.area),
    artifact_compactness: Number(artifact.compactness.toFixed(3)),
    target_area_after_sq_m: Math.round(target.area)
  });
}

blocks.features = kept.map(record => record.feature);
blocks.properties = {
  ...(blocks.properties || {}),
  road_artifact_merge: {
    threshold_sq_m: SLIVER_AREA_SQ_M,
    tiny_sliver_threshold_sq_m: TINY_SLIVER_AREA_SQ_M,
    compactness_threshold: ROAD_ARTIFACT_COMPACTNESS,
    skinny_feature_area_sq_m: SKINNY_FEATURE_AREA_SQ_M,
    skinny_feature_compactness_threshold: SKINNY_FEATURE_COMPACTNESS,
    thin_feature_area_sq_m: THIN_FEATURE_AREA_SQ_M,
    thin_feature_width_m: THIN_FEATURE_WIDTH_M,
    elongated_feature_area_sq_m: ELONGATED_FEATURE_AREA_SQ_M,
    elongated_feature_width_m: ELONGATED_FEATURE_WIDTH_M,
    elongated_feature_ratio: ELONGATED_FEATURE_RATIO,
    complex_artifact_area_sq_m: COMPLEX_ARTIFACT_AREA_SQ_M,
    complex_artifact_compactness: COMPLEX_ARTIFACT_COMPACTNESS,
    split_part_area_sq_m: SPLIT_PART_AREA_SQ_M,
    merged_count: mergeLog.length,
    dropped_count: droppedArtifacts.length,
    generated_at: new Date().toISOString(),
    merges: mergeLog,
    dropped_artifacts: droppedArtifacts
  }
};

fs.writeFileSync(BLOCKS_PATH, JSON.stringify(blocks));
fs.writeFileSync(GRAPH_PATH, JSON.stringify(redirectGraph(graph, keptById, mergeTargets)));
fs.writeFileSync(EDGES_PATH, JSON.stringify(redirectEdges(edges, keptById, mergeTargets)));

console.log(`Merged ${mergeLog.length} touching road-like artifacts.`);
for (const row of mergeLog) {
  console.log(
    `${row.artifact_geoid} -> ${row.merged_into_geoid} (${row.artifact_area_sq_m} sq m, compactness ${row.artifact_compactness})`
  );
}

if (droppedArtifacts.length > 0) {
  console.log(`Dropped ${droppedArtifacts.length} non-touching road-like artifacts.`);
}

function isRoadArtifact(record) {
  const props = record.feature.properties || {};
  const hasNoResidents = Number(props.housing_units || 0) === 0 && Number(props.pop || 0) === 0;
  const isSplitPart = Boolean(props.original_geoid) && Number(props.split_part || 1) > 1;
  const minDimension = Math.min(record.dimensions.width, record.dimensions.height);
  const maxDimension = Math.max(record.dimensions.width, record.dimensions.height);
  const elongation = maxDimension / Math.max(minDimension, 1);

  if (record.area > 0 && record.area < TINY_SLIVER_AREA_SQ_M) return true;
  if (isSplitPart && record.area > 0 && record.area < SPLIT_PART_AREA_SQ_M) return true;
  if (record.area > 0 && record.area < SKINNY_FEATURE_AREA_SQ_M && record.compactness < SKINNY_FEATURE_COMPACTNESS) return true;
  if (record.area > 0 && record.area < THIN_FEATURE_AREA_SQ_M && minDimension < THIN_FEATURE_WIDTH_M) return true;
  if (
    record.area > 0 &&
    record.area < ELONGATED_FEATURE_AREA_SQ_M &&
    minDimension < ELONGATED_FEATURE_WIDTH_M &&
    elongation >= ELONGATED_FEATURE_RATIO
  ) return true;
  if (
    record.holeCount > 0 &&
    record.area < COMPLEX_ARTIFACT_AREA_SQ_M &&
    record.compactness < COMPLEX_ARTIFACT_COMPACTNESS
  ) return true;
  if (!hasNoResidents) return false;
  if (record.area > 0 && record.area < SLIVER_AREA_SQ_M) return true;

  return record.compactness > 0 && record.compactness < ROAD_ARTIFACT_COMPACTNESS;
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
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

function geometryCompactness(geometry) {
  const area = geometryAreaSqM(geometry);
  const perimeter = geometryPerimeterM(geometry);

  if (!area || !perimeter) return 0;

  return 4 * Math.PI * area / (perimeter * perimeter);
}

function geometryPerimeterM(geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
  let perimeter = 0;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = project(ring[i]);
        const [x2, y2] = project(ring[i + 1]);
        perimeter += Math.hypot(x2 - x1, y2 - y1);
      }
    }
  }

  return perimeter;
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

function geometryDimensionsM(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  visitPositions(geometry.coordinates, position => {
    const [x, y] = project(position);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  return {
    width: maxX - minX,
    height: maxY - minY
  };
}

function geometryHoleCount(geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;

  return polygons.reduce((sum, polygon) => sum + Math.max(0, polygon.length - 1), 0);
}

function touchingSmallBlock(sliver, candidates) {
  let best = null;
  let bestSharedLength = 0;

  for (const candidate of candidates) {
    const sharedLength = sharedBoundaryLength(sliver, candidate);

    if (
      sharedLength > bestSharedLength + 0.001 ||
      (Math.abs(sharedLength - bestSharedLength) <= 0.001 && best && candidate.area < best.area)
    ) {
      best = candidate;
      bestSharedLength = sharedLength;
    }
  }

  return best;
}

function nearestSmallBlock(sliver, candidates) {
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = geometryDistance(sliver, candidate);

    if (
      distance < bestDistance - 0.001 ||
      (Math.abs(distance - bestDistance) <= 0.001 && best && candidate.area < best.area)
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
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

function geometryToMultiPolygon(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function multiPolygonToGeometry(multiPolygon) {
  return {
    type: "MultiPolygon",
    coordinates: multiPolygon
  };
}

function redirectGraph(originalGraph, keptById, mergeTargets) {
  const nextGraph = {};

  for (const id of keptById.keys()) {
    nextGraph[id] = [];
  }

  for (const [id, neighbors] of Object.entries(originalGraph)) {
    const mappedId = mergeTargets.get(String(id)) || String(id);
    if (!keptById.has(mappedId)) continue;

    const nextNeighbors = new Set(nextGraph[mappedId] || []);
    for (const neighbor of neighbors || []) {
      const mappedNeighbor = mergeTargets.get(String(neighbor)) || String(neighbor);
      if (mappedNeighbor !== mappedId && keptById.has(mappedNeighbor)) {
        nextNeighbors.add(mappedNeighbor);
      }
    }

    nextGraph[mappedId] = Array.from(nextNeighbors).sort();
  }

  return nextGraph;
}

function redirectEdges(collection, keptById, mergeTargets) {
  const nextFeatures = [];
  const seen = new Set();

  for (const feature of collection.features || []) {
    const a = mergeTargets.get(String(feature.properties.a)) || String(feature.properties.a);
    const b = mergeTargets.get(String(feature.properties.b)) || String(feature.properties.b);

    if (a === b || !keptById.has(a) || !keptById.has(b)) continue;

    const key = [
      a,
      b,
      JSON.stringify(feature.geometry)
    ].sort().join("|");

    if (seen.has(key)) continue;
    seen.add(key);

    nextFeatures.push({
      ...feature,
      properties: {
        ...feature.properties,
        a,
        b
      }
    });
  }

  return {
    ...collection,
    features: nextFeatures
  };
}
