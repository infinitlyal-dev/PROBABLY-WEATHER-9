
/**
 * /api/suggest?q=cape%20town
 * Uses Open-Meteo geocoding to return place suggestions.
 */
async function fetchJson(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
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
      (country ? `&country=${country}&country_code=${country}` : "");

    const data = await fetchJson(url);
    const results = (data.results || []).map(r => ({
      name: r.name,
      country: r.country_code,
      lat: r.latitude,
      lon: r.longitude
    }));
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ results });
  }catch(err){
    res.status(500).json({ results: [], error: String(err?.message || err) });
  }
}
