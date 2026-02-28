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
  selectedProducts: ["volaille", "ble", "lait"]
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
  geoById: new Map()
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
  d3.selectAll('input[name="product"]').on("change", () => {
    const selected = d3
      .selectAll('input[name="product"]:checked')
      .nodes()
      .map((n) => n.value);

    state.selectedProducts = selected.length ? selected : ["volaille", "ble", "lait"];

    if (!selected.length) {
      d3.select('input[name="product"][value="volaille"]').property("checked", true);
      state.selectedProducts = ["volaille"];
    }

    updateMap();
    updateCharts();
  });
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

  app.mapG
    .selectAll("path")
    .data(app.mapFeatures)
    .join("path")
    .attr("class", "country")
    .attr("d", app.mapPath)
    .attr("fill", "#d4d8db")
    .style("pointer-events", "all")
    .on("mousemove", (event, d) => {
      const entityId = getSelectableEntityId(d);
      const label = getCountryName(d, entityId);
      showTooltip(event.clientX, event.clientY, [
        `<strong>${label}</strong>`,
        ...(entityId && getValue(entityId, state.selectedYear, state.selectedProducts) != null
          ? []
          : ["No data for current filters"])
      ]);
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

  const color = d3.scaleSequential(d3.interpolateYlGn).domain([0, 1]);

  app.mapG
    .selectAll(".country")
    .transition()
    .duration(400)
    .attr("fill", (d) => {
      const entityId = getSelectableEntityId(d);
      const value = getValue(entityId, state.selectedYear, state.selectedProducts);
      if (value == null) return "#d4d8db";
      return color(value);
    })
    .attr("class", (d) => {
      const entityId = getSelectableEntityId(d);
      return `country${entityId === state.selectedCountryId ? " selected" : ""}`;
    });

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

  const seriesByProduct = getSeriesForCountry(selectedId, state.selectedProducts);

  if (!seriesByProduct.length || seriesByProduct.every((s) => !s.values.length)) {
    legend.selectAll("*").remove();
    app.chartsSvg
      .append("text")
      .attr("class", "no-data-msg")
      .attr("x", 40)
      .attr("y", 50)
      .text("No time-series data for this selection");
    return;
  }

  renderLegend(state.selectedProducts);
  drawSmallMultiples(seriesByProduct);
}

function drawSingleChart(seriesByProduct) {
  const width = 920;
  const height = 600;
  const margin = { top: 20, right: 24, bottom: 50, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  app.chartsSvg.attr("viewBox", `0 0 ${width} ${height}`);

  const g = app.chartsSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain(d3.extent(app.years)).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);

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

  const line = d3
    .line()
    .x((d) => x(d.year))
    .y((d) => y(d.value));

  const lines = g.selectAll(".line-series").data(seriesByProduct, (d) => d.product);

  lines
    .join((enter) =>
      enter
        .append("path")
        .attr("class", "line-series")
        .attr("fill", "none")
        .attr("stroke-width", 2.2)
        .attr("stroke", (d) => PRODUCT_COLOR[d.product])
        .attr("d", (d) => line(d.values))
        .attr("opacity", 0)
        .call((e) => e.transition().duration(450).attr("opacity", 1))
    )
    .transition()
    .duration(450)
    .attr("stroke", (d) => PRODUCT_COLOR[d.product])
    .attr("d", (d) => line(d.values));

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

function getValue(countryId, year, selectedProducts) {
  if (!countryId || !year || !selectedProducts.length) return null;

  const products = app.byCountryYearProduct[countryId]?.[year];
  if (!products) return null;

  const values = selectedProducts
    .map((p) => products[p])
    .filter((v) => v != null && Number.isFinite(v));

  if (!values.length) return null;

  return d3.mean(values);
}

function getSeriesForCountry(countryId, selectedProducts) {
  return selectedProducts.map((product) => {
    const values = app.years
      .map((year) => ({
        year,
        value: app.byCountryYearProduct[countryId]?.[year]?.[product]
      }))
      .filter((d) => d.value != null);

    return { product, values };
  });
}

function renderLegend(products) {
  d3.select("#chart-legend")
    .selectAll(".legend-item")
    .data(products)
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
      (countryId) => getValue(countryId, year, state.selectedProducts) != null
    );
    if (hasData) return year;
  }

  return app.latestYear || app.years[0] || null;
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

