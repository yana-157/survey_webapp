import fs from "fs";
import pc from "polygon-clipping";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_base.geojson";
const BOUNDARY_PATH = "assets/wilkinsburg_survey_boundary.geojson";
const TRACTS_PATH = "assets/wilkinsburg_census_tracts.geojson";
const GRID_PATH = "assets/wilkinsburg_fluid_grid.geojson";
const GRAPH_PATH = "assets/wilkinsburg_fluid_grid_graph.json";
const EDGES_PATH = "assets/wilkinsburg_fluid_grid_boundary_edges.geojson";
const OUTLINE_PATH = "assets/wilkinsburg_fluid_grid_selectable_boundary.geojson";
const SPEC_PATH = "assets/wilkinsburg_fluid_grid.json";
const CELL_WIDTH_M = 120;
const CELL_HEIGHT_M = 120;
const MIN_CELL_AREA_SQ_M = 3500;
const FRINGE_TRACT_AREA_SQ_M = 60000;
const COORD_PRECISION = 7;
const EARTH_RADIUS_M = 6371008.8;

const blocks = readJson(BLOCKS_PATH);
const boundary = readJson(BOUNDARY_PATH);
const tracts = readJson(TRACTS_PATH);
const latitudeOrigin = averageLatitude(boundary);
const boundaryMultiPolygon = collectionToMultiPolygon(boundary);
const tractRecords = tracts.features.map(feature => ({
  feature,
  area: geometryAreaSqM(feature.geometry),
  multiPolygon: geometryToMultiPolygon(feature.geometry)
}));
const dominantAngle = dominantStreetAngle(blocks);
const gridFeatures = mergeSmallCells(generateGridCells());
const graph = buildGraph(gridFeatures);
const edges = buildEdges(gridFeatures);
const bounds = lonLatBounds(boundary);

const grid = {
  type: "FeatureCollection",
  properties: {
    generated_from: BOUNDARY_PATH,
    street_angle_degrees: Number((dominantAngle * 180 / Math.PI).toFixed(2)),
    cell_width_m: CELL_WIDTH_M,
    cell_height_m: CELL_HEIGHT_M,
    min_cell_area_sq_m: MIN_CELL_AREA_SQ_M,
    fringe_tract_area_sq_m: FRINGE_TRACT_AREA_SQ_M,
    feature_count: gridFeatures.length,
    census_tract_source: TRACTS_PATH,
    note: "Experimental road-aligned grid for neighborhood perception assignment; every selectable area is clipped to one census tract."
  },
  features: gridFeatures
};

fs.writeFileSync(GRID_PATH, JSON.stringify(grid));
fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph));
fs.writeFileSync(EDGES_PATH, JSON.stringify(edges));
fs.writeFileSync(OUTLINE_PATH, JSON.stringify(selectableBoundary(gridFeatures)));
fs.writeFileSync(SPEC_PATH, JSON.stringify({
  units: {
    name: ["Areas"],
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
        data: "./assets/wilkinsburg_fluid_grid.geojson?v=20260630-fluid-grid-1"
      },
      sourceLayer: [null]
    }
  }
}));

console.log(
  `Generated ${GRID_PATH} with ${gridFeatures.length} road-aligned grid area${gridFeatures.length === 1 ? "" : "s"} at ${grid.properties.street_angle_degrees} degrees.`
);

function generateGridCells() {
  const box = rotatedBounds(boundaryMultiPolygon, dominantAngle);
  const features = tractRecords
    .filter(tract => tract.area <= FRINGE_TRACT_AREA_SQ_M)
    .map(tract => tractFeature(tract));
  const gridTracts = tractRecords.filter(tract => tract.area > FRINGE_TRACT_AREA_SQ_M);
  let row = 0;

  for (let v = box.minV - CELL_HEIGHT_M; v < box.maxV + CELL_HEIGHT_M; v += CELL_HEIGHT_M) {
    let col = 0;

    for (let u = box.minU - CELL_WIDTH_M; u < box.maxU + CELL_WIDTH_M; u += CELL_WIDTH_M) {
      const ring = rectangleRing(u, v, u + CELL_WIDTH_M, v + CELL_HEIGHT_M, dominantAngle);

      for (const tract of gridTracts) {
        const clipped = pc.intersection([ring], tract.multiPolygon);
        if (!clipped || clipped.length === 0) continue;

        const area = multiPolygonAreaSqM(clipped);

        if (area > 1) {
          const tractId = String(tract.feature.properties.GEOID);

          features.push({
            type: "Feature",
            properties: {
              GEOID: `FG_${tractId}_${String(row).padStart(2, "0")}_${String(col).padStart(2, "0")}`,
              census_tract_geoid: tractId,
              census_tract_name: String(tract.feature.properties.NAME || ""),
              grid_row: row,
              grid_col: col,
              area_sq_m: Math.round(area)
            },
            geometry: multiPolygonToGeometry(clipped)
          });
        }
      }

      col++;
    }

    row++;
  }

  return features;
}

function mergeSmallCells(features) {
  const records = features.map(feature => makeRecord(feature));
  const locked = new Set();

  while (true) {
    const small = records
      .filter(record => record.area < MIN_CELL_AREA_SQ_M && !locked.has(record.id))
      .sort((a, b) => a.area - b.area)[0];

    if (!small) break;

    const target = bestMergeTarget(small, records);
    if (!target) {
      locked.add(small.id);
      continue;
    }

    target.feature.geometry = multiPolygonToGeometry(pc.union(
      geometryToMultiPolygon(target.feature.geometry),
      geometryToMultiPolygon(small.feature.geometry)
    ));
    target.feature.properties.merged_grid_geoids = [
      ...(target.feature.properties.merged_grid_geoids || []),
      small.id
    ];
    target.area = geometryAreaSqM(target.feature.geometry);
    target.segments = geometrySegments(target.feature.geometry);

    records.splice(records.indexOf(small), 1);
  }

  return records
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((record, index) => ({
      ...record.feature,
      properties: {
        ...record.feature.properties,
        GEOID: `FG${String(index + 1).padStart(4, "0")}`,
        area_sq_m: Math.round(geometryAreaSqM(record.feature.geometry))
      }
    }));
}

function tractFeature(tract) {
  const tractId = String(tract.feature.properties.GEOID);

  return {
    type: "Feature",
    properties: {
      GEOID: `FG_TRACT_${tractId}`,
      census_tract_geoid: tractId,
      census_tract_name: String(tract.feature.properties.NAME || ""),
      grid_row: null,
      grid_col: null,
      fringe_tract_piece: true,
      area_sq_m: Math.round(tract.area)
    },
    geometry: tract.feature.geometry
  };
}

function bestMergeTarget(small, records) {
  const candidates = records
    .filter(record => record !== small && record.tractId === small.tractId)
    .map(record => ({
      record,
      shared: sharedBoundaryLength(small, record),
      distance: geometryDistance(small, record)
    }))
    .sort((a, b) => {
      if (Math.abs(b.shared - a.shared) > 0.001) return b.shared - a.shared;
      if (Math.abs(a.distance - b.distance) > 0.001) return a.distance - b.distance;
      return a.record.area - b.record.area;
    });

  return candidates[0]?.record || null;
}

function dominantStreetAngle(collection) {
  const bins = new Map();
  const binSize = Math.PI / 36;

  for (const feature of collection.features) {
    for (const segment of geometrySegments(feature.geometry)) {
      const [[x1, y1], [x2, y2]] = segment;
      const length = Math.hypot(x2 - x1, y2 - y1);
      if (length < 25) continue;

      let angle = Math.atan2(y2 - y1, x2 - x1);
      while (angle < 0) angle += Math.PI;
      while (angle >= Math.PI / 2) angle -= Math.PI / 2;

      const bin = Math.round(angle / binSize) * binSize;
      bins.set(bin, (bins.get(bin) || 0) + length);
    }
  }

  const best = Array.from(bins.entries()).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 0;
}

function buildGraph(features) {
  const graph = {};
  const segments = sharedSegmentMap(features);

  for (const feature of features) {
    graph[String(feature.properties.GEOID)] = [];
  }

  for (const segment of segments.values()) {
    const ids = Array.from(segment.ids);
    if (ids.length !== 2) continue;

    const [a, b] = ids;
    graph[a].push(b);
    graph[b].push(a);
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
  return {
    id: String(feature.properties.GEOID),
    tractId: String(feature.properties.census_tract_geoid),
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

function rectangleRing(minU, minV, maxU, maxV, angle) {
  return [
    unproject(unrotate([minU, minV], angle)),
    unproject(unrotate([maxU, minV], angle)),
    unproject(unrotate([maxU, maxV], angle)),
    unproject(unrotate([minU, maxV], angle)),
    unproject(unrotate([minU, minV], angle))
  ];
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

  return { minU, minV, maxU, maxV };
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
