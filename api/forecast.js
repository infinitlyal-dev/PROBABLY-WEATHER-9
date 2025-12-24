
/**
 * /api/forecast?lat=-33.92&lon=18.42&units=metric|imperial
 *
 * Aggregates:
 * - Open-Meteo forecast (no key)
 * - MET Norway forecast (no key, requires a User-Agent)
 * - WeatherAPI current (optional, needs WEATHERAPI_KEY in Vercel env vars)
 *
 * Returns:
 * {
 *  place: {lat,lon},
 *  current: {tempC, feelsC, windKmh, humidity, precipMm, precipProb, visKm, uvIndex, category, label},
 *  sun: {sunrise, sunset},
 *  hourly: [{time, tempC, windKmh, precipMm, precipProb, humidity, category, label}],
 *  daily: [{date, minC, maxC, precipMm, precipProb, category, label}]
 * }
 */
const UA = "ProbablyWeather/1.0 (+https://vercel.com)";

function median(nums){
  const a = (nums||[]).filter(n => Number.isFinite(n)).sort((x,y)=>x-y);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}
function round(n,d=0){
  if (!Number.isFinite(n)) return null;
  const m = Math.pow(10,d);
  return Math.round(n*m)/m;
}
function kmhFromMs(ms){
  if (!Number.isFinite(ms)) return null;
  return ms*3.6;
}
function pickCategory({tempC, windKmh, precipMm, precipProb, visKm}){
  if ((Number.isFinite(precipMm) && precipMm >= 8) || (Number.isFinite(windKmh) && windKmh >= 55 && (precipProb||0) >= 40)) return "storm";
  if ((Number.isFinite(precipMm) && precipMm >= 1.5) || (Number.isFinite(precipProb) && precipProb >= 60)) return "rain";
  if (Number.isFinite(windKmh) && windKmh >= 35) return "wind";
  if (Number.isFinite(visKm) && visKm <= 2.0) return "fog";
  if (Number.isFinite(tempC) && tempC >= 28) return "heat";
  if (Number.isFinite(tempC) && tempC <= 12) return "cold";
  return "clear";
}
function labelFor(cat){
  return ({
    clear:"Clear",
    cold:"Cold",
    fog:"Fog",
    heat:"Hot",
    rain:"Rain",
    storm:"Storm",
    wind:"Wind"
  })[cat] || "Clear";
}

async function fetchJson(url, opts={}){
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function openMeteo(lat, lon){
  const url =
    "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
    + "&current=temperature_2m,apparent_temperature,precipitation,relative_humidity_2m,wind_speed_10m,visibility,precipitation_probability,uv_index"
    + "&hourly=temperature_2m,precipitation,precipitation_probability,relative_humidity_2m,wind_speed_10m,visibility"
    + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset"
    + "&timezone=auto";
  return await fetchJson(url);
}

async function metNo(lat, lon){
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`met.no HTTP ${res.status}`);
  return await res.json();
}

function metNoToHourly(met){
  // returns map ISO -> {tempC, windMs, precipMm}
  const out = new Map();
  const ts = met?.properties?.timeseries || [];
  for (const t of ts){
    const time = t.time;
    const det = t?.data?.instant?.details || {};
    const next1h = t?.data?.next_1_hours?.details || {};
    out.set(time, {
      tempC: det.air_temperature,
      windMs: det.wind_speed,
      precipMm: next1h.precipitation_amount
    });
  }
  return out;
}

async function weatherApiCurrent(lat, lon){
  const key = process.env.WEATHERAPI_KEY;
  if (!key) return null;
  const url = `https://api.weatherapi.com/v1/current.json?key=${encodeURIComponent(key)}&q=${encodeURIComponent(lat + "," + lon)}&aqi=no`;
  return await fetchJson(url);
}

export default async function handler(req, res){
  try{
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const units = (req.query.units || "metric") === "imperial" ? "imperial" : "metric";

    if (!Number.isFinite(lat) || !Number.isFinite(lon)){
      res.status(400).json({ error: "Missing lat/lon" });
      return;
    }

    const [om, met, wa] = await Promise.allSettled([
      openMeteo(lat, lon),
      metNo(lat, lon),
      weatherApiCurrent(lat, lon)
    ]);

    const omv = om.status === "fulfilled" ? om.value : null;
    const metv = met.status === "fulfilled" ? met.value : null;
    const wav = wa.status === "fulfilled" ? wa.value : null;

    const metHourly = metv ? metNoToHourly(metv) : new Map();

    // Current (median of Open-Meteo + met.no, plus WeatherAPI extras if available)
    const curOm = omv?.current || {};
    const metNow = metHourly.get(omv?.current?.time) || null;

    const tempC = median([curOm.temperature_2m, metNow?.tempC]);
    const feelsC = curOm.apparent_temperature ?? null;
    const windKmh = median([curOm.wind_speed_10m, metNow?.windMs != null ? kmhFromMs(metNow.windMs) : null]);
    const humidity = curOm.relative_humidity_2m ?? null;
    const precipMm = median([curOm.precipitation, metNow?.precipMm]);
    const precipProb = curOm.precipitation_probability ?? null;
    const visKm = curOm.visibility != null ? curOm.visibility / 1000 : null;

    const uvIndex = wav?.current?.uv ?? curOm.uv_index ?? null;

    const cat = pickCategory({ tempC, windKmh, precipMm, precipProb, visKm });

    const sunrise = omv?.daily?.sunrise?.[0] || null;
    const sunset  = omv?.daily?.sunset?.[0] || null;

    // Hourly - every 3 hours, next 24h
    const hours = [];
    const tArr = omv?.hourly?.time || [];
    for (let i=0; i<tArr.length && hours.length<8; i+=3){
      const time = tArr[i];
      const metH = metHourly.get(time) || null;
      const hTempC = median([omv?.hourly?.temperature_2m?.[i], metH?.tempC]);
      const hWindKmh = median([omv?.hourly?.wind_speed_10m?.[i], metH?.windMs != null ? kmhFromMs(metH.windMs) : null]);
      const hPrecipMm = median([omv?.hourly?.precipitation?.[i], metH?.precipMm]);
      const hPrecipProb = omv?.hourly?.precipitation_probability?.[i] ?? null;
      const hHum = omv?.hourly?.relative_humidity_2m?.[i] ?? null;
      const hVisKm = omv?.hourly?.visibility?.[i] != null ? omv.hourly.visibility[i]/1000 : null;
      const hCat = pickCategory({ tempC: hTempC, windKmh: hWindKmh, precipMm: hPrecipMm, precipProb: hPrecipProb, visKm: hVisKm });
      hours.push({
        time,
        tempC: round(hTempC,1),
        windKmh: round(hWindKmh,1),
        precipMm: round(hPrecipMm,1),
        precipProb: hPrecipProb != null ? round(hPrecipProb,0) : null,
        humidity: hHum != null ? round(hHum,0) : null,
        visKm: hVisKm != null ? round(hVisKm,1) : null,
        category: hCat,
        label: labelFor(hCat)
      });
    }

    // Daily (next 7)
    const daily = [];
    const dTime = omv?.daily?.time || [];
    for (let i=0; i<dTime.length && i<7; i++){
      const minC = omv?.daily?.temperature_2m_min?.[i];
      const maxC = omv?.daily?.temperature_2m_max?.[i];
      const dPrecipMm = omv?.daily?.precipitation_sum?.[i];
      const dProb = omv?.daily?.precipitation_probability_max?.[i];
      const dCat = pickCategory({ tempC: maxC, windKmh: null, precipMm: dPrecipMm, precipProb: dProb, visKm: null });
      daily.push({
        date: dTime[i],
        minC: round(minC,1),
        maxC: round(maxC,1),
        precipMm: round(dPrecipMm,1),
        precipProb: dProb != null ? round(dProb,0) : null,
        category: dCat,
        label: labelFor(dCat)
      });
    }

    // Units conversion done in frontend; keep payload in metric base.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      place:{lat,lon},
      current:{
        tempC: round(tempC,1),
        feelsC: round(feelsC,1),
        windKmh: round(windKmh,1),
        humidity: humidity != null ? round(humidity,0) : null,
        precipMm: round(precipMm,1),
        precipProb: precipProb != null ? round(precipProb,0) : null,
        visKm: visKm != null ? round(visKm,1) : null,
        uvIndex: uvIndex != null ? round(uvIndex,1) : null,
        category: cat,
        label: labelFor(cat)
      },
      sun:{sunrise, sunset},
      hourly: hours,
      daily
    });
  }catch(err){
    res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
