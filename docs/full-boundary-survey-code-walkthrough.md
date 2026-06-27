# Full Boundary Survey Project Walkthrough

This document explains the current Wilkinsburg Neighborhood Boundary Survey app: what each main file does, how the user flow works, how the map is drawn, how responses are saved, and where to edit things safely.

The short version: the respondent moves through neighborhoods in order, paints blocks on a map, validates the drawing, optionally revises neighborhoods, submits the map, and can then leave feedback or an email for future surveys.

## Main Files

- `html/full-boundary-survey.html` is the source HTML for the standalone survey page.
- `src/full-boundary-survey.js` is the source JavaScript for loading data, drawing on the map, validating neighborhoods, saving progress, submitting responses, and saving post-submission feedback.
- `sass/full-boundary-survey.scss` is the source styling for the panel, map, controls, mobile drawer, dialogs, and responsive layout.
- `assets/` contains source data used by the app.
- `docs/` is the GitHub Pages build output. Do not hand-edit generated files in `docs/` unless you are intentionally patching a deployed artifact.
- `html/full-boundary-survey.js` and `html/full-boundary-survey.css` are generated local-preview copies.
- `gulpfile.babel.js` controls the build process.
- `.gitattributes` is a git metadata file from the earlier vector-tile version. The current editable block source is GeoJSON.

Make normal code changes in:

- `html/full-boundary-survey.html`
- `src/full-boundary-survey.js`
- `sass/full-boundary-survey.scss`
- `assets/...`

Then run:

```bash
npm run build
```

That rebuilds `docs/` for GitHub Pages and `html/` for local preview.

## Data Files

- `assets/wilkinsburg.json` tells the app where the Wilkinsburg block vector tiles are and what bounds to use.
- `assets/wilkinsburg_blocks_base.geojson` contains the clean committed block source used for rebuilding the survey block file.
- `assets/wilkinsburg_blocks_clipped.geojson` contains the exact clipped selectable block polygons.
- `assets/wilkinsburg_osm_boundary.geojson` contains the clean OpenStreetMap Wilkinsburg boundary polygon.
- `assets/wilkinsburg_survey_boundary.geojson` contains the survey boundary copied from the OSM polygon. This is the boundary used for clipping, display, verification, and hit-testing.
- `assets/wilkinsburg_selectable_boundary.geojson` contains a derived outline generated from the exact selectable block polygons.
- `assets/wilkinsburg_graph.json` contains the clipped block adjacency graph used to check whether each neighborhood is connected.
- `assets/wilkinsburg_boundary_edges.geojson` contains side-aware block-boundary edges used for selected-neighborhood outlines.
- `assets/survey-config.js` is where the public Supabase URL and anon key can be added for deployed response collection.
- `docs/supabase-response-spreadsheet.sql` contains the Supabase setup SQL.
- `docs/DEPLOYMENT.md` explains deployment and Supabase setup.
- `scripts/build-wilkinsburg-survey-boundary.mjs` rebuilds the survey boundary polygon from the visible map-outline file.
- `scripts/clip-wilkinsburg-blocks-to-survey-boundary.mjs` physically slices every selectable block against the survey boundary polygon.
- `scripts/clean-wilkinsburg-road-artifacts.mjs` merges zero-population road-like artifacts into nearby real blocks.
- `scripts/fill-wilkinsburg-internal-gaps.mjs` assigns internal road/gap space back into neighboring blocks so unpaintable gaps do not sit inside the visible boundary.
- `scripts/split-wilkinsburg-disconnected-block-parts.mjs` splits any disconnected MultiPolygon pieces into separate paintable units so clicking one island does not paint another.
- `scripts/generate-wilkinsburg-graph.mjs` rebuilds the adjacency graph from the current selectable block polygons.
- `scripts/generate-wilkinsburg-selectable-boundary.mjs` rebuilds the visible map boundary from the exact selectable block polygons.
- `scripts/generate-wilkinsburg-boundary-edges.mjs` rebuilds selected-neighborhood outline edges from the current clipped block polygons.
- `scripts/verify-wilkinsburg-boundary.sh` checks that every selectable block geometry is covered by the survey boundary.

The block polygons are physically clipped to the Wilkinsburg survey boundary. That means blocks stop at the visible borough border instead of spilling outside the drawn shape. The old MBTiles source covers a larger area than Wilkinsburg, so the live survey uses local clipped GeoJSON instead of the original tileset.

After clipping, zero-population road-like artifacts are merged into touching blocks so respondents do not have to paint roads as their own neighborhoods. A final boundary clip keeps every selectable block covered by the survey polygon.

The visible boundary line uses `wilkinsburg_selectable_boundary.geojson`, which is generated from the exact paintable block union. The invisible hit-test layer still uses `wilkinsburg_survey_boundary.geojson`, so paint and erase are ignored unless the pointer is inside the survey boundary.

## Current User Flow

1. The user answers basic context questions.
2. The user chooses which neighborhood names to include.
3. The map stays hidden until **Start drawing** is clicked.
4. The user draws one neighborhood at a time in the selected order.
5. The Paint, Erase, and Clear controls live on the map.
6. **Save & next** checks the current neighborhood before moving forward.
7. If the current neighborhood has an issue, an internal app dialog explains the issue and lets the user keep fixing or continue anyway.
8. After all neighborhoods, the user reaches the validation screen.
9. The validation screen lists each neighborhood with a status.
10. The user can choose a neighborhood from the validation dropdown and revise it.
11. During revision, painting over a block from another neighborhood moves that block into the revised neighborhood.
12. After revising one neighborhood, the user returns to validation before choosing another one.
13. Final submission checks for remaining issues.
14. If issues remain, the app gives a summary and lets the user correct them or submit anyway.
15. After final submission, the feedback and optional email fields appear.
16. Feedback/email save back to the same respondent ID as the final map.

## HTML Structure

`#app` contains the whole interface.

`#panel` is the survey panel. On desktop it sits on the left. On smaller screens it becomes the main full-width panel.

Important panel sections:

- `#intro` shows the opening copy.
- `#context-section` contains relationship, known-area, years-connected, and homeowner-years questions.
- `#neighborhood-setup-section` lets the user choose, add, or remove neighborhood names before drawing.
- `#draw-section` shows the current neighborhood, progress, Back, and Save & next.
- `#review-section` shows validation statuses and the revision dropdown.
- `#final-section` shows submission status, feedback, optional email, and backup download controls.

`#map-wrap` contains the map experience:

- `#map-expand-btn` expands/collapses the mobile map drawer.
- `#map-search-toggle` opens the landmark search panel.
- `#map-search` contains the search input, Search button, Clear button, and search status.
- `#map-mode-controls` contains Paint, Erase, and Clear.
- `#map-neighborhood-picker` is the compact bottom dropdown-style current-neighborhood control.
- `#map-neighborhood-list` opens from the compact picker and shows neighborhood names, swatches, current state, and completed checks.
- `#border-toggle-row` shows/hides borough and neighborhood borders.
- `#map` is the actual Mapbox GL container.

There is no large bottom legend anymore. The compact bottom picker is the only map neighborhood display.

`#app-dialog-backdrop` and `#app-dialog` create internal app popups. The app avoids native `alert()` or `confirm()` dialogs for validation/submission decisions.

## JavaScript Constants

Important source URLs:

- `SPECIFICATION_URL` points to `./assets/wilkinsburg.json`.
- `GRAPH_URL` points to `./assets/wilkinsburg_graph.json`.
- `BOUNDARY_EDGE_URL` points to `./assets/wilkinsburg_boundary_edges.geojson`.
- `BOROUGH_BOUNDARY_URL` points to `./assets/wilkinsburg_survey_boundary.geojson`.

Map constants:

- `BASEMAP_STYLE` defines a token-free CARTO/OpenStreetMap raster basemap.
- `PUBLIC_MAPBOX_TOKEN` is still available for Mapbox GL and landmark search.
- `MIN_BORDER_SEGMENT_LENGTH` filters tiny edge fragments out of selected-neighborhood outlines.

Neighborhood constants:

- `DEFAULT_NEIGHBORHOODS` defines the starting neighborhood list.
- `MAX_CUSTOM_NEIGHBORHOODS` caps added neighborhoods at 10.
- `NEIGHBORHOOD_COLORS` contains the color palette used for neighborhoods.

Storage constants:

- `STORAGE_KEY` stores saved survey progress in `localStorage`.
- `RESPONDENT_ID_KEY` stores the stable respondent ID.
- `RESPONDENT_WRITE_TOKEN_KEY` stores a per-browser write token used when updating the same Supabase response row after final submission.

## JavaScript State

- `availableNeighborhoods` is every neighborhood option shown during setup.
- `activeNeighborhoods` is the selected ordered list used for drawing.
- `hasStarted` tracks whether drawing has begun.
- `map` stores the Mapbox GL map instance.
- `spec` stores normalized map/tile metadata from `wilkinsburg.json`.
- `graph` stores the clipped adjacency graph.
- `currentIndex` points to the current neighborhood.
- `paintMode` is `"paint"` or `"erase"`.
- `isRevisionMode` tracks whether the user is revising from validation.
- `isPointerDown` tracks drag painting.
- `selectedByNeighborhood` maps each neighborhood name to a `Set` of selected block GEOIDs.
- `boundaryEdges` stores the side-aware edge data.
- `boroughBoundaryFeatures` stores the official boundary feature used for the borough outline.
- `searchMarker` stores the current landmark marker.
- `landmarkSearchOpen` tracks whether the search panel is open.
- `neighborhoodListOpen` tracks whether the compact bottom neighborhood list is open.
- `showBorders` tracks whether border layers are visible.
- `respondentId` and `respondentWriteToken` identify and protect a user's saved response.

The `el` object caches DOM elements. This keeps the rest of the file readable because code can use `el.mapSearchToggle` instead of repeatedly calling `document.getElementById("map-search-toggle")`.

## Startup

`init()` runs immediately.

It does this:

1. Redirects `file://` previews to `http://localhost:3000/full-boundary-survey.html`.
2. Initializes state objects.
3. Loads saved progress from `localStorage`.
4. Wires UI events.
5. Renders setup controls.
6. Applies setup/drawing visibility.
7. Gets the Mapbox token.
8. Fetches the map spec, graph, boundary edges, and official borough boundary.
9. Normalizes all loaded data.
10. Prunes saved selections that are no longer in the current clipped block graph.
11. Creates the map.
12. Restores the current drawing step if progress was already started.

## Map Setup

`createMap()` builds the map.

The map uses:

- CARTO/OpenStreetMap raster tiles as the basemap.
- Local clipped Wilkinsburg GeoJSON from `assets/wilkinsburg_blocks_clipped.geojson` as the block source.
- `assets/wilkinsburg_survey_boundary.geojson` as the borough outline and invisible selection guard.

The block source comes from `assets/wilkinsburg.json`:

```json
"data": "./assets/wilkinsburg_blocks_clipped.geojson?v=20260628-boundary-safe-9"
```

The source is GeoJSON instead of vector tiles. This avoids tile simplification and stale tile caching, both of which can otherwise make clipped blocks appear to cross the boundary. The `?v=...` query is still bumped when the clipped geometry changes so browsers fetch the newest GeoJSON.

Map layers:

- `fillLayerId` draws block fills. It changes color/opacity based on selected neighborhoods.
- `lineLayerId` draws thin base block lines.
- `boundaryHitLayerId` is a nearly transparent fill over the survey boundary. It is used only to reject clicks and drags outside the valid survey area.
- `boroughBorderLayerId` draws the visible border around the exact paintable block union.
- `neighborhoodBorderLayerId` draws darker outlines around selected neighborhoods.

Map controls:

- Mapbox's standard navigation control is placed at top-left.
- Search for Landmark sits near the top-left but offset so it does not cover the zoom buttons.
- Paint/Erase/Clear are centered at the top of the map.
- Borders and the compact neighborhood picker sit near the bottom.

## Clipped Blocks

The current block polygons are not just filtered by ID. They are geometrically clipped to the Wilkinsburg survey boundary before being loaded into the map.

That matters because:

- Blocks outside Wilkinsburg do not appear as selectable shapes.
- Blocks touching the border are cut at the border.
- The block mesh reaches the border without leaving unnecessary outside pieces.
- The graph and validation counts only include the clipped Wilkinsburg block set.

The survey-boundary-clipped graph has 350 block nodes after small slivers, roads, internal gaps, and disconnected polygon parts are cleaned up.

The map fill and line layers also use a defensive GEOID filter from the current clipped graph. That means even if a stale or unexpected tile contains extra block IDs, the app only renders blocks that belong to the current Wilkinsburg clipped graph.

If the boundary or block source ever changes, regenerate both:

- `node scripts/build-wilkinsburg-survey-boundary.mjs`
- `node scripts/clip-wilkinsburg-blocks-to-survey-boundary.mjs`
- `node scripts/generate-wilkinsburg-graph.mjs`
- `node scripts/generate-wilkinsburg-boundary-edges.mjs`
- `node scripts/clean-wilkinsburg-road-artifacts.mjs`
- `node scripts/fill-wilkinsburg-internal-gaps.mjs`
- `node scripts/split-wilkinsburg-disconnected-block-parts.mjs`
- `node scripts/generate-wilkinsburg-graph.mjs`
- `node scripts/generate-wilkinsburg-selectable-boundary.mjs`
- `node scripts/generate-wilkinsburg-boundary-edges.mjs`
- `bash scripts/verify-wilkinsburg-boundary.sh`

Then run `npm run build` so `docs/assets/` matches.

## Drawing Behavior

Drawing uses exact pointer hit-testing.

- Clicking paints or erases the single block under the pointer.
- Dragging keeps the painting logic active.
- Dragging only changes a block when the pointer actually contacts a block.
- The app does not use a fuzzy brush radius.

`applyPaintAtPoint(point)` asks Mapbox what feature is under the point, then passes that feature to `applyPaintToFeatures(features)`.

`applyPaintToFeatures(features)`:

1. Refuses drawing before the survey starts.
2. Finds the current neighborhood.
3. Reads the block GEOID.
4. Skips duplicate features during a single paint pass.
5. In normal drawing mode, refuses to overwrite blocks already assigned to another neighborhood.
6. In revision mode, allows painting over another neighborhood and moves that block into the current neighborhood.
7. Adds or removes the block depending on Paint or Erase.
8. Repaints fills.
9. Re-renders borders.
10. Refreshes the step UI.
11. Saves progress.

## Paint, Erase, And Clear

Paint mode adds contacted blocks to the current neighborhood.

Erase mode removes contacted blocks from the current neighborhood only.

Clear clears the whole current neighborhood:

```js
selectedByNeighborhood[name].clear();
```

Then the app calls:

- `repaintBlocks()`
- `renderBorders()`
- `renderStep()`
- `saveProgress()`

The clear status message is temporary and disappears after about three seconds.

## Block Colors

`repaintBlocks()` builds Mapbox paint expressions from `selectedByNeighborhood`.

- Current neighborhood blocks are more opaque.
- Other selected neighborhoods are lower opacity.
- Unassigned blocks are white/faint.
- If no blocks are selected anywhere, the fill expression resets to the unselected style.

`colorForNeighborhood(name)` picks a stable color from `NEIGHBORHOOD_COLORS`.

When custom neighborhoods are added, they use later colors from the same palette. The app allows up to 10 custom neighborhoods.

## Borders

There are two visual border systems:

1. The borough border.
2. The selected-neighborhood border.

The borough border comes from:

```text
assets/wilkinsburg_survey_boundary.geojson
```

The invisible hit-test boundary comes from:

```text
assets/wilkinsburg_survey_boundary.geojson
```

The old Pennsylvania municipal boundary and traced boundary files are still kept as source history, but the current survey uses `assets/wilkinsburg_osm_boundary.geojson` through `assets/wilkinsburg_survey_boundary.geojson`.

Selected-neighborhood outlines come from:

```text
assets/wilkinsburg_boundary_edges.geojson
```

`renderBorders()` starts with the borough boundary feature, then adds selected-neighborhood edge features. It only adds an edge when one side is selected and the other side is not selected. Shared edges inside the same selected neighborhood are skipped, so users see an outline around the selected area rather than every internal block line.

`#border-toggle` updates `showBorders`.

`updateBorderVisibility()` switches the border layers between `visible` and `none`.

## Compact Neighborhood Picker

The bottom map picker shows the current neighborhood with:

- A color swatch.
- The current neighborhood name.
- A small arrow.

When opened, `#map-neighborhood-list` shows:

- The current neighborhood highlighted.
- Not-yet-completed neighborhoods.
- Completed neighborhoods moved lower with a check mark.
- Color swatches for each neighborhood.

Outside the map, users are mostly forced through neighborhoods in order. The validation screen is where they can pick a neighborhood out of order to revise.

## Landmark Search

`#map-search-toggle` opens and closes the landmark search panel.

`searchLandmark(event)`:

1. Reads the search text.
2. Builds a Mapbox Geocoding request biased to the Wilkinsburg bounds.
3. Uses the first result.
4. Places a marker.
5. Opens a popup with the place name.
6. Flies the map to the result.
7. Shows the Clear button.

`clearSearchMarker()` removes the marker, hides the Clear button, and clears the status.

## Connectivity Validation

Connectivity uses `assets/wilkinsburg_graph.json`.

The graph maps each block GEOID to neighboring block GEOIDs. Since the current graph is clipped, validation only considers blocks inside the official Wilkinsburg boundary.

`isConnectedBlockSet(blockSet)` returns true if the selected blocks have zero or one connected component.

`countConnectedComponents(blockSet)`:

1. Converts selected IDs to strings.
2. Keeps an `unvisited` set.
3. Starts a stack from one unvisited block.
4. Walks through graph neighbors that are also selected.
5. Counts how many separate graph walks are needed.

`validateCurrentNeighborhoodBeforeMovingOn()` checks the current neighborhood when **Save & next** is clicked.

It flags:

- No blocks selected.
- Multiple disconnected groups.
- Too few remaining unassigned blocks to give every later neighborhood at least one block.

The popup is internal to the app, not a browser-native alert.

## Review And Revision

`showReview()` displays the validation screen.

It:

- Hides the drawing section.
- Shows the review section.
- Hides map mode controls until revision starts.
- Renders one validation row per neighborhood.
- Highlights neighborhoods with issues.
- Renders a dropdown for selecting one neighborhood to revise.

`reviewStatusForNeighborhood(name)` returns:

- `"Needs review"` when the neighborhood is empty or disconnected.
- `"Looks good"` when it has selected blocks and is connected.

`reviseSelectedNeighborhood()` reads the dropdown and starts revision for that neighborhood.

During revision:

- The panel shows `Revise [neighborhood]`.
- Back becomes `Back to validation`.
- Save & next becomes `Done revising`.
- Painting over another neighborhood can move blocks into the current revised neighborhood.
- After the revision, the user returns to validation to choose the next neighborhood.

## Final Submission Validation

`submitFinalResponse()` runs final checks.

If there are invalid states, the app shows a summary dialog. The final dialog is intentionally less detailed than the per-neighborhood popup. It tells the user that specific neighborhoods have issues and asks whether to correct them or submit anyway.

Invalid state categories include:

- Empty neighborhoods.
- Disconnected neighborhoods.
- Unassigned blocks.

The user can still submit anyway.

## Saving Progress

`saveProgress()` stores progress in `localStorage`.

It stores:

- Respondent ID.
- Current neighborhood index.
- Available neighborhoods.
- Active neighborhoods.
- Whether drawing started.
- Border visibility.
- Selected blocks by neighborhood.
- Context question answers.

`loadSavedProgress()` restores that state on reload.

After loading the clipped graph, `pruneSelectionsToCurrentBlocks()` removes any saved selections that no longer exist in the current clipped block set. This keeps older localStorage from causing weird counts after boundary/tile updates.

## Response Payload

`buildPayload()` creates the final JSON response.

It includes:

- `respondent_id`
- `created_at`
- `active_neighborhoods`
- `neighborhoods`
- `unassigned_blocks`
- `invalid_states`
- `metadata`

`buildSpreadsheetRow()` converts the payload into one spreadsheet-friendly row.

The row includes:

- Respondent ID.
- Submission timestamp.
- Context responses.
- Homeowner years, where `No` means the respondent is not a Wilkinsburg homeowner.
- Active neighborhood names.
- Neighborhood count.
- Human-readable neighborhood summary.
- Full neighborhood-to-block mapping.
- Unassigned block count and IDs.
- Invalid state count and details.
- Full JSON response.
- Optional feedback and email after submission.

## Supabase Collection

Supabase is set up in the repo, but a real Supabase project still needs its SQL and public config.

The app reads config from either:

1. URL hash params.
2. `window.WLB_SURVEY_CONFIG` in `assets/survey-config.js`.

`assets/survey-config.js` should look like this after setup:

```js
window.WLB_SURVEY_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY"
};
```

Only the anon public key belongs in the website. Do not put a service-role key in this repo.

The SQL file:

```text
docs/supabase-response-spreadsheet.sql
```

creates:

- `full_boundary_responses`
- `full_boundary_response_spreadsheet`
- `full_boundary_response_export`
- RPC function `submit_full_boundary_response(...)`
- RPC function `update_full_boundary_feedback(...)`

The app submits through RPC calls instead of direct public table inserts.

`submitToSupabase(payload, spreadsheetRow)` sends the final map and spreadsheet row.

`savePostSubmissionDetails()` sends feedback and optional email after final submission. It uses the same `respondent_id` and `respondentWriteToken`, so feedback/email update the same response row instead of creating a second respondent.

If Supabase is not configured, the app still lets the user download JSON and CSV backups.

## Generated Spreadsheet View

For exporting responses, use:

```sql
select * from public.full_boundary_response_export;
```

That view is intended to behave like a spreadsheet:

- One row per respondent.
- Indexed by respondent ID.
- Includes the full mapping and metadata.
- Includes post-submission feedback/email when provided.

## Styling And Responsive Layout

The SCSS creates a clean form-and-map interface.

Desktop:

- Survey panel is fixed-width on the left.
- Map fills the rest of the screen.
- Search is near the upper-left but offset from zoom controls.
- Paint/Erase/Clear are centered at the top of the map.
- Border toggle is near the bottom.
- Compact neighborhood picker is at the bottom.

Mobile:

- Panel becomes full-screen.
- Map appears as a bottom drawer after drawing starts.
- The drawer can expand to full screen.
- Map-only controls appear when the drawer is expanded.
- The compact picker remains the main neighborhood display.

The font is Roboto, with common fallbacks:

```css
font-family: "Roboto", Arial, Helvetica, sans-serif;
```

## Build System

`npm run build` runs `gulp build`.

The build:

- Cleans `docs/`.
- Copies `src/full-boundary-survey.js` to `docs/` and `html/`.
- Compiles `sass/full-boundary-survey.scss` to CSS.
- Copies `html/full-boundary-survey.html` to `docs/`.
- Copies `assets/` to `docs/assets/`.

Local preview:

```bash
cd /Users/yana/survey_webapp
python3 -m http.server 3000 --directory docs
```

Then open:

```text
http://localhost:3000/full-boundary-survey.html
```

The app redirects `file://` previews to localhost because map assets and fetches are more reliable through a local server.

## Editing Guide

Common edits:

- Text copy: edit `html/full-boundary-survey.html`, then run `npm run build`.
- Styling/layout: edit `sass/full-boundary-survey.scss`, then run `npm run build`.
- Survey behavior: edit `src/full-boundary-survey.js`, then run `npm run build`.
- Supabase public config: edit `assets/survey-config.js`, then run `npm run build`.
- Boundary/block data: update `assets/wilkinsburg_osm_boundary.geojson` or `assets/wilkinsburg_blocks_base.geojson`, rebuild the survey boundary and clipped block files, then run `npm run build`.
- Road-like block artifacts and slivers: run `node scripts/clean-wilkinsburg-road-artifacts.mjs`, then run `node scripts/fill-wilkinsburg-internal-gaps.mjs`, `node scripts/split-wilkinsburg-disconnected-block-parts.mjs`, run `node scripts/clean-wilkinsburg-road-artifacts.mjs` again, then run `node scripts/generate-wilkinsburg-graph.mjs`, `node scripts/generate-wilkinsburg-selectable-boundary.mjs`, `node scripts/generate-wilkinsburg-boundary-edges.mjs`, and `npm run build`.
- Boundary safety check: run `bash scripts/verify-wilkinsburg-boundary.sh`. It fails if any selectable block geometry extends outside the survey boundary.

After building:

```bash
git status
git add ...
git commit -m "Your message"
git push origin main
```

GitHub Pages serves from `docs/`, so `docs/` must be committed for hosted updates to appear.

## Current Feature Checklist

- Roboto font.
- Public Mapbox token present for Mapbox GL/geocoding.
- Token-free CARTO/OpenStreetMap basemap.
- Local clipped Wilkinsburg block GeoJSON.
- Blocks clipped to the Wilkinsburg survey boundary.
- Zero-population road-like artifacts merged into nearby selectable blocks.
- Final block file clipped to the same survey boundary drawn on the map.
- Invisible boundary hit-test layer prevents outside-boundary selection.
- Map hidden until drawing starts.
- Paint, Erase, and Clear on the map.
- Drag painting selects contacted blocks only.
- Distinct colors for neighborhoods.
- Large legend removed.
- Compact map neighborhood picker with swatches and completed checks.
- Block count hidden from respondents.
- Context questions visually separated.
- Homeowner question included in the starter context section.
- Responsive desktop and mobile layout.
- Expandable mobile map drawer.
- Landmark search with clear button.
- Border show/hide toggle.
- Ordered drawing flow.
- Validation screen with status list and revision dropdown.
- Per-neighborhood detailed issue popup.
- Final summary issue popup with submit-anyway option.
- Post-submission optional feedback.
- Post-submission optional email for future surveys.
- Supabase SQL and repo-side integration ready.
- JSON and CSV backup downloads still available.
