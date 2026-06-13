// Shared report logic for both variations.
// Exports React components on `window.B64Report.*`, themed via CSS variables.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const DATA = window.B64_DATA;

// Resolve a CSS variable to its actual computed value (Chart.js can't read var() strings)
function cssVar(name, fallback = "#64748b") {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Hook: bumps a counter whenever data-mode flips on <html>, so charts re-render with new theme colors
function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => {
      if (typeof applyChartDefaults === "function") applyChartDefaults();
      setV((x) => x + 1);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "style"] });
    return () => obs.disconnect();
  }, []);
  return v;
}

// ---------- Filters context ----------
function useFilters(initial = {}) {
  const [filters, setFilters] = useState({
    region: "all",
    age: "all",
    anciennete: "all",
    territoire: "all",
    ...initial
  });

  const filtered = useMemo(() => {
    return DATA.respondents.filter((r) => {
      if (filters.region !== "all" && r.demographics.region !== filters.region) return false;
      if (filters.age !== "all" && r.demographics.age_tranche !== filters.age) return false;
      if (filters.anciennete !== "all" && r.demographics.anciennete_benevole !== filters.anciennete) return false;
      if (filters.territoire !== "all" && r.demographics.type_territoire !== filters.territoire) return false;
      return true;
    });
  }, [filters]);

  return [filters, setFilters, filtered];
}

// ---------- KPI helpers ----------
function computeKPIs(respondents) {
  const n = respondents.length;
  const retraite = respondents.filter((r) => r.demographics.situation_pro === "Retraité·e").length;
  const rural = respondents.filter((r) => r.demographics.type_territoire === "Rural").length;
  const ancienMoyen = (() => {
    const map = { "Moins d'1 an": 0.5, "1-2 ans": 1.5, "3-4 ans": 3.5, "5-9 ans": 7, "10 ans et +": 12 };
    if (!n) return 0;
    return respondents.reduce((acc, r) => acc + (map[r.demographics.anciennete_benevole] || 0), 0) / n;
  })();
  return {
    n,
    retraite_pct: n ? Math.round(retraite / n * 100) : 0,
    rural_pct: n ? Math.round(rural / n * 100) : 0,
    anc_moyen: ancienMoyen
  };
}

// ---------- Distribution helper ----------
function distribute(respondents, key) {
  const out = {};
  respondents.forEach((r) => {
    const v = r.demographics[key];
    out[v] = (out[v] || 0) + 1;
  });
  return out;
}

function radarAverage(respondents) {
  if (!respondents.length) return DATA.radarAxes.map(() => 0);
  const sums = DATA.radarAxes.map((_, i) =>
  respondents.reduce((acc, r) => acc + r.radar_data.scores[i], 0)
  );
  return sums.map((s) => s / respondents.length);
}

// ---------- Chart helpers (Chart.js) ----------
function applyChartDefaults() {
  if (!window.Chart) return;
  window.Chart.defaults.color = cssVar("--chart-tick", "#64748b");
  window.Chart.defaults.borderColor = cssVar("--chart-grid", "rgba(0,0,0,0.06)");
  window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily || "Inter, sans-serif";
}
applyChartDefaults();

function useChart(canvasRef, config, deps = []) {
  const chartRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, config);
    return () => {chartRef.current && chartRef.current.destroy();};
    // eslint-disable-next-line
  }, deps);
}

// ---------- Reusable: bar chart ----------
function BarChart({ labels, values, color, horizontal, max, suffix }) {
  const ref = useRef(null);
  useChart(ref, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: color,
        borderRadius: 6,
        barPercentage: 0.78,
        categoryPercentage: 0.72
      }]
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed[horizontal ? "x" : "y"]}${suffix || ""}`
          }
        }
      },
      scales: {
        [horizontal ? "x" : "y"]: {
          beginAtZero: true,
          max: max,
          grid: { color: cssVar("--chart-grid", "rgba(0,0,0,0.06)") },
          ticks: { color: cssVar("--chart-tick", "#64748b"), font: { size: 11 } }
        },
        [horizontal ? "y" : "x"]: {
          grid: { display: false },
          ticks: { color: cssVar("--chart-tick", "#64748b"), font: { size: 11 } }
        }
      }
    }
  }, [labels.join("|"), values.join("|"), color, horizontal, max]);
  return <canvas ref={ref} />;
}

// ---------- Doughnut ----------
function DoughnutChart({ labels, values, colors }) {
  const ref = useRef(null);
  useChart(ref, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: cssVar("--card-bg", "#fff") }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { color: cssVar("--chart-tick", "#475569"), font: { size: 11 }, boxWidth: 12, padding: 12 } }
      }
    }
  }, [labels.join("|"), values.join("|"), colors.join("|")]);
  return <canvas ref={ref} />;
}

// ---------- Radar ----------
function RadarChart({ axes, datasets, max = 1 }) {
  const ref = useRef(null);
  const themeV = useThemeVersion();
  useChart(ref, {
    type: "radar",
    data: {
      labels: axes,
      datasets: datasets.map((d) => ({
        label: d.label,
        data: d.values,
        backgroundColor: d.fill || "rgba(36,82,138,0.18)",
        borderColor: d.color || "rgba(36,82,138,1)",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: d.color || "rgba(36,82,138,1)"
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 12 },
      plugins: {
        legend: { display: datasets.length > 1, position: "bottom", labels: { color: cssVar("--chart-tick", "#475569"), boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            title: (context) => axes[context[0].dataIndex] || "",
            label: (context) => `${context.dataset.label}: ${Math.round(context.parsed.r * 100)} %`
          }
        }
      },
      scales: {
        r: {
          min: 0,
          max,
          ticks: { display: false, stepSize: 0.25 },
          pointLabels: { font: { size: 10 }, color: cssVar("--chart-label", "#334155") },
          grid: { color: cssVar("--chart-grid", "rgba(0,0,0,0.07)") },
          angleLines: { color: cssVar("--chart-grid", "rgba(0,0,0,0.06)") }
        }
      }
    }
  }, [JSON.stringify(axes), JSON.stringify(datasets), max, themeV]);
  return <canvas ref={ref} />;
}

// ---------- Radar legend ----------
function RadarLegend() {
  if (!DATA.radarAxesInfo) return null;
  return (
    <details style={{ marginBottom: "20px", fontSize: "13px", color: "var(--ink-soft)" }}>
      <summary style={{ cursor: "pointer", userSelect: "none", padding: "6px 0" }}>
        Définition des dimensions
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px 32px", marginTop: "12px", padding: "16px", background: "var(--bg-dim)", borderRadius: "6px" }}>
        {DATA.radarAxesInfo.map((ax) => (
          <div key={ax.label}>
            <strong style={{ color: "var(--ink)", fontSize: "13px" }}>{ax.label}</strong>
            <p style={{ margin: "2px 0 6px", fontSize: "12px" }}>{ax.note}</p>
            <ul style={{ margin: 0, paddingLeft: "14px", fontSize: "11px", lineHeight: 1.5 }}>
              {ax.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- Gap compare chart (grouped, écart par segment) ----------
function GapCompareChart({ datasets, topics }) {
  const ref = useRef(null);
  const themeV = useThemeVersion();
  const tick = cssVar("--chart-tick", "#64748b");
  const grid = cssVar("--chart-grid", "rgba(0,0,0,0.06)");
  useChart(ref, {
    type: "bar",
    data: { labels: topics, datasets },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", align: "end", labels: { color: tick, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} : +${ctx.parsed.x} pts` } },
      },
      scales: {
        x: { beginAtZero: true, max: 60, grid: { color: grid }, ticks: { callback: (v) => v + " pts", color: tick } },
        y: { grid: { display: false }, ticks: { color: tick, font: { size: 11 } } },
      },
    },
  }, [JSON.stringify(datasets), JSON.stringify(topics), themeV]);
  return <canvas ref={ref} />;
}

// ---------- Gap heatmap ----------
function GapHeatmap({ src, topics, segLabels }) {
  const gapColor = (val) => {
    const pct = Math.min(val / 55, 1);
    return `rgb(${Math.round(248 - 55 * pct)},${Math.round(215 - 158 * pct)},${Math.round(218 - 171 * pct)})`;
  };
  return (
    <div className="gap-heatmap">
      <table>
        <thead>
          <tr>
            <th className="gap-heatmap-label">Thème</th>
            {segLabels.map(s => <th key={s}>{s}</th>)}
          </tr>
        </thead>
        <tbody>
          {topics.map((topic, i) => (
            <tr key={topic}>
              <td className="gap-heatmap-label">{topic}</td>
              {Object.keys(src).map((seg, j) => {
                const val = src[seg]?.[i] ?? 0;
                return <td key={j} style={{ background: gapColor(val), color: val > 33 ? "#fff" : "#333" }}>{val}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Diverging gap chart ----------
function GapChart({ items }) {
  const ref = useRef(null);
  const themeV = useThemeVersion();
  const accent1 = cssVar("--accent-1", "#c1392f");
  const accent2 = cssVar("--accent-2", "#94a3b8");
  const tick = cssVar("--chart-tick", "#64748b");
  const grid = cssVar("--chart-grid", "rgba(0,0,0,0.06)");
  useChart(ref, {
    type: "bar",
    data: {
      labels: items.map((i) => i.sujet),
      datasets: [
      { label: "Formation reçue", data: items.map((i) => i.recue), backgroundColor: accent2, borderRadius: 4, barPercentage: 0.85 },
      { label: "Besoin exprimé", data: items.map((i) => i.besoin), backgroundColor: accent1, borderRadius: 4, barPercentage: 0.85 }]

    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", align: "end", labels: { color: tick, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} : ${ctx.parsed.x}%` } }
      },
      scales: {
        x: { beginAtZero: true, max: 80, grid: { color: grid }, ticks: { callback: (v) => v + "%", color: tick } },
        y: { grid: { display: false }, ticks: { color: tick, font: { size: 11 } } }
      }
    }
  }, [JSON.stringify(items), themeV]);
  return <canvas ref={ref} />;
}

// ---------- Stacked horizontal (réseau) ----------
function StackedNetwork({ items }) {
  const ref = useRef(null);
  const themeV = useThemeVersion();
  const accent1 = cssVar("--accent-1", "#2c5e8c");
  const accent2 = cssVar("--accent-2", "#94a3b8");
  const muted = cssVar("--muted", "#d6dde6");
  const tick = cssVar("--chart-tick", "#64748b");
  const grid = cssVar("--chart-grid", "rgba(0,0,0,0.06)");
  useChart(ref, {
    type: "bar",
    data: {
      labels: items.map((i) => i.acteur),
      datasets: [
      { label: "Régulier", data: items.map((i) => i.regulier), backgroundColor: accent1, stack: "s" },
      { label: "Parfois", data: items.map((i) => i.parfois), backgroundColor: accent2, stack: "s" },
      { label: "Jamais", data: items.map((i) => i.jamais), backgroundColor: muted, stack: "s" }]

    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", align: "end", labels: { color: tick, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label} : ${ctx.parsed.x}` } }
      },
      scales: {
        x: { stacked: true, grid: { color: grid }, ticks: { color: tick } },
        y: { stacked: true, grid: { display: false }, ticks: { color: tick, font: { size: 11 } } }
      }
    }
  }, [JSON.stringify(items), themeV]);
  return <canvas ref={ref} />;
}

// ---------- FilterBar ----------
function FilterBar({ filters, setFilters, filteredCount, totalCount, compact }) {
  const fields = [
  { id: "region", label: "Territoire", options: ["Béarn", "Pays Basque", "Pays Basque Intérieur"] },
  { id: "age", label: "Tranche d'âge", options: Object.keys(DATA.distributions.age_tranche) },
  { id: "anciennete", label: "Ancienneté", options: Object.keys(DATA.distributions.anciennete_benevole) },
  { id: "territoire", label: "Type de commune", options: Object.keys(DATA.distributions.type_territoire) }];

  const reset = () => setFilters({ region: "all", age: "all", anciennete: "all", territoire: "all" });
  const hasFilter = Object.values(filters).some((v) => v !== "all");

  return (
    <div className={`filter-bar ${compact ? "compact" : ""}`}>
      <div className="filter-fields">
        {fields.map((f) =>
        <label key={f.id} className="filter-field">
            <span className="filter-label" style={{ fontSize: "14px" }}>{f.label}</span>
            <select value={filters[f.id]} onChange={(e) => setFilters({ ...filters, [f.id]: e.target.value })}>
              <option value="all">Tous</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="filter-status">
        <span className="filter-count" style={{ fontSize: "16px" }}><strong style={{ fontFamily: "\"JetBrains Mono\"" }}>{filteredCount}</strong> / {totalCount} répondants</span>
        {hasFilter && <button type="button" className="filter-reset" onClick={reset}>Réinitialiser</button>}
      </div>
    </div>);

}

// ---------- KPI ----------
function KPIBlock({ k }) {
  return (
    <div className="kpi-block">
      <div className="kpi"><div className="kpi-value">{k.n}</div><div className="kpi-label" style={{ fontSize: "14px" }}>répondants</div></div>
      <div className="kpi"><div className="kpi-value">{k.retraite_pct}<span>%</span></div><div className="kpi-label" style={{ fontSize: "14px" }}>retraité·es</div></div>
      <div className="kpi"><div className="kpi-value">{k.rural_pct}<span>%</span></div><div className="kpi-label" style={{ fontSize: "14px" }}>en milieu rural</div></div>
      <div className="kpi"><div className="kpi-value">{k.anc_moyen.toFixed(1)}<span>ans</span></div><div className="kpi-label" style={{ fontSize: "14px" }}>d'ancienneté moyenne</div></div>
    </div>);

}

// ---------- K Slider (reusable) ----------
function KSlider({ k, setK }) {
  return (
    <div className="k-control" style={{ marginBottom: "24px" }}>
      <label style={{ textAlign: "center" }}>
        <span style={{ textAlign: "center" }}>Nombre de profils types (K)</span>
        <input type="range" min="2" max="6" step="1" value={k} onChange={(e) => setK(parseInt(e.target.value))} />
        <strong className="k-value">{k}</strong>
      </label>
    </div>
  );
}

// Generate comparison text for selected clusters
function generateClusterComparison(profiles, selected) {
  if (selected.length < 2) return "";
  const axes = DATA.radarAxes;
  const sprofs = selected.map(id => profiles[id]);
  const names = selected.map((id, i) => `G${parseInt(id) + 1} (${sprofs[i].label})`).join(" et ");

  const [pa, pb] = sprofs;
  const diffs = axes.map((ax, i) => ({ ax, diff: Math.abs(pa.radar[i] - pb.radar[i]), aVal: pa.radar[i], bVal: pb.radar[i] }));
  diffs.sort((a, b) => b.diff - a.diff);
  const contrastLines = diffs.slice(0, 2).map(({ ax, aVal, bVal }) => {
    const hiId = aVal >= bVal ? selected[0] : selected[1];
    const loId = aVal >= bVal ? selected[1] : selected[0];
    return `« ${ax} » : G${parseInt(hiId) + 1} ${Math.round(Math.max(aVal, bVal) * 100)} % vs G${parseInt(loId) + 1} ${Math.round(Math.min(aVal, bVal) * 100)} %`;
  }).join(" ; ");

  const domA = axes[pa.radar.indexOf(Math.max(...pa.radar))];
  const domB = axes[pb.radar.indexOf(Math.max(...pb.radar))];
  const domText = domA === domB
    ? `Les deux partagent « ${domA} » comme axe dominant.`
    : `G${parseInt(selected[0]) + 1} se définit par « ${domA} », G${parseInt(selected[1]) + 1} par « ${domB} ».`;

  return `${names}. Contrastes principaux : ${contrastLines}. ${domText}`;
}

// ---------- Cluster comparator ----------
function ClusterComparator({ k }) {
  const profiles = DATA.clusters[`k${k}`].profiles;
  const ids = Object.keys(profiles);
  const [selected, setSelected] = useState(() => ids.slice(0, Math.min(2, ids.length)));

  useEffect(() => {
    setSelected(ids.slice(0, Math.min(2, ids.length)));
  }, [k]);

  const toggle = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      if (prev.length >= 3) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const palette = ["#2c5e8c", "#c1392f", "#7e8a3b", "#7a5d8b", "#c47a3a", "#3a8c8c"];

  const datasets = selected.map((id, i) => ({
    label: `G${parseInt(id) + 1} · ${profiles[id].label}`,
    values: profiles[id].radar,
    color: palette[i],
    fill: palette[i] + "33"
  }));

  return (
    <div className="comparator">
      <div className="comparator-pills">
        {ids.map((id, i) => {
          const p = profiles[id];
          const isSel = selected.includes(id);
          return (
            <button key={id} type="button"
            className={`pill ${isSel ? "pill-on" : ""}`}
            onClick={() => toggle(id)}
            style={isSel ? { borderColor: palette[selected.indexOf(id)], background: palette[selected.indexOf(id)] + "18", color: palette[selected.indexOf(id)] } : {}}>
              <span className="pill-num">G{parseInt(id) + 1}</span>
              <span className="pill-label">{p.label}</span>
              <span className="pill-n">{p.n}</span>
            </button>);

        })}
      </div>

      <div className="comparator-body">
        <p style={{ fontSize: "15px", lineHeight: 1.6, color: "var(--ink-soft)", marginBottom: "24px" }}>
          {generateClusterComparison(profiles, selected)}
        </p>
        <RadarLegend />
        <div className="comparator-radar">
          <RadarChart axes={DATA.radarAxes} datasets={datasets} />
        </div>
        <div className="comparator-table">
          <table>
            <thead>
              <tr>
                <th></th>
                {selected.map((id, i) =>
                <th key={id} style={{ color: palette[i] }}>G{parseInt(id) + 1}</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr><td>Effectif</td>{selected.map((id) => <td key={id}>{profiles[id].n}</td>)}</tr>
              <tr><td>Âge moyen</td>{selected.map((id) => <td key={id}>{Math.round(profiles[id].avg_age)}&nbsp;ans</td>)}</tr>
              <tr><td>Ancienneté moy.</td>{selected.map((id) => <td key={id}>{profiles[id].avg_senio.toFixed(1)}&nbsp;ans</td>)}</tr>
              <tr>
                <td>Besoins prioritaires</td>
                {selected.map((id) =>
                <td key={id}>
                    <div className="needs-list">
                      {profiles[id].top_needs.map((n) => <span key={n} className="need-tag">{n}</span>)}
                    </div>
                  </td>
                )}
              </tr>
              <tr>
                <td>Description</td>
                {selected.map((id) => <td key={id} className="desc-cell">{profiles[id].summary || "–"}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="comparator-hint">Cliquez les pastilles pour ajouter / retirer un groupe (max 3).</p>

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> L'outil de comparaison directe entre profils complète l'analyse agrégée de la section 3 en permettant une lecture par contraste. Là où la section 3 décrit chaque groupe individuellement, ici on peut mettre deux ou trois groupes en regard et identifier précisément sur quelles dimensions leurs trajectoires divergent. Cette lecture différentielle est la plus utile pour concevoir des parcours de formation différenciés.</p>
        <p style={{ margin: "0 0 12px" }}>Le texte de synthèse généré automatiquement sous le radar identifie les axes les plus discriminants entre les groupes sélectionnés. Il s'agit d'une aide à la lecture, pas d'une conclusion : les chiffres mentionnés (scores en pourcentage) reflètent des moyennes de groupe qui peuvent masquer une dispersion interne importante. Avant d'agir sur la base de cet écart, il est utile de vérifier la compacité du groupe concerné via la section 3 ou les fiches individuelles (section 11).</p>
        <p style={{ margin: "0 0 12px" }}>Le tableau comparatif en bas de section fournit les indicateurs factuels (effectif, âge moyen, ancienneté, besoins prioritaires) qui donnent corps aux différences visuelles du radar. Un groupe de bénévoles jeunes et récents aura structurellement des scores différents d'un groupe expérimenté, indépendamment de toute différence de motivation ou de contexte.</p>
        <p style={{ margin: 0 }}>Cet outil est particulièrement utile lors de présentations aux équipes de Biblio64 ou aux partenaires institutionnels : il permet de naviguer interactivement dans les données sans nécessiter de connaissance statistique préalable, et de répondre en temps réel aux questions du type "et si on compare les jeunes bénévoles aux plus expérimentés ?".</p>
      </CommentBox>
    </div>);

}

// ---------- Accordion ----------
function Accordion({ id, num, title, hint, children, defaultOpen = false, openSet, setOpenSet }) {
  const isControlled = openSet && setOpenSet;
  const isOpen = isControlled ? openSet.has(id) : undefined;
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = isControlled ? isOpen : localOpen;
  const toggle = () => {
    if (isControlled) {
      const next = new Set(openSet);
      next.has(id) ? next.delete(id) : next.add(id);
      setOpenSet(next);
    } else {
      setLocalOpen((o) => !o);
    }
  };
  return (
    <section className={`acc ${open ? "acc-open" : ""}`} id={`section-${id}`}>
      <button type="button" className="acc-header" onClick={toggle} aria-expanded={open} style={{ height: "150px" }}>
        <span className="acc-num">{num}</span>
        <span className="acc-title-wrap" style={{ height: "100px" }}>
          <span className="acc-title">{title}</span>
          {hint && <span className="acc-hint" style={{ fontSize: "14px", padding: "20px 0px", height: "50px", margin: "20px 0px" }}>{hint}</span>}
        </span>
        <span className="acc-chev" aria-hidden>{open ? "−" : "+"}</span>
      </button>
      <div className="acc-body" hidden={!open} style={{ padding: "8px 0px 48px" }}>
        {open && children}
      </div>
    </section>);

}

// ---------- CommentBox ----------
function CommentBox({ children }) {
  return (
    <div style={{
      margin: "40px 0 8px",
      padding: "20px 24px",
      background: "#D6E4F0",
      borderLeft: "4px solid #C1392F",
      borderRadius: "4px",
      fontSize: "14px",
      lineHeight: 1.75,
      color: "#1D1916"
    }}>
      {children}
    </div>
  );
}

// ---------- Heatmap table ----------
function HeatmapTable({ colonnes, lignes, labelKey, max = 100 }) {
  const cellColor = (v) => {
    const t = Math.min(v / max, 1);
    const r = Math.round(200 + 55 * (1 - t));
    const g = Math.round(230 - 130 * t);
    const b = Math.round(200 - 150 * t);
    return `rgb(${r},${g},${b})`;
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--ink)", fontWeight: 600, borderBottom: "2px solid var(--rule)", minWidth: "150px" }}></th>
            {colonnes.map((c) => <th key={c} style={{ padding: "8px 12px", textAlign: "center", color: "var(--ink)", fontWeight: 600, borderBottom: "2px solid var(--rule)", whiteSpace: "nowrap" }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {lignes.map((row, i) => (
            <tr key={i}>
              <td style={{ padding: "7px 12px", textAlign: "left", color: "var(--ink)", fontWeight: 400, whiteSpace: "nowrap", minWidth: "150px", borderBottom: "1px solid var(--rule)" }}>{row[labelKey]}</td>
              {row.valeurs.map((v, j) => (
                <td key={j} style={{ padding: "7px 12px", textAlign: "center", background: cellColor(v), color: "#1d1916", fontWeight: 600, borderBottom: "1px solid var(--rule)" }}>
                  {v}%
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Boxplot ----------
function BoxplotChart({ items, max = 2 }) {
  const palette = ["#2c5e8c", "#c1392f", "#7e8a3b"];
  const pct = (v) => (v / max) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "16px 0" }}>
      {items.map((d, i) => {
        const color = palette[i % palette.length];
        return (
          <div key={d.bloc} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ width: "90px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{d.bloc}</span>
            <div style={{ flex: 1, position: "relative", height: "32px" }}>
              <div style={{ position: "absolute", top: "50%", left: `${pct(d.min)}%`, width: `${pct(d.max - d.min)}%`, height: "1px", background: color, opacity: 0.5 }} />
              <div style={{ position: "absolute", top: "50%", left: `${pct(d.min)}%`, transform: "translateY(-50%)", width: "1px", height: "14px", background: color }} />
              <div style={{ position: "absolute", top: "50%", left: `${pct(d.max)}%`, transform: "translateY(-50%)", width: "1px", height: "14px", background: color }} />
              <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: `${pct(d.q1)}%`, width: `${pct(d.q3 - d.q1)}%`, height: "24px", background: color + "25", border: `2px solid ${color}`, borderRadius: "4px" }} />
              <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: `${pct(d.median)}%`, width: "3px", height: "24px", background: color, borderRadius: "2px" }} />
            </div>
            <span style={{ width: "40px", fontSize: "11px", color: "var(--ink-soft)" }}>{d.median.toFixed(2)}</span>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ width: "90px" }} />
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--ink-soft)" }}>
          {[0, 0.5, 1, 1.5, 2].map((v) => <span key={v}>{v}</span>)}
        </div>
        <span style={{ width: "40px" }} />
      </div>
    </div>
  );
}

// ---------- PNG helpers ----------
function PngCard({ src, caption, alt }) {
  return (
    <div className="chart-card" style={{ textAlign: "center" }}>
      {caption && <h4>{caption}</h4>}
      <img src={`../png/${src}`} alt={alt || caption || ""} style={{ width: "100%", height: "auto", display: "block", borderRadius: "4px" }} />
    </div>
  );
}

function PngGrid({ images }) {
  return (
    <div className="grid-charts">
      {images.map(({ src, caption }) => <PngCard key={src} src={src} caption={caption} />)}
    </div>
  );
}

// ---------- Main report sections ----------
function OverviewSection({ filtered }) {
  const ageDist = distribute(filtered, "age_tranche");
  const regionDist = distribute(filtered, "region");
  const sitDist = distribute(filtered, "situation_pro");
  const ancDist = distribute(filtered, "anciennete_benevole");
  const terDist = distribute(filtered, "type_territoire");

  // Order keys to match canonical ordering
  const ordered = (dist, ref) => {
    const labels = Object.keys(ref).filter((k) => dist[k]);
    return { labels, values: labels.map((l) => dist[l]) };
  };

  const age = ordered(ageDist, DATA.distributions.age_tranche);
  const reg = ordered(regionDist, DATA.distributions.region);
  const sit = ordered(sitDist, DATA.distributions.situation_pro);
  const anc = ordered(ancDist, DATA.distributions.anciennete_benevole);
  const ter = ordered(terDist, DATA.distributions.type_territoire);

  return (
    <div>
      <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "24px", color: "var(--ink)" }}>Territoire</h3>
      <div className="grid-charts" style={{ marginBottom: "48px" }}>
        <div className="chart-card">
          <h4>Territoires</h4>
          <div className="chart-h"><DoughnutChart labels={reg.labels} values={reg.values} colors={["#2c5e8c", "#c1392f", "#a06c4f"]} /></div>
        </div>
        <div className="chart-card">
          <h4>Type de territoire</h4>
          <div className="chart-h"><DoughnutChart labels={ter.labels} values={ter.values} colors={["#7e8a3b", "#c47a3a", "#94a3b8"]} /></div>
        </div>
      </div>

      <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "48px 0 24px", color: "var(--ink)" }}>Caractéristiques des bibliothèques</h3>
      <div className="grid-charts">
        {DATA.caracterisationBiblio?.localisation?.length > 0 && (
          <div className="chart-card">
            <h4>Localisation (urbain/rural)</h4>
            <div className="chart-h">
              <DoughnutChart labels={DATA.caracterisationBiblio.localisation.map((d) => d.modalite)} values={DATA.caracterisationBiblio.localisation.map((d) => d.pct)} colors={["#7e8a3b", "#c47a3a", "#2c5e8c"]} />
            </div>
          </div>
        )}
        {DATA.caracterisationBiblio?.superficie?.length > 0 && (
          <div className="chart-card">
            <h4>Superficie</h4>
            <div className="chart-h">
              <BarChart labels={DATA.caracterisationBiblio.superficie.map((d) => d.modalite)} values={DATA.caracterisationBiblio.superficie.map((d) => d.pct)} color="#2c5e8c" max={100} suffix="%" />
            </div>
          </div>
        )}
        {DATA.caracterisationBiblio?.heuresOuverture?.length > 0 && (
          <div className="chart-card">
            <h4>Heures d'ouverture par semaine</h4>
            <div className="chart-h">
              <BarChart labels={DATA.caracterisationBiblio.heuresOuverture.map((d) => d.modalite)} values={DATA.caracterisationBiblio.heuresOuverture.map((d) => d.pct)} color="#7a5d8b" max={100} suffix="%" />
            </div>
          </div>
        )}
        {DATA.caracterisationBiblio?.joursOuverture?.length > 0 && (
          <div className="chart-card">
            <h4>Jours d'ouverture par semaine</h4>
            <div className="chart-h">
              <BarChart labels={DATA.caracterisationBiblio.joursOuverture.map((d) => d.modalite)} values={DATA.caracterisationBiblio.joursOuverture.map((d) => d.pct)} color="#c47a3a" max={100} suffix="%" />
            </div>
          </div>
        )}
      </div>
      {DATA.servicesHeatmap?.lignes?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Fréquence d'utilisation des services complémentaires</h4>
          <HeatmapTable colonnes={DATA.servicesHeatmap.colonnes} lignes={DATA.servicesHeatmap.lignes} labelKey="variable" />
        </div>
      )}

      <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "48px 0 24px", color: "var(--ink)" }}>Âge et ancienneté</h3>
      <div className="grid-charts" style={{ marginBottom: "48px" }}>
        <div className="chart-card" style={{ textAlign: "left" }}>
          <h4>Âges</h4>
          <div className="chart-h"><DoughnutChart labels={age.labels} values={age.values} colors={["#dde6ef", "#9fb6cd", "#5d83a8", "#2c5e8c", "#1a3f5e"]} /></div>
        </div>
        <div className="chart-card">
          <h4>Ancienneté</h4>
          <div className="chart-h"><BarChart labels={anc.labels} values={anc.values} color="#7e8a3b" /></div>
        </div>
        <div className="chart-card">
          <h4>Situation professionnelle</h4>
          <div className="chart-h"><BarChart labels={sit.labels} values={sit.values} color="#2c5e8c" horizontal /></div>
        </div>
      </div>

      <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "48px 0 24px", color: "var(--ink)" }}>Domaines d'activité</h3>
      {DATA.activitesHebdo?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Tâches pratiquées chaque semaine</h4>
          <div className="chart-h tall">
            <BarChart labels={DATA.activitesHebdo.map((a) => a.tache)} values={DATA.activitesHebdo.map((a) => a.pct)} color="#7e8a3b" horizontal max={100} suffix="%" />
          </div>
        </div>
      )}

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> La démographie des bénévoles de Biblio64 offre le socle descriptif à partir duquel toutes les analyses suivantes prennent sens. La répartition géographique (Béarn, Pays Basque, Pays Basque Intérieur) signale des contextes différenciés : densité associative, accessibilité aux ressources et dynamiques territoriales ne sont pas homogènes. Toute préconisation de formation gagne à être territorialisée plutôt que de s'adresser à un profil moyen fictif.</p>
        <p style={{ margin: "0 0 12px" }}>La répartition entre actifs et retraités, lisible sur le graphique de situation professionnelle, conditionne directement la disponibilité et le rythme de mobilisation envisageables. Elle permet aussi d'anticiper les enjeux de transmission : selon la composition du collectif, la question du renouvellement des bénévoles et des compétences associées se pose à des horizons différents.</p>
        <p style={{ margin: "0 0 12px" }}>La distribution de l'ancienneté éclaire la composition du collectif dans le temps. Un noyau de bénévoles très expérimentés coexiste souvent avec des entrants récents : ces deux populations n'ont ni les mêmes besoins de formation, ni les mêmes ressorts d'engagement. Le type de territoire (rural, périurbain, urbain) ajoute une couche de lecture complémentaire sur les conditions concrètes d'exercice du bénévolat.</p>
        <p style={{ margin: 0 }}>Enfin, la carte des domaines pratiqués (accueil, médiation, gestion documentaire, animation culturelle) dessine le périmètre opérationnel réel de ces bénévoles. Elle constitue la base de référence pour identifier, dans les sections 5 et 9, les thèmes pour lesquels un écart entre formation reçue et besoin exprimé justifie une action de Biblio64.</p>
      </CommentBox>
    </div>);

}

function generateProfilesInterpretation(profiles, k) {
  const profs = Object.values(profiles);
  const axes = DATA.radarAxes;

  const variances = axes.map((_, i) => {
    const vals = profs.map(p => p.radar[i]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length;
  });
  const topAxisIdx = variances.indexOf(Math.max(...variances));
  const topAxis = axes[topAxisIdx];

  const highlights = Object.entries(profiles).map(([id, p]) => {
    const domIdx = p.radar.indexOf(Math.max(...p.radar));
    return `G${parseInt(id) + 1} (${p.label}) : « ${axes[domIdx]} » ${Math.round(p.radar[domIdx] * 100)} %`;
  });

  const contrastVals = profs.map(p => p.radar[topAxisIdx]);
  const hiIdx = contrastVals.indexOf(Math.max(...contrastVals));
  const loIdx = contrastVals.indexOf(Math.min(...contrastVals));
  const hiId = Object.keys(profiles)[hiIdx];
  const loId = Object.keys(profiles)[loIdx];
  const contrastText = hiIdx !== loIdx
    ? ` L’axe le plus discriminant est « ${topAxis} » : G${parseInt(hiId) + 1} (${Math.round(contrastVals[hiIdx] * 100)} %) vs G${parseInt(loId) + 1} (${Math.round(contrastVals[loIdx] * 100)} %).`
    : "";

  const profileDesc = k === 2 ? "deux profils" : k === 3 ? "trois profils" : `${k} profils`;
  return `À K=${k}, ${profileDesc} distincts : ${highlights.join(" ; ")}.${contrastText} Ces différences orientent vers des approches de formation spécifiques pour Biblio64.`;
}

function ClustersSection({ filtered, k, setK }) {
  const profiles = DATA.clusters[`k${k}`].profiles;
  const palette = ["#2c5e8c", "#c1392f", "#7e8a3b", "#7a5d8b", "#c47a3a", "#3a8c8c"];

  return (
    <div>
      <div className="k-control">
        <label style={{ textAlign: "center" }}>
          <span style={{ textAlign: "center" }}>Nombre de profils types (K)</span>
          <input type="range" min="2" max="6" step="1" value={k} onChange={(e) => setK(parseInt(e.target.value))} />
          <strong className="k-value">{k}</strong>
        </label>
      </div>
      <RadarLegend />
      <div style={{ marginBottom: "48px", marginTop: "32px" }}>
        <p style={{ fontSize: "16px", lineHeight: 1.6, color: "var(--ink-soft)", marginBottom: "24px" }}>
          À <strong>K={k}</strong>, l'analyse révèle <strong>{k} profil{k > 1 ? 's' : ''}</strong> :
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
          {Object.entries(profiles).map(([id, p], i) => (
            <div key={id} style={{ padding: "20px", border: `1px solid var(--rule-soft)`, borderRadius: "8px", background: "var(--card-bg)", minHeight: "420px", display: "flex", flexDirection: "column" }}>
              <h4 style={{ margin: "0 0 12px 0", color: palette[i], fontSize: "16px" }}>G{parseInt(id) + 1} · {p.label}</h4>
              <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "var(--ink-soft)" }}>{p.summary}</p>
              <dl style={{ margin: "12px 0 0 0", fontSize: "13px", lineHeight: 1.8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", borderBottom: "1px solid var(--rule-soft)" }}>
                  <dt style={{ fontWeight: 600 }}>Effectif</dt>
                  <dd style={{ margin: 0 }}>{p.n} pers.</dd>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", paddingTop: "8px", borderBottom: "1px solid var(--rule-soft)" }}>
                  <dt style={{ fontWeight: 600 }}>Âge moy.</dt>
                  <dd style={{ margin: 0 }}>{Math.round(p.avg_age)} ans</dd>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: "8px", paddingTop: "8px", borderBottom: "1px solid var(--rule-soft)" }}>
                  <dt style={{ fontWeight: 600 }}>Ancienneté moy.</dt>
                  <dd style={{ margin: 0 }}>{p.avg_senio.toFixed(1)} ans</dd>
                </div>
                <div style={{ paddingTop: "8px" }}>
                  <dt style={{ fontWeight: 600, marginBottom: "6px" }}>Besoins clés</dt>
                  <dd style={{ margin: 0, display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {p.top_needs.slice(0, 3).map((n) => <span key={n} style={{ fontSize: "12px", padding: "4px 8px", background: palette[i] + "18", color: palette[i], borderRadius: "4px", fontWeight: 500 }}>{n}</span>)}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <p style={{ fontSize: "15px", lineHeight: 1.6, color: "var(--ink-soft)", marginTop: "32px", padding: "20px", background: "var(--bg-dim)", borderRadius: "8px", borderLeft: `4px solid var(--accent-1)` }}>
          {generateProfilesInterpretation(profiles, k)}
        </p>
      </div>
      <SynthesesSection k={k} />

      <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "48px 0 24px", color: "var(--ink)" }}>Analyse de clustering</h3>
      <div className="grid-charts">
        <div className="chart-card">
          <h4>Effectifs par cluster (K={k})</h4>
          <div className="chart-h">
            <BarChart
              labels={Object.keys(profiles).map((id) => profiles[id].label || `Groupe ${parseInt(id) + 1}`)}
              values={Object.keys(profiles).map((id) => profiles[id].n)}
              color="#2c5e8c"
              suffix=""
            />
          </div>
        </div>
        <div className="chart-card">
          <h4>Radar comparatif (K={k})</h4>
          <div className="chart-h" style={{ height: "360px" }}>
            <RadarChart
              axes={DATA.radarAxes}
              datasets={Object.keys(profiles).map((id, i) => ({
                label: profiles[id].label || `Groupe ${parseInt(id) + 1}`,
                values: profiles[id].radar,
                color: palette[i % palette.length],
                fill: palette[i % palette.length] + "18",
              }))}
              max={1}
            />
          </div>
        </div>
      </div>

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> L'analyse de clustering ne produit pas un classement hiérarchique des bénévoles, mais une segmentation en groupes homogènes sur les six dimensions du radar (engagement, compétences, réseau, formation, autonomie, animation). L'intérêt opérationnel est de sortir de la logique de l'individu moyen pour identifier des sous-populations avec des besoins spécifiques, qui méritent des réponses différenciées.</p>
        <p style={{ margin: "0 0 12px" }}>Le dendrogramme illustre la logique du regroupement : il montre à quel niveau de proximité deux individus ou deux groupes sont fusionnés, et donne ainsi une idée de la compacité des clusters retenus. Un dendrogramme avec des fusions tardives et bien espacées indique des groupes nettement distincts ; des fusions précoces suggèrent une population plus homogène, où les différences entre groupes sont moins tranchées.</p>
        <p style={{ margin: "0 0 12px" }}>Les effectifs par cluster permettent d'apprécier la robustesse statistique de chaque groupe : un groupe très petit (5 % ou moins de la population) doit être interprété avec prudence : il peut refléter une réalité marginale ou un artefact de la méthode. Les groupes larges fournissent les bases les plus solides pour des recommandations généralisables.</p>
        <p style={{ margin: 0 }}>Le radar comparatif est la pièce maîtresse de cette section : en superposant les profils moyens de chaque groupe, il rend visible les axes sur lesquels les groupes se distinguent le plus. Ces contrastes orientent directement la priorisation des thèmes de formation et la personnalisation des parcours que Biblio64 peut proposer à chaque profil type.</p>
      </CommentBox>
    </div>);

}

function GapRadar({ k }) {
  const globalItems = DATA.gapFormationBiblio64 || DATA.gapFormation || [];
  const clusterData = DATA.gapBiblio64ByCluster?.[`k${k}`] || {};
  const clusterIds = Object.keys(clusterData);
  const profiles = DATA.clusters?.[`k${k}`]?.profiles;

  const COLORS = {
    besoin: { color: "#c1392f", fill: "rgba(193,57,47,0.18)" },
    recue:  { color: "#2c5e8c", fill: "rgba(44,94,140,0.18)" },
  };
  const [show, setShow] = useState({ besoin: true, recue: true });
  const [clusterId, setClusterId] = useState("all");
  const toggle = (key) => setShow((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    if (!next.besoin && !next.recue) return prev;
    return next;
  });

  const items = clusterId === "all" ? globalItems : (clusterData[clusterId] || globalItems);
  const axes = items.map((it) => it.sujet);
  const datasets = [];
  if (show.besoin) datasets.push({ label: "Besoin exprimé", values: items.map((it) => it.besoin / 100), ...COLORS.besoin });
  if (show.recue)  datasets.push({ label: "Formation reçue", values: items.map((it) => it.recue / 100),  ...COLORS.recue });

  const clusterLabel = (cId) => {
    const p = profiles?.[cId];
    return p?.label ? `G${parseInt(cId) + 1} · ${p.label}` : `Groupe ${parseInt(cId) + 1}`;
  };

  return (
    <div className="gap-radar" style={{ marginBottom: "32px" }}>
      <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px", color: "var(--ink)" }}>Formations Biblio64 : besoins et formations reçues</h3>
      <p style={{ fontSize: "13px", color: "var(--ink-soft)", margin: "0 0 16px", maxWidth: "640px" }}>
        13 sujets de formation proposés par la Biblio64. Besoin exprimé : moyenne de l'intérêt déclaré (échelle 0–100). Formation reçue : pourcentage de bénévoles ayant suivi la formation.
      </p>
      <div className="comparator-pills" style={{ marginBottom: "16px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {[
          { key: "besoin", label: "Besoin exprimé" },
          { key: "recue",  label: "Formation reçue" },
        ].map(({ key, label }) => {
          const isOn = show[key];
          const c = COLORS[key];
          return (
            <button key={key} type="button"
              className={`pill ${isOn ? "pill-on" : ""}`}
              onClick={() => toggle(key)}
              style={isOn ? { borderColor: c.color, background: c.color + "18", color: c.color } : {}}>
              <span className="pill-label">{label}</span>
            </button>
          );
        })}
        <span style={{ borderLeft: "1px solid var(--ink-soft)", margin: "0 4px", opacity: 0.3 }} />
        <button type="button"
          className={`pill ${clusterId === "all" ? "pill-on" : ""}`}
          onClick={() => setClusterId("all")}
          style={clusterId === "all" ? { borderColor: "var(--accent-1)", background: "var(--accent-1)" + "18", color: "var(--accent-1)" } : {}}>
          <span className="pill-label">Tous</span>
        </button>
        {clusterIds.map((cId) => (
          <button key={cId} type="button"
            className={`pill ${clusterId === cId ? "pill-on" : ""}`}
            onClick={() => setClusterId(cId)}
            style={clusterId === cId ? { borderColor: "var(--accent-1)", background: "var(--accent-1)" + "18", color: "var(--accent-1)" } : {}}>
            <span className="pill-label">{clusterLabel(cId)}</span>
          </button>
        ))}
      </div>
      <div style={{ maxWidth: "560px", margin: "0 auto", height: "420px" }}>
        <RadarChart axes={axes} datasets={datasets} max={1} />
      </div>
      <p className="gap-hint" style={{ fontSize: "14px", textAlign: "center", color: "var(--ink-soft)", margin: "12px 0 0" }}>
        Les valeurs sont exprimées en pourcentage de bénévoles concernés. Cliquez sur une pastille pour masquer ou afficher une couche, ou sélectionnez un profil type.
      </p>
    </div>
  );
}

function GapSection({ k, setK }) {
  const [varId, setVarId] = useState("region");

  const VARS = [
    { id: "region",    label: "Région",     src: DATA.gapByRegion },
    { id: "age",       label: "Âge",        src: DATA.gapByAge },
    { id: "seniority", label: "Ancienneté", src: DATA.gapBySeniority },
    { id: "territory", label: "Territoire", src: DATA.gapByTerritory },
    { id: "cluster",   label: "Cluster",    src: DATA.gapByCluster?.[`k${k}`] },
  ].filter(v => v.src);

  const current = VARS.find(v => v.id === varId) || VARS[0];
  const segments = Object.keys(current.src);
  const topics = DATA.gapFormation.map(it => it.sujet);

  const segLabel = (seg) => {
    if (varId === "cluster") {
      const profiles = DATA.clusters?.[`k${k}`]?.profiles;
      return profiles?.[seg]?.label ? `G${parseInt(seg) + 1} · ${profiles[seg].label}` : `Groupe ${parseInt(seg) + 1}`;
    }
    return seg;
  };

  const palette = ["#2c5e8c", "#c1392f", "#7e8a3b", "#7a5d8b", "#c47a3a", "#3a8c8c"];
  const chartDatasets = segments.map((seg, i) => ({
    label: segLabel(seg),
    data: current.src[seg],
    backgroundColor: palette[i % palette.length],
    borderRadius: 3,
    barPercentage: 0.75,
  }));
  const chartHeight = Math.max(360, segments.length * topics.length * 16);

  return (
    <div className="gap-wrap">
      <KSlider k={k} setK={setK} />
      <GapRadar k={k} />
      <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "24px", color: "var(--ink)" }}>Besoins de formation exprimés</h3>
      <div className="grid-charts">
        <div className="chart-card chart-card-wide">
          <h4>Besoins de formation Biblio64 (13 sujets, triés par besoin décroissant)</h4>
          <div className="chart-h tall">
            <BarChart
              labels={[...DATA.gapFormation].sort((a, b) => b.besoin - a.besoin).map((d) => d.sujet)}
              values={[...DATA.gapFormation].sort((a, b) => b.besoin - a.besoin).map((d) => d.besoin)}
              color="#c1392f" horizontal max={100} suffix="%" />
          </div>
        </div>
        <div className="chart-card chart-card-wide">
          <h4>Écart besoin / formation reçue par sujet</h4>
          <div className="chart-h tall">
            <GapChart items={[...DATA.gapFormation].sort((a, b) => b.gap - a.gap)} />
          </div>
        </div>
      </div>
      {DATA.boxplotBlocs?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Distribution des scores de besoin par bloc (boxplot)</h4>
          <BoxplotChart items={DATA.boxplotBlocs} max={2} />
        </div>
      )}

      <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "48px 0 24px", color: "var(--ink)" }}>Potentiel de formation</h3>
      <div className="gap-toolbar" style={{ textAlign: "center" }}>
        <div className="seg">
          {VARS.map(v => (
            <button key={v.id} type="button" className={varId === v.id ? "seg-on" : ""} onClick={() => setVarId(v.id)}>{v.label}</button>
          ))}
        </div>
        {varId === "cluster" && <div style={{ marginTop: 12 }}><KSlider k={k} setK={setK} /></div>}
        <p className="gap-hint" style={{ fontSize: "16px", textAlign: "center", padding: "0px", margin: "10px 0px" }}>Lecture : chaque barre = points d'écart entre besoin exprimé et formation reçue. Plus la valeur est élevée, plus l'opportunité de programmation est forte.</p>
      </div>
      <div className="gap-chart" style={{ height: `${chartHeight}px` }}>
        <GapCompareChart datasets={chartDatasets} topics={topics} />
      </div>
      <GapHeatmap src={current.src} topics={topics} segLabels={segments.map(segLabel)} />
      <div className="gap-top">
        {[...DATA.gapFormation].sort((a, b) => b.gap - a.gap).slice(0, 3).map((it, i) =>
          <div key={it.sujet} className="gap-top-card">
            <div className="gap-rank">#{i + 1}</div>
            <div>
              <div className="gap-top-sujet">{it.sujet}</div>
              <div className="gap-top-meta">+{it.gap}&nbsp;pts d'écart entre besoin ({it.besoin}%) et formation reçue ({it.recue}%)</div>
            </div>
          </div>
        )}
      </div>

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> L'écart entre besoin exprimé et formation reçue est la donnée la plus directement actionnable de l'ensemble de l'enquête. Il ne mesure pas seulement un manque de compétences, mais une frustration : des bénévoles qui souhaitent progresser sur un thème donné et n'ont pas eu accès à une formation correspondante. Cette frustration, si elle n'est pas adressée, contribue à l'érosion de la motivation.</p>
        <p style={{ margin: "0 0 12px" }}>Le graphique de potentiel, ventilé par territoire, âge, ancienneté ou profil type, permet d'identifier les segments pour lesquels cet écart est le plus prononcé. Ce n'est pas nécessairement le même thème qui concentre le plus grand besoin dans toutes les sous-populations : un thème prioritaire pour les bénévoles béarnais peut être secondaire pour les bénévoles basques, et vice versa. La segmentation est indispensable pour éviter une réponse uniforme inadaptée.</p>
        <p style={{ margin: "0 0 12px" }}>La heatmap apporte une lecture complémentaire en croisant simultanément tous les thèmes et tous les segments. Elle révèle des structures que le graphique à barres peut masquer : des thèmes moyennement prioritaires qui le deviennent fortement pour un segment précis, ou des thèmes où l'écart est homogène sur l'ensemble de la population et justifient une réponse universelle.</p>
        <p style={{ margin: 0 }}>Les trois thèmes en tête de liste constituent le point de départ naturel d'un catalogue de formation. Mais l'interprétation gagne à être nuancée : un écart élevé sur un thème très technique (catalogage, systèmes de gestion) ne s'adresse pas de la même manière qu'un écart sur un thème transversal (communication, animation). La nature du besoin conditionne autant que son intensité le type de réponse appropriée.</p>
      </CommentBox>
    </div>
  );
}

function ActiviteSection() {
  return (
    <div>
      <div className="grid-charts">
        <div className="chart-card chart-card-wide">
          <h4>Tâches pratiquées chaque semaine</h4>
          <div className="chart-h tall">
            <BarChart labels={DATA.activitesHebdo.map((a) => a.tache)}
            values={DATA.activitesHebdo.map((a) => a.pct)}
            color="#2c5e8c" horizontal max={100} suffix="%" />
          </div>
        </div>
        <div className="chart-card">
          <h4>Temps hebdomadaire consacré</h4>
          <div className="chart-h">
            <BarChart labels={Object.keys(DATA.tempsHebdo)} values={Object.values(DATA.tempsHebdo)} color="#7e8a3b" />
          </div>
        </div>
      </div>

      <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "48px 0 24px", color: "var(--ink)" }}>Détail des activités</h3>
      <div className="grid-charts">
        {DATA.volumeHoraire?.length > 0 && (
          <div className="chart-card">
            <h4>Volume horaire hebdomadaire</h4>
            <div className="chart-h">
              <BarChart labels={DATA.volumeHoraire.map((d) => d.modalite)} values={DATA.volumeHoraire.map((d) => d.pct)} color="#2c5e8c" max={100} suffix="%" />
            </div>
          </div>
        )}
        {DATA.permanence?.length > 0 && (
          <div className="chart-card">
            <h4>Fréquence des permanences</h4>
            <div className="chart-h">
              <BarChart labels={DATA.permanence.map((d) => d.modalite)} values={DATA.permanence.map((d) => d.pct)} color="#7a5d8b" max={100} suffix="%" />
            </div>
          </div>
        )}
      </div>
      {DATA.tachesHeatmap?.lignes?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Tâches pratiquées : fréquence</h4>
          <HeatmapTable colonnes={DATA.tachesHeatmap.colonnes} lignes={DATA.tachesHeatmap.lignes} labelKey="tache" />
        </div>
      )}
      {DATA.documentsHeatmap?.lignes?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Documents utilisés : fréquence</h4>
          <HeatmapTable colonnes={DATA.documentsHeatmap.colonnes} lignes={DATA.documentsHeatmap.lignes} labelKey="document" />
        </div>
      )}

      <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "48px 0 24px", color: "var(--ink)" }}>Gouvernance</h3>
      <div className="grid-charts">
        {DATA.formalisation?.length > 0 && (
          <div className="chart-card">
            <h4>Degré de formalisation</h4>
            <div className="chart-h">
              <BarChart labels={DATA.formalisation.map((d) => d.indicateur.replace(/_/g, " "))} values={DATA.formalisation.map((d) => d.pct)} color="#c47a3a" max={100} suffix="%" />
            </div>
          </div>
        )}
        {DATA.modeGestion?.length > 0 && (
          <div className="chart-card">
            <h4>Mode de gestion</h4>
            <div className="chart-h">
              <BarChart labels={DATA.modeGestion.map((d) => d.modalite)} values={DATA.modeGestion.map((d) => d.pct)} color="#2c5e8c" horizontal max={100} suffix="%" />
            </div>
          </div>
        )}
      </div>

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> Le volume hebdomadaire de l'activité bénévole constitue l'une des données les plus directement opérationnelles de l'enquête. Le graphique des tâches pratiquées chaque semaine donne à voir quelles fonctions sont réellement portées par les bénévoles (par opposition aux tâches occasionnelles ou réservées à un professionnel) et dans quelles proportions ces fonctions sont partagées au sein de la population.</p>
        <p style={{ margin: "0 0 12px" }}>Le temps consacré chaque semaine est une variable clé pour la faisabilité des formations : un bénévole engagé deux heures par semaine n'a pas les mêmes contraintes qu'un bénévole présent toute une journée. Cette distribution conditionne les formats acceptables (présentiel long, modules courts en ligne, tutorat pair-à-pair) et l'intensité des formations envisageables.</p>
        <p style={{ margin: "0 0 12px" }}>Les heatmaps de tâches et de documents permettent une lecture à deux niveaux : horizontale (quelles tâches reviennent le plus souvent sur la semaine ?) et verticale (y a-t-il des profils de bénévoles spécialisés sur certaines fonctions, ou une polyvalence généralisée ?). Cette structure fonctionnelle nuance le portrait tracé à la section 1 en le rendant actionnable.</p>
        <p style={{ margin: 0 }}>Enfin, le degré de formalisation et le mode de gestion apportent un contexte institutionnel essentiel. Une bibliothèque fortement formalisée offre un cadre dans lequel une politique de formation structurée peut plus facilement s'ancrer ; une gouvernance informelle exige des approches plus souples, fondées sur la confiance et la proximité.</p>
      </CommentBox>
    </div>);

}

function ReseauSection() {
  return (
    <div>
      <div className="chart-card chart-card-wide">
        <h4>Fréquence des échanges avec…</h4>
        <div className="chart-h tall">
          <StackedNetwork items={DATA.reseau} />
        </div>
      </div>

      {DATA.qualiteEchanges?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Qualité perçue des échanges</h4>
          <div className="chart-h tall">
            <BarChart labels={DATA.qualiteEchanges.map((d) => d.acteur)} values={DATA.qualiteEchanges.map((d) => d.pct_tres_sat)} color="#2c5e8c" horizontal max={100} suffix="%" />
          </div>
        </div>
      )}

      <div className="grid-charts">
        {DATA.motifsEngagement?.length > 0 && (
          <div className="chart-card">
            <h4>Motifs d'engagement</h4>
            <div className="chart-h tall">
              <BarChart labels={DATA.motifsEngagement.map((d) => d.categorie)} values={DATA.motifsEngagement.map((d) => d.n)} color="#c47a3a" horizontal />
            </div>
          </div>
        )}
        {DATA.rolesPercus?.length > 0 && (
          <div className="chart-card">
            <h4>Rôles perçus (score moyen)</h4>
            <div className="chart-h">
              <BarChart labels={DATA.rolesPercus.map((d) => d.role)} values={DATA.rolesPercus.map((d) => d.score)} color="#7a5d8b" horizontal max={2} />
            </div>
          </div>
        )}
        {DATA.compensations?.length > 0 && (
          <div className="chart-card">
            <h4>Compensation</h4>
            <div className="chart-h">
              <DoughnutChart labels={DATA.compensations.map((d) => d.groupe)} values={DATA.compensations.map((d) => d.pct)} colors={["#94a3b8", "#c47a3a"]} />
            </div>
          </div>
        )}
        {DATA.profilMiroir?.length > 0 && (
          <div className="chart-card">
            <h4>Ce qui plaît : ici vs ailleurs</h4>
            <div className="chart-h tall">
              <BarChart labels={DATA.profilMiroir.map((d) => d.categorie)} values={DATA.profilMiroir.map((d) => d.pct_ici)} color="#2c5e8c" horizontal max={100} suffix="%" />
            </div>
          </div>
        )}
      </div>

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> Le réseau relationnel des bénévoles de bibliothèque est souvent le vecteur principal d'apprentissage informel : c'est par les échanges avec d'autres bénévoles, avec les agents de la médiathèque de réseau ou avec des partenaires associatifs que se transmettent les pratiques, les normes et les ressources documentaires. La fréquence et la qualité de ces échanges conditionnent donc directement la capacité des bénévoles à progresser en dehors de toute formation formelle.</p>
        <p style={{ margin: "0 0 12px" }}>Le graphique de fréquence donne à voir quels acteurs sont régulièrement en contact avec les bénévoles et lesquels restent en marge. Une densité relationnelle faible avec Biblio64 ou les bibliothécaires professionnels peut signaler un besoin d'animation de réseau, plus qu'un besoin de formation technique.</p>
        <p style={{ margin: "0 0 12px" }}>Les motifs d'engagement éclairent la psychologie de l'implication : un bénévole motivé par le lien social est sensible à des formats collectifs ; un bénévole motivé par la maîtrise d'une compétence attend des contenus précis et mesurables. Cette donnée devrait guider le ton et la pédagogie des dispositifs proposés par Biblio64, au-delà du simple contenu.</p>
        <p style={{ margin: 0 }}>Enfin, les rôles occupés et le profil miroir complètent la cartographie fonctionnelle amorcée à la section 2. La comparaison entre le rôle déclaré et le profil radar permet d'identifier des bénévoles dont l'engagement pratique dépasse ce que leur formation ou leur reconnaissance institutionnelle reflète, une ressource inexploitée pour le développement du réseau.</p>
      </CommentBox>
    </div>);

}

function FichesSection({ k }) {
  const [cluster, setCluster] = useState("all");
  const [region, setRegion] = useState("all");

  useEffect(() => {
    setCluster("all");
  }, [k]);

  const filtered = DATA.respondents.filter((r) => {
    if (cluster !== "all" && String(r.clusters[`k${k}`]) !== cluster) return false;
    if (region !== "all" && r.demographics.region !== region) return false;
    return true;
  });
  const palette = Array.from({ length: k }, (_, i) => ["#2c5e8c", "#c1392f", "#7e8a3b", "#7a5d8b", "#c47a3a", "#3a8c8c"][i]);

  return (
    <div>
      <div className="fiches-toolbar">
        <label className="filter-field">
          <span className="filter-label">Profil type (K={k})</span>
          <select value={cluster} onChange={(e) => setCluster(e.target.value)}>
            <option value="all">Tous</option>
            {Array.from({ length: k }, (_, i) => {
              const profiles = DATA.clusters[`k${k}`].profiles;
              const label = profiles[String(i)]?.label || `Groupe ${i + 1}`;
              return <option key={i} value={String(i)}>G{i + 1} · {label}</option>;
            })}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-label">Territoire</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">Tous</option>
            {Object.keys(DATA.distributions.region).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <p className="filter-count"><strong>{filtered.length}</strong> fiche{filtered.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="fiches-grid">
        {filtered.map((r) => {
          const clusterAssignment = r.clusters[`k${k}`];
          return (
        <article key={r.id} className="fiche-card" style={{ "--accent": palette[clusterAssignment] }}>
            <header className="fiche-head">
              <span className="fiche-id">#{String(r.id + 1).padStart(2, "0")}</span>
              <span className="fiche-pill" style={{ background: palette[clusterAssignment] + "26", color: palette[clusterAssignment], borderColor: palette[clusterAssignment] + "66", fontWeight: 600 }}>
                G{clusterAssignment + 1}
              </span>
            </header>
            <div className="fiche-radar">
              <RadarChart axes={DATA.radarAxes}
            datasets={[
            { values: r.radar_data.scores, color: palette[clusterAssignment], fill: palette[clusterAssignment] + "33", label: "Cette personne" },
            { values: DATA.clusters[`k${k}`].profiles[String(clusterAssignment)].radar, color: "#475569", fill: "transparent", label: "Moyenne G" + (clusterAssignment + 1) }]
            } />
            </div>
            <dl className="fiche-meta">
              <div><dt>Âge</dt><dd>{r.demographics.age_tranche}</dd></div>
              <div><dt>Territoire</dt><dd>{r.demographics.region}</dd></div>
              <div><dt>Ancienneté</dt><dd>{r.demographics.anciennete_benevole}</dd></div>
              <div><dt>Situation</dt><dd>{r.demographics.situation_pro}</dd></div>
            </dl>
          </article>
        );
        })}
      </div>

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Mode d'emploi des fiches individuelles.</strong> Cette section est un outil de navigation, non une source d'analyse agrégée. Chaque fiche présente le portrait radar d'un répondant superposé à la moyenne du groupe auquel il est rattaché (pour la valeur de K choisie). L'écart entre les deux profils indique dans quelle mesure ce bénévole est représentatif de son groupe ou s'en distingue sur certaines dimensions.</p>
        <p style={{ margin: "0 0 12px" }}>Les filtres par profil type et par territoire permettent d'isoler des sous-ensembles pertinents pour des actions ciblées : préparer un entretien approfondi, constituer un groupe de travail, ou vérifier si une recommandation formulée pour un groupe reste cohérente avec la diversité interne de ce groupe.</p>
        <p style={{ margin: 0 }}>L'anonymat des répondants est préservé : les fiches ne comportent pas de nom ni d'identifiant nominatif, uniquement un numéro d'ordre et les dimensions démographiques utilisées dans l'ensemble du rapport.</p>
      </CommentBox>
    </div>);

}

// Synthesis cluster cards (section 12)
function SynthesesSection({ k }) {
  const profiles = DATA.clusters[`k${k}`].profiles;
  const palette = ["#2c5e8c", "#c1392f", "#7e8a3b", "#7a5d8b", "#c47a3a", "#3a8c8c"];
  return (
    <div className="syntheses-grid">
      {Object.entries(profiles).map(([id, p], i) =>
      <article key={id} className="synthese-card" style={{ "--accent": palette[i] }}>
          <div className="synthese-radar">
            <RadarChart axes={DATA.radarAxes}
          datasets={[
          { values: p.radar, color: palette[i], fill: palette[i] + "33", label: p.label },
          { values: DATA.radarAxes.map((_, idx) => DATA.respondents.reduce((a, r) => a + r.radar_data.scores[idx], 0) / DATA.respondents.length),
            color: "#94a3b8", fill: "transparent", label: "Tous" }]
          } />
          </div>
          <div className="synthese-body">
            <h4 style={{ color: palette[i] }}>G{parseInt(id) + 1} · {p.label}</h4>
            <p>{p.summary}</p>
            <div className="needs-list">
              {p.top_needs.map((n) => <span key={n} className="need-tag" style={{ background: palette[i] + "26", color: palette[i], borderColor: palette[i] + "66", fontWeight: 600 }}>{n}</span>)}
            </div>
            <p className="synthese-meta">{p.n} bénévoles · âge moy. {Math.round(p.avg_age)} ans · ancienneté moy. {p.avg_senio.toFixed(1)} ans</p>
          </div>
        </article>
      )}
    </div>);

}

// Comparison radar by region (section 11)
function InterRadarsSection() {
  const byRegion = useMemo(() => {
    const out = {};
    Object.keys(DATA.distributions.region).forEach((r) => {
      const subset = DATA.respondents.filter((x) => x.demographics.region === r);
      out[r] = radarAverage(subset);
    });
    return out;
  }, []);
  const colors = { "Béarn": "#2c5e8c", "Pays Basque": "#c1392f", "Pays Basque Intérieur": "#a06c4f" };
  return (
    <div>
      <div className="chart-card chart-card-wide">
        <h4>Typologie des réponses par territoire</h4>
        <p className="muted">Pays Basque (n=9) et Pays Basque Intérieur (n=7) : effectifs faibles, lecture indicative.</p>
        <RadarLegend />
        <div className="chart-h xtall">
          <RadarChart axes={DATA.radarAxes}
          datasets={Object.entries(byRegion).map(([r, vals]) => ({
            label: r, values: vals, color: colors[r], fill: colors[r] + "22"
          }))} />
        </div>
      </div>

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> La comparaison inter-territoriale est l'une des lectures les plus stimulantes (et les plus délicates) de l'enquête. Elle offre une vue simultanée des trois zones géographiques sur les six dimensions du radar, permettant d'identifier où les territoires convergent et où ils divergent de manière significative. Mais la prudence s'impose : les effectifs du Pays Basque et du Pays Basque Intérieur sont faibles, ce qui rend les conclusions particulièrement sensibles à des cas individuels atypiques.</p>
        <p style={{ margin: "0 0 12px" }}>Lorsqu'un territoire se distingue nettement des autres sur une dimension, deux hypothèses doivent être testées avant de conclure. Première hypothèse : une différence réelle de pratiques, de ressources ou de contexte qui explique le score plus élevé ou plus faible. Deuxième hypothèse : un biais de composition de l'échantillon (profil d'âge, ancienneté, type de territoire dans le territoire) qui explique mécaniquement l'écart sans qu'il reflète une différence de fond.</p>
        <p style={{ margin: "0 0 12px" }}>Les dimensions où les trois territoires sont proches suggèrent des besoins communs sur lesquels une réponse de Biblio64 peut être mutualisée sans différenciation territoriale. Les dimensions où les écarts sont marqués invitent à une approche localisée, voire à des dispositifs distincts selon le contexte.</p>
        <p style={{ margin: 0 }}>Cette section est également utile pour des conversations avec les partenaires institutionnels de Biblio64 (DRAC, Département) : elle fournit un argument visuel sur les inégalités territoriales de l'offre de formation et de la structuration du bénévolat bibliothécaire en Pyrénées-Atlantiques.</p>
      </CommentBox>
    </div>);

}

function FreinsSection() {
  const items = (DATA.freinsDistribution || []).filter((d) => d.pct > 0);
  return (
    <div>
      {items.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Freins aux projets : distribution des catégories</h4>
          <div className="chart-h tall">
            <BarChart
              labels={items.map((d) => d.categorie)}
              values={items.map((d) => d.pct)}
              color="#9b6b4a"
              horizontal
              max={100}
              suffix="%"
            />
          </div>
        </div>
      )}
      {DATA.freinsComposites?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Freins composites : catégories les plus citées</h4>
          <div className="chart-h tall">
            <BarChart labels={DATA.freinsComposites.map((d) => d.categorie)} values={DATA.freinsComposites.map((d) => d.n)} color="#9b6b4a" horizontal />
          </div>
        </div>
      )}

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> L'analyse des freins à l'engagement est l'envers indispensable de la cartographie des besoins : elle rappelle que la demande de formation n'est pas seulement une question de contenu manquant, mais aussi de conditions permettant ou empêchant l'investissement dans un apprentissage supplémentaire. Un bénévole contraint par le temps ou l'éloignement géographique ne peut accéder aux mêmes dispositifs qu'un bénévole en milieu urbain avec une disponibilité flexible.</p>
        <p style={{ margin: "0 0 12px" }}>La distribution des catégories de freins donne à Biblio64 une grille de priorisation : les obstacles les plus fréquents doivent être levés en premier, même partiellement, pour que les offres de formation aient une chance d'être accessibles à la majorité. Certains freins (manque de compétences perçu, sentiment d'isolement) sont eux-mêmes des points d'entrée pour une offre d'accompagnement adaptée.</p>
        <p style={{ margin: "0 0 12px" }}>Les indicateurs composites apportent une lecture synthétique au-delà des freins isolés : ils permettent d'identifier des profils de vulnérabilité cumulant plusieurs types de contraintes. Ces profils concentrés méritent une attention spécifique dans la conception des réponses de Biblio64, car ils sont souvent les plus sous-représentés dans les publics de formation.</p>
        <p style={{ margin: 0 }}>La mise en regard de ces freins avec les données démographiques de la section 1 (territoire rural, ancienneté, situation professionnelle) permet d'affiner encore l'analyse. Certaines sous-populations cumulent des contraintes territoriales, temporelles et relationnelles qui appellent des modalités d'intervention spécifiques : accompagnement à distance, soutien pair-à-pair, ressources asynchrones.</p>
      </CommentBox>
    </div>);
}

function AnimationSection() {
  const capacite = DATA.animationCapacite || [];
  const types = DATA.animationTypes || [];
  const COLORS_CAP = ["#4a7ebf", "#7eb3f5", "#c0392b", "#e07b6a"];
  return (
    <div>
      <div className="grid-charts">
        {capacite.length > 0 && (
          <div className="chart-card">
            <h4>Capacité à piloter des animations</h4>
            <div className="chart-h">
              <DoughnutChart
                labels={capacite.map((d) => d.modalite)}
                values={capacite.map((d) => d.pct)}
                colors={COLORS_CAP.slice(0, capacite.length)}
              />
            </div>
          </div>
        )}
        {types.length > 0 && (
          <div className="chart-card chart-card-wide">
            <h4>Types d'animation organisés (% ayant organisé)</h4>
            <div className="chart-h tall">
              <BarChart
                labels={types.map((d) => d.type)}
                values={types.map((d) => d.pct_organise)}
                color="#2c7a4b"
                horizontal
                max={100}
                suffix="%"
              />
            </div>
          </div>
        )}
      </div>
      {DATA.experienceVsFormation?.length > 0 && (
        <div className="chart-card chart-card-wide">
          <h4>Expérience d'animation vs intérêt pour la formation</h4>
          <div className="chart-h tall">
            <BarChart labels={DATA.experienceVsFormation.map((d) => d.type)} values={DATA.experienceVsFormation.map((d) => d.pct_organise)} color="#2c7a4b" horizontal max={100} suffix="%" />
          </div>
        </div>
      )}

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> La capacité d'animation est l'une des compétences les plus différenciantes dans le paysage du bénévolat bibliothécaire : elle distingue les bénévoles centrés sur la gestion documentaire de ceux qui portent une fonction de médiation culturelle active. Le graphique de capacité déclarée permet de mesurer la proportion de bénévoles qui se positionnent comme capables d'animer (avec ou sans soutien) et ceux qui s'en sentent éloignés.</p>
        <p style={{ margin: "0 0 12px" }}>La distinction entre "capable de manière autonome" et "capable avec soutien" est particulièrement précieuse pour calibrer une offre de formation : le deuxième groupe représente un potentiel de montée en compétences directement mobilisable, sans nécessiter une formation longue ou coûteuse. Un accompagnement ciblé (tutorat, co-animation, partage de ressources) peut suffire à lever le frein.</p>
        <p style={{ margin: "0 0 12px" }}>Le croisement entre expérience et formation révèle si les compétences d'animation sont principalement autodidactes ou si elles ont été structurées par des dispositifs formels. Une proportion élevée d'animateurs sans formation spécifique indique un besoin latent fort et une opportunité pour Biblio64 de valoriser des pratiques existantes en leur donnant un cadre reconnu.</p>
        <p style={{ margin: 0 }}>La diversité des types d'animation organisés dessine enfin un répertoire d'expériences à partir duquel Biblio64 peut construire une communauté de pratiques : les bénévoles qui animent des ateliers, des conférences ou des expositions ont des savoir-faire mutualisables, à condition que des espaces d'échange soient créés pour les mobiliser collectivement.</p>
      </CommentBox>
    </div>);
}

function PoursuiteSection() {
  const dispo = DATA.poursuiteDisponibilite || [];
  const modalites = DATA.poursuiteModalites || [];
  const COLORS_DISPO = ["#4a7ebf", "#c0392b", "#7eb3f5"];
  return (
    <div>
      <div className="grid-charts">
        {dispo.length > 0 && (
          <div className="chart-card">
            <h4>Disponibilité pour des entretiens</h4>
            <div className="chart-h">
              <DoughnutChart
                labels={dispo.map((d) => d.reponse)}
                values={dispo.map((d) => d.pct)}
                colors={COLORS_DISPO.slice(0, dispo.length)}
              />
            </div>
          </div>
        )}
        {modalites.length > 0 && (
          <div className="chart-card">
            <h4>Modalités souhaitées (base : volontaires)</h4>
            <div className="chart-h">
              <BarChart
                labels={modalites.map((d) => d.modalite)}
                values={modalites.map((d) => d.pct)}
                color="#7e5ea6"
                horizontal
                max={100}
                suffix="%"
              />
            </div>
          </div>
        )}
      </div>
      {DATA.profilPoursuiteAge?.oui?.length > 0 && (
        <div className="grid-charts">
          <div className="chart-card">
            <h4>Profil par âge : disponibles (Oui)</h4>
            <div className="chart-h">
              <BarChart labels={DATA.profilPoursuiteAge.oui.map((d) => d.modalite)} values={DATA.profilPoursuiteAge.oui.map((d) => d.pct)} color="#4a7ebf" max={100} suffix="%" />
            </div>
          </div>
          <div className="chart-card">
            <h4>Profil par âge : non disponibles</h4>
            <div className="chart-h">
              <BarChart labels={DATA.profilPoursuiteAge.non.map((d) => d.modalite)} values={DATA.profilPoursuiteAge.non.map((d) => d.pct)} color="#c0392b" max={100} suffix="%" />
            </div>
          </div>
        </div>
      )}

      <CommentBox>
        <p style={{ margin: "0 0 12px" }}><strong>Ce que révèle cette section.</strong> La disponibilité pour des entretiens approfondis constitue un indicateur composite de plusieurs réalités simultanées : la disponibilité temporelle, la motivation à s'investir davantage dans le projet collectif, et la confiance accordée à Biblio64 comme interlocuteur légitime. La proportion de bénévoles se déclarant disponibles donne une première mesure de ce capital de confiance et de disponibilité.</p>
        <p style={{ margin: "0 0 12px" }}>Les modalités souhaitées (présentiel, téléphone, visioconférence, autres) informent directement les choix logistiques de Biblio64 pour la suite de l'enquête ou pour des actions de formation. Si une modalité domine nettement, elle doit guider le format des prochaines étapes. Une répartition équilibrée invite plutôt à proposer plusieurs options en parallèle, ce qui a un coût organisationnel à anticiper.</p>
        <p style={{ margin: "0 0 12px" }}>Le croisement avec le profil par âge est particulièrement révélateur : si la disponibilité est concentrée sur certaines tranches d'âge, cela signale à la fois un biais potentiel dans les données issues d'entretiens (les répondants ne représentent plus la population totale) et une ressource humaine réelle pour des groupes de travail, des comités d'usagers ou des relais de terrain.</p>
        <p style={{ margin: 0 }}>Au-delà de son usage méthodologique, cette section révèle le degré d'implication des bénévoles dans la démarche de Biblio64 elle-même. Un fort taux de disponibilité est un signal positif sur la légitimité perçue de l'enquête et un atout pour la co-construction des réponses qui en découlent.</p>
      </CommentBox>
    </div>);
}

// All sections wired up, order matches original 13 sections
function ReportBody({ filtered }) {
  const [k, setK] = useState(2);
  const [openSet, setOpenSet] = useState(new Set(["overview", "clusters", "gap"]));

  // Listen for global events (expand/collapse all, print)
  useEffect(() => {
    const expandAll = () => setOpenSet(new Set(SECTIONS.map((s) => s.id)));
    const collapseAll = () => setOpenSet(new Set());
    const jump = (e) => {
      const id = e.detail && e.detail.id;
      if (!id) return;
      setOpenSet((prev) => new Set([...prev, id]));
      // scroll after the layout settles
      requestAnimationFrame(() => {
        const el = document.getElementById(`section-${id}`);
        if (el) {
          const y = el.getBoundingClientRect().top + window.pageYOffset - 120;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      });
    };
    window.addEventListener("b64:expand-all", expandAll);
    window.addEventListener("b64:collapse-all", collapseAll);
    window.addEventListener("b64:jump", jump);
    window.addEventListener("beforeprint", expandAll);
    return () => {
      window.removeEventListener("b64:expand-all", expandAll);
      window.removeEventListener("b64:collapse-all", collapseAll);
      window.removeEventListener("b64:jump", jump);
      window.removeEventListener("beforeprint", expandAll);
    };
  }, []);

  const SECTIONS = [
  { id: "overview",   num: "01", title: "Typologie des bénévoles et des territoires", hint: "Qui sont les bénévoles ? Répartition géographique, tranche d'âge, ancienneté et situation professionnelle.", render: () => <OverviewSection filtered={filtered} /> },
  { id: "activite",   num: "02", title: "Activité hebdomadaire",                       hint: "Quelles tâches occupent le bénévole ? Temps consacré, permanences, documents traités et gouvernance locale.", render: () => <ActiviteSection /> },
  { id: "clusters",   num: "03", title: "Profils types (clusters)",                    hint: "Segmentation statistique de la population en profils homogènes sur les six dimensions radar.", render: () => <ClustersSection filtered={filtered} k={k} setK={setK} /> },
  { id: "comparator", num: "04", title: "Comparaison des profils",                     hint: "Outil interactif de mise en regard de deux ou trois groupes sur le radar à six dimensions.", render: () => <div className="comp-wrap"><KSlider k={k} setK={setK} /><ClusterComparator k={k} /></div> },
  { id: "gap",        num: "05", title: "Opportunité de formation",                    hint: "Écart entre besoins exprimés et formations reçues, ventilé par territoire, âge, ancienneté et profil.", render: () => <GapSection k={k} setK={setK} /> },
  { id: "inter",      num: "06", title: "Comparaison entre territoires",               hint: "Radar comparatif Béarn / Pays Basque / Pays Basque Intérieur sur les six dimensions.", render: () => <InterRadarsSection /> },
  { id: "reseau",     num: "07", title: "Réseau relationnel",                          hint: "Fréquence et qualité des échanges avec les acteurs du territoire ; motifs et rôles des bénévoles.", render: () => <ReseauSection /> },
  { id: "freins",     num: "08", title: "Freins à l'engagement",                       hint: "Obstacles déclarés à l'engagement : catégories, intensité et indicateurs composites.", render: () => <FreinsSection /> },
  { id: "animation",  num: "09", title: "Capacité d'animation",                        hint: "Aptitude à piloter des animations culturelles : capacité déclarée, types d'événements organisés.", render: () => <AnimationSection /> },
  { id: "poursuite",  num: "10", title: "Poursuite de l'engagement",                   hint: "Disponibilité future et modalités souhaitées par les bénévoles pour continuer leur engagement.", render: () => <PoursuiteSection /> },
  { id: "fiches",     num: "11", title: "Fiches individuelles",                        hint: "Portrait radar de chaque répondant, filtrable par profil type et territoire.", render: () => <div><KSlider k={k} setK={setK} /><FichesSection k={k} /></div> }];


  return (
    <div className="report-body" style={{ padding: "0px" }}>
      {SECTIONS.map((s) =>
      <Accordion key={s.id} id={s.id} num={s.num} title={s.title} hint={s.hint} openSet={openSet} setOpenSet={setOpenSet}>
          {s.render()}
        </Accordion>
      )}
    </div>);

}

// Static section meta, used by tab strips outside the report
const SECTION_META = [
{ id: "overview",   num: "01", label: "Vue d'ensemble", title: "Vue d'ensemble de la population" },
{ id: "activite",   num: "02", label: "Activité",       title: "Activité hebdomadaire & temps" },
{ id: "clusters",   num: "03", label: "Profils types",  title: "Profils types (clusters)" },
{ id: "comparator", num: "04", label: "Comparaison",    title: "Comparaison des profils" },
{ id: "gap",        num: "05", label: "Opportunité",    title: "Besoin de formation exprimé selon les territoires" },
{ id: "inter",      num: "06", label: "Territoires",    title: "Comparaison entre territoires" },
{ id: "reseau",     num: "07", label: "Réseau",         title: "Réseau relationnel" },
{ id: "freins",     num: "08", label: "Freins",         title: "Freins à l'engagement" },
{ id: "animation",  num: "09", label: "Animation",      title: "Capacité d'animation" },
{ id: "poursuite",  num: "10", label: "Poursuite",      title: "Poursuite de l'engagement" },
{ id: "fiches",     num: "11", label: "Fiches",         title: "Fiches individuelles" }];


// Expose
window.B64Report = {
  useFilters,
  computeKPIs,
  FilterBar,
  KPIBlock,
  ReportBody,
  ClusterComparator,
  RadarChart, BarChart, DoughnutChart, GapChart, StackedNetwork,
  SECTION_META,
  DATA
};