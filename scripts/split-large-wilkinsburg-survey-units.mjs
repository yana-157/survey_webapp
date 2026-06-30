import fs from "fs";
import pc from "polygon-clipping";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const MAX_SURVEY_UNIT_AREA_SQ_M = 90000;
const TARGET_SURVEY_UNIT_AREA_SQ_M = 65000;
const MIN_SPLIT_PART_AREA_SQ_M = 15000;
const MAX_PARTS_PER_FEATURE = 8;
const EARTH_RADIUS_M = 6371008.8;

const blocks = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
const latitudeOrigin = averageLatitude(blocks);
const splitLog = [];
const nextFeatures = [];

for (const feature of blocks.features) {
  const record = makeRecord(feature);

  if (record.area <= MAX_SURVEY_UNIT_AREA_SQ_M) {
    nextFeatures.push(feature);
    continue;
  }

  const parts = splitRecord(record);

  if (parts.length <= 1) {
    nextFeatures.push(feature);
    continue;
  }

  splitLog.push({
    geoid: record.id,
    original_area_sq_m: Math.round(record.area),
    part_count: parts.length,
    parts: parts.map((part, index) => ({
      geoid: `${record.id}__survey${index + 1}`,
      area_sq_m: Math.round(part.area)
    }))
  });

  for (let index = 0; index < parts.length; index++) {
    nextFeatures.push({
      ...feature,
      properties: {
        ...feature.properties,
        GEOID: `${record.id}__survey${index + 1}`,
        original_geoid: feature.properties.original_geoid || record.id,
        survey_unit_part: index + 1,
        survey_unit_part_count: parts.length
      },
      geometry: multiPolygonToGeometry(parts[index].multiPolygon)
    });
  }
}

blocks.features = nextFeatures;
blocks.properties = {
  ...(blocks.properties || {}),
  large_survey_unit_split: {
    max_survey_unit_area_sq_m: MAX_SURVEY_UNIT_AREA_SQ_M,
    target_survey_unit_area_sq_m: TARGET_SURVEY_UNIT_AREA_SQ_M,
    min_split_part_area_sq_m: MIN_SPLIT_PART_AREA_SQ_M,
    max_parts_per_feature: MAX_PARTS_PER_FEATURE,
    split_feature_count: splitLog.length,
    generated_at: new Date().toISOString(),
    splits: splitLog
  }
};

fs.writeFileSync(BLOCKS_PATH, JSON.stringify(blocks));
console.log(`Split ${splitLog.length} oversized survey unit${splitLog.length === 1 ? "" : "s"}.`);

function splitRecord(record) {
  const targetCount = Math.min(
    MAX_PARTS_PER_FEATURE,
    Math.max(2, Math.ceil(record.area / TARGET_SURVEY_UNIT_AREA_SQ_M))
  );
  let parts = [record];

  while (parts.length < targetCount) {
    const candidate = parts
      .map((part, index) => ({ part, index }))
      .filter(item => item.part.area > MAX_SURVEY_UNIT_AREA_SQ_M)
      .sort((a, b) => b.part.area - a.part.area)[0];

    if (!candidate) break;

    const split = splitLargestPart(candidate.part);
    if (!split) break;

    parts.splice(candidate.index, 1, ...split);
  }

  return parts;
}

function splitLargestPart(record) {
  const box = projectedBbox(record.multiPolygon);
  const preferVertical = box.width >= box.height;
  const attempts = [
    { vertical: preferVertical, fraction: 0.5 },
    { vertical: preferVertical, fraction: 0.42 },
    { vertical: preferVertical, fraction: 0.58 },
    { vertical: !preferVertical, fraction: 0.5 },
    { vertical: !preferVertical, fraction: 0.42 },
    { vertical: !preferVertical, fraction: 0.58 }
  ];

  for (const attempt of attempts) {
    const split = splitByFraction(record, box, attempt.vertical, attempt.fraction);
    if (split) return split;
  }

  return null;
}

function splitByFraction(record, box, vertical, fraction) {
  const cut = vertical
    ? box.minX + box.width * fraction
    : box.minY + box.height * fraction;

  const firstClip = vertical
    ? rectangleRing(box.minX - 10, box.minY - 10, cut, box.maxY + 10)
    : rectangleRing(box.minX - 10, box.minY - 10, box.maxX + 10, cut);
  const secondClip = vertical
    ? rectangleRing(cut, box.minY - 10, box.maxX + 10, box.maxY + 10)
    : rectangleRing(box.minX - 10, cut, box.maxX + 10, box.maxY + 10);

  const first = pc.intersection(record.multiPolygon, [firstClip]);
  const second = pc.intersection(record.multiPolygon, [secondClip]);

  if (!first || !second || first.length === 0 || second.length === 0) return null;

  const firstRecord = makeRecord({
    type: "Feature",
    properties: { GEOID: `${record.id}__a` },
    geometry: multiPolygonToGeometry(first)
  });
  const secondRecord = makeRecord({
    type: "Feature",
    properties: { GEOID: `${record.id}__b` },
    geometry: multiPolygonToGeometry(second)
  });

  if (
    firstRecord.area < MIN_SPLIT_PART_AREA_SQ_M ||
    secondRecord.area < MIN_SPLIT_PART_AREA_SQ_M
  ) return null;

  return [firstRecord, secondRecord];
}

function rectangleRing(minX, minY, maxX, maxY) {
  return [
    unproject([minX, minY]),
    unproject([maxX, minY]),
    unproject([maxX, maxY]),
    unproject([minX, maxY]),
    unproject([minX, minY])
  ];
}

function makeRecord(feature) {
  const multiPolygon = geometryToMultiPolygon(feature.geometry);
  const id = String(feature.properties.GEOID);

  return {
    id,
    feature,
    multiPolygon,
    area: multiPolygonAreaSqM(multiPolygon)
  };
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

function projectedBbox(multiPolygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  visitPositions(multiPolygon, position => {
    const [x, y] = project(position);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
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
