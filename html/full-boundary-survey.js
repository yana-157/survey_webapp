"use strict";

const SPECIFICATION_URL = "./assets/wilkinsburg.json";
const GRAPH_URL = "./assets/wilkinsburg_graph.json";
const BOUNDARY_EDGE_URL = "./assets/wilkinsburg_boundary_edges.geojson";
const TRACED_BOUNDARY_URL = "./assets/wilkinsburg_traced_boundary.geojson";
const PUBLIC_MAPBOX_TOKEN = "pk.eyJ1IjoiY21jY2FydGFuIiwiYSI6ImNrZGdkdW9waTA1eGEycmxycnQzZ3o4c3kifQ.v_XViAm-nItfHgx0J3Xg3A";
const MIN_BORDER_SEGMENT_LENGTH = 0.00004;

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

const MAX_CUSTOM_NEIGHBORHOODS = 10;

const NEIGHBORHOOD_COLORS = [
  "#1d4ed8",
  "#f97316",
  "#16a34a",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#334155",
  "#84cc16",
  "#7c2d12",
  "#0d9488",
  "#7e22ce",
  "#ea580c",
  "#0f766e",
  "#be123c",
  "#2563eb",
  "#65a30d",
  "#b45309",
  "#4f46e5",
  "#15803d",
  "#c026d3"
];

const STORAGE_KEY = "wilkinsburg_full_boundary_survey_v2";
const RESPONDENT_ID_KEY = "wilkinsburg_boundary_respondent_id";
const RESPONSE_TABLE = "full_boundary_responses";
const SPREADSHEET_TABLE = "full_boundary_response_spreadsheet";

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
let boundaryEdges = [];
let boroughBoundaryFeatures = [];
let searchMarker = null;
let landmarkSearchOpen = false;
let neighborhoodListOpen = false;
let showBorders = true;
let respondentId = getOrCreateRespondentId();
let statusClearTimer = null;
let activeDialogResolve = null;

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
  progressFill: document.getElementById("progress-fill"),
  neighborhoodTitle: document.getElementById("neighborhood-title"),
  status: document.getElementById("status"),

  backBtn: document.getElementById("back-btn"),
  saveNextBtn: document.getElementById("save-next-btn"),

  reviewList: document.getElementById("review-list"),
  revisionNeighborhood: document.getElementById("revision-neighborhood"),
  reviseSelectedBtn: document.getElementById("revise-selected-btn"),
  finalFeedback: document.getElementById("final-feedback"),
  followupEmail: document.getElementById("followup-email"),
  saveFeedbackBtn: document.getElementById("save-feedback-btn"),
  finishBtn: document.getElementById("finish-btn"),

  submitStatus: document.getElementById("submit-status"),
  finalJson: document.getElementById("final-json"),
  downloadJsonBtn: document.getElementById("download-json-btn"),
  downloadCsvBtn: document.getElementById("download-csv-btn"),
  mapWrap: document.getElementById("map-wrap"),
  mapModeControls: document.getElementById("map-mode-controls"),
  mapPaintMode: document.getElementById("map-paint-mode"),
  mapEraseMode: document.getElementById("map-erase-mode"),
  mapClearCurrentBtn: document.getElementById("map-clear-current-btn"),
  mapNeighborhoodPicker: document.getElementById("map-neighborhood-picker"),
  mapNeighborhoodSwatch: document.getElementById("map-neighborhood-swatch"),
  mapNeighborhoodTitle: document.getElementById("map-neighborhood-title"),
  mapNeighborhoodToggle: document.getElementById("map-neighborhood-toggle"),
  mapNeighborhoodList: document.getElementById("map-neighborhood-list"),
  mapExpandBtn: document.getElementById("map-expand-btn"),
  mapLegend: document.getElementById("map-legend"),
  mapSearchToggle: document.getElementById("map-search-toggle"),
  mapSearchForm: document.getElementById("map-search"),
  mapSearchInput: document.getElementById("map-search-input"),
  mapSearchClearBtn: document.getElementById("map-search-clear-btn"),
  mapSearchStatus: document.getElementById("map-search-status"),
  borderToggle: document.getElementById("border-toggle"),
  resetProgressBtn: document.getElementById("reset-progress-btn"),
  appDialogBackdrop: document.getElementById("app-dialog-backdrop"),
  appDialogTitle: document.getElementById("app-dialog-title"),
  appDialogMessage: document.getElementById("app-dialog-message"),
  appDialogList: document.getElementById("app-dialog-list"),
  appDialogCancel: document.getElementById("app-dialog-cancel"),
  appDialogConfirm: document.getElementById("app-dialog-confirm")
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
    const [loadedSpec, loadedGraph, loadedEdges, loadedTracedBoundary] = await Promise.all([
      fetch(SPECIFICATION_URL).then(r => {
        if (!r.ok) throw new Error("Could not load wilkinsburg.json");
        return r.json();
      }),
      fetch(GRAPH_URL).then(r => {
        if (!r.ok) throw new Error("Could not load wilkinsburg_graph.json");
        return r.json();
      }),
      fetch(BOUNDARY_EDGE_URL).then(r => {
        if (!r.ok) throw new Error("Could not load wilkinsburg_boundary_edges.geojson");
        return r.json();
      }),
      fetch(TRACED_BOUNDARY_URL).then(r => {
        if (!r.ok) throw new Error("Could not load wilkinsburg_traced_boundary.geojson");
        return r.json();
      })
    ]);

    spec = normalizeSpec(loadedSpec);
    graph = normalizeGraph(loadedGraph);
    boundaryEdges = normalizeBoundaryEdges(loadedEdges);
    boroughBoundaryFeatures = normalizeTracedBoundary(loadedTracedBoundary);
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

function normalizeBoundaryEdges(collection) {
  return (collection.features || [])
    .filter(feature => feature.geometry && feature.properties && feature.properties.a)
    .map(feature => ({
      a: String(feature.properties.a),
      b: feature.properties.b ? String(feature.properties.b) : null,
      geometry: feature.geometry,
      length: geometryLength(feature.geometry)
    }))
    .filter(edge => edge.length >= MIN_BORDER_SEGMENT_LENGTH);
}

function normalizeTracedBoundary(collection) {
  return (collection.features || [])
    .filter(feature => feature.geometry)
    .map(feature => ({
      type: "Feature",
      properties: {
        kind: "borough",
        name: "Wilkinsburg"
      },
      geometry: feature.geometry
    }));
}

function lineLength(line) {
  let length = 0;

  for (let i = 1; i < line.length; i += 1) {
    const previous = line[i - 1];
    const current = line[i];
    length += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
  }

  return length;
}

function geometryLength(geometry) {
  if (!geometry) return 0;

  if (geometry.type === "LineString") {
    return lineLength(geometry.coordinates);
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.reduce((sum, line) => sum + lineLength(line), 0);
  }

  return 0;
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
        "line-color": "#475569",
        "line-opacity": 0.22,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10, 0.35,
          16, 1.1
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
        "line-color": "#0f172a",
        "line-opacity": 0.72,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10, 1.1,
          16, 2.9
        ]
      },
      layout: {
        "line-cap": "round",
        "line-join": "round"
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
          10, 1.9,
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
  });
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
  let capacityBlocked = false;
  const seen = new Set();

  for (const feature of features) {
    const geoid = getGeoid(feature);
    if (!geoid || seen.has(geoid)) continue;
    seen.add(geoid);

    const otherOwner = ownerOfBlock(geoid, name);
    if (otherOwner) {
      if (!isRevisionMode || paintMode !== "paint") {
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

  if (capacityBlocked) {
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

  const idExpression = blockIdExpression();
  const colorExpression = ["case"];
  const opacityExpression = ["case"];
  let hasSelectedBlocks = false;

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);

    const blocks = Array.from(selectedByNeighborhood[name]).map(String);
    if (blocks.length === 0) continue;

    hasSelectedBlocks = true;

    colorExpression.push(
      ["in", idExpression, ["literal", blocks]],
      colorForNeighborhood(name)
    );
    opacityExpression.push(
      ["in", idExpression, ["literal", blocks]],
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
      ["==", idExpression, "__no_selected_blocks__"],
      "#ffffff",
      "#ffffff"
    ]);
    map.setPaintProperty(fillLayerId, "fill-opacity", [
      "case",
      ["==", idExpression, "__no_selected_blocks__"],
      0.08,
      0.08
    ]);
  }

  renderBorders();
}

function blockIdExpression() {
  return [
    "case",
    ["has", "GEOID"],
    ["to-string", ["get", "GEOID"]],
    ["to-string", ["id"]]
  ];
}

function renderBorders() {
  if (!map || !map.getSource(borderSourceId)) return;

  const features = [...boroughBoundaryFeatures];

  for (const name of activeNeighborhoods) {
    ensureNeighborhoodState(name);

    const selected = selectedByNeighborhood[name];
    if (selected.size === 0) continue;

    for (const edge of boundaryEdges) {
      const aSelected = selected.has(edge.a);
      const bSelected = edge.b ? selected.has(edge.b) : false;
      if (aSelected === bSelected) continue;

      features.push(edgeFeature(edge, {
        kind: "neighborhood",
        name,
        color: colorForNeighborhood(name)
      }));
    }
  }

  map.getSource(borderSourceId).setData({
    type: "FeatureCollection",
    features
  });

  updateBorderVisibility();
}

function edgeFeature(edge, properties) {
  return {
    type: "Feature",
    properties,
    geometry: edge.geometry
  };
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
  const setupIndex = availableNeighborhoods.indexOf(name);
  const activeIndex = activeNeighborhoods.indexOf(name);
  const colorIndex = setupIndex >= 0 ? setupIndex : activeIndex;

  return NEIGHBORHOOD_COLORS[
    Math.max(0, colorIndex) % NEIGHBORHOOD_COLORS.length
  ];
}

function isDefaultNeighborhood(name) {
  return DEFAULT_NEIGHBORHOODS.some(defaultName => {
    return defaultName.toLowerCase() === String(name).toLowerCase();
  });
}

function customNeighborhoodCount() {
  return availableNeighborhoods.filter(name => !isDefaultNeighborhood(name)).length;
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

async function addCustomNeighborhood() {
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

  if (customNeighborhoodCount() >= MAX_CUSTOM_NEIGHBORHOODS) {
    await showInfoDialog({
      title: "Neighborhood limit reached",
      message: `You can add up to ${MAX_CUSTOM_NEIGHBORHOODS} additional neighborhoods.`,
      details: ["You can still check or uncheck neighborhoods already in the list."],
      confirmLabel: "OK"
    });
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

function hasRemainingCapacity(currentName) {
  const unassigned = unassignedBlockIds().length;
  const emptyOthers = emptyActiveNeighborhoodNames(currentName).length;

  return unassigned >= emptyOthers;
}

function validateRemainingCapacity(currentName) {
  if (!hasRemainingCapacity(currentName)) {
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

function finalInvalidStateDetails() {
  const details = [];
  const empty = emptyActiveNeighborhoodNames(null);
  const unassigned = unassignedBlockIds();
  const disconnected = disconnectedNeighborhoodDetails();

  if (empty.length > 0) {
    for (const name of empty) {
      details.push({
        type: "empty",
        name,
        message: `${name} has no blocks selected.`
      });
    }
  }

  if (unassigned.length > 0) {
    details.push({
      type: "unassigned",
      message: `${unassigned.length} block${unassigned.length === 1 ? " is" : "s are"} still unassigned.`
    });
  }

  for (const detail of disconnected) {
    details.push({
      type: "disconnected",
      name: detail.name,
      message: `${detail.name} has ${detail.groups} separate groups across ${detail.blocks} selected blocks.`
    });
  }

  return details;
}

async function confirmSubmitWithInvalidStates(details) {
  if (details.length === 0) return true;

  const issueNeighborhoods = new Set(details
    .map(detail => detail.name)
    .filter(Boolean));
  const hasUnassigned = details.some(detail => detail.type === "unassigned");
  const rows = [];

  if (issueNeighborhoods.size > 0) {
    rows.push(`${issueNeighborhoods.size} neighborhood${issueNeighborhoods.size === 1 ? " has" : "s have"} an issue.`);
  }

  if (hasUnassigned) {
    rows.push("Some blocks are still unassigned.");
  }

  return showChoiceDialog({
    title: "Submit anyway?",
    message: "This map still has issues.",
    details: rows,
    confirmLabel: "Submit anyway",
    cancelLabel: "Go back"
  });
}

function currentNeighborhoodIssueDetails(name) {
  const issues = [];
  const blocks = selectedByNeighborhood[name];

  if (blocks.size === 0) {
    issues.push(`${name} has no blocks selected.`);
  }

  if (blocks.size > 1 && !isConnectedBlockSet(blocks)) {
    const detail = disconnectedNeighborhoodDetail(name);
    issues.push(`${name} is split into ${detail.groups} separate groups.`);
  }

  if (!hasRemainingCapacity(name)) {
    issues.push("There may not be enough unassigned blocks left for every remaining neighborhood.");
  }

  return issues;
}

async function confirmContinueWithCurrentIssues(name, issues) {
  if (issues.length === 0) return true;

  return showChoiceDialog({
    title: `${name} needs attention`,
    message: "You can fix this now or continue anyway.",
    details: issues,
    confirmLabel: "Continue anyway",
    cancelLabel: "Keep fixing"
  });
}

async function validateCurrentNeighborhoodBeforeMovingOn() {
  const name = currentNeighborhoodName();
  const issues = currentNeighborhoodIssueDetails(name);

  if (issues.length > 0 && !(await confirmContinueWithCurrentIssues(name, issues))) {
    setStatus(`${name} still needs attention.`);
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
  el.mapNeighborhoodToggle.addEventListener("click", toggleNeighborhoodList);
  el.appDialogCancel.addEventListener("click", () => resolveChoiceDialog(false));
  el.appDialogConfirm.addEventListener("click", () => resolveChoiceDialog(true));

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

  el.mapClearCurrentBtn.addEventListener("click", clearCurrentNeighborhood);

  el.saveNextBtn.addEventListener("click", async () => {
    if (isRevisionMode) {
      showReview();
      return;
    }

    if (!(await validateCurrentNeighborhoodBeforeMovingOn())) return;
    goNext();
  });

  el.addNeighborhoodBtn.addEventListener("click", () => {
    void addCustomNeighborhood();
  });

  el.customNeighborhoodName.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      void addCustomNeighborhood();
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
  el.mapSearchToggle.addEventListener("click", toggleLandmarkSearch);
  el.mapSearchClearBtn.addEventListener("click", clearLandmarkSearch);

  el.downloadJsonBtn.addEventListener("click", () => {
    downloadJson(buildPayload(), "wilkinsburg-boundary-response.json");
  });

  el.downloadCsvBtn.addEventListener("click", () => {
    downloadCsv(
      buildSpreadsheetCsvRow(buildPayload()),
      "wilkinsburg-boundary-response-row.csv"
    );
  });

  el.saveFeedbackBtn.addEventListener("click", () => {
    void savePostSubmissionDetails();
  });

  for (const input of [el.finalFeedback, el.followupEmail]) {
    input.addEventListener("input", refreshFinalOutput);
  }

  el.resetProgressBtn.addEventListener("click", async () => {
    const ok = await showChoiceDialog({
      title: "Reset saved progress?",
      message: "This clears the saved draft on this device and restarts the survey.",
      details: ["Your submitted data is not affected."],
      confirmLabel: "Reset progress",
      cancelLabel: "Keep progress"
    });

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

function showInfoDialog({ title, message, details, confirmLabel }) {
  return showChoiceDialog({
    title,
    message,
    details,
    confirmLabel,
    cancelLabel: ""
  });
}

function showChoiceDialog({ title, message, details = [], confirmLabel, cancelLabel }) {
  el.appDialogTitle.textContent = title;
  el.appDialogMessage.textContent = message;
  el.appDialogConfirm.textContent = confirmLabel;
  el.appDialogCancel.textContent = cancelLabel;
  el.appDialogCancel.hidden = !cancelLabel;
  el.appDialogList.innerHTML = "";

  for (const detail of details) {
    const item = document.createElement("li");
    item.textContent = detail;
    el.appDialogList.appendChild(item);
  }

  el.appDialogBackdrop.hidden = false;
  el.appDialogConfirm.focus();

  return new Promise(resolve => {
    activeDialogResolve = resolve;
  });
}

function resolveChoiceDialog(value) {
  if (!activeDialogResolve) return;

  const resolve = activeDialogResolve;
  activeDialogResolve = null;
  el.appDialogBackdrop.hidden = true;
  resolve(value);
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
  el.mapExpandBtn.setAttribute("aria-label", expanded ? "Collapse map" : "Expand map");
  el.mapExpandBtn.querySelector(".map-toggle-label").textContent = expanded ? "Close" : "Expand";
}

function toggleLandmarkSearch() {
  setLandmarkSearchOpen(!landmarkSearchOpen);
}

function setLandmarkSearchOpen(open) {
  landmarkSearchOpen = open;
  document.body.classList.toggle("landmark-search-open", open);
  el.mapSearchToggle.setAttribute("aria-expanded", open ? "true" : "false");
  el.mapSearchToggle.textContent = open ? "Close" : "Search for Landmark";

  if (open) {
    window.setTimeout(() => el.mapSearchInput.focus(), 0);
  }
}

function resizeMapSoon() {
  window.setTimeout(() => {
    if (map) map.resize();
  }, 180);
}

function clearCurrentNeighborhood() {
  const name = currentNeighborhoodName();
  selectedByNeighborhood[name].clear();

  setTemporaryStatus(`Cleared ${name}.`, 3000);
  repaintBlocks();
  renderBorders();
  renderStep();
  saveProgress();
}

function clearLandmarkSearch() {
  if (searchMarker) {
    searchMarker.remove();
    searchMarker = null;
  }

  el.mapSearchInput.value = "";
  el.mapSearchStatus.textContent = "";
  el.mapSearchClearBtn.hidden = true;
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
      .setPopup(new mapboxgl.Popup({ closeButton: false, offset: 12 }).setText(result.place_name))
      .addTo(map);

    searchMarker.togglePopup();
    map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 16), essential: true });
    el.mapSearchStatus.textContent = result.place_name;
    el.mapSearchClearBtn.hidden = false;
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
  el.neighborhoodTitle.textContent = isRevisionMode ? `Revise ${name}` : name;
  el.mapNeighborhoodTitle.textContent = isRevisionMode ? `Revise ${name}` : name;
  el.mapNeighborhoodSwatch.style.background = colorForNeighborhood(name);
  renderNeighborhoodList();
  el.progressFill.style.width = isRevisionMode
    ? "100%"
    : `${((currentIndex + 1) / activeNeighborhoods.length) * 100}%`;

  el.backBtn.disabled = false;

  if (isRevisionMode) {
    el.backBtn.hidden = false;
    el.backBtn.textContent = "Back to validation";
  } else if (currentIndex === 0) {
    el.backBtn.hidden = true;
    el.backBtn.textContent = "Back";
  } else {
    el.backBtn.hidden = false;
    el.backBtn.textContent = `Back to ${activeNeighborhoods[currentIndex - 1]}`;
  }

  el.saveNextBtn.textContent = isRevisionMode ? "Done revising" : "Save & next";
  renderMapLegend();
}

function toggleNeighborhoodList() {
  setNeighborhoodListOpen(!neighborhoodListOpen);
}

function setNeighborhoodListOpen(open) {
  neighborhoodListOpen = open;
  el.mapNeighborhoodPicker.classList.toggle("neighborhood-list-open", open);
  el.mapNeighborhoodToggle.setAttribute("aria-expanded", open ? "true" : "false");
  el.mapNeighborhoodList.hidden = !open;
}

function renderNeighborhoodList() {
  const rows = activeNeighborhoods.map((name, index) => ({
    name,
    index,
    current: index === currentIndex,
    completed: !isRevisionMode && index < currentIndex
  }));

  const orderedRows = [
    ...rows.filter(row => row.current),
    ...rows.filter(row => !row.current && !row.completed),
    ...rows.filter(row => row.completed)
  ];

  renderNeighborhoodListItems(el.mapNeighborhoodList, orderedRows);

  setNeighborhoodListOpen(neighborhoodListOpen);
}

function renderNeighborhoodListItems(container, orderedRows) {
  container.innerHTML = "";

  let completedDividerAdded = false;
  for (const row of orderedRows) {
    if (row.completed && !completedDividerAdded) {
      const divider = document.createElement("div");
      divider.className = "neighborhood-list-divider";
      divider.textContent = "Completed";
      container.appendChild(divider);
      completedDividerAdded = true;
    }

    const item = document.createElement("div");
    item.className = "neighborhood-list-item";
    if (row.current) item.classList.add("current");
    if (row.completed) item.classList.add("completed");

    if (row.completed) {
      const check = document.createElement("span");
      check.className = "neighborhood-list-check";
      check.setAttribute("aria-label", "Completed");
      check.textContent = "✓";
      item.appendChild(check);
    }

    const swatch = document.createElement("span");
    swatch.className = "neighborhood-list-swatch";
    swatch.style.background = colorForNeighborhood(row.name);
    item.appendChild(swatch);

    const name = document.createElement("span");
    name.className = "neighborhood-list-name";
    name.textContent = row.name;

    item.appendChild(name);

    container.appendChild(item);
  }
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
  const invalidStates = finalInvalidStateDetails();

  if (invalidStates.length > 0 && !(await confirmSubmitWithInvalidStates(invalidStates))) {
    el.reviewSection.hidden = false;
    el.finalSection.hidden = true;
    el.submitStatus.textContent = "";
    return;
  }

  const payload = buildPayload();
  const spreadsheetRow = buildSpreadsheetRow(payload);
  const json = JSON.stringify(payload, null, 2);

  el.reviewSection.hidden = true;
  el.finalSection.hidden = false;
  el.mapModeControls.hidden = true;
  el.finalJson.value = json;

  const config = getSupabaseConfig();

  if (!config) {
    el.submitStatus.textContent = "No Supabase connection configured. Download or copy the JSON/CSV response.";
    return;
  }

  try {
    const client = supabase.createClient(config.url, config.anonKey);
    const { error } = await client
      .from(RESPONSE_TABLE)
      .insert({
        respondent_id: respondentId,
        response_json: payload
      });

    if (error) throw error;

    const { error: spreadsheetError } = await client
      .from(SPREADSHEET_TABLE)
      .upsert(spreadsheetRow, { onConflict: "respondent_id" });

    if (spreadsheetError) {
      console.error(spreadsheetError);
      el.submitStatus.textContent = "Response saved, but the spreadsheet row could not be updated. Download the CSV backup.";
      return;
    }

    el.submitStatus.textContent = "Response submitted successfully and added to the spreadsheet table.";
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error(err);
    el.submitStatus.textContent = "Could not submit to Supabase. Download the JSON/CSV backup.";
  }
}

async function savePostSubmissionDetails() {
  refreshFinalOutput();

  const config = getSupabaseConfig();

  if (!config) {
    el.submitStatus.textContent = "Feedback added to the JSON/CSV backup on this page.";
    return;
  }

  try {
    const client = supabase.createClient(config.url, config.anonKey);
    const { error } = await client
      .from(SPREADSHEET_TABLE)
      .upsert(buildSpreadsheetRow(buildPayload()), { onConflict: "respondent_id" });

    if (error) throw error;

    el.submitStatus.textContent = "Feedback saved to the same spreadsheet row.";
  } catch (err) {
    console.error(err);
    el.submitStatus.textContent = "Could not save feedback. Download the CSV backup.";
  }
}

function refreshFinalOutput() {
  if (el.finalSection.hidden) return;

  el.finalJson.value = JSON.stringify(buildPayload(), null, 2);
}

function getSupabaseConfig() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const url = params.get("supabase_url");
  const anonKey = params.get("supabase_anon_key");

  if (!url || !anonKey) return null;

  return { url, anonKey };
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
    invalid_states: finalInvalidStateDetails(),
    metadata: {
      relationship_to_wilkinsburg: el.relationship.value,
      anchor_area: el.anchorArea.value,
      years_connected: el.yearsConnected.value,
      final_feedback: el.finalFeedback.value.trim(),
      followup_email: el.followupEmail.value.trim()
    }
  };
}

function buildSpreadsheetRow(payload) {
  const neighborhoodRows = payload.active_neighborhoods.map((name, index) => {
    const blockIds = payload.neighborhoods[name] || [];

    return {
      order: index + 1,
      name,
      color: colorForNeighborhood(name),
      block_count: blockIds.length,
      block_geoids: blockIds
    };
  });

  return {
    respondent_id: payload.respondent_id,
    submitted_at: payload.created_at,
    relationship_to_wilkinsburg: payload.metadata.relationship_to_wilkinsburg || "",
    anchor_area: payload.metadata.anchor_area || "",
    years_connected: payload.metadata.years_connected || "",
    final_feedback: payload.metadata.final_feedback || "",
    followup_email: payload.metadata.followup_email || "",
    active_neighborhoods: payload.active_neighborhoods,
    neighborhood_count: payload.active_neighborhoods.length,
    neighborhood_summary: neighborhoodRows
      .map(row => `${row.order}. ${row.name}: ${row.block_count} block${row.block_count === 1 ? "" : "s"}`)
      .join("\n"),
    neighborhood_mappings: payload.neighborhoods,
    neighborhood_rows: neighborhoodRows,
    unassigned_block_count: payload.unassigned_blocks.length,
    unassigned_blocks: payload.unassigned_blocks,
    invalid_state_count: payload.invalid_states.length,
    invalid_states: payload.invalid_states,
    response_json: payload
  };
}

function buildSpreadsheetCsvRow(payload) {
  const row = buildSpreadsheetRow(payload);
  const columns = [
    "respondent_id",
    "submitted_at",
    "relationship_to_wilkinsburg",
    "anchor_area",
    "years_connected",
    "final_feedback",
    "followup_email",
    "active_neighborhoods",
    "neighborhood_count",
    "neighborhood_summary",
    "neighborhood_mappings",
    "neighborhood_rows",
    "unassigned_block_count",
    "unassigned_blocks",
    "invalid_state_count",
    "invalid_states",
    "response_json"
  ];

  const values = columns.map(column => csvEscape(row[column]));

  return `${columns.join(",")}\n${values.join(",")}\n`;
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
  if (statusClearTimer) {
    window.clearTimeout(statusClearTimer);
    statusClearTimer = null;
  }

  el.status.textContent = message || "";
}

function setTemporaryStatus(message, duration = 3000) {
  setStatus(message);

  statusClearTimer = window.setTimeout(() => {
    el.status.textContent = "";
    statusClearTimer = null;
  }, duration);
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

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv" });
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

function csvEscape(value) {
  let text;

  if (Array.isArray(value) || (value && typeof value === "object")) {
    text = JSON.stringify(value);
  } else {
    text = String(value === undefined || value === null ? "" : value);
  }

  return `"${text.replace(/"/g, '""')}"`;
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
