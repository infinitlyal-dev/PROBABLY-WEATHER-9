
/**
 * /api/suggest?q=cape%20town
 * Uses Open-Meteo geocoding to return place suggestions.
 */
async function fetchJson(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// South Africa fallback map for common places that Open‑Meteo may not index well (eg. suburbs like Strand).
const ZA_FALLBACK = {
  "strand": { name: "Strand", country: "ZA", lat: -34.112, lon: 18.829 },
  "somerset west": { name: "Somerset West", country: "ZA", lat: -34.08, lon: 18.85 },
  "stellenbosch": { name: "Stellenbosch", country: "ZA", lat: -33.9321, lon: 18.8602 },
  "cape town": { name: "Cape Town", country: "ZA", lat: -33.9249, lon: 18.4241 },
  "observatory": { name: "Observatory, Cape Town", country: "ZA", lat: -33.9395, lon: 18.4679 },
  "sea point": { name: "Sea Point, Cape Town", country: "ZA", lat: -33.9171, lon: 18.383 },
  "gordons bay": { name: "Gordon's Bay", country: "ZA", lat: -34.1506, lon: 18.871 },
  "muizenberg": { name: "Muizenberg", country: "ZA", lat: -34.1078, lon: 18.4681 },
  "simon's town": { name: "Simon's Town", country: "ZA", lat: -34.1937, lon: 18.4358 },
  "paarl": { name: "Paarl", country: "ZA", lat: -33.7342, lon: 18.962 }
};

function normalizeKey(s){
  return String(s || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res){
  try{
    const q = String(req.query.q || "").trim();
    if (q.length < 2){
      res.status(200).json({ results: [] });
      return;
    }
    let name = q;
    let country = "";

    // Accept "ZA", "South Africa", "RSA" in the query and force SA results
    const upper = q.toUpperCase();
    if (/\bZA\b/.test(upper) || /SOUTH\s*AFRICA/i.test(q) || /\bRSA\b/.test(upper)){
      country = "ZA";
      name = q
        .replace(/\bZA\b/ig, "")
        .replace(/\bRSA\b/ig, "")
        .replace(/south\s*africa/ig, "")
        .replace(/[,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}` +
      `&count=8&language=en&format=json` +
      (country ? `&country=${country}` : "");

    const data = await fetchJson(url);    const rawResults = (data.results || []).map(r => ({
      name: r.name,
      country: r.country_code,
      lat: r.latitude,
      lon: r.longitude
    }));

    let results = rawResults;
    if (country === "ZA"){
      // If the user explicitly asked for South Africa, prefer ZA-only results.
      const zaOnly = rawResults.filter(r => r.country === "ZA");
      if (zaOnly.length){
        results = zaOnly;
      } else {
        // Open‑Meteo sometimes doesn’t return smaller SA place names (eg. Strand). Use a small curated fallback.
        const key = normalizeKey(name);
        const fb = ZA_FALLBACK[key] || ZA_FALLBACK[key.replace(/,.*$/, "")] ||
                   (key.startsWith("strand") ? ZA_FALLBACK["strand"] : null);
        results = fb ? [fb] : [];
      }
    }
res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ results });
  }catch(err){
    res.status(500).json({ results: [], error: String(err?.message || err) });
  }
}
