import fs from "fs";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const EARTH_RADIUS_M = 6371008.8;

const blocks = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
const latitudeOrigin = averageLatitude(blocks);
const splitLog = [];
const nextFeatures = [];

for (const feature of blocks.features) {
  if (feature.geometry.type !== "MultiPolygon" || feature.geometry.coordinates.length <= 1) {
    nextFeatures.push(normalizeSinglePartFeature(feature));
    continue;
  }

  const baseId = String(feature.properties.GEOID);
  const parts = feature.geometry.coordinates
    .map((coordinates, index) => ({
      coordinates,
      originalIndex: index,
      area: polygonAreaSqM(coordinates)
    }))
    .sort((a, b) => b.area - a.area);

  parts.forEach((part, index) => {
    const nextId = index === 0 ? baseId : `${baseId}__part${index + 1}`;

    nextFeatures.push({
      ...feature,
      properties: {
        ...feature.properties,
        GEOID: nextId,
        original_geoid: baseId,
        split_part: index + 1,
        split_part_count: parts.length
      },
      geometry: {
        type: "Polygon",
        coordinates: part.coordinates
      }
    });
  });

  splitLog.push({
    original_geoid: baseId,
    part_count: parts.length,
    part_areas_sq_m: parts.map(part => Math.round(part.area))
  });
}

blocks.features = nextFeatures;
blocks.properties = {
  ...(blocks.properties || {}),
  disconnected_part_split: {
    split_feature_count: splitLog.length,
    generated_at: new Date().toISOString(),
    splits: splitLog
  }
};

fs.writeFileSync(BLOCKS_PATH, JSON.stringify(blocks));
console.log(`Split ${splitLog.length} disconnected block feature${splitLog.length === 1 ? "" : "s"} into separate paintable pieces.`);

function normalizeSinglePartFeature(feature) {
  if (feature.geometry.type !== "MultiPolygon") return feature;

  return {
    ...feature,
    geometry: {
      type: "Polygon",
      coordinates: feature.geometry.coordinates[0]
    }
  };
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

function polygonAreaSqM(polygon) {
  const exterior = Math.abs(ringAreaSqM(polygon[0] || []));
  const holes = polygon
    .slice(1)
    .reduce((sum, ring) => sum + Math.abs(ringAreaSqM(ring)), 0);

  return exterior - holes;
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
