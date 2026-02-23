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
  Switzerland: "CHE",
  "European Union (27)": "EU27"
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

    app.rows = rows.filter((d) => d.country_id && d.product);
    buildIndices();
    initControls();
    initMap(geometry);
    initCharts();
    initRegionChips();

    state.selectedYear = app.latestYear;
    state.selectedCountryId = app.byCountryYearProduct.EU27 ? "EU27" : null;

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
  const country_id = COUNTRY_NAME_TO_ID[d.country] || d.country_id || null;
  const product = PRODUCT_MAP[d.product] || d.product || null;

  return {
    country_id,
    country_name: d.country_name || d.country,
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

function initRegionChips() {
  const chips = [{ id: "EU27", label: "EU27" }];

  d3.select("#region-chips")
    .selectAll("button")
    .data(chips)
    .join("button")
    .attr("class", "chip")
    .classed("active", (d) => d.id === state.selectedCountryId)
    .text((d) => d.label)
    .on("click", (_, d) => {
      state.selectedCountryId = d.id;
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
      const countryId = getFeatureCountryId(d);
      const value = getValue(countryId, state.selectedYear, state.selectedProducts);
      const products = state.selectedProducts.map((p) => PRODUCT_LABEL[p]).join(", ");
      const countryName = getCountryName(d, countryId);

      showTooltip(event.clientX, event.clientY, [
        `<strong>${countryName}</strong>`,
        `Year: ${state.selectedYear ?? "-"}`,
        `Products: ${products}`,
        `Rate: ${value == null ? "No data" : d3.format(".1%")((value))}`
      ]);
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      const id = getFeatureCountryId(d);
      if (!id) return;
      state.selectedCountryId = id;
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
      const id = getFeatureCountryId(d);
      const value = getValue(id, state.selectedYear, state.selectedProducts);
      return value == null ? "#d4d8db" : color(value);
    })
    .attr("class", (d) => {
      const id = getFeatureCountryId(d);
      return `country${id === state.selectedCountryId ? " selected" : ""}`;
    });

  d3.selectAll(".chip").classed("active", (d) => d.id === state.selectedCountryId);
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
  const continent = (props.CONTINENT || props.continent || "").toLowerCase();

  if (continent === "europe") return true;

  // Fallback bounding box filter if continent metadata is absent.
  const [lon, lat] = d3.geoCentroid(feature);
  return lon >= -31 && lon <= 45 && lat >= 34 && lat <= 73;
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
  const featureName = (p.ADMIN || p.NAME || p.name || "").trim().toLowerCase();
  if (!featureName) return null;

  const match = Object.entries(app.countryNames).find(([, name]) => name.toLowerCase() === featureName);
  return match ? match[0] : null;
}

function getCountryName(feature, countryId) {
  const p = feature.properties || {};
  return app.countryNames[countryId] || p.ADMIN || p.NAME || p.name || countryId;
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

