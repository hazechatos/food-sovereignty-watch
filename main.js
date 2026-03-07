const DATA_SOURCES = [
  "data/agri_self_sufficiency_prepared.csv",
  "./data/agri_self_sufficiency_prepared.csv",
  "../data/agri_self_sufficiency_prepared.csv"
];
const MAP_SOURCES = [
  "data/europe.geojson",
  "./data/europe.geojson",
  "../data/europe.geojson",
  "https://cdn.jsdelivr.net/gh/datasets/geo-countries@master/data/countries.geojson",
  "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"
];


const PRODUCT_MAP = {
  "Meat of chickens, fresh or chilled": "volaille",
  Wheat: "ble",
  "Raw milk of cattle": "lait"
};

const PRODUCT_LABEL = {
  volaille: "Poultry",
  ble: "Wheat",
  lait: "Milk"
};

const PRODUCT_COLOR = {
  volaille: "#cc5a24",
  ble: "#7a8f2a",
  lait: "#2b6cb0"
};

const COUNTRY_NAME_TO_ID = {
  Norway: "NOR",
  Switzerland: "CHE"
};

const EUROPE_BOUNDS = { lonMin: -31, lonMax: 45, latMin: 34, latMax: 72 };
const EXCLUDED_MAP_FEATURE_IDS = new Set(["GUY", "SJM"]);
const EXCLUDED_MAP_FEATURE_NAMES = new Set([
  "guyana",
  "french guiana",
  "svalbard",
  "svalbard and jan mayen"
]);
const MAP_COLOR_DOMAIN = [0, 1];
const COUNTRY_NAME_ALIASES = {
  "bolivia plurinational state of": "bolivia",
  "cabo verde": "cape verde",
  "congo democratic republic of the": "democratic republic of the congo",
  "congo": "republic of the congo",
  "cote d ivoire": "ivory coast",
  "iran islamic republic of": "iran",
  "korea republic of": "south korea",
  "korea democratic people s republic of": "north korea",
  "lao people s democratic republic": "laos",
  "micronesia federated states of": "micronesia",
  "moldova republic of": "moldova",
  "palestine state of": "palestine",
  "russian federation": "russia",
  "syrian arab republic": "syria",
  "tanzania united republic of": "tanzania",
  "united kingdom of great britain and northern ireland": "united kingdom",
  "united states of america": "united states",
  "venezuela bolivarian republic of": "venezuela",
  "viet nam": "vietnam"
};

const state = {
  selectedCountryId: null,
  selectedYear: null,
  selectedProduct: "volaille"
};

const app = {
  rows: [],
  years: [],
  latestYear: null,
  byCountryYearProduct: {},
  countryNames: {},
  mapFeatures: [],
  mapSvg: null,
  mapPath: null,
  mapG: null,
  chartsSvg: null,
  geoById: new Map(),
  mapColorScale: null
};

const tooltip = d3.select("#tooltip");

init();

async function init() {
  try {
    const [rows, geometry] = await Promise.all([loadDataset(), loadMapGeometry()]);

    const geometryCountryIndex = buildGeometryCountryIndex(geometry);
    app.rows = rows
      .map((d) => {
        const normalizedCountryName = normalizeCountryName(d.country_name);
        const mappedId =
          d.country_id ||
          geometryCountryIndex.get(normalizedCountryName) ||
          normalizedCountryName ||
          null;
        return { ...d, country_id: mappedId };
      })
      .filter((d) => d.country_id && d.product && Number.isFinite(d.year));
    buildIndices();
    initControls();
    initMap(geometry);
    initCharts();

    state.selectedYear = getDefaultSelectedYear();
    state.selectedCountryId = getDefaultSelectedCountryId();
    syncYearControl(state.selectedYear);

    updateMap();
    updateCharts();
  } catch (error) {
    d3.select("#map-container")
      .append("div")
      .attr("class", "no-data-msg")
      .text(`Data load failed: ${error.message}`);
  }
}

function parseRow(d) {
  const country_name = (d.country_name || d.country || "").trim();
  const country_id = d.country_id || COUNTRY_NAME_TO_ID[country_name] || null;
  const product = PRODUCT_MAP[d.product] || d.product || null;

  return {
    country_id,
    country_name,
    product,
    year: +d.year,
    self_sufficiency_rate: d.self_sufficiency_rate === "" ? null : +d.self_sufficiency_rate,
    production_tonnes: d.production_tonnes === "" ? null : +d.production_tonnes,
    imports_tonnes: d.imports_tonnes === "" ? null : +d.imports_tonnes
  };
}

async function loadMapGeometry() {
  let lastError = null;
  for (const source of MAP_SOURCES) {
    try {
      const raw = await d3.json(source);
      if (!raw) continue;

      if (raw.type === "Topology") {
        const key = Object.keys(raw.objects)[0];
        const features = topojson.feature(raw, raw.objects[key]).features;
        return features;
      }

      if (raw.type === "FeatureCollection") {
        return raw.features;
      }
    } catch (err) {
      lastError = err;
    }
  }
  const details = lastError && lastError.message ? ` (${lastError.message})` : "";
  throw new Error(`Unable to load map geometry from known sources${details}`);
}

async function loadDataset() {
  let lastError = null;
  for (const source of DATA_SOURCES) {
    try {
      const rows = await d3.csv(source, parseRow);
      if (rows && rows.length) return rows;
    } catch (err) {
      lastError = err;
    }
  }
  const details = lastError && lastError.message ? ` (${lastError.message})` : "";
  throw new Error(`Unable to load dataset CSV from known paths${details}`);
}

function buildIndices() {
  const years = new Set();

  app.rows.forEach((d) => {
    if (!Number.isFinite(d.year)) return;
    years.add(d.year);
    if (!app.byCountryYearProduct[d.country_id]) app.byCountryYearProduct[d.country_id] = {};
    if (!app.byCountryYearProduct[d.country_id][d.year]) app.byCountryYearProduct[d.country_id][d.year] = {};

    app.byCountryYearProduct[d.country_id][d.year][d.product] = d.self_sufficiency_rate;
    app.countryNames[d.country_id] = d.country_name;
  });

  app.years = Array.from(years).sort((a, b) => a - b);
  app.latestYear = app.years[app.years.length - 1];
}

function initControls() {
  d3.selectAll('input[name="product"]').on("change", (event) => {
    state.selectedProduct = event.target.value;
    updateMap();
    updateCharts();
  });

  const yearSlider = d3.select("#year-slider");
  const yearValue = d3.select("#year-value");
  if (!yearSlider.empty()) {
    const [minYear, maxYear] = d3.extent(app.years);
    yearSlider.attr("min", minYear).attr("max", maxYear).attr("step", 1).property("value", maxYear);
    yearValue.text(maxYear);

    yearSlider.on("input", (event) => {
      const requestedYear = +event.target.value;
      const selectedYear = getClosestAvailableYear(requestedYear);
      state.selectedYear = selectedYear;
      syncYearControl(selectedYear);
      updateMap();
    });
  }
}

function initMap(features) {
  const mapContainer = document.getElementById("map-container");
  const { width, height } = mapContainer.getBoundingClientRect();
  const safeWidth = Math.max(480, Math.round(width));
  const safeHeight = Math.max(380, Math.round(height));

  let europeFeatures = features
    .map(trimFeatureToEurope)
    .filter((f) => f != null)
    .filter(isEuropeFeature)
    .map((f) => {
      const id = getFeatureCountryId(f);
      if (id) app.geoById.set(id, f);
      return f;
    });
  if (europeFeatures.length < 5) {
    europeFeatures = features;
  }
  app.mapFeatures = europeFeatures;

  // Create color scale used both for the map and its legend.
  // Values above 100% are clamped to the maximum color.
  app.mapColorScale = d3
    .scaleSequential(d3.interpolateYlGn)
    .domain(MAP_COLOR_DOMAIN)
    .clamp(true);

  app.mapSvg = d3
    .select("#map-container")
    .append("svg")
    .attr("viewBox", `0 0 ${safeWidth} ${safeHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const projection = d3.geoMercator().fitSize([safeWidth, safeHeight], {
    type: "FeatureCollection",
    features: app.mapFeatures
  });

  app.mapPath = d3.geoPath().projection(projection);
  app.mapG = app.mapSvg.append("g");

  renderMapLegend();

  app.mapG
    .selectAll("path")
    .data(app.mapFeatures)
    .join("path")
    .attr("class", "country")
    .attr("d", app.mapPath)
    .attr("fill", "#d4d8db")
    .style("pointer-events", "all")
    .on("mouseenter", (event, d) => {
      showTooltip(event.clientX, event.clientY, getCountryTooltipLines(d));
    })
    .on("mousemove", (event, d) => {
      showTooltip(event.clientX, event.clientY, getCountryTooltipLines(d));
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      const selectedId = getSelectableEntityId(d);
      if (!selectedId) return;
      state.selectedCountryId = selectedId;
      updateMap();
      updateCharts();
    });

}

function updateMap() {
  if (!app.mapG) return;

  const color = app.mapColorScale || d3.scaleSequential(d3.interpolateYlGn).domain(MAP_COLOR_DOMAIN);

  app.mapG
    .selectAll(".country")
    .transition()
    .duration(400)
    .attr("fill", (d) => {
      const entityId = getSelectableEntityId(d);
      const value = getValue(entityId, state.selectedYear, state.selectedProduct);
      if (value == null) return "#d4d8db";
      return color(value);
    })
    .attr("class", (d) => {
      const entityId = getSelectableEntityId(d);
      return `country${entityId === state.selectedCountryId ? " selected" : ""}`;
    });

}

function renderMapLegend() {
  if (!app.mapSvg || !app.mapColorScale) return;

  const legendWidth = 140;
  const legendHeight = 10;
  const legendOffsetX = 16;
  const legendOffsetY = 16;

  const defs = app.mapSvg.append("defs");
  const gradientId = "map-legend-gradient";
  const gradient = defs
    .append("linearGradient")
    .attr("id", gradientId)
    .attr("x1", "0%")
    .attr("x2", "100%")
    .attr("y1", "0%")
    .attr("y2", "0%");

  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    gradient
      .append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", app.mapColorScale(t));
  }

  const legendGroup = app.mapSvg
    .append("g")
    .attr("class", "map-legend")
    .attr("transform", `translate(${legendOffsetX},${legendOffsetY})`);

  legendGroup
    .append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", `url(#${gradientId})`)
    .attr("stroke", "#777")
    .attr("stroke-width", 0.7)
    .attr("rx", 2)
    .attr("ry", 2);

  legendGroup
    .append("text")
    .attr("x", 0)
    .attr("y", legendHeight + 12)
    .attr("text-anchor", "start")
    .attr("font-size", 10)
    .text("0%");

  legendGroup
    .append("text")
    .attr("x", legendWidth / 2)
    .attr("y", legendHeight + 12)
    .attr("text-anchor", "middle")
    .attr("font-size", 10)
    .text("50%");

  legendGroup
    .append("text")
    .attr("x", legendWidth)
    .attr("y", legendHeight + 12)
    .attr("text-anchor", "end")
    .attr("font-size", 10)
    .text("≥100%");

  legendGroup
    .append("text")
    .attr("x", 0)
    .attr("y", -4)
    .attr("font-size", 11)
    .attr("font-weight", "600")
    .text("Self-sufficiency");
}

function initCharts() {
  const container = document.getElementById("charts-container");
  const { width, height } = container.getBoundingClientRect();

  app.chartsSvg = d3
    .select("#charts-container")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
}

function updateCharts() {
  if (!app.chartsSvg) return;

  const selectedId = state.selectedCountryId;
  const title = d3.select("#chart-title");
  const legend = d3.select("#chart-legend");

  app.chartsSvg.selectAll("*").remove();

  if (!selectedId) {
    title.text("Self-sufficiency time series");
    legend.selectAll("*").remove();

    app.chartsSvg
      .append("text")
      .attr("class", "no-data-msg")
      .attr("x", 40)
      .attr("y", 50)
      .text("Click a country on the map");
    return;
  }

  title.text(`Self-sufficiency - ${app.countryNames[selectedId] || selectedId}`);

  const series = getSeriesForCountry(selectedId, state.selectedProduct);

  if (!series.values.length) {
    legend.selectAll("*").remove();
    app.chartsSvg
      .append("text")
      .attr("class", "no-data-msg")
      .attr("x", 40)
      .attr("y", 50)
      .text("No time-series data for this selection");
    return;
  }

  renderLegend(state.selectedProduct);
  drawSingleChart(series);
}

function drawSingleChart(series) {
  const width = 920;
  const height = 600;
  const margin = { top: 20, right: 24, bottom: 50, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  app.chartsSvg.attr("viewBox", `0 0 ${width} ${height}`);

  const g = app.chartsSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain(d3.extent(app.years)).range([0, innerW]);
  const yMax = Math.max(1, d3.max(series.values, (d) => d.value));
  const y = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]).nice();

  g.append("g")
    .attr("class", "chart-grid")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(Math.min(10, app.years.length)).tickSize(-innerH).tickFormat(""));
  g.append("g")
    .attr("class", "chart-grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerW).tickFormat(""));

  g.append("g").attr("transform", `translate(0,${innerH})`).call(d3.axisBottom(x).tickFormat(d3.format("d")));
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", innerW / 2)
    .attr("y", innerH + 40)
    .attr("text-anchor", "middle")
    .text("Year");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -38)
    .attr("text-anchor", "middle")
    .text("Self-sufficiency rate");

  g.append("line")
    .attr("x1", 0)
    .attr("x2", innerW)
    .attr("y1", y(1))
    .attr("y2", y(1))
    .attr("stroke", "#888")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4 3");

  g.append("text")
    .attr("x", innerW + 4)
    .attr("y", y(1))
    .attr("dy", "0.35em")
    .attr("font-size", 10)
    .attr("fill", "#888")
    .text("100%");

  const line = d3
    .line()
    .x((d) => x(d.year))
    .y((d) => y(d.value));

  g.append("path")
    .datum(series.values)
    .attr("class", "line-series")
    .attr("fill", "none")
    .attr("stroke-width", 2.2)
    .attr("stroke", PRODUCT_COLOR[series.product])
    .attr("d", line)
    .attr("opacity", 0)
    .transition()
    .duration(450)
    .attr("opacity", 1);
}

function drawSmallMultiples(seriesByProduct) {
  const width = 920;
  const height = 620;
  const margin = { top: 10, right: 20, bottom: 30, left: 52 };
  const rowGap = 18;

  app.chartsSvg.attr("viewBox", `0 0 ${width} ${height}`);

  const rows = seriesByProduct.length;
  const rowHeight = (height - margin.top - margin.bottom - rowGap * (rows - 1)) / rows;

  const x = d3.scaleLinear().domain(d3.extent(app.years)).range([0, width - margin.left - margin.right]);
  const y = d3.scaleLinear().domain([0, 1]).range([rowHeight, 0]);

  seriesByProduct.forEach((series, i) => {
    const yOffset = margin.top + i * (rowHeight + rowGap);
    const g = app.chartsSvg.append("g").attr("transform", `translate(${margin.left},${yOffset})`);
    const innerW = width - margin.left - margin.right;

    g.append("g")
      .attr("class", "chart-grid")
      .attr("transform", `translate(0,${rowHeight})`)
      .call(d3.axisBottom(x).ticks(Math.min(8, app.years.length)).tickSize(-rowHeight).tickFormat(""));
    g.append("g")
      .attr("class", "chart-grid")
      .call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(""));

    g.append("g").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".0%")));

    g.append("text")
      .attr("x", 4)
      .attr("y", 14)
      .attr("fill", PRODUCT_COLOR[series.product])
      .style("font-size", "12px")
      .style("font-weight", "600")
      .text(PRODUCT_LABEL[series.product]);

    if (i === rows - 1) {
      g.append("g")
        .attr("transform", `translate(0,${rowHeight})`)
        .call(d3.axisBottom(x).tickFormat(d3.format("d")));

      g.append("text")
        .attr("class", "axis-label")
        .attr("x", (width - margin.left - margin.right) / 2)
        .attr("y", rowHeight + 28)
        .attr("text-anchor", "middle")
        .text("Year");
    }

    const line = d3
      .line()
      .x((d) => x(d.year))
      .y((d) => y(d.value));

    g.append("path")
      .datum(series.values)
      .attr("fill", "none")
      .attr("stroke", PRODUCT_COLOR[series.product])
      .attr("stroke-width", 2.1)
      .attr("d", line)
      .attr("opacity", 0)
      .transition()
      .duration(450)
      .attr("opacity", 1);

  });

  app.chartsSvg
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", 16)
    .attr("text-anchor", "middle")
    .text("Self-sufficiency rate");
}

function getValue(countryId, year, product) {
  if (!countryId || !year || !product) return null;

  const value = app.byCountryYearProduct[countryId]?.[year]?.[product];
  if (value == null || !Number.isFinite(value)) return null;

  return value;
}

function getSeriesForCountry(countryId, product) {
  const values = app.years
    .map((year) => ({
      year,
      value: app.byCountryYearProduct[countryId]?.[year]?.[product]
    }))
    .filter((d) => d.value != null);

  return { product, values };
}

function renderLegend(product) {
  d3.select("#chart-legend")
    .selectAll(".legend-item")
    .data([product])
    .join("div")
    .attr("class", "legend-item")
    .html(
      (p) =>
        `<span class="legend-swatch" style="background:${PRODUCT_COLOR[p]}"></span><span>${PRODUCT_LABEL[p]}</span>`
    );
}

function isEuropeFeature(feature) {
  const props = feature.properties || {};
  const name = (props.ADMIN || props.NAME || props.name || "").trim().toLowerCase();
  if (EXCLUDED_MAP_FEATURE_NAMES.has(name)) return false;

  const iso = getIso3(feature);
  if (iso && EXCLUDED_MAP_FEATURE_IDS.has(iso)) return false;

  const continent = (props.CONTINENT || props.continent || "").toLowerCase();

  if (continent === "europe") return true;

  // Fallback bounding box filter if continent metadata is absent.
  const [lon, lat] = d3.geoCentroid(feature);
  return isPointInEuropeBounds([lon, lat]);
}

function trimFeatureToEurope(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;

  if (geometry.type === "Polygon") {
    return polygonIntersectsEurope(geometry.coordinates)
      ? feature
      : null;
  }

  if (geometry.type === "MultiPolygon") {
    const kept = geometry.coordinates.filter((coords) => polygonIntersectsEurope(coords));
    if (!kept.length) return null;
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: kept
      }
    };
  }

  return feature;
}

function polygonIntersectsEurope(polygonCoordinates) {
  const polygon = {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: polygonCoordinates }
  };
  const [[minLon, minLat], [maxLon, maxLat]] = d3.geoBounds(polygon);
  return !(
    maxLon < EUROPE_BOUNDS.lonMin ||
    minLon > EUROPE_BOUNDS.lonMax ||
    maxLat < EUROPE_BOUNDS.latMin ||
    minLat > EUROPE_BOUNDS.latMax
  );
}

function isPointInEuropeBounds([lon, lat]) {
  return (
    lon >= EUROPE_BOUNDS.lonMin &&
    lon <= EUROPE_BOUNDS.lonMax &&
    lat >= EUROPE_BOUNDS.latMin &&
    lat <= EUROPE_BOUNDS.latMax
  );
}

function getIso3(feature) {
  const p = feature.properties || {};
  const id = p.ISO_A3 || p.ISO3 || p.ADM0_A3 || p.iso_a3 || p.iso3 || p.id || feature.id || null;
  if (id === "-99" || id === -99) return null;
  return id;
}

function getFeatureCountryId(feature) {
  const iso = getIso3(feature);
  if (iso) return iso;

  const p = feature.properties || {};
  const featureName = normalizeCountryName(p.ADMIN || p.NAME || p.name || "");
  if (!featureName) return null;

  const match = Object.entries(app.countryNames).find(
    ([, name]) => normalizeCountryName(name) === featureName
  );
  return match ? match[0] : null;
}

function getCountryName(feature, countryId) {
  const p = feature.properties || {};
  return (
    app.countryNames[countryId] ||
    p.ADMIN ||
    p.NAME ||
    p.name ||
    countryId ||
    "Unknown"
  );
}

function getCountryTooltipLines(feature) {
  const entityId = getSelectableEntityId(feature);
  const label = getCountryName(feature, entityId);
  const lines = [`<strong>${label}</strong>`];
  const value = entityId ? getValue(entityId, state.selectedYear, state.selectedProduct) : null;
  lines.push(value == null ? "No data for current filters" : `Self-sufficiency: ${d3.format(".1%")(value)}`);
  return lines;
}

function getSelectableEntityId(feature) {
  return getFeatureCountryId(feature);
}

function getDefaultSelectedCountryId() {
  for (const countryId of Object.keys(app.byCountryYearProduct)) {
    if (app.geoById.has(countryId)) return countryId;
  }
  return Object.keys(app.byCountryYearProduct)[0] || null;
}

function getDefaultSelectedYear() {
  const yearsDesc = [...app.years].sort((a, b) => b - a);
  const mapCountryIds = app.mapFeatures
    .map((f) => getSelectableEntityId(f))
    .filter(Boolean);

  for (const year of yearsDesc) {
    const hasData = mapCountryIds.some(
      (countryId) => getValue(countryId, year, state.selectedProduct) != null
    );
    if (hasData) return year;
  }

  return app.latestYear || app.years[0] || null;
}

function getClosestAvailableYear(year) {
  if (!app.years.length) return year;
  return app.years.reduce((best, current) => {
    return Math.abs(current - year) < Math.abs(best - year) ? current : best;
  }, app.years[0]);
}

function syncYearControl(year) {
  const yearSlider = d3.select("#year-slider");
  const yearValue = d3.select("#year-value");
  if (yearSlider.empty() || yearValue.empty() || year == null) return;
  yearSlider.property("value", year);
  yearValue.text(year);
}

function buildGeometryCountryIndex(features) {
  const index = new Map();
  features.forEach((feature) => {
    const iso = getIso3(feature);
    if (!iso) return;
    const p = feature.properties || {};
    const names = [p.ADMIN, p.NAME, p.name].filter(Boolean);
    names.forEach((name) => {
      index.set(normalizeCountryName(name), iso);
    });
  });
  return index;
}

function normalizeCountryName(name) {
  if (!name) return "";
  const normalized = name
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.,()/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return COUNTRY_NAME_ALIASES[normalized] || normalized;
}

function showTooltip(x, y, lines) {
  tooltip
    .classed("hidden", false)
    .style("left", `${x + 14}px`)
    .style("top", `${y + 12}px`)
    .html(lines.join("<br/>"));
}

function hideTooltip() {
  tooltip.classed("hidden", true);
}

