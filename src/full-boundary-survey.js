"use strict";

const SPECIFICATION_URL = "./assets/wilkinsburg.json";
const GRAPH_URL = "./assets/wilkinsburg_graph.json";
const PUBLIC_MAPBOX_TOKEN = "pk.eyJ1IjoiY21jY2FydGFuIiwiYSI6ImNrZGdkdW9waTA1eGEycmxycnQzZ3o4c3kifQ.v_XViAm-nItfHgx0J3Xg3A";

const DEFAULT_NEIGHBORHOODS = [
  "Hamnett",
  "Hunter Park",
  "South Wilkinsburg",
  "Downtown / Borough Center",
  "Turner",
  "Blackridge",
  "Singer Place",
  "Pennwood"
];

const NEIGHBORHOOD_COLORS = [
  "#2457a6",
  "#c2410c",
  "#15803d",
  "#7c3aed",
  "#be123c",
  "#0f766e",
  "#b45309",
  "#4f46e5",
  "#64748b",
  "#a21caf",
  "#0369a1",
  "#65a30d"
];

const STORAGE_KEY = "wilkinsburg_full_boundary_survey_v2";
const RESPONDENT_ID_KEY = "wilkinsburg_boundary_respondent_id";

let availableNeighborhoods = [...DEFAULT_NEIGHBORHOODS];
let activeNeighborhoods = [...DEFAULT_NEIGHBORHOODS];
let hasStarted = false;

let map = null;
let spec = null;
let graph = {};
let currentIndex = 0;
let paintMode = "paint";
let isRevisionMode = false;
let isPointerDown = false;

let sourceId = "wlb-blocks";
let fillLayerId = "wlb-block-fill";
let lineLayerId = "wlb-block-line";
let borderSourceId = "wlb-border-source";
let boroughBorderLayerId = "wlb-borough-border";
let neighborhoodBorderLayerId = "wlb-neighborhood-border";
let sourceLayer = "blocks";

let selectedByNeighborhood = {};
let blockFeaturesById = new Map();
let searchMarker = null;
let showBorders = true;
let respondentId = getOrCreateRespondentId();

const el = {
  panel: document.getElementById("panel"),
  intro: document.getElementById("intro"),
  relationship: document.getElementById("relationship"),
  anchorArea: document.getElementById("anchor-area"),
  yearsConnected: document.getElementById("years-connected"),

  contextSection: document.getElementById("context-section"),
  neighborhoodSetupSection: document.getElementById("neighborhood-setup-section"),
  neighborhoodChoiceList: document.getElementById("neighborhood-choice-list"),
  customNeighborhoodName: document.getElementById("custom-neighborhood-name"),
  addNeighborhoodBtn: document.getElementById("add-neighborhood-btn"),
  startSurveyBtn: document.getElementById("start-survey-btn"),
  setupStatus: document.getElementById("setup-status"),

  drawSection: document.getElementById("draw-section"),
  reviewSection: document.getElementById("review-section"),
  finalSection: document.getElementById("final-section"),

  stepLabel: document.getElementById("step-label"),
  blockCountLabel: document.getElementById("block-count-label"),
  progressFill: document.getElementById("progress-fill"),
  neighborhoodTitle: document.getElementById("neighborhood-title"),
  status: document.getElementById("status"),

  backBtn: document.getElementById("back-btn"),
  clearCurrentBtn: document.getElementById("clear-current-btn"),
  saveNextBtn: document.getElementById("save-next-btn"),

  reviewList: document.getElementById("review-list"),
  revisionNeighborhood: document.getElementById("revision-neighborhood"),
  reviseSelectedBtn: document.getElementById("revise-selected-btn"),
  finishBtn: document.getElementById("finish-btn"),

  submitStatus: document.getElementById("submit-status"),
  finalJson: document.getElementById("final-json"),
  downloadJsonBtn: document.getElementById("download-json-btn"),
  mapWrap: document.getElementById("map-wrap"),
  mapModeControls: document.getElementById("map-mode-controls"),
  mapPaintMode: document.getElementById("map-paint-mode"),
  mapEraseMode: document.getElementById("map-erase-mode"),
  mapExpandBtn: document.getElementById("map-expand-btn"),
  mapLegend: document.getElementById("map-legend"),
  mapSearchForm: document.getElementById("map-search"),
  mapSearchInput: document.getElementById("map-search-input"),
  mapSearchStatus: document.getElementById("map-search-status"),
  borderToggle: document.getElementById("border-toggle"),
  resetProgressBtn: document.getElementById("reset-progress-btn")
};

init();

async function init() {
  if (redirectFilePreviewToLocalhost()) return;

  initializeStateObjects();
  loadSavedProgress();
  wireUiEvents();
  ensureAllNeighborhoodState();
  renderNeighborhoodSetup();
  applyStartVisibility();

  const token = getMapboxToken();
  if (!token) {
    setStatus("A Mapbox public token is required to load the map.");
    return;
  }

  mapboxgl.accessToken = token;

  try {
    const [loadedSpec, loadedGraph] = await Promise.all([
      fetch(SPECIFICATION_URL).then(r => {
        if (!r.ok) throw new Error("Could not load wilkinsburg.json");
        return r.json();
      }),
      fetch(GRAPH_URL).then(r => {
        if (!r.ok) throw new Error("Could not load wilkinsburg_graph.json");
        return r.json();
      })
    ]);

    spec = normalizeSpec(loadedSpec);
    graph = normalizeGraph(loadedGraph);
    sourceLayer = spec.units.tileset.sourceLayer;

    createMap();

    if (hasStarted) {
      resizeMapSoon();
      renderStep();
    }
  } catch (err) {
    console.error(err);
    setStatus(err.message);
  }
}

function redirectFilePreviewToLocalhost() {
  if (window.location.protocol !== "file:") return false;

  window.location.replace("http://localhost:3000/full-boundary-survey.html");
  return true;
}

function getMapboxToken() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const tokenFromHash = params.get("mapbox_token");

  if (tokenFromHash && tokenFromHash.trim()) {
    return tokenFromHash.trim();
  }

  if (PUBLIC_MAPBOX_TOKEN) {
    return PUBLIC_MAPBOX_TOKEN;
  }

  const entered = window.prompt("Paste your public Mapbox pk token:");
  return entered ? entered.trim() : "";
}

function normalizeSpec(rawSpec) {
  const units = rawSpec.units;

  return {
    units: {
      name: first(units.name),
      id: first(units.id),
      idColumn: {
        key: first(units.idColumn.key),
        name: first(units.idColumn.name)
      },
      bounds: units.bounds,
      zoomTo: Number(first(units.zoomTo) || 14),
      tileset: {
        type: first(units.tileset.type),
        source: {
          type: first(units.tileset.source.type),
          url: first(units.tileset.source.url)
        },
        sourceLayer: first(units.tileset.sourceLayer)
      }
    }
  };
}

function normalizeGraph(rawGraph) {
  const out = {};

  for (const key of Object.keys(rawGraph || {})) {
    out[String(key)] = (rawGraph[key] || []).map(String);
  }

  return out;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function createMap() {
  const bounds = spec.units.bounds;

  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/outdoors-v11",
    bounds: bounds,
    fitBoundsOptions: { padding: 30 },
    minZoom: 12,
    pitchWithRotate: false,
    dragRotate: false
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-left");
  labelRotateControl();

  map.on("load", () => {
    map.addSource(sourceId, spec.units.tileset.source);

    map.addLayer({
      id: fillLayerId,
      type: "fill",
      source: sourceId,
      "source-layer": sourceLayer,
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0.08
      }
    });

    map.addLayer({
      id: lineLayerId,
      type: "line",
      source: sourceId,
      "source-layer": sourceLayer,
      paint: {
        "line-color": "#2f3a45",
        "line-opacity": 0.28,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10, 0.4,
          16, 1.4
        ]
      }
    });

    map.addSource(borderSourceId, {
      type: "geojson",
      data: emptyFeatureCollection()
    });

    map.addLayer({
      id: boroughBorderLayerId,
      type: "line",
      source: borderSourceId,
      filter: ["==", ["get", "kind"], "borough"],
      paint: {
        "line-color": "#111827",
        "line-opacity": 0.95,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10, 2.2,
          16, 5.2
        ]
      }
    });

    map.addLayer({
      id: neighborhoodBorderLayerId,
      type: "line",
      source: borderSourceId,
      filter: ["==", ["get", "kind"], "neighborhood"],
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.95,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10, 1.8,
          16, 4.2
        ]
      }
    });

    updateBorderVisibility();

    map.fitBounds(bounds, { padding: 30 });
    map.setMaxBounds(expandBounds(bounds, 0.01));
    map.setMinZoom(12);

    wireMapEvents();
    repaintBlocks();

    map.on("idle", () => {
      rememberVisibleBlockFeatures();
      renderBorders();
    });
  });
}

function labelRotateControl() {
  window.setTimeout(() => {
    const compass = document.querySelector(".mapboxgl-ctrl-compass");
    if (!compass) return;

    compass.setAttribute("aria-label", "Rotate map");
    compass.setAttribute("title", "Rotate map");
  }, 0);
}

function expandBounds(bounds, amount) {
  return [
    [bounds[0][0] - amount, bounds[0][1] - amount],
    [bounds[1][0] + amount, bounds[1][1] + amount]
  ];
}

function wireMapEvents() {
  map.on("click", fillLayerId, e => {
    applyPaintAtPoint(e.point);
  });

  map.on("mousedown", fillLayerId, e => {
    isPointerDown = true;
    map.dragPan.disable();
    applyPaintAtPoint(e.point);
  });

  map.on("mousemove", e => {
    const features = featuresAtPoint(e.point);
    map.getCanvas().style.cursor = features.length > 0 ? "crosshair" : "";

    if (isPointerDown) {
      applyPaintToFeatures(features);
    }
  });

  map.on("mouseleave", fillLayerId, () => {
    map.getCanvas().style.cursor = "";
  });

  window.addEventListener("mouseup", stopPainting);

  map.on("touchstart", fillLayerId, e => {
    isPointerDown = true;
    map.dragPan.disable();
    preventOriginalEvent(e);
    applyPaintAtPoint(e.point || (e.points && e.points[0]));
  });

  map.on("touchmove", e => {
    if (!isPointerDown) return;

    const point = e.point || (e.points && e.points[0]);
    if (!point) return;

    preventOriginalEvent(e);
    applyPaintAtPoint(point);
  });

  window.addEventListener("touchend", stopPainting);
  window.addEventListener("touchcancel", stopPainting);
}

function stopPainting() {
  isPointerDown = false;
  if (map) map.dragPan.enable();
}

function preventOriginalEvent(e) {
  if (e.originalEvent && e.originalEvent.preventDefault) {
    e.originalEvent.preventDefault();
  }
}

function featuresAtPoint(point) {
  if (!point) return [];

  return map.queryRenderedFeatures(point, { layers: [fillLayerId] });
}

function applyPaintAtPoint(point) {
  const features = featuresAtPoint(point);
  applyPaintToFeatures(features && features[0] ? [features[0]] : []);
}

function applyPaintToFeatures(features) {
  if (!hasStarted) {
    el.setupStatus.textContent = "Choose the neighborhood list and click Start drawing first.";
    return;
  }

  const name = currentNeighborhoodName();
  if (!name || !features || features.length === 0) return;

  let changed = false;
  let lockedOwner = null;
  let capacityBlocked = false;
  const seen = new Set();

  for (const feature of features) {
    rememberBlockFeature(feature);

    const geoid = getGeoid(feature);
    if (!geoid || seen.has(geoid)) continue;
    seen.add(geoid);

    const otherOwner = ownerOfBlock(geoid, name);
    if (otherOwner) {
      if (!isRevisionMode || paintMode !== "paint") {
        lockedOwner = lockedOwner || otherOwner;
        continue;
      }

      selectedByNeighborhood[otherOwner].delete(geoid);
    }

    if (paintMode === "paint") {
      if (!selectedByNeighborhood[name].has(geoid)) {
        if (!isRevisionMode && wouldLeaveTooFewBlocksForEmptyNeighborhoods(geoid, name)) {
          capacityBlocked = true;
          continue;
        }

        selectedByNeighborhood[name].add(geoid);
        changed = true;
      }
    } else if (selectedByNeighborhood[name].has(geoid)) {
      selectedByNeighborhood[name].delete(geoid);
      changed = true;
    }
  }

  if (lockedOwner) {
    setStatus(`Some blocks are already assigned to ${lockedOwner}. Use the validation step to move blocks between neighborhoods.`);
  } else if (capacityBlocked) {
    setStatus("Leave space for each remaining selected neighborhood.");
  } else if (changed) {
    setStatus("");
  }

  if (changed) {
    repaintBlocks();
    renderStep();
    renderBorders();
    saveProgress();
  }
}

function getGeoid(feature) {
  if (feature.properties && feature.properties.GEOID !== undefined) {
    return String(feature.properties.GEOID);
  }

  if (feature.id !== undefined && feature.id !== null) {
    return String(feature.id);
  }

  return null;
}

function repaintBlocks() {
  if (!map || !map.getLayer(fillLayerId)) return;

  const colorExpression = ["case"];
  const opacityExpression = ["case"];
  let hasSelectedBlocks = false;

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);

    const blocks = Array.from(selectedByNeighborhood[name]).map(String);
    if (blocks.length === 0) continue;

    hasSelectedBlocks = true;

    colorExpression.push(
      ["in", ["to-string", ["get", "GEOID"]], ["literal", blocks]],
      colorForNeighborhood(name)
    );
    opacityExpression.push(
      ["in", ["to-string", ["get", "GEOID"]], ["literal", blocks]],
      name === currentNeighborhoodName() ? 0.76 : 0.56
    );
  }

  if (hasSelectedBlocks) {
    colorExpression.push("#ffffff");
    opacityExpression.push(0.08);

    map.setPaintProperty(fillLayerId, "fill-color", colorExpression);
    map.setPaintProperty(fillLayerId, "fill-opacity", opacityExpression);
  } else {
    map.setPaintProperty(fillLayerId, "fill-color", [
      "case",
      ["==", ["to-string", ["get", "GEOID"]], "__no_selected_blocks__"],
      "#ffffff",
      "#ffffff"
    ]);
    map.setPaintProperty(fillLayerId, "fill-opacity", [
      "case",
      ["==", ["to-string", ["get", "GEOID"]], "__no_selected_blocks__"],
      0.08,
      0.08
    ]);
  }

  renderBorders();
}

function rememberVisibleBlockFeatures() {
  if (!map || !map.getSource(sourceId)) return;

  const sourceFeatures = map.querySourceFeatures(sourceId, {
    sourceLayer: sourceLayer
  });

  const renderedFeatures = map.getLayer(fillLayerId)
    ? map.queryRenderedFeatures({ layers: [fillLayerId] })
    : [];

  for (const feature of [...sourceFeatures, ...renderedFeatures]) {
    rememberBlockFeature(feature);
  }
}

function rememberBlockFeature(feature) {
  const geoid = getGeoid(feature);
  if (!geoid || !feature.geometry) return;
  if (blockFeaturesById.has(geoid)) return;

  blockFeaturesById.set(geoid, {
    type: "Feature",
    properties: { GEOID: geoid },
    geometry: cloneGeometry(feature.geometry)
  });
}

function cloneGeometry(geometry) {
  return {
    type: geometry.type,
    coordinates: JSON.parse(JSON.stringify(geometry.coordinates))
  };
}

function renderBorders() {
  if (!map || !map.getSource(borderSourceId)) return;

  const features = [];
  const blockFeatures = Array.from(blockFeaturesById.values());

  features.push(...lineFeaturesFromEdges(blockFeatures, {
    kind: "borough",
    name: "Wilkinsburg",
    color: "#111827"
  }));

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);

    const selectedFeatures = Array.from(selectedByNeighborhood[name])
      .map(geoid => blockFeaturesById.get(String(geoid)))
      .filter(Boolean);

    if (selectedFeatures.length === 0) continue;

    features.push(...lineFeaturesFromEdges(selectedFeatures, {
      kind: "neighborhood",
      name,
      color: colorForNeighborhood(name)
    }));
  }

  map.getSource(borderSourceId).setData({
    type: "FeatureCollection",
    features
  });

  updateBorderVisibility();
}

function lineFeaturesFromEdges(features, properties) {
  const edgeMap = new Map();

  for (const feature of features) {
    collectGeometryEdges(feature.geometry, edgeMap);
  }

  const lines = [];
  for (const edge of edgeMap.values()) {
    if (edge.count !== 1) continue;

    lines.push({
      type: "Feature",
      properties,
      geometry: {
        type: "LineString",
        coordinates: edge.coordinates
      }
    });
  }

  return lines;
}

function collectGeometryEdges(geometry, edgeMap) {
  if (!geometry || !geometry.coordinates) return;

  if (geometry.type === "Polygon") {
    collectPolygonEdges(geometry.coordinates, edgeMap);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      collectPolygonEdges(polygon, edgeMap);
    }
  }
}

function collectPolygonEdges(rings, edgeMap) {
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const start = ring[i];
      const end = ring[i + 1];
      const key = edgeKey(start, end);
      const existing = edgeMap.get(key);

      if (existing) {
        existing.count++;
      } else {
        edgeMap.set(key, {
          count: 1,
          coordinates: [start, end]
        });
      }
    }
  }
}

function edgeKey(start, end) {
  const a = normalizedPointKey(start);
  const b = normalizedPointKey(end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function normalizedPointKey(point) {
  return `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
}

function emptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function updateBorderVisibility() {
  if (!map) return;

  const visibility = showBorders ? "visible" : "none";

  for (const layerId of [boroughBorderLayerId, neighborhoodBorderLayerId]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }
}

function colorForNeighborhood(name) {
  const index = activeNeighborhoods.indexOf(name);
  const fallbackIndex = availableNeighborhoods.indexOf(name);
  const colorIndex = index >= 0 ? index : fallbackIndex;

  return NEIGHBORHOOD_COLORS[
    Math.max(0, colorIndex) % NEIGHBORHOOD_COLORS.length
  ];
}

function renderMapLegend() {
  el.mapLegend.innerHTML = "";

  const current = currentNeighborhoodName();
  for (const name of activeNeighborhoods) {
    const item = document.createElement("span");
    item.className = name === current ? "legend-active" : "";

    const swatch = document.createElement("i");
    swatch.style.background = colorForNeighborhood(name);

    const label = document.createElement("span");
    label.textContent = name;

    item.appendChild(swatch);
    item.appendChild(label);
    el.mapLegend.appendChild(item);
  }

  const openItem = document.createElement("span");
  const openSwatch = document.createElement("i");
  openSwatch.className = "legend-open";
  const openLabel = document.createElement("span");
  openLabel.textContent = "Unassigned";

  openItem.appendChild(openSwatch);
  openItem.appendChild(openLabel);
  el.mapLegend.appendChild(openItem);
}

function currentNeighborhoodName() {
  return activeNeighborhoods[currentIndex] || null;
}

function ensureNeighborhoodState(name) {
  if (!selectedByNeighborhood[name]) {
    selectedByNeighborhood[name] = new Set();
  }
}

function ensureAllNeighborhoodState() {
  const all = new Set([...availableNeighborhoods, ...activeNeighborhoods]);

  for (const name of all) {
    ensureNeighborhoodState(name);
  }
}

function initializeStateObjects() {
  for (const name of DEFAULT_NEIGHBORHOODS) {
    ensureNeighborhoodState(name);
  }
}

function renderNeighborhoodSetup() {
  el.neighborhoodChoiceList.innerHTML = "";

  for (const name of availableNeighborhoods) {
    ensureNeighborhoodState(name);

    const row = document.createElement("label");
    row.className = "neighborhood-choice";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = name;
    checkbox.checked = activeNeighborhoods.includes(name);
    checkbox.disabled = hasStarted;

    checkbox.addEventListener("change", syncActiveNeighborhoodsFromSetup);

    const span = document.createElement("span");
    span.textContent = name;

    row.appendChild(checkbox);
    row.appendChild(span);
    el.neighborhoodChoiceList.appendChild(row);
  }

  el.customNeighborhoodName.disabled = hasStarted;
  el.addNeighborhoodBtn.disabled = hasStarted;
  renderMapLegend();
}

function syncActiveNeighborhoodsFromSetup() {
  if (hasStarted) return;

  const checked = Array.from(
    el.neighborhoodChoiceList.querySelectorAll("input[type='checkbox']:checked")
  ).map(input => input.value);

  activeNeighborhoods = checked;

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);
  }

  renderMapLegend();
  saveProgress();
}

function addCustomNeighborhood() {
  if (hasStarted) {
    el.setupStatus.textContent = "You cannot add neighborhoods after drawing has started.";
    return;
  }

  const raw = el.customNeighborhoodName.value.trim();
  if (!raw) return;

  const alreadyExists = availableNeighborhoods.some(
    name => name.toLowerCase() === raw.toLowerCase()
  );

  if (alreadyExists) {
    el.setupStatus.textContent = "That neighborhood is already in the list.";
    return;
  }

  availableNeighborhoods.push(raw);
  activeNeighborhoods.push(raw);
  ensureNeighborhoodState(raw);

  el.customNeighborhoodName.value = "";
  el.setupStatus.textContent = "";

  renderNeighborhoodSetup();
  renderMapLegend();
  saveProgress();
}

function validateSetupBeforeStart() {
  syncActiveNeighborhoodsFromSetup();

  if (activeNeighborhoods.length === 0) {
    el.setupStatus.textContent = "Choose at least one neighborhood.";
    return false;
  }

  const totalBlocks = allBlockIds().size;

  if (totalBlocks === 0) {
    el.setupStatus.textContent = "The block graph has not loaded yet. Wait a moment and try again.";
    return false;
  }

  if (activeNeighborhoods.length > totalBlocks) {
    el.setupStatus.textContent =
      `You selected ${activeNeighborhoods.length} neighborhoods, but there are only ${totalBlocks} blocks.`;
    return false;
  }

  el.setupStatus.textContent = "";
  return true;
}

function startSurvey() {
  if (!validateSetupBeforeStart()) return;

  hasStarted = true;
  isRevisionMode = false;
  currentIndex = 0;

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);
  }

  applyStartVisibility();
  renderNeighborhoodSetup();
  scrollPanelToTop();
  renderStep();
  resizeMapSoon();
  repaintBlocks();
  saveProgress();
}

function applyStartVisibility() {
  el.intro.hidden = hasStarted;
  el.contextSection.hidden = hasStarted;
  el.neighborhoodSetupSection.hidden = hasStarted;
  el.drawSection.hidden = !hasStarted;
  el.reviewSection.hidden = true;
  el.finalSection.hidden = true;
  el.mapWrap.hidden = !hasStarted;
  el.mapModeControls.hidden = !hasStarted;
  if (hasStarted) resizeMapSoon();
}

function allBlockIds() {
  return new Set(Object.keys(graph || {}).map(String));
}

function assignedBlockIds() {
  const assigned = new Set();

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);

    for (const geoid of selectedByNeighborhood[name]) {
      assigned.add(String(geoid));
    }
  }

  return assigned;
}

function unassignedBlockIds() {
  const all = allBlockIds();
  const assigned = assignedBlockIds();
  const missing = [];

  for (const geoid of all) {
    if (!assigned.has(geoid)) {
      missing.push(geoid);
    }
  }

  return missing;
}

function emptyActiveNeighborhoodNames(exceptName = null) {
  return activeNeighborhoods.filter(name => {
    if (name === exceptName) return false;
    ensureNeighborhoodState(name);
    return selectedByNeighborhood[name].size === 0;
  });
}

function wouldLeaveTooFewBlocksForEmptyNeighborhoods(blockToAdd, currentName) {
  const assigned = assignedBlockIds();

  let assignedAfter = assigned.size;
  if (!assigned.has(String(blockToAdd))) {
    assignedAfter++;
  }

  const unassignedAfter = allBlockIds().size - assignedAfter;
  const emptyOtherNeighborhoods = emptyActiveNeighborhoodNames(currentName).length;

  return unassignedAfter < emptyOtherNeighborhoods;
}

function validateRemainingCapacity(currentName) {
  const unassigned = unassignedBlockIds().length;
  const emptyOthers = emptyActiveNeighborhoodNames(currentName).length;

  if (unassigned < emptyOthers) {
    setStatus("Leave space for each remaining selected neighborhood.");
    return false;
  }

  return true;
}

function isConnectedBlockSet(blockSet) {
  return countConnectedComponents(blockSet) <= 1;
}

function countConnectedComponents(blockSet) {
  const selected = new Set(Array.from(blockSet).map(String));
  if (selected.size <= 1) return selected.size;

  const unvisited = new Set(selected);
  let components = 0;

  while (unvisited.size > 0) {
    const start = unvisited.values().next().value;
    const stack = [start];
    components++;

    while (stack.length > 0) {
      const current = stack.pop();
      if (!unvisited.has(current)) continue;

      unvisited.delete(current);

      const neighbors = graph[current] || [];
      for (const neighbor of neighbors) {
        const neighborId = String(neighbor);

        if (unvisited.has(neighborId)) {
          stack.push(neighborId);
        }
      }
    }
  }

  return components;
}

function disconnectedNeighborhoodDetails() {
  const details = [];

  for (const name of activeNeighborhoods) {
    const detail = disconnectedNeighborhoodDetail(name);
    if (detail) {
      details.push(detail);
    }
  }

  return details;
}

function disconnectedNeighborhoodDetail(name) {
  ensureNeighborhoodState(name);

  const blocks = selectedByNeighborhood[name];
  const groups = countConnectedComponents(blocks);

  if (groups <= 1) return null;

  return {
    name,
    groups,
    blocks: blocks.size
  };
}

function showDisconnectedNeighborhoodAlert(details) {
  const rows = details.filter(Boolean).map(detail => {
    return `- ${detail.name}: ${detail.groups} separate groups across ${detail.blocks} selected blocks`;
  });

  if (rows.length === 0) return;

  alert(
    "Some neighborhoods are not connected yet.\n\n" +
    rows.join("\n") +
    "\n\nAdd connecting blocks or erase isolated pieces before continuing."
  );
}

function validateEveryActiveNeighborhoodHasBlocks() {
  const empty = emptyActiveNeighborhoodNames(null);

  if (empty.length > 0) {
    alert(
      "These selected neighborhoods still have no blocks assigned: " +
      empty.join(", ") +
      ". Every selected neighborhood must receive at least one block."
    );
    return false;
  }

  return true;
}

function validateAllBlocksAssigned() {
  const missing = unassignedBlockIds();

  if (missing.length > 0) {
    alert(
      "Some blocks are still unassigned. Every block must be assigned to a neighborhood before submitting."
    );
    return false;
  }

  return true;
}

function validateCurrentNeighborhoodBeforeMovingOn() {
  const name = currentNeighborhoodName();
  const blocks = selectedByNeighborhood[name];

  if (blocks.size === 0) {
    setStatus(`${name} needs at least one block.`);
    return false;
  }

  if (blocks.size > 1 && !isConnectedBlockSet(blocks)) {
    showDisconnectedNeighborhoodAlert([disconnectedNeighborhoodDetail(name)]);
    setStatus(`${name} must be connected before moving on.`);
    return false;
  }

  if (!validateRemainingCapacity(name)) {
    return false;
  }

  setStatus("");
  return true;
}

function ownerOfBlock(geoid, exceptNeighborhood = null) {
  for (const name of activeNeighborhoods) {
    if (name === exceptNeighborhood) continue;

    ensureNeighborhoodState(name);

    if (selectedByNeighborhood[name].has(String(geoid))) {
      return name;
    }
  }

  return null;
}

function wireUiEvents() {
  el.mapPaintMode.addEventListener("click", () => {
    setPaintMode("paint");
  });

  el.mapEraseMode.addEventListener("click", () => {
    setPaintMode("erase");
  });

  el.backBtn.addEventListener("click", () => {
    if (isRevisionMode) {
      showReview();
      return;
    }

    if (currentIndex > 0) {
      currentIndex--;
      scrollPanelToTop();
      renderStep();
      repaintBlocks();
      saveProgress();
    }
  });

  el.clearCurrentBtn.addEventListener("click", () => {
    const name = currentNeighborhoodName();
    selectedByNeighborhood[name].clear();

    setStatus(`Cleared ${name}.`);
    repaintBlocks();
    renderBorders();
    renderStep();
    saveProgress();
  });

  el.saveNextBtn.addEventListener("click", () => {
    if (isRevisionMode) {
      showReview();
      return;
    }

    if (!validateCurrentNeighborhoodBeforeMovingOn()) return;
    goNext();
  });

  el.addNeighborhoodBtn.addEventListener("click", addCustomNeighborhood);

  el.customNeighborhoodName.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomNeighborhood();
    }
  });

  el.startSurveyBtn.addEventListener("click", startSurvey);

  el.reviseSelectedBtn.addEventListener("click", reviseSelectedNeighborhood);

  el.finishBtn.addEventListener("click", submitFinalResponse);

  el.mapExpandBtn.addEventListener("click", toggleMapDrawer);

  el.borderToggle.checked = showBorders;
  el.borderToggle.addEventListener("change", () => {
    showBorders = el.borderToggle.checked;
    updateBorderVisibility();
    saveProgress();
  });

  el.mapSearchForm.addEventListener("submit", searchLandmark);

  el.downloadJsonBtn.addEventListener("click", () => {
    downloadJson(buildPayload(), "wilkinsburg-boundary-response.json");
  });

  el.resetProgressBtn.addEventListener("click", () => {
    const ok = window.confirm("Clear saved progress and restart this survey?");
    if (!ok) return;

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RESPONDENT_ID_KEY);
    window.location.reload();
  });

  for (const input of [el.relationship, el.anchorArea, el.yearsConnected]) {
    input.addEventListener("change", saveProgress);
    input.addEventListener("input", saveProgress);
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth > 860) {
      document.body.classList.remove("map-expanded");
      updateMapDrawerButton();
    }

    resizeMapSoon();
  });
}

function setPaintMode(mode) {
  paintMode = mode;

  const isPaint = mode === "paint";
  el.mapPaintMode.classList.toggle("active", isPaint);
  el.mapEraseMode.classList.toggle("active", !isPaint);

  renderStep();
}

function toggleMapDrawer() {
  document.body.classList.toggle("map-expanded");
  updateMapDrawerButton();
  resizeMapSoon();
}

function updateMapDrawerButton() {
  const expanded = document.body.classList.contains("map-expanded");
  el.mapExpandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  el.mapExpandBtn.querySelector(".map-toggle-label").textContent = expanded ? "Collapse map" : "Expand map";
}

function resizeMapSoon() {
  window.setTimeout(() => {
    if (map) map.resize();
  }, 180);
}

async function searchLandmark(event) {
  event.preventDefault();

  const query = el.mapSearchInput.value.trim();
  if (!query) {
    el.mapSearchStatus.textContent = "Enter a landmark or address.";
    return;
  }

  if (!map || !spec) {
    el.mapSearchStatus.textContent = "Map is still loading.";
    return;
  }

  el.mapSearchStatus.textContent = "Searching...";

  try {
    const bounds = spec.units.bounds;
    const bbox = [
      bounds[0][0],
      bounds[0][1],
      bounds[1][0],
      bounds[1][1]
    ].join(",");
    const center = [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2
    ].join(",");
    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(`${query} Wilkinsburg PA`) +
      `.json?bbox=${bbox}&proximity=${center}&limit=5&types=poi,address,neighborhood,place&access_token=${encodeURIComponent(mapboxgl.accessToken)}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Search failed.");

    const data = await response.json();
    const result = data.features && data.features[0];

    if (!result || !result.center) {
      el.mapSearchStatus.textContent = "No nearby landmark found.";
      return;
    }

    const lngLat = result.center;

    if (searchMarker) {
      searchMarker.remove();
    }

    searchMarker = new mapboxgl.Marker({ color: "#111827" })
      .setLngLat(lngLat)
      .setPopup(new mapboxgl.Popup({ offset: 12 }).setText(result.place_name))
      .addTo(map);

    searchMarker.togglePopup();
    map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 16), essential: true });
    el.mapSearchStatus.textContent = result.place_name;
  } catch (err) {
    console.error(err);
    el.mapSearchStatus.textContent = "Could not search right now.";
  }
}

function goNext() {
  setStatus("");

  if (currentIndex < activeNeighborhoods.length - 1) {
    currentIndex++;
    scrollPanelToTop();
    renderStep();
    repaintBlocks();
    saveProgress();
  } else {
    isRevisionMode = false;
    scrollPanelToTop();
    showReview();
  }
}

function renderStep() {
  const name = currentNeighborhoodName();

  if (!name) return;

  ensureNeighborhoodState(name);

  el.drawSection.hidden = false;
  el.reviewSection.hidden = true;
  el.finalSection.hidden = true;
  el.mapModeControls.hidden = false;

  el.stepLabel.textContent = isRevisionMode
    ? "Validation edit"
    : `Neighborhood ${currentIndex + 1} of ${activeNeighborhoods.length}`;
  el.blockCountLabel.textContent = `${paintMode === "paint" ? "Paint" : "Erase"} mode`;

  el.neighborhoodTitle.textContent = `${isRevisionMode ? "Revise" : "Draw"} ${name}`;
  el.progressFill.style.width = isRevisionMode
    ? "100%"
    : `${((currentIndex + 1) / activeNeighborhoods.length) * 100}%`;

  el.backBtn.disabled = !isRevisionMode && currentIndex === 0;
  el.backBtn.textContent = isRevisionMode ? "Back to validation" : "Back";
  el.saveNextBtn.textContent = isRevisionMode ? "Done revising" : "Save & next";
  renderMapLegend();
}

function showReview() {
  isRevisionMode = false;
  el.drawSection.hidden = true;
  el.reviewSection.hidden = false;
  el.finalSection.hidden = true;
  el.mapModeControls.hidden = true;
  setStatus("");

  el.reviewList.innerHTML = "";
  renderRevisionNeighborhoodOptions();
  renderMapLegend();

  for (const [index, name] of activeNeighborhoods.entries()) {
    ensureNeighborhoodState(name);

    const item = document.createElement("div");
    item.className = "review-item";

    const connected = isConnectedBlockSet(selectedByNeighborhood[name]);
    const count = selectedByNeighborhood[name].size;

    item.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <small>${count === 0 ? "No blocks yet" : connected ? "Connected" : "Not connected yet"}</small>
    `;

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = `Revise ${name}`;
    edit.addEventListener("click", () => {
      startRevisionForNeighborhood(index);
    });

    item.appendChild(edit);
    el.reviewList.appendChild(item);
  }

  saveProgress();
}

function renderRevisionNeighborhoodOptions() {
  el.revisionNeighborhood.innerHTML = "";

  for (const [index, name] of activeNeighborhoods.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = name;
    option.selected = index === currentIndex;
    el.revisionNeighborhood.appendChild(option);
  }
}

function reviseSelectedNeighborhood() {
  const index = Number(el.revisionNeighborhood.value);
  if (!Number.isInteger(index) || !activeNeighborhoods[index]) return;

  startRevisionForNeighborhood(index);
}

function startRevisionForNeighborhood(index) {
  currentIndex = index;
  isRevisionMode = true;
  el.reviewSection.hidden = true;
  el.drawSection.hidden = false;
  el.finalSection.hidden = true;
  el.mapModeControls.hidden = false;
  setStatus("");
  scrollPanelToTop();
  renderStep();
  repaintBlocks();
  saveProgress();
}

async function submitFinalResponse() {
  if (!validateEveryActiveNeighborhoodHasBlocks()) {
    el.reviewSection.hidden = false;
    el.finalSection.hidden = true;
    return;
  }

  if (!validateAllBlocksAssigned()) {
    el.reviewSection.hidden = false;
    el.finalSection.hidden = true;
    return;
  }

  const disconnected = disconnectedNeighborhoodDetails();

  if (disconnected.length > 0) {
    el.reviewSection.hidden = false;
    el.finalSection.hidden = true;
    el.submitStatus.textContent = "";
    showDisconnectedNeighborhoodAlert(disconnected);
    return;
  }

  const payload = buildPayload();
  const json = JSON.stringify(payload, null, 2);

  el.reviewSection.hidden = true;
  el.finalSection.hidden = false;
  el.mapModeControls.hidden = true;
  el.finalJson.value = json;

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const supabaseUrl = params.get("supabase_url");
  const supabaseAnonKey = params.get("supabase_anon_key");

  if (!supabaseUrl || !supabaseAnonKey) {
    el.submitStatus.textContent = "No Supabase connection configured. Download or copy the JSON response.";
    return;
  }

  try {
    const client = supabase.createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await client
      .from("full_boundary_responses")
      .insert({
        respondent_id: respondentId,
        response_json: payload
      });

    if (error) throw error;

    el.submitStatus.textContent = "Response submitted successfully.";
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error(err);
    el.submitStatus.textContent = "Could not submit to Supabase. Download the JSON backup.";
  }
}

function buildPayload() {
  const neighborhoods = {};

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);
    neighborhoods[name] = Array.from(selectedByNeighborhood[name]);
  }

  return {
    respondent_id: respondentId,
    created_at: new Date().toISOString(),
    active_neighborhoods: activeNeighborhoods,
    neighborhoods: neighborhoods,
    unassigned_blocks: unassignedBlockIds(),
    metadata: {
      relationship_to_wilkinsburg: el.relationship.value,
      anchor_area: el.anchorArea.value,
      years_connected: el.yearsConnected.value
    }
  };
}

function saveProgress() {
  const neighborhoods = {};

  const allNames = new Set([...availableNeighborhoods, ...activeNeighborhoods]);
  for (const name of allNames) {
    ensureNeighborhoodState(name);
    neighborhoods[name] = Array.from(selectedByNeighborhood[name]);
  }

  const payload = {
    respondentId,
    currentIndex,
    availableNeighborhoods,
    activeNeighborhoods,
    hasStarted,
    showBorders,
    neighborhoods,
    metadata: {
      relationship: el.relationship.value,
      anchorArea: el.anchorArea.value,
      yearsConnected: el.yearsConnected.value
    }
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSavedProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);

    respondentId = saved.respondentId || respondentId;

    if (Array.isArray(saved.availableNeighborhoods)) {
      availableNeighborhoods = saved.availableNeighborhoods;
    }

    if (Array.isArray(saved.activeNeighborhoods)) {
      activeNeighborhoods = saved.activeNeighborhoods;
    }

    hasStarted = !!saved.hasStarted;
    if (typeof saved.showBorders === "boolean") {
      showBorders = saved.showBorders;
    }

    const maxIndex = Math.max(0, activeNeighborhoods.length - 1);
    currentIndex = Math.min(Number(saved.currentIndex || 0), maxIndex);

    const allNames = new Set([...availableNeighborhoods, ...activeNeighborhoods]);

    for (const name of allNames) {
      const arr = saved.neighborhoods && saved.neighborhoods[name] ? saved.neighborhoods[name] : [];
      selectedByNeighborhood[name] = new Set(arr.map(String));
    }

    if (saved.metadata) {
      el.relationship.value = saved.metadata.relationship || "";
      el.anchorArea.value = saved.metadata.anchorArea || "";
      el.yearsConnected.value = saved.metadata.yearsConnected || "";
    }
  } catch (err) {
    console.warn("Could not load saved progress", err);
  }
}

function getOrCreateRespondentId() {
  let id = localStorage.getItem(RESPONDENT_ID_KEY);

  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random().toString(16).slice(2);

    localStorage.setItem(RESPONDENT_ID_KEY, id);
  }

  return id;
}

function setStatus(message) {
  el.status.textContent = message || "";
}

function scrollPanelToTop() {
  el.panel.scrollTop = 0;
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return map[ch];
  });
}
