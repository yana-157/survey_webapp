import fs from "fs";

const INPUT_PATH = "assets/wilkinsburg_osm_boundary.geojson";
const OUTPUT_PATH = "assets/wilkinsburg_survey_boundary.geojson";

const source = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
const boundaryFeature = source.features.find(feature =>
  feature.geometry && ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
);

if (!boundaryFeature) {
  throw new Error(`Could not find a polygon boundary in ${INPUT_PATH}`);
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
  type: "FeatureCollection",
  properties: {
    generated_from: INPUT_PATH,
    generated_at: new Date().toISOString(),
    note: "Survey boundary copied from the clean OpenStreetMap Wilkinsburg boundary polygon."
  },
  features: [
    {
      type: "Feature",
      properties: {
        name: "Wilkinsburg survey boundary",
        source: INPUT_PATH
      },
      geometry: boundaryFeature.geometry
    }
  ]
}));

console.log(`Generated ${OUTPUT_PATH} from ${INPUT_PATH}.`);
