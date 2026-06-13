// Loads data.json synchronously before React boots.
// Falls back to window.B64_DATA_MOCK if fetch fails (e.g. file:// without server).
// Also fills in optional meta display fields with defaults so the page works
// with any data.json that has the core analysis structure.
(function () {
  const META_DEFAULTS = {
    period_label: "Février à mars 2026",
    n_communes: 41,
    methodology: "Questionnaire en ligne, K-Means, ACP",
    region_label: "Pyrénées-Atlantiques",
    publication_date: "Avril 2026",
    key_message: "Les besoins de formation s'articulent <em>autour de deux profils dominants</em> : l'animation rurale et l'opérationnel numérique.",
    key_message_tag: "Message-clé · Provisoire"
  };

  function applyMetaDefaults(data) {
    data.meta = Object.assign({}, META_DEFAULTS, data.meta || {});
    return data;
  }

  const xhr = new XMLHttpRequest();
  try {
    xhr.open("GET", "data.json", false); // sync, runs before next <script>
    xhr.send(null);
    if (xhr.status === 200 || xhr.status === 0) {
      window.B64_DATA = applyMetaDefaults(JSON.parse(xhr.responseText));
      return;
    }
  } catch (e) {
    console.warn("[data-loader] could not load data.json, using mock:", e.message);
  }
  if (window.B64_DATA_MOCK) window.B64_DATA = applyMetaDefaults(window.B64_DATA_MOCK);
})();
