import fs from "fs";
import pc from "polygon-clipping";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const BOUNDARY_PATH = "assets/wilkinsburg_survey_boundary.geojson";
const GRID_PATH = "assets/wilkinsburg_fluid_grid.geojson";
const GRAPH_PATH = "assets/wilkinsburg_fluid_grid_graph.json";
const EDGES_PATH = "assets/wilkinsburg_fluid_grid_boundary_edges.geojson";
const OUTLINE_PATH = "assets/wilkinsburg_fluid_grid_selectable_boundary.geojson";
const SPEC_PATH = "assets/wilkinsburg_fluid_grid.json";
const MAX_UNIT_AREA_SQ_M = 30000;
const TARGET_UNIT_AREA_SQ_M = 16000;
const MIN_SPLIT_PART_AREA_SQ_M = 3500;
const MAX_PARTS_PER_BLOCK = 10;
const COORD_PRECISION = 7;
const EARTH_RADIUS_M = 6371008.8;

const blocks = readJson(BLOCKS_PATH);
const boundary = readJson(BOUNDARY_PATH);
const latitudeOrigin = averageLatitude(blocks);
const flowFeatures = buildRoadFlowFeatures();
const graph = buildGraph(flowFeatures);
const edges = buildEdges(flowFeatures);
const bounds = lonLatBounds(boundary);

const grid = {
  type: "FeatureCollection",
  properties: {
    generated_from: BLOCKS_PATH,
    method: "road-flow-block-splits",
    max_unit_area_sq_m: MAX_UNIT_AREA_SQ_M,
    target_unit_area_sq_m: TARGET_UNIT_AREA_SQ_M,
    min_split_part_area_sq_m: MIN_SPLIT_PART_AREA_SQ_M,
    max_parts_per_block: MAX_PARTS_PER_BLOCK,
    feature_count: flowFeatures.length,
    note: "Experimental road-flow survey layer generated from street/census-block-shaped Wilkinsburg units. Oversized units are split only inside their existing road-bounded footprint."
  },
  features: flowFeatures
};

fs.writeFileSync(GRID_PATH, JSON.stringify(grid));
fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph));
fs.writeFileSync(EDGES_PATH, JSON.stringify(edges));
fs.writeFileSync(OUTLINE_PATH, JSON.stringify(selectableBoundary(flowFeatures)));
fs.writeFileSync(SPEC_PATH, JSON.stringify({
  units: {
    name: ["Road-flow areas"],
    id: ["fluid-grid"],
    idColumn: {
      key: ["GEOID"],
      name: ["GEOID"]
    },
    bounds,
    zoomTo: [14],
    tileset: {
      type: ["fill"],
      source: {
        type: ["geojson"],
        data: "./assets/wilkinsburg_fluid_grid.geojson?v=20260630-road-flow-1"
      },
      sourceLayer: [null]
    }
  }
}));

console.log(`Generated ${GRID_PATH} with ${flowFeatures.length} road-flow areas from ${blocks.features.length} road-shaped source units.`);

function buildRoadFlowFeatures() {
  return blocks.features.flatMap(feature => splitFeature(feature))
    .map((feature, index) => ({
      ...feature,
      properties: {
        ...feature.properties,
        GEOID: `RF${String(index + 1).padStart(4, "0")}`,
        road_flow_id: `RF${String(index + 1).padStart(4, "0")}`,
        area_sq_m: Math.round(geometryAreaSqM(feature.geometry))
      }
    }));
}

function splitFeature(feature) {
  const record = makeRecord(feature);
  const targetCount = Math.min(
    MAX_PARTS_PER_BLOCK,
    Math.max(1, Math.ceil(record.area / TARGET_UNIT_AREA_SQ_M))
  );

  if (record.area <= MAX_UNIT_AREA_SQ_M || targetCount <= 1) {
    return [featureWithRoadFlowProperties(feature, record, 1, 1)];
  }

  let parts = [record];

  while (parts.length < targetCount) {
    const candidate = parts
      .map((part, index) => ({ part, index }))
      .filter(item => item.part.area > MAX_UNIT_AREA_SQ_M || parts.length < targetCount)
      .sort((a, b) => b.part.area - a.part.area)[0];

    if (!candidate) break;

    const split = splitRoadFlowPart(candidate.part);
    if (!split) break;

    parts.splice(candidate.index, 1, ...split);
  }

  return parts.map((part, index) => featureWithRoadFlowProperties(
    feature,
    part,
    index + 1,
    parts.length
  ));
}

function featureWithRoadFlowProperties(sourceFeature, record, part, count) {
  const originalId = String(sourceFeature.properties.original_geoid || sourceFeature.properties.GEOID);

  return {
    type: "Feature",
    properties: {
      ...sourceFeature.properties,
      original_geoid: originalId,
      source_geoid: String(sourceFeature.properties.GEOID),
      census_tract_geoid: originalId.slice(0, 11),
      road_flow_part: part,
      road_flow_part_count: count
    },
    geometry: multiPolygonToGeometry(record.multiPolygon)
  };
}

function splitRoadFlowPart(record) {
  const angle = dominantEdgeAngle(record.multiPolygon);
  const box = rotatedBounds(record.multiPolygon, angle);
  const splitAlongU = box.width >= box.height;
  const attempts = [0.5, 0.44, 0.56, 0.38, 0.62]
    .flatMap(fraction => [
      { angle, splitAlongU, fraction },
      { angle, splitAlongU: !splitAlongU, fraction }
    ]);

  for (const attempt of attempts) {
    const split = splitByRotatedFraction(record, attempt.angle, attempt.splitAlongU, attempt.fraction);
    if (split) return split;
  }

  return null;
}

function splitByRotatedFraction(record, angle, splitAlongU, fraction) {
  const box = rotatedBounds(record.multiPolygon, angle);
  const padding = 20;
  const cut = splitAlongU
    ? box.minU + box.width * fraction
    : box.minV + box.height * fraction;

  const firstClip = splitAlongU
    ? rotatedRectangleRing(box.minU - padding, box.minV - padding, cut, box.maxV + padding, angle)
    : rotatedRectangleRing(box.minU - padding, box.minV - padding, box.maxU + padding, cut, angle);
  const secondClip = splitAlongU
    ? rotatedRectangleRing(cut, box.minV - padding, box.maxU + padding, box.maxV + padding, angle)
    : rotatedRectangleRing(box.minU - padding, cut, box.maxU + padding, box.maxV + padding, angle);

  const first = pc.intersection(record.multiPolygon, [firstClip]);
  const second = pc.intersection(record.multiPolygon, [secondClip]);

  if (!first || !second || first.length === 0 || second.length === 0) return null;

  const firstRecord = makeRecord({ type: "Feature", properties: { GEOID: `${record.id}__a` }, geometry: multiPolygonToGeometry(first) });
  const secondRecord = makeRecord({ type: "Feature", properties: { GEOID: `${record.id}__b` }, geometry: multiPolygonToGeometry(second) });

  if (firstRecord.area < MIN_SPLIT_PART_AREA_SQ_M || secondRecord.area < MIN_SPLIT_PART_AREA_SQ_M) return null;

  return [firstRecord, secondRecord];
}

function dominantEdgeAngle(multiPolygon) {
  const bins = new Map();
  const binSize = Math.PI / 36;

  for (const segment of multiPolygonSegments(multiPolygon)) {
    const [[x1, y1], [x2, y2]] = segment;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < 12) continue;

    let angle = Math.atan2(y2 - y1, x2 - x1);
    while (angle < 0) angle += Math.PI;
    while (angle >= Math.PI) angle -= Math.PI;

    const bin = Math.round(angle / binSize) * binSize;
    bins.set(bin, (bins.get(bin) || 0) + length);
  }

  const best = Array.from(bins.entries()).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 0;
}

function rotatedBounds(multiPolygon, angle) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;

  visitPositions(multiPolygon, position => {
    const [u, v] = rotate(project(position), angle);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  });

  return { minU, minV, maxU, maxV, width: maxU - minU, height: maxV - minV };
}

function rotatedRectangleRing(minU, minV, maxU, maxV, angle) {
  return [
    unproject(unrotate([minU, minV], angle)),
    unproject(unrotate([maxU, minV], angle)),
    unproject(unrotate([maxU, maxV], angle)),
    unproject(unrotate([minU, maxV], angle)),
    unproject(unrotate([minU, minV], angle))
  ];
}

function buildGraph(features) {
  const graph = {};
  const records = features.map(feature => ({
    id: String(feature.properties.GEOID),
    segments: multiPolygonSegments(geometryToMultiPolygon(feature.geometry))
  }));

  for (const feature of features) {
    graph[String(feature.properties.GEOID)] = [];
  }

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (sharedBoundaryLength(records[i], records[j]) <= 0.5) continue;

      graph[records[i].id].push(records[j].id);
      graph[records[j].id].push(records[i].id);
    }
  }

  for (const id of Object.keys(graph)) {
    graph[id] = Array.from(new Set(graph[id])).sort();
  }

  return graph;
}

function buildEdges(features) {
  const segments = sharedSegmentMap(features);
  const edgeFeatures = Array.from(segments.values())
    .filter(segment => segment.ids.size <= 2)
    .map(segment => {
      const ids = Array.from(segment.ids).sort();

      return {
        type: "Feature",
        properties: {
          a: ids[0] || null,
          b: ids[1] || null
        },
        geometry: {
          type: "LineString",
          coordinates: segment.coordinates
        }
      };
    });

  return {
    type: "FeatureCollection",
    properties: {
      generated_from: GRID_PATH
    },
    features: edgeFeatures
  };
}

function sharedSegmentMap(features) {
  const segments = new Map();

  for (const feature of features) {
    const id = String(feature.properties.GEOID);

    for (const polygon of geometryToMultiPolygon(feature.geometry)) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const start = ring[i];
          const end = ring[i + 1];
          if (samePoint(start, end)) continue;

          const key = segmentKey(start, end);
          const segment = segments.get(key) || {
            ids: new Set(),
            coordinates: orderedSegment(start, end)
          };

          segment.ids.add(id);
          segments.set(key, segment);
        }
      }
    }
  }

  return segments;
}

function selectableBoundary(features) {
  const union = pc.union(...features.map(feature => geometryToMultiPolygon(feature.geometry)));

  return {
    type: "FeatureCollection",
    properties: {
      generated_from: GRID_PATH
    },
    features: union.map((polygon, index) => ({
      type: "Feature",
      properties: {
        kind: "selectable_boundary",
        part: index + 1,
        source: GRID_PATH
      },
      geometry: {
        type: "Polygon",
        coordinates: polygon
      }
    }))
  };
}

function makeRecord(feature) {
  const multiPolygon = geometryToMultiPolygon(feature.geometry);

  return {
    id: String(feature.properties.GEOID),
    feature,
    multiPolygon,
    area: multiPolygonAreaSqM(multiPolygon)
  };
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
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

function rotate([x, y], angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    x * cos + y * sin,
    -x * sin + y * cos
  ];
}

function unrotate([u, v], angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    u * cos - v * sin,
    u * sin + v * cos
  ];
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
  return multiPolygonAreaSqM(geometryToMultiPolygon(geometry));
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

function multiPolygonSegments(multiPolygon) {
  const segments = [];

  for (const polygon of multiPolygon) {
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

function segmentKey(start, end) {
  return orderedSegment(start, end)
    .map(point => point.map(value => value.toFixed(COORD_PRECISION)).join(","))
    .join("|");
}

function orderedSegment(start, end) {
  const startKey = start.map(value => value.toFixed(COORD_PRECISION)).join(",");
  const endKey = end.map(value => value.toFixed(COORD_PRECISION)).join(",");

  return startKey < endKey ? [start, end] : [end, start];
}

function samePoint(start, end) {
  return start[0] === end[0] && start[1] === end[1];
}

function lonLatBounds(collection) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const feature of collection.features) {
    visitPositions(feature.geometry.coordinates, position => {
      minLon = Math.min(minLon, position[0]);
      minLat = Math.min(minLat, position[1]);
      maxLon = Math.max(maxLon, position[0]);
      maxLat = Math.max(maxLat, position[1]);
    });
  }

  return [[minLon, minLat], [maxLon, maxLat]];
}
