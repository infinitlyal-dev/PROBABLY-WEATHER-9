
const state = {
  units: localStorage.getItem("pw_units") || "metric", // metric | imperial
  place: JSON.parse(localStorage.getItem("pw_place") || "null"),
  favorites: JSON.parse(localStorage.getItem("pw_favs") || "[]"),
  view: "home",
  cache: new Map(), // key -> forecast payload
};

const el = (sel) => document.querySelector(sel);

function saveState(){
  localStorage.setItem("pw_units", state.units);
  localStorage.setItem("pw_place", JSON.stringify(state.place));
  localStorage.setItem("pw_favs", JSON.stringify(state.favorites));
}

function toast(msg){
  const t = el("#toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> t.style.display="none", 1600);
}

function slotFromHour(h){
  if (h >= 5 && h < 9) return "dawn";
  if (h >= 9 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

function clamp(n,min,max){ return Math.min(max, Math.max(min,n)); }

function pickCategory(cur){
  // cur: {tempC, windKmh, precipMm, precipProb, visKm}
  const t = cur?.tempC;
  const w = cur?.windKmh;
  const p = cur?.precipMm;
  const pp = cur?.precipProb;
  const v = cur?.visKm;

  if ((Number.isFinite(p) && p >= 8) || (Number.isFinite(w) && w >= 55 && (pp||0) >= 40)) return "storm";
  if ((Number.isFinite(p) && p >= 1.5) || (Number.isFinite(pp) && pp >= 60)) return "rain";
  if (Number.isFinite(w) && w >= 35) return "wind";
  if (Number.isFinite(v) && v <= 2.0) return "fog";
  if (Number.isFinite(t) && t >= 28) return "heat";
  if (Number.isFinite(t) && t <= 12) return "cold";
  return "clear";
}

async function setBackground(category, slot){
  // Try jpg then png, otherwise fallback
  const root = "assets/images/bg";
  const tries = [
    `${root}/${category}/${slot}.jpg`,
    `${root}/${category}/${slot}.png`,
    `${root}/default.jpg`,
    `${root}/default.png`
  ];
  for (const url of tries){
    const ok = await fetch(url, { method:"HEAD" }).then(r=>r.ok).catch(()=>false);
    if (ok){
      el("#bg").style.backgroundImage = `url('${url}')`;
      return;
    }
  }
  el("#bg").style.background = "#111";
}

function phrase(category, slot, tempText){
  // Middle-ground tone: human, gentle, not trying too hard.
  const map = {
    clear: {
      dawn: `Fresh start. ${tempText}`,
      day: `Looks good out there. ${tempText}`,
      dusk: `Easy evening energy. ${tempText}`,
      night: `Calm skies. ${tempText}`,
    },
    wind: {
      dawn: `Wind’s already up. Hold onto your coffee.`,
      day: `Windy. Hair has opinions today.`,
      dusk: `That breeze isn’t clocking out yet.`,
      night: `Windy night. Secure the washing.`,
    },
    rain: {
      dawn: `Pack a jacket. You’ll thank yourself later.`,
      day: `Rain’s doing its thing. Umbrella = hero.`,
      dusk: `Showers around. Drive like a saint.`,
      night: `Wet night. Watch the roads.`,
    },
    storm: {
      dawn: `Rough start. Keep it safe.`,
      day: `Stormy conditions. Take it seriously.`,
      dusk: `Storm still hanging around. Avoid drama (and puddles).`,
      night: `Stormy night. Best plan: indoors.`,
    },
    fog: {
      dawn: `Low visibility. Lights on, patience on.`,
      day: `Hazy. Take it slow.`,
      dusk: `Foggy pockets. Watch the corners.`,
      night: `Fog + night = extra careful.`,
    },
    cold: {
      dawn: `Chilly start. Layers win.`,
      day: `Cool day. Sun helps, but not that much.`,
      dusk: `Cold evening incoming. Jacket time.`,
      night: `Cold night. Blanket energy.`,
    },
    heat: {
      dawn: `Warm early. Hydrate like it’s your job.`,
      day: `Hot. Shade is a lifestyle choice.`,
      dusk: `Still warm. Slow down a bit.`,
      night: `Warm night. Fan season.`,
    }
  };
  const t = map?.[category]?.[slot];
  return t || `Probably fine. ${tempText}`;
}

function fmtTempC(c){
  if (!Number.isFinite(c)) return "—";
  if (state.units === "imperial"){
    return Math.round((c * 9/5) + 32) + "°F";
  }
  return Math.round(c) + "°C";
}
function fmtWindKmh(kmh){
  if (!Number.isFinite(kmh)) return "—";
  if (state.units === "imperial"){
    return Math.round(kmh / 1.60934) + " mph";
  }
  return Math.round(kmh) + " km/h";
}
function fmtMm(mm){
  if (!Number.isFinite(mm)) return "—";
  return (Math.round(mm*10)/10) + " mm";
}
function fmtTime(ts){
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function fmtDay(ts){
  const d = new Date(ts);
  return d.toLocaleDateString([], {weekday:"short", day:"2-digit", month:"short"});
}

async function fetchForecast(lat, lon){
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${state.units}`;
  if (state.cache.has(key)) return state.cache.get(key);

  const url = `/api/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${encodeURIComponent(state.units)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast failed");
  const data = await res.json();
  state.cache.set(key, data);
  return data;
}

async function ensurePlace(){
  if (state.place) return state.place;
  // Default: Cape Town CBD-ish
  state.place = { name: "Cape Town", country: "ZA", lat: -33.9258, lon: 18.4232 };
  saveState();
  return state.place;
}

function navTo(view){
  state.view = view;
  render();
}

function navButton(id, view){
  const b = el(id);
  b.classList.toggle("active", state.view === view);
}

async function renderHome(data){
  const cur = data.current || {};
  const slot = slotFromHour(new Date().getHours());
  const cat = pickCategory(cur);
  await setBackground(cat, slot);

  const tempText = fmtTempC(cur.tempC);
  el("#pageTitle").textContent = `${state.place.name}${state.place.country ? ", " + state.place.country : ""}`;
  el("#pageSubtitle").textContent = phrase(cat, slot, tempText);

  el("#main").innerHTML = `
    <div class="card">
      <h2>Today’s conditions</h2>
      <div class="row">
        <div>
          <div class="bigTemp">${tempText}</div>
          <div class="sub">${(cur.label || cat).toUpperCase()} • Feels like ${fmtTempC(cur.feelsC)}</div>
        </div>
        <div class="pill">Wind: <b>${fmtWindKmh(cur.windKmh)}</b></div>
      </div>
      <div style="height:10px"></div>
      <div class="grid">
        <div class="kv"><span>UV index</span><strong>${cur.uvIndex ?? "—"}</strong></div>
        <div class="kv"><span>Humidity</span><strong>${cur.humidity != null ? Math.round(cur.humidity)+"%" : "—"}</strong></div>
        <div class="kv"><span>Rain chance</span><strong>${cur.precipProb != null ? Math.round(cur.precipProb)+"%" : "—"}</strong></div>
        <div class="kv"><span>Rain (mm)</span><strong>${fmtMm(cur.precipMm)}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Sunrise & Sunset</h2>
      <div class="row">
        <div class="pill">Sunrise <b>${fmtTime(data.sun?.sunrise)}</b></div>
        <div class="pill">Sunset <b>${fmtTime(data.sun?.sunset)}</b></div>
      </div>
    </div>

    <div class="note">Probably Weather = 2 sources + a vibe.</div>
  `;
}

function renderHourly(data){
  el("#pageSubtitle").textContent = "Next 24 hours, every 3 hours.";
  const rows = (data.hourly || []).slice(0, 8).map(h => `
    <div class="item">
      <div>
        <b>${fmtTime(h.time)}</b><br/>
        <small>${h.label || h.category || "—"}</small>
      </div>
      <div class="actions">
        <div class="pill">${fmtTempC(h.tempC)}</div>
        <div class="pill">${fmtWindKmh(h.windKmh)}</div>
      </div>
    </div>
  `).join("");

  el("#main").innerHTML = `
    <div class="card">
      <h2>Hourly</h2>
      <div class="list">${rows || "<div class='item'><small>No data</small></div>"}</div>
    </div>
  `;
}

function renderWeekly(data){
  el("#pageSubtitle").textContent = "The week, in one clean glance.";
  const rows = (data.daily || []).slice(0, 7).map(d => `
    <div class="item">
      <div>
        <b>${fmtDay(d.date)}</b><br/>
        <small>${d.label || d.category || "—"}</small>
      </div>
      <div class="actions">
        <div class="pill">Hi <b>${fmtTempC(d.maxC)}</b></div>
        <div class="pill">Lo <b>${fmtTempC(d.minC)}</b></div>
      </div>
    </div>
  `).join("");

  el("#main").innerHTML = `
    <div class="card">
      <h2>Weekly</h2>
      <div class="list">${rows || "<div class='item'><small>No data</small></div>"}</div>
    </div>
  `;
}

async function renderSearch(){
  el("#pageSubtitle").textContent = "Search, save, repeat.";
  const favs = state.favorites.slice(0,5);

  const favRows = await Promise.all(favs.map(async (p, idx) => {
    try{
      const d = await fetchForecast(p.lat, p.lon);
      const t = fmtTempC(d.current?.tempC);
      const c = (d.current?.label || d.current?.category || "—");
      return `
        <div class="item">
          <div>
            <b>${p.name}${p.country ? ", " + p.country : ""}</b><br/>
            <small>${t} • ${c}</small>
          </div>
          <div class="actions">
            <button class="iconBtn" data-act="goFav" data-idx="${idx}">Open</button>
            <button class="iconBtn" data-act="delFav" data-idx="${idx}">✕</button>
          </div>
        </div>
      `;
    }catch(e){
      return `
        <div class="item">
          <div>
            <b>${p.name}</b><br/>
            <small>Couldn’t load right now</small>
          </div>
          <div class="actions">
            <button class="iconBtn" data-act="delFav" data-idx="${idx}">✕</button>
          </div>
        </div>
      `;
    }
  }));

  el("#main").innerHTML = `
    <div class="card">
      <h2>Search</h2>
      <input id="q" class="input" placeholder="Type a city, suburb, or landmark…" />
      <div id="results" class="list" style="margin-top:10px"></div>
    </div>

    <div class="card">
      <h2>Favourites (max 5)</h2>
      <div class="list">${favRows.join("") || "<div class='item'><small>No favourites yet.</small></div>"}</div>
      <div class="sub" style="margin-top:8px">To delete one: tap ✕. Then add a new favourite.</div>
    </div>
  `;

  el("#q").addEventListener("input", debounce(async (e)=>{
    const q = e.target.value.trim();
    if (q.length < 2){
      el("#results").innerHTML = "";
      return;
    }
    const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`).then(r=>r.json());
    const html = (res.results || []).slice(0,6).map((r,i)=>`
      <div class="item">
        <div>
          <b>${r.name}</b><br/>
          <small>${r.country || ""}</small>
        </div>
        <div class="actions">
          <button class="iconBtn" data-act="setPlace" data-i="${i}">Use</button>
          <button class="iconBtn" data-act="addFav" data-i="${i}">+ Fav</button>
        </div>
      </div>
    `).join("");
    el("#results").innerHTML = html || "<div class='item'><small>No matches</small></div>";
    // attach actions
    el("#results").querySelectorAll("button").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const act = btn.dataset.act;
        const i = Number(btn.dataset.i);
        const pick = res.results[i];
        if (!pick) return;
        if (act==="setPlace"){
          state.place = pick;
          saveState();
          toast("Updated location");
          navTo("home");
        } else if (act==="addFav"){
          addFavorite(pick);
        }
      });
    });
  }, 300));

  // attach fav actions
  el("#main").querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const act = btn.dataset.act;
      const idx = Number(btn.dataset.idx);
      if (!Number.isFinite(idx)) return;
      if (act==="delFav"){
        state.favorites.splice(idx,1);
        saveState();
        toast("Removed favourite");
        render(); // rerender same page
      }
      if (act==="goFav"){
        const p = state.favorites[idx];
        if (!p) return;
        state.place = p;
        saveState();
        navTo("home");
      }
    });
  });
}

function addFavorite(p){
  // enforce max 5
  const exists = state.favorites.some(x => Math.abs(x.lat-p.lat) < 1e-6 && Math.abs(x.lon-p.lon) < 1e-6);
  if (exists){ toast("Already in favourites"); return; }
  if (state.favorites.length >= 5){
    toast("Max 5 favourites. Delete one first.");
    return;
  }
  state.favorites.push(p);
  saveState();
  toast("Added to favourites");
  render();
}

function renderSettings(){
  el("#pageSubtitle").textContent = "Keep it simple.";
  el("#main").innerHTML = `
    <div class="card">
      <h2>Units</h2>
      <div class="list">
        <div class="item">
          <div>
            <b>Temperature</b><br/>
            <small>${state.units === "metric" ? "Celsius (°C)" : "Fahrenheit (°F)"}</small>
          </div>
          <div class="actions">
            <button class="iconBtn" id="toggleUnits">Switch</button>
          </div>
        </div>
        <div class="item">
          <div>
            <b>Data sources</b><br/>
            <small>Open-Meteo + MET Norway + WeatherAPI (if key)</small>
          </div>
        </div>
        <div class="item">
          <div>
            <b>Clear favourites</b><br/>
            <small>Start fresh.</small>
          </div>
          <div class="actions">
            <button class="iconBtn" id="clearFavs">Clear</button>
          </div>
        </div>
      </div>
    </div>
  `;
  el("#toggleUnits").addEventListener("click", ()=>{
    state.units = state.units === "metric" ? "imperial" : "metric";
    state.cache.clear();
    saveState();
    toast("Units updated");
    navTo("home");
  });
  el("#clearFavs").addEventListener("click", ()=>{
    state.favorites = [];
    saveState();
    toast("Favourites cleared");
    navTo("search");
  });
}

function debounce(fn, ms){
  let t;
  return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=>fn(...args), ms);
  };
}

async function render(){
  navButton("#navHome","home");
  navButton("#navHourly","hourly");
  navButton("#navWeekly","weekly");
  navButton("#navSearch","search");
  navButton("#navSettings","settings");

  await ensurePlace();
  el("#pageTitle").textContent = `${state.place.name}${state.place.country ? ", " + state.place.country : ""}`;

  if (state.view === "search"){
    await setBackground("clear", slotFromHour(new Date().getHours()));
    await renderSearch();
    return;
  }
  if (state.view === "settings"){
    await setBackground("clear", slotFromHour(new Date().getHours()));
    renderSettings();
    return;
  }

  try{
    const data = await fetchForecast(state.place.lat, state.place.lon);
    if (state.view === "home") await renderHome(data);
    if (state.view === "hourly") renderHourly(data);
    if (state.view === "weekly") renderWeekly(data);
  }catch(e){
    el("#main").innerHTML = `
      <div class="card">
        <h2>Oops</h2>
        <div class="sub">Couldn’t load weather right now. Check your internet and try again.</div>
      </div>
    `;
  }
}

document.addEventListener("click", (e)=>{
  const btn = e.target.closest("[data-nav]");
  if (!btn) return;
  navTo(btn.dataset.nav);
});

document.addEventListener("DOMContentLoaded", ()=>{
  el("#locationBtn").addEventListener("click", ()=> navTo("search"));
  render();
});
