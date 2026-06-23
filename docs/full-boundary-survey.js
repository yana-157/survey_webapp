"use strict";

/*
  Wilkinsburg full-boundary survey app.

  This app uses the existing Wilkinsburg Mapbox tileset/spec files:
  - docs/assets/wilkinsburg.json
  - docs/assets/wilkinsburg_graph.json

  It does not use the original address-gated MapDraw workflow.
  Instead, respondents assign blocks to fixed neighborhood names.
*/

const SPECIFICATION_URL = "./assets/wilkinsburg.json";
const GRAPH_URL = "./assets/wilkinsburg_graph.json";

const NEIGHBORHOODS = [
  "Hamnett",
  "Hunter Park",
  "South Wilkinsburg",
  "Downtown / Borough Center",
  "Turner",
  "Blackridge",
  "Singer Place",
  "Pennwood"
];

// Edit this list later if your supervisor wants different neighborhood names.

const STORAGE_KEY = "wilkinsburg_full_boundary_survey_v1";

let map = null;
let spec = null;
let graph = null;

let sourceId = "wlb-blocks";
let fillLayerId = "wlb-block-fill";
let lineLayerId = "wlb-block-line";
let sourceLayer = "blocks";

let currentIndex = 0;
let paintMode = "paint";
let isPointerDown = false;

let selectedByNeighborhood = {};
let skippedNeighborhoods = {};
let featureStateIdsByGeoid = {};
let respondentId = getOrCreateRespondentId();

const el = {
  relationship: document.getElementById("relationship"),
  anchorArea: document.getElementById("anchor-area"),
  yearsConnected: document.getElementById("years-connected"),

  contextSection: document.getElementById("context-section"),
  drawSection: document.getElementById("draw-section"),
  reviewSection: document.getElementById("review-section"),
  finalSection: document.getElementById("final-section"),

  stepLabel: document.getElementById("step-label"),
  blockCountLabel: document.getElementById("block-count-label"),
  progressFill: document.getElementById("progress-fill"),
  neighborhoodTitle: document.getElementById("neighborhood-title"),
  status: document.getElementById("status"),

  paintMode: document.getElementById("paint-mode"),
  eraseMode: document.getElementById("erase-mode"),
  backBtn: document.getElementById("back-btn"),
  clearCurrentBtn: document.getElementById("clear-current-btn"),
  skipBtn: document.getElementById("skip-btn"),
  saveNextBtn: document.getElementById("save-next-btn"),

  reviewList: document.getElementById("review-list"),
  finishBtn: document.getElementById("finish-btn"),

  submitStatus: document.getElementById("submit-status"),
  finalJson: document.getElementById("final-json"),
  downloadJsonBtn: document.getElementById("download-json-btn")
};

init();

async function init() {
  initializeStateObjects();
  loadSavedProgress();
  wireUiEvents();

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
    graph = loadedGraph;
    sourceLayer = spec.units.tileset.sourceLayer;

    createMap();
    renderStep();
  } catch (err) {
    console.error(err);
    setStatus(err.message);
  }
}

function getMapboxToken() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const tokenFromHash = params.get("mapbox_token");

  if (tokenFromHash && tokenFromHash.trim()) {
    return tokenFromHash.trim();
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

    map.fitBounds(bounds, { padding: 30 });
    map.setMaxBounds(expandBounds(bounds, 0.01));
    map.setMinZoom(12);

    wireMapEvents();
    repaintBlocks();
  });

  map.on("moveend", repaintBlocks);
  map.on("sourcedata", repaintBlocks);
}

function expandBounds(bounds, amount) {
  return [
    [bounds[0][0] - amount, bounds[0][1] - amount],
    [bounds[1][0] + amount, bounds[1][1] + amount]
  ];
}

function wireMapEvents() {
  map.on("click", fillLayerId, e => {
    const feature = e.features && e.features[0];
    if (!feature) return;
    applyPaintToFeature(feature);
  });

  map.on("mousedown", fillLayerId, e => {
    isPointerDown = true;
    map.dragPan.disable();
    const feature = e.features && e.features[0];
    if (feature) applyPaintToFeature(feature);
  });

  map.on("mousemove", fillLayerId, e => {
    map.getCanvas().style.cursor = "pointer";

    if (e.features && e.features[0]) {
      rememberFeature(e.features[0]);
      setHoverFeature(e.features[0], true);
    }

    if (!isPointerDown) return;

    const feature = e.features && e.features[0];
    if (feature) applyPaintToFeature(feature);
  });

  map.on("mouseleave", fillLayerId, () => {
    map.getCanvas().style.cursor = "";
  });

  window.addEventListener("mouseup", () => {
    isPointerDown = false;
    if (map) map.dragPan.enable();
  });

  map.on("touchstart", fillLayerId, e => {
    const feature = e.features && e.features[0];
    if (feature) applyPaintToFeature(feature);
  });

  map.on("touchmove", fillLayerId, e => {
    if (!e.points || !e.points[0]) return;
    const features = map.queryRenderedFeatures(e.points[0], { layers: [fillLayerId] });
    if (features && features[0]) applyPaintToFeature(features[0]);
  });
}

let hoveredStateId = null;

function setHoverFeature(feature, isHover) {
  const stateId = getStateId(feature);
  if (!stateId) return;

  if (hoveredStateId && hoveredStateId !== stateId) {
    safeSetFeatureState(hoveredStateId, { hover: false });
  }

  hoveredStateId = stateId;
  safeSetFeatureState(stateId, { hover: isHover });
}

function applyPaintToFeature(feature) {
  const name = currentNeighborhoodName();
  const geoid = getGeoid(feature);
  if (!geoid) return;

  const otherOwner = ownerOfBlock(geoid, name);
  if (otherOwner) {
    setStatus(`That block is already assigned to ${otherOwner}. Edit ${otherOwner} first if you want to move it.`);
    return;
  }

  skippedNeighborhoods[name] = false;

  if (paintMode === "paint") {
    selectedByNeighborhood[name].add(geoid);
  } else {
    selectedByNeighborhood[name].delete(geoid);
  }

  repaintBlocks();
  renderStep();
  saveProgress();
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

function getStateId(feature) {
  if (feature.id !== undefined && feature.id !== null) {
    return feature.id;
  }
  if (feature.properties && feature.properties.GEOID !== undefined) {
    return feature.properties.GEOID;
  }
  return null;
}

function rememberFeature(feature) {
  const geoid = getGeoid(feature);
  const stateId = getStateId(feature);
  if (geoid && stateId !== undefined && stateId !== null) {
    featureStateIdsByGeoid[geoid] = stateId;
  }
}

function updateFeatureStateForGeoid(geoid) {
  const stateId = featureStateIdsByGeoid[geoid];
  if (stateId === undefined || stateId === null) return;

  const current = currentNeighborhoodName();
  const isCurrent = selectedByNeighborhood[current].has(geoid);
  const isLocked = !!ownerOfBlock(geoid, current);

  safeSetFeatureState(stateId, {
    current: isCurrent,
    locked: isLocked
  });
}

function repaintBlocks() {
  if (!map || !map.isStyleLoaded()) return;
  if (!map.getLayer(fillLayerId)) return;

  const features = map.queryRenderedFeatures({ layers: [fillLayerId] });
  for (const feature of features) {
    rememberFeature(feature);
    const geoid = getGeoid(feature);
    if (geoid) updateFeatureStateForGeoid(geoid);
  }
}

function safeSetFeatureState(stateId, state) {
  try {
    map.setFeatureState(
      {
        source: sourceId,
        sourceLayer: sourceLayer,
        id: stateId
      },
      state
    );
  } catch (err) {
    // Some vector tile features may not support state until source is fully ready.
    console.warn("Could not set feature state", stateId, err);
  }
}

function ownerOfBlock(geoid, exceptNeighborhood = null) {
  for (const name of NEIGHBORHOODS) {
    if (name === exceptNeighborhood) continue;
    if (selectedByNeighborhood[name].has(geoid)) return name;
  }
  return null;
}

function currentNeighborhoodName() {
  return NEIGHBORHOODS[currentIndex];
}

function initializeStateObjects() {
  for (const name of NEIGHBORHOODS) {
    selectedByNeighborhood[name] = new Set();
    skippedNeighborhoods[name] = false;
  }
}

function wireUiEvents() {
  el.paintMode.addEventListener("click", () => {
    paintMode = "paint";
    el.paintMode.classList.add("active");
    el.eraseMode.classList.remove("active");
  });

  el.eraseMode.addEventListener("click", () => {
    paintMode = "erase";
    el.eraseMode.classList.add("active");
    el.paintMode.classList.remove("active");
  });

  el.backBtn.addEventListener("click", () => {
    if (currentIndex > 0) {
      currentIndex--;
      renderStep();
      repaintBlocks();
      saveProgress();
    }
  });

  el.clearCurrentBtn.addEventListener("click", () => {
    const name = currentNeighborhoodName();
    selectedByNeighborhood[name].clear();
    skippedNeighborhoods[name] = false;
    setStatus(`Cleared ${name}.`);
    repaintBlocks();
    renderStep();
    saveProgress();
  });

  el.skipBtn.addEventListener("click", () => {
    const name = currentNeighborhoodName();
    selectedByNeighborhood[name].clear();
    skippedNeighborhoods[name] = true;
    setStatus(`Skipped ${name}.`);
    goNext();
  });

  el.saveNextBtn.addEventListener("click", () => {
    const name = currentNeighborhoodName();
    if (selectedByNeighborhood[name].size === 0 && !skippedNeighborhoods[name]) {
      setStatus("Select at least one block, or choose “I don’t know this one.”");
      return;
    }
    goNext();
  });

  el.finishBtn.addEventListener("click", submitFinalResponse);

  el.downloadJsonBtn.addEventListener("click", () => {
    downloadJson(buildPayload(), "wilkinsburg-boundary-response.json");
  });

  for (const input of [el.relationship, el.anchorArea, el.yearsConnected]) {
    input.addEventListener("change", saveProgress);
    input.addEventListener("input", saveProgress);
  }
}

function goNext() {
  setStatus("");

  if (currentIndex < NEIGHBORHOODS.length - 1) {
    currentIndex++;
    renderStep();
    repaintBlocks();
    saveProgress();
  } else {
    showReview();
  }
}

function renderStep() {
  const name = currentNeighborhoodName();
  const count = selectedByNeighborhood[name].size;

  el.drawSection.hidden = false;
  el.reviewSection.hidden = true;
  el.finalSection.hidden = true;

  el.stepLabel.textContent = `Neighborhood ${currentIndex + 1} of ${NEIGHBORHOODS.length}`;
  el.blockCountLabel.textContent = `${count} block${count === 1 ? "" : "s"} selected`;
  el.neighborhoodTitle.textContent = `Draw ${name}`;
  el.progressFill.style.width = `${((currentIndex + 1) / NEIGHBORHOODS.length) * 100}%`;

  el.backBtn.disabled = currentIndex === 0;

  if (skippedNeighborhoods[name]) {
    setStatus(`${name} is currently marked as skipped. Tap blocks to unskip it.`);
  } else if (!el.status.textContent) {
    setStatus("");
  }
}

function showReview() {
  el.drawSection.hidden = true;
  el.reviewSection.hidden = false;
  el.finalSection.hidden = true;
  setStatus("");

  el.reviewList.innerHTML = "";

  for (const [index, name] of NEIGHBORHOODS.entries()) {
    const item = document.createElement("div");
    item.className = "review-item";

    const count = selectedByNeighborhood[name].size;
    const skipped = skippedNeighborhoods[name];

    item.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <small>${skipped ? "Skipped" : `${count} selected block${count === 1 ? "" : "s"}`}</small>
    `;

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = `Edit ${name}`;
    edit.addEventListener("click", () => {
      currentIndex = index;
      renderStep();
      repaintBlocks();
      saveProgress();
    });

    item.appendChild(edit);
    el.reviewList.appendChild(item);
  }

  saveProgress();
}

async function submitFinalResponse() {
  const payload = buildPayload();
  const json = JSON.stringify(payload, null, 2);

  el.reviewSection.hidden = true;
  el.finalSection.hidden = false;
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
  for (const name of NEIGHBORHOODS) {
    neighborhoods[name] = Array.from(selectedByNeighborhood[name]);
  }

  return {
    respondent_id: respondentId,
    created_at: new Date().toISOString(),
    neighborhoods: neighborhoods,
    skipped: NEIGHBORHOODS.filter(name => skippedNeighborhoods[name]),
    metadata: {
      relationship_to_wilkinsburg: el.relationship.value,
      anchor_area: el.anchorArea.value,
      years_connected: el.yearsConnected.value
    }
  };
}

function saveProgress() {
  const neighborhoods = {};
  for (const name of NEIGHBORHOODS) {
    neighborhoods[name] = Array.from(selectedByNeighborhood[name]);
  }

  const payload = {
    respondentId,
    currentIndex,
    neighborhoods,
    skippedNeighborhoods,
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
    currentIndex = Number(saved.currentIndex || 0);

    for (const name of NEIGHBORHOODS) {
      const arr = saved.neighborhoods && saved.neighborhoods[name] ? saved.neighborhoods[name] : [];
      selectedByNeighborhood[name] = new Set(arr);
      skippedNeighborhoods[name] = !!(saved.skippedNeighborhoods && saved.skippedNeighborhoods[name]);
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
  const key = "wilkinsburg_boundary_respondent_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    localStorage.setItem(key, id);
  }
  return id;
}

function setStatus(message) {
  el.status.textContent = message || "";
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

function repaintBlocks() {
  if (!map || !map.getLayer(fillLayerId)) return;

  const current = currentNeighborhoodName();
  const currentBlocks = Array.from(selectedByNeighborhood[current]);

  const lockedBlocks = [];
  for (const name of NEIGHBORHOODS) {
    if (name === current) continue;
    for (const geoid of selectedByNeighborhood[name]) {
      lockedBlocks.push(geoid);
    }
  }

  map.setPaintProperty(fillLayerId, "fill-color", [
    "case",
    ["in", ["to-string", ["get", "GEOID"]], ["literal", currentBlocks]], "#1f5fbf",
    ["in", ["to-string", ["get", "GEOID"]], ["literal", lockedBlocks]], "#8b8b8b",
    "#ffffff"
  ]);

  map.setPaintProperty(fillLayerId, "fill-opacity", [
    "case",
    ["in", ["to-string", ["get", "GEOID"]], ["literal", currentBlocks]], 0.72,
    ["in", ["to-string", ["get", "GEOID"]], ["literal", lockedBlocks]], 0.50,
    0.08
  ]);
}