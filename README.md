# Europe Food Self-Sufficiency (D3.js)

Interactive web app to explore food self-sufficiency in Europe with:
- Left panel: clickable choropleth map
- Right panel: time-series charts that update by country/region

## Files
- `index.html`: app structure and controls
- `styles.css`: split layout, styles, tooltip
- `main.js`: data loading, state, map, charts, updates
- `data/agri_self_sufficiency_prepared.csv`: preprocessed dataset
- Optional map file: `data/europe.geojson`

## Data Schema
Expected columns:
- `country_id` (ISO3, plus `EU27` synthetic id)
- `country_name`
- `product` (`volaille`, `ble`, `lait`)
- `year` (integer)
- `self_sufficiency_rate` (0..1)
- optional `production_tonnes`, `imports_tonnes`

Current `main.js` also maps your existing CSV fields (`country`, FAOSTAT product names) to this schema.

## Run
Use a local static server. Example:

```powershell
cd c:\Users\aurel\Projects\centrale-4a\dataviz
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Notes
- If `EU27` is not in map geometry, it is selectable via a dedicated chip above the map.
- Map loader tries `data/europe.geojson` first, then a remote fallback and filters Europe features.

## To-do
- Try Supply Utilization Accounts data (https://www.fao.org/faostat/en/#data/SCL) to incorporate stock variation.