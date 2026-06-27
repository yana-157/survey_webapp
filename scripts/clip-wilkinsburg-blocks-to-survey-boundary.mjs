import fs from "fs";
import pc from "polygon-clipping";

const BLOCKS_SOURCE_PATH = "assets/wilkinsburg_blocks_base.geojson";
const BLOCKS_OUTPUT_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const BOUNDARY_PATH = "assets/wilkinsburg_survey_boundary.geojson";

const blocks = JSON.parse(fs.readFileSync(BLOCKS_SOURCE_PATH, "utf8"));
const boundary = JSON.parse(fs.readFileSync(BOUNDARY_PATH, "utf8"));
const boundaryMultiPolygon = collectionToMultiPolygon(boundary);
let droppedCount = 0;
let clippedCount = 0;

blocks.features = blocks.features.flatMap(feature => {
  const clipped = pc.intersection(
    geometryToMultiPolygon(feature.geometry),
    boundaryMultiPolygon
  );

  if (!clipped || clipped.length === 0) {
    droppedCount++;
    return [];
  }

  const nextFeature = {
    ...feature,
    geometry: multiPolygonToGeometry(clipped)
  };

  if (JSON.stringify(nextFeature.geometry) !== JSON.stringify(feature.geometry)) {
    clippedCount++;
  }

  return [nextFeature];
});

blocks.properties = {
  ...(blocks.properties || {}),
  survey_boundary_clip: {
    source_blocks: BLOCKS_SOURCE_PATH,
    boundary: BOUNDARY_PATH,
    clipped_count: clippedCount,
    dropped_count: droppedCount,
    generated_at: new Date().toISOString()
  }
};

fs.writeFileSync(BLOCKS_OUTPUT_PATH, JSON.stringify(blocks));

console.log(`Physically clipped ${clippedCount} block geometries from ${BLOCKS_SOURCE_PATH} to ${BOUNDARY_PATH}.`);
if (droppedCount > 0) {
  console.log(`Dropped ${droppedCount} block geometries outside the survey boundary.`);
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
