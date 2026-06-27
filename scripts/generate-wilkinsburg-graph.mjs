import fs from "fs";

const BLOCKS_PATH = "assets/wilkinsburg_blocks_clipped.geojson";
const GRAPH_PATH = "assets/wilkinsburg_graph.json";
const COORD_PRECISION = 7;

const blocks = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
const graph = {};
const segments = new Map();

for (const feature of blocks.features) {
  const id = String(feature.properties.GEOID);
  graph[id] = graph[id] || [];

  for (const polygon of polygonsFor(feature.geometry)) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        addSegment(id, ring[i], ring[i + 1]);
      }
    }
  }
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

fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph));
console.log(`Generated ${GRAPH_PATH} with ${Object.keys(graph).length} nodes.`);

function polygonsFor(geometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function addSegment(id, start, end) {
  if (samePoint(start, end)) return;

  const key = segmentKey(start, end);
  const segment = segments.get(key) || { ids: new Set() };
  segment.ids.add(id);
  segments.set(key, segment);
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
