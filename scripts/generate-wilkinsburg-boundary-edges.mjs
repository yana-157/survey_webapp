import fs from "fs";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const EDGES_PATH = "assets/wilkinsburg_boundary_edges.geojson";
const COORD_PRECISION = 7;

const blocks = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
const edges = new Map();

for (const feature of blocks.features) {
  const id = String(feature.properties.GEOID);

  for (const polygon of polygonsFor(feature.geometry)) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        addSegment(id, ring[i], ring[i + 1]);
      }
    }
  }
}

const features = Array.from(edges.values())
  .filter(edge => edge.ids.size <= 2)
  .map(edge => {
    const ids = Array.from(edge.ids).sort();

    return {
      type: "Feature",
      properties: {
        a: ids[0] || null,
        b: ids[1] || null
      },
      geometry: {
        type: "LineString",
        coordinates: edge.coordinates
      }
    };
  });

fs.writeFileSync(EDGES_PATH, JSON.stringify({
  type: "FeatureCollection",
  features,
  properties: {
    generated_from: BLOCKS_PATH,
    generated_at: new Date().toISOString()
  }
}));

const shared = features.filter(feature => feature.properties.b).length;
const exterior = features.length - shared;
console.log(`Generated ${features.length} block boundary edges (${shared} shared, ${exterior} exterior).`);

function polygonsFor(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function addSegment(id, start, end) {
  if (samePoint(start, end)) return;

  const key = segmentKey(start, end);
  const edge = edges.get(key) || {
    ids: new Set(),
    coordinates: orderedSegment(start, end)
  };

  edge.ids.add(id);
  edges.set(key, edge);
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
