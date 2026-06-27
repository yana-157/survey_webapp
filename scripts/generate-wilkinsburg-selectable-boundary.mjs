import fs from "fs";
import pc from "polygon-clipping";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const OUTPUT_PATH = "assets/wilkinsburg_selectable_boundary.geojson";
const MIN_VISIBLE_HOLE_AREA_SQ_M = 25;
const EARTH_RADIUS_M = 6371008.8;

const blocks = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
const latitudeOrigin = averageLatitude(blocks);
const blockGeometries = blocks.features.map(feature => geometryToMultiPolygon(feature.geometry));
const union = pc.union(...blockGeometries);

const features = union.map((polygon, index) => ({
  type: "Feature",
  properties: {
    kind: "selectable_boundary",
    part: index + 1,
    source: BLOCKS_PATH
  },
  geometry: {
    type: "Polygon",
    coordinates: [
      polygon[0],
      ...polygon
        .slice(1)
        .filter(ring => Math.abs(ringAreaSqM(ring)) >= MIN_VISIBLE_HOLE_AREA_SQ_M)
    ]
  }
}));

fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
  type: "FeatureCollection",
  properties: {
    generated_from: BLOCKS_PATH,
    generated_at: new Date().toISOString(),
    note: "Visible boundary generated from the exact selectable block polygons, including interior unpaintable gaps when any remain."
  },
  features
}));

console.log(`Generated selectable boundary with ${features.length} exterior part${features.length === 1 ? "" : "s"}.`);

function geometryToMultiPolygon(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
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

function ringAreaSqM(ring) {
  let area = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = project(ring[i]);
    const [x2, y2] = project(ring[i + 1]);
    area += x1 * y2 - x2 * y1;
  }

  return area / 2;
}
