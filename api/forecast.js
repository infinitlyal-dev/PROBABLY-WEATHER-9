// /api/forecast?lat=-33.9&lon=18.4
// Aggregates 3 sources (Yr.no, Open-Meteo, WeatherAPI) into a simple median forecast.

function median(nums){
  const a = nums.filter(n => Number.isFinite(n)).sort((x,y)=>x-y);
  if (!a.length) return null;
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

function pick(list){
  // list: [{source, value}]
  const vals = list.map(x=>x.value).filter(v=>Number.isFinite(v));
  return median(vals);
}

function confidenceFromCount(n){
  if (n >= 3) return 'High';
  if (n === 2) return 'Medium';
  return 'Low';
}

function toKmh(ms){
  return Number.isFinite(ms) ? ms * 3.6 : null;
}

async function fetchJSON(url, opts={}){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), opts.timeoutMs ?? 9000);
  try{
    const res = await fetch(url, { headers: opts.headers || {}, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchYr(lat, lon){
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
  const json = await fetchJSON(url, {
    headers: {
      // Required by met.no terms: identify your app.
      'User-Agent': 'ProbablyWeather/1.0 (demo; contact: none)'
    },
    timeoutMs: 9000
  });
  const ts = json?.properties?.timeseries;
  if (!Array.isArray(ts) || !ts.length) throw new Error('No Yr timeseries');

  const now = ts[0];
  const inst = now?.data?.instant?.details || {};
  const next1 = now?.data?.next_1_hours?.details || {};

  const current = {
    tempC: inst.air_temperature,
    windKmh: toKmh(inst.wind_speed),
    gustKmh: toKmh(inst.wind_speed_of_gust),
    precipMm: next1.precipitation_amount,
    precipProb: null, // Yr compact does not always provide
    uv: inst.ultraviolet_index_clear_sky,
    visKm: null,
    condition: now?.data?.next_1_hours?.summary?.symbol_code || null,
  };

  // Next 24 hours at 1h granularity (best-effort)
  const hourly = ts.slice(0, 24).map(row => {
    const i = row?.data?.instant?.details || {};
    const n1 = row?.data?.next_1_hours?.details || {};
    const summary = row?.data?.next_1_hours?.summary || {};
    return {
      time: row.time,
      tempC: i.air_temperature,
      windKmh: toKmh(i.wind_speed),
      gustKmh: toKmh(i.wind_speed_of_gust),
      precipMm: n1.precipitation_amount,
      precipProb: null,
      condition: summary.symbol_code || null,
    };
  });

  return { source: 'Yr.no', current, hourly };
}

async function fetchOpenMeteo(lat, lon){
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,weather_code,uv_index,visibility`
    + `&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability,weather_code`
    + `&forecast_days=2&timezone=auto`;

  const json = await fetchJSON(url, { timeoutMs: 9000 });

  const c = json.current || {};
  const current = {
    tempC: c.temperature_2m,
    windKmh: c.wind_speed_10m,
    gustKmh: c.wind_gusts_10m,
    precipMm: c.precipitation,
    precipProb: null,
    uv: c.uv_index,
    visKm: Number.isFinite(c.visibility) ? c.visibility/1000 : null,
    condition: Number.isFinite(c.weather_code) ? `om_${c.weather_code}` : null,
  };

  const h = json.hourly || {};
  const times = h.time || [];
  const hourly = times.slice(0, 24).map((t, idx) => ({
    time: t,
    tempC: h.temperature_2m?.[idx],
    windKmh: h.wind_speed_10m?.[idx],
    gustKmh: h.wind_gusts_10m?.[idx],
    precipMm: h.precipitation?.[idx],
    precipProb: h.precipitation_probability?.[idx],
    condition: Number.isFinite(h.weather_code?.[idx]) ? `om_${h.weather_code[idx]}` : null,
  }));

  return { source: 'Open-Meteo', current, hourly };
}

async function fetchWeatherAPI(lat, lon, key){
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(key)}`
    + `&q=${lat},${lon}&days=2&aqi=no&alerts=no`;

  const json = await fetchJSON(url, { timeoutMs: 9000 });
  const c = json.current || {};
  const current = {
    tempC: c.temp_c,
    windKmh: c.wind_kph,
    gustKmh: c.gust_kph,
    precipMm: c.precip_mm,
    precipProb: null,
    uv: c.uv,
    visKm: c.vis_km,
    condition: c?.condition?.text || null,
  };

  // Flatten hourly from day[0] + day[1]
  const hours = [];
  const f = json.forecast?.forecastday || [];
  for (const d of f){
    for (const hr of (d.hour || [])){
      hours.push({
        time: hr.time,
        tempC: hr.temp_c,
        windKmh: hr.wind_kph,
        gustKmh: hr.gust_kph,
        precipMm: hr.precip_mm,
        precipProb: hr.chance_of_rain ?? hr.chance_of_snow ?? null,
        condition: hr?.condition?.text || null,
      });
    }
  }

  return { source: 'WeatherAPI', current, hourly: hours.slice(0,24) };
}

export default async function handler(req, res){
  try{
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)){
      res.status(400).json({ error: 'Missing lat/lon' });
      return;
    }

    const key = process.env.WEATHERAPI_KEY;
    if (!key){
      res.status(500).json({ error: 'WEATHERAPI_KEY not set on server' });
      return;
    }

    const results = await Promise.allSettled([
      fetchYr(lat, lon),
      fetchOpenMeteo(lat, lon),
      fetchWeatherAPI(lat, lon, key),
    ]);

    const sources = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    if (!sources.length){
      res.status(502).json({ error: 'All sources failed' });
      return;
    }

    const usedNames = sources.map(s=>s.source);

    // Build current median
    const cur = {
      tempC: median(sources.map(s=>s.current.tempC)),
      windKmh: median(sources.map(s=>s.current.windKmh)),
      gustKmh: median(sources.map(s=>s.current.gustKmh)),
      precipMm: median(sources.map(s=>s.current.precipMm)),
      precipProb: median(sources.map(s=>s.current.precipProb)),
      uv: median(sources.map(s=>s.current.uv)),
      visKm: median(sources.map(s=>s.current.visKm)),
      condition: sources.find(s=>s.current.condition)?.current.condition || null,
    };

    // Hourly median (aligned by index, best-effort)
    const hours = [];
    for (let i=0;i<24;i++){
      const time = sources.find(s=>s.hourly?.[i]?.time)?.hourly?.[i]?.time || null;
      hours.push({
        time,
        tempC: median(sources.map(s=>s.hourly?.[i]?.tempC)),
        windKmh: median(sources.map(s=>s.hourly?.[i]?.windKmh)),
        gustKmh: median(sources.map(s=>s.hourly?.[i]?.gustKmh)),
        precipMm: median(sources.map(s=>s.hourly?.[i]?.precipMm)),
        precipProb: median(sources.map(s=>s.hourly?.[i]?.precipProb)),
        condition: sources.find(s=>s.hourly?.[i]?.condition)?.hourly?.[i]?.condition || null,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).json({
      current: cur,
      hourly: hours,
      sources: usedNames,
      confidence: confidenceFromCount(usedNames.length),
      meta: { sourcesAttempted: 3, sourcesUsed: usedNames.length },
    });
  } catch (err){
    res.status(500).json({ error: err?.message || String(err) });
  }
}
