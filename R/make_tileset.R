STATE = "PA"
COUNTIES = c("Allegheny")
TILESET_ID = "wilkinsburg"
MAPBOX_SECRET_TOKEN = Sys.getenv("MAPBOX_SECRET_TOKEN")
MAPBOX_USERNAME = "wilkinsburglandbank"

library(tidycensus)
library(tidyverse)
library(sf)
library(spdep)
library(jsonlite)
library(mapboxapi)
library(tigris)

options(tigris_use_cache = TRUE)

# Census variables you wish to include in the tileset
vars = c(pop = "P1_001N",
         housing_units = "H1_001N"
)

if (MAPBOX_SECRET_TOKEN == "") {
  stop("MAPBOX_SECRET_TOKEN is not set.")
}

if (Sys.getenv("CENSUS_API_KEY") == "") {
  stop("CENSUS_API_KEY is not set.")
}

dir.create("assets", showWarnings = FALSE)
dir.create("R/data", recursive = TRUE, showWarnings = FALSE)

d = get_decennial(
  geography = "block",
  variables = vars,
  state = STATE,
  county = COUNTIES,
  year = 2020,
  sumfile = "pl",
  output = "wide",
  geometry = TRUE,
  key = Sys.getenv("CENSUS_API_KEY")
)

cat("Census data downloaded.\n")

# Get Wilkinsburg borough boundary
places_pa = places(state = STATE, cb = TRUE, year = 2020)

wilkinsburg_boundary = places_pa %>%
  filter(NAME == "Wilkinsburg" | NAMELSAD == "Wilkinsburg borough") %>%
  st_transform(st_crs(d))

if (nrow(wilkinsburg_boundary) == 0) {
  stop("Could not find Wilkinsburg boundary.")
}

# Filter Allegheny County blocks down to Wilkinsburg only
d = d %>%
  st_make_valid() %>%
  st_filter(wilkinsburg_boundary, .predicate = st_intersects) %>%
  st_transform(4326)

if (nrow(d) == 0) {
  stop("Filtering produced 0 Wilkinsburg blocks.")
}

cat("Filtered to", nrow(d), "Wilkinsburg blocks.\n")
print(st_bbox(d))

g = poly2nb(d, queen = TRUE)
ids = d$GEOID
class(g) = "list"
names(g) = ids
g = map(g, ~ ids[.])

write_json(g, paste0("assets/", TILESET_ID, "_graph.json"))
cat("Adjacency graph created.\n")

# Create vector tiles
mbtile_name = paste0("R/data/", TILESET_ID, ".mbtiles")

tippecanoe(
  d,
  mbtile_name,
  layer_name = "blocks",
  min_zoom = 10,
  max_zoom = 12,
  other_options = "--coalesce-densest-as-needed --detect-shared-borders --use-attribute-for-id=GEOID"
)

cat("Vector tiles created.\n")


upload_tiles(input = mbtile_name,
             access_token = MAPBOX_SECRET_TOKEN,
             username = MAPBOX_USERNAME,
             tileset_id = TILESET_ID,
             tileset_name = paste0(TILESET_ID, "_z10_z12"),
             multipart=TRUE)

cat("Tileset uploaded.\n")

# Create Wilkinsburg spec file from Boston template
spec = read_json("assets/boston.json", simplifyVector = TRUE)

# Wilkinsburg-specific bounds
spec$units$bounds = matrix(as.numeric(st_bbox(d)), nrow = 2, byrow = TRUE)
spec$units$zoomTo = 14

# Location for mapbox tileset URL
spec$units$tileset$source$url = str_glue("mapbox://{MAPBOX_USERNAME}.{TILESET_ID}")
spec$units$tileset$sourceLayer = "blocks"

# Remove old fields if present
spec$units$tilesets = NULL

write_json(spec, paste0("assets/", TILESET_ID, ".json"))
cat("Specification written.\n")
