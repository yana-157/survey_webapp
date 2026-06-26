# Full Boundary Survey Project Walkthrough

This document explains the current Wilkinsburg full-boundary survey app: what each main file does, how the user flow works, and how the map behavior is wired.

## Main Files

- `html/full-boundary-survey.html` is the source HTML for the standalone survey page.
- `src/full-boundary-survey.js` is the source JavaScript for map loading, drawing, validation, saving, review, and submission.
- `sass/full-boundary-survey.scss` is the source styling for the responsive survey panel and map controls.
- `docs/full-boundary-survey.html`, `docs/full-boundary-survey.js`, and `docs/full-boundary-survey.css` are generated build outputs.
- `html/full-boundary-survey.js` and `html/full-boundary-survey.css` are generated local-preview copies.
- `assets/wilkinsburg_graph.json` stores the block adjacency graph used to validate connected neighborhoods.
- `assets/wilkinsburg.json` stores the Mapbox tileset/source specification.
- `R/make_tileset.R` documents how the Wilkinsburg blocks, graph, and tileset are generated.
- `gulpfile.babel.js` copies and compiles the standalone files into `docs/` and `html/`.

Do source edits in `html/full-boundary-survey.html`, `src/full-boundary-survey.js`, and `sass/full-boundary-survey.scss`, then run `npm run build`.

## User Flow

1. The user answers basic context questions.
2. The user chooses which neighborhood names to include.
3. The map is hidden until **Start drawing** is clicked.
4. The user draws one neighborhood at a time.
5. Paint/Erase controls live only on the map.
6. **Save & next** validates that the current neighborhood has at least one block and is connected.
7. After all neighborhoods, the user reaches **Validate your drawing**.
8. From validation, the user can choose any neighborhood and revise it.
9. During validation revision, painting over another neighborhood moves that block into the currently selected neighborhood.
10. Final submission validates every selected neighborhood, every block assignment, and connectivity.

## HTML Structure

`#app` contains the whole interface.

`#panel` is the left/top survey panel. It contains:

- Header and reset button.
- `#context-section` for respondent context.
- `#neighborhood-setup-section` for choosing and adding neighborhood names.
- `#draw-section` for drawing the current neighborhood, including an expandable neighborhood list.
- `#review-section` for validation and neighborhood revision.
- `#final-section` for submission status and JSON backup.

`#map-wrap` is the map area. It contains:

- `#map-expand-btn`, the mobile map drawer toggle.
- `#map-search`, the landmark/address search overlay.
- `#map-mode-controls`, the map-only Paint/Erase controls.
- `#border-toggle-row`, the Show borders checkbox.
- `#map`, the Mapbox map container.
- `#map-legend`, the dynamic neighborhood color legend.

## JavaScript State

Important constants:

- `SPECIFICATION_URL` points to `./assets/wilkinsburg.json`.
- `GRAPH_URL` points to `./assets/wilkinsburg_graph.json`.
- `PUBLIC_MAPBOX_TOKEN` stores the public Mapbox token.
- `DEFAULT_NEIGHBORHOODS` defines the initial neighborhood names.
- `NEIGHBORHOOD_COLORS` assigns distinct colors to neighborhoods.
- `STORAGE_KEY` stores saved survey progress in `localStorage`.
- `RESPONDENT_ID_KEY` stores a stable respondent ID.

Important mutable state:

- `availableNeighborhoods` is every neighborhood option shown in setup.
- `activeNeighborhoods` is the subset the user selected.
- `hasStarted` controls whether setup or drawing is visible.
- `currentIndex` points to the current active neighborhood.
- `paintMode` is either `"paint"` or `"erase"`.
- `isRevisionMode` controls whether a validation edit is active.
- `selectedByNeighborhood` maps neighborhood names to selected block GEOID sets.
- `blockFeaturesById` caches Mapbox block geometries for border generation.
- `showBorders` controls whether thick border layers are visible.
- `searchMarker` stores the current landmark search marker.

The `el` object caches all DOM nodes used by the script. This keeps the rest of the code from repeatedly calling `document.getElementById(...)`.

## Startup

`init()` runs immediately.

It:

1. Redirects `file://` previews to `http://localhost:3000/full-boundary-survey.html`.
2. Initializes default state objects.
3. Loads saved progress from `localStorage`.
4. Wires button, form, resize, and map UI events.
5. Renders the neighborhood setup.
6. Applies the correct setup/drawing visibility.
7. Loads the Mapbox token.
8. Fetches `wilkinsburg.json` and `wilkinsburg_graph.json`.
9. Normalizes the loaded data.
10. Creates the Mapbox map.
11. Restores the current drawing step if the survey had already started.

## Map Setup

`createMap()` builds the Mapbox map using the Wilkinsburg bounds and `outdoors-v11` style.

The app adds:

- A block fill layer for selected/unselected colors.
- A thin block line layer for base block outlines.
- A thicker selected-neighborhood line layer drawn directly from the same Mapbox block source.
- A standard Mapbox navigation control for zooming and rotation.

The app previously tried to rebuild neighborhood outlines from cached vector-tile geometry. That was removed because tile fragments can create messy visual borders. The current version uses stable Mapbox filters and paint expressions instead.

## Drawing Behavior

The app uses exact pointer hit-testing.

- Click paints or erases the block directly under the pointer.
- Dragging keeps the painting logic active, but still only changes a block when the pointer is actually over that block.
- The earlier fuzzy-radius brush was removed.

`applyPaintToFeatures(features)` is the core edit function.

It:

1. Blocks drawing until the survey has started.
2. Finds the current neighborhood.
3. Reads the block GEOID from the Mapbox feature.
4. In normal drawing, refuses to edit blocks already owned by another neighborhood.
5. In validation revision mode, allows painting over another neighborhood, moving that block into the current one.
6. Applies Paint or Erase.
7. Repaints block colors.
8. Renders borders.
9. Updates the panel step.
10. Saves progress.

## Clear Behavior

The **Clear this neighborhood** button clears the current neighborhood set:

```js
selectedByNeighborhood[name].clear();
```

Then it calls:

- `repaintBlocks()` to update fill colors immediately.
- `renderBorders()` to remove that neighborhood's thick outline.
- `renderStep()` to refresh labels.
- `saveProgress()` to persist the cleared state.

The clear confirmation is temporary. `setTemporaryStatus("Cleared ...", 3000)` shows the message for about three seconds, then removes it unless another status message has replaced it.

`repaintBlocks()` has a special empty-selection path. If no selected blocks remain anywhere, it sets the fill layer back to constant white/unselected styling instead of leaving Mapbox with an invalid or stale expression.

## Block Colors

`repaintBlocks()` builds Mapbox paint expressions from `selectedByNeighborhood`.

- Current neighborhood blocks are more opaque.
- Other selected neighborhoods are lower opacity.
- Unassigned blocks are white and faint.
- If there are no selected blocks, the fill layer is reset directly to white with low opacity.

`colorForNeighborhood(name)` chooses a stable color from `NEIGHBORHOOD_COLORS`.

## Borders

The app draws borders from generated GeoJSON assets:

- `assets/wilkinsburg_borough_boundary.geojson` stores the dissolved outside boundary of Wilkinsburg.
- `assets/wilkinsburg_boundary_edges.geojson` stores side-aware block boundary edges. Each edge has an `a` block ID and either a neighboring `b` block ID or no `b` value for the outside borough edge.
- Tiny borough-boundary fragments are ignored at draw time so they do not appear as stray black marks on the map.
- Very short boundary-edge fragments are also filtered out before drawing selected-neighborhood outlines.

`renderBorders()` uses those assets like this:

- The borough layer always uses the dissolved Wilkinsburg boundary.
- A selected neighborhood draws only edges where one side is selected and the other side is not selected.
- Shared edges between two blocks in the same selected neighborhood are skipped, so the map shows the neighborhood outline instead of every internal block line.

`#border-toggle` controls `showBorders`.

`updateBorderVisibility()` switches the borough and selected-neighborhood border layers between `visible` and `none`.

## Landmark Search

`#map-search-toggle` opens and closes the compact landmark search panel. `#map-search` submits to `searchLandmark(event)`.

Search behavior:

1. Reads the typed landmark/address.
2. Biases the Mapbox Geocoding request to Wilkinsburg.
3. Uses the Wilkinsburg bounding box and proximity center.
4. Places a marker on the first result.
5. Opens a popup with the returned place name. The popup close button is disabled so the X does not overlap the name.
6. Flies the map to the result.

If no result is found, `#map-search-status` reports that. Once a marker exists, `#map-search-clear-btn` appears and removes the marker plus the status text.

## Connectivity Validation

Connectivity uses `assets/wilkinsburg_graph.json`, which maps each block GEOID to neighboring block GEOIDs.

`isConnectedBlockSet(blockSet)` returns true if the selected block set has zero or one connected component.

`countConnectedComponents(blockSet)` performs a graph traversal:

1. Convert all block IDs to strings.
2. Keep a set of unvisited selected blocks.
3. Start a stack from one unvisited block.
4. Walk through graph neighbors that are also selected.
5. Count how many separate traversals are needed.

`validateCurrentNeighborhoodBeforeMovingOn()` runs when **Save & next** is clicked.

It prevents moving on if:

- The current neighborhood has no blocks.
- The current neighborhood has multiple disconnected groups.
- There are too few unassigned blocks left to give every remaining selected neighborhood at least one block.

When disconnected, `showDisconnectedNeighborhoodAlert(...)` gives detailed feedback, such as how many separate groups and selected blocks the neighborhood has.

Final submit repeats the connectivity check as a backup.

## Review And Revision

`showReview()` displays **Validate your drawing**.

It:

- Hides drawing controls in the panel.
- Hides the map Paint/Erase controls until the user chooses to revise.
- Renders a neighborhood dropdown.
- Renders one review row per neighborhood.
- Shows whether each neighborhood is connected.
- Final submission describes empty, unassigned, or disconnected states and lets the user either correct them or submit anyway.

`reviseSelectedNeighborhood()` reads the dropdown and calls `startRevisionForNeighborhood(index)`.

During revision:

- The panel shows **Revise [neighborhood]** in the expandable neighborhood selector.
- **Back** names the previous neighborhood while drawing, is hidden on the first neighborhood, and becomes **Back to validation** during revision.
- **Save & next** becomes **Done revising**.
- Painting over a block from another neighborhood moves it into the selected neighborhood.

## Saving And Submission

`saveProgress()` stores:

- Respondent ID.
- Current neighborhood index.
- Available neighborhoods.
- Active neighborhoods.
- Whether drawing has started.
- Border visibility preference.
- All selected blocks by neighborhood.
- Context question answers.

`loadSavedProgress()` restores that state on reload.

`buildPayload()` creates the final JSON response:

- `respondent_id`
- `created_at`
- `active_neighborhoods`
- `neighborhoods`
- `unassigned_blocks`
- `metadata`

`submitFinalResponse()` validates the full response. If Supabase URL/key are provided in the URL hash, it inserts into `full_boundary_responses`. Otherwise it leaves the JSON available for download.

## Styling And Responsive Layout

The SCSS builds a restrained, form-focused interface.

Desktop:

- The survey panel is fixed-width on the left.
- The map fills the remaining space.
- Map search, Paint/Erase, border toggle, and legend float over the map.

Mobile:

- The panel becomes full-screen.
- The map becomes a bottom drawer after drawing starts.
- The drawer can expand to full screen.
- The legend is hidden until the drawer is expanded.
- The search form and border toggle reposition to fit smaller screens.

The font stack is intentionally common:

```css
font-family: Arial, Helvetica, sans-serif;
```

## Build System

`npm run build` runs `gulp build`.

The build:

- Cleans `docs/`.
- Copies `src/full-boundary-survey.js` to `docs/` and `html/`.
- Compiles `sass/full-boundary-survey.scss` to `docs/full-boundary-survey.css` and `html/full-boundary-survey.css`.
- Copies `html/full-boundary-survey.html` to `docs/`.
- Copies assets into `docs/assets`.

Use `http://localhost:3000/full-boundary-survey.html` for the reliable preview. The app redirects local `file://` previews to that URL.

## Current Feature Checklist

- Public Mapbox token is prefilled in source.
- Neighborhood names render before map assets finish loading.
- Map stays hidden until drawing starts.
- Paint, Erase, and Clear controls are available on the map.
- Drag painting selects only contacted blocks.
- Selected neighborhoods use different map colors.
- Block count is hidden from the respondent during drawing.
- Each context question is visually separated.
- The layout is responsive for desktop and mobile.
- The map can expand on mobile.
- Users can validate and revise after drawing.
- Users can move blocks between neighborhoods during validation revision.
- Disconnected neighborhoods are explained when the user tries to continue.
- Wilkinsburg and selected-neighborhood outer borders can be shown/hidden.
- Compact landmark search can zoom to a searched place and clear its marker.
- The map uses Mapbox's standard compact navigation controls.
