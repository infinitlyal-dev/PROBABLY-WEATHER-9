
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
      // Two-layer background (blurred cover + foreground contain)
      const blur = document.getElementById('bgBlur');
      const img  = document.getElementById('bgImg');
      if (blur) blur.style.backgroundImage = `url('${url}')`;
      if (img) img.src = url;
      return;
    }
  }
  const blur = document.getElementById('bgBlur');
  const img  = document.getElementById('bgImg');
  if (blur) blur.style.backgroundImage = '';
  if (img) img.src = '';
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
      day: `Clouds are going to cry like NZ at the World Cup.`,
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
  const daily0 = (data.daily || [])[0] || {};
  const sun = data.sun || {};

  const slot = slotFromHour(new Date().getHours());
  const cat = pickCategory(cur);
  await setBackground(cat, slot);

  // Verdict word (mockup: "This is windy.")
  const verdictWord = ({
    wind: "windy",
    rain: "rainy",
    storm: "wild",
    fog: "foggy",
    heat: "hot",
    cold: "cold",
    clear: "fine"
  })[cat] || "fine";

  const verdictLine = `This is ${verdictWord}.`;

  // Range (mockup: 22–26°)
  const minC = daily0.minC;
  const maxC = daily0.maxC;
  const minT = fmtTempC(minC);
  const maxT = fmtTempC(maxC);
  const rangeText = (Number.isFinite(minC) && Number.isFinite(maxC))
    ? `${minT.replace("°C","°").replace("°F","°")}–${maxT}`
    : fmtTempC(cur.tempC);

  // “Today’s extreme” block
  function extremeCopy(){
    if (cat === "wind"){
      return {
        title: "Today’s extreme: Wind",
        line: "Wind is the main event today.",
        meta: `${fmtWindKmh(cur.windKmh)}`
      };
    }
    if (cat === "rain"){
      return {
        title: "Today’s extreme: Rain",
        line: "You’ll probably get wet at some point.",
        meta: `${fmtMm(cur.precipMm)} mm · ${Math.round(cur.precipProb||0)}% chance`
      };
    }
    if (cat === "storm"){
      return {
        title: "Today’s extreme: Storm",
        line: "Keep plans flexible. It’s a spicy one.",
        meta: `${fmtWindKmh(cur.windKmh)} · ${fmtMm(cur.precipMm)} mm`
      };
    }
    if (cat === "heat"){
      return {
        title: "Today’s extreme: Heat",
        line: "It’s giving sunscreen and shade.",
        meta: `Feels like ${fmtTempC(cur.feelsC)}`
      };
    }
    if (cat === "cold"){
      return {
        title: "Today’s extreme: Cold",
        line: "Layers. Hot coffee. No shame.",
        meta: `Feels like ${fmtTempC(cur.feelsC)}`
      };
    }
    if (cat === "fog"){
      return {
        title: "Today’s extreme: Fog",
        line: "Low visibility vibes. Drive like a grownup.",
        meta: `Visibility ${Number.isFinite(cur.visKm) ? cur.visKm.toFixed(1) + " km" : "—"}`
      };
    }
    return {
      title: "Today’s extreme: Calm",
      line: "Not much drama. Take the win.",
      meta: ""
    };
  }

  const ex = extremeCopy();

  const conf = (data.meta && data.meta.confidence) ? data.meta.confidence : "Medium";

  const placeLabel = `${state.place.name}${state.place.country ? ", " + state.place.country : ""}`;

  const rainProb = Math.round(cur.precipProb || 0);
  const rainMm = fmtMm(cur.precipMm);
  const windKmh = Math.round(cur.windKmh || 0);
  const gustKmh = Math.round(cur.gustKmh || 0);
  const uv = (typeof cur.uv === "number") ? Math.round(cur.uv) : null;
  const feels = (typeof cur.feelsC === "number") ? Math.round(cur.feelsC) : null;

  const railTile = (label, value, sub, icon) => `
    <div class="railTile">
      <div class="railIcon" aria-hidden="true">${icon || ""}</div>
      <div class="railLabel">${label}</div>
      <div class="railValue">${value}</div>
      ${sub ? `<div class="railSub">${sub}</div>` : ""}
    </div>
  `;

  el("#main").innerHTML = `
    <div class="homeLayout">
      <div class="homeTop">
        <div class="hero">
          <div class="heroBadge"><span class="badge">Probably</span><span class="badgeDot badgeDot-${conf.toLowerCase()}" aria-hidden="true"></span><span class="badgeText">${conf}</span></div>
          <div class="heroTitle">${verdictLine}</div>
          <div class="heroRange">${rangeText}</div>

          <button class="heroLoc" id="homeLocBtn" title="Change location">
            <span>📍</span>
            <small>${placeLabel}</small>
            <span style="opacity:.9">▾</span>
          </button>
        </div>
      </div>

      <aside class="sideRail" aria-label="Today metrics">
        ${railTile("Rain", `${rainProb}%`, `${rainMm} • chance`, "💧")}
        ${railTile("Wind", `${windKmh} km/h`, gustKmh ? `gusts ${gustKmh} km/h` : "", "🌬️")}
        ${railTile("UV", uv === null ? "—" : `${uv}`, uv === null ? "" : (uv >= 8 ? "high" : uv >= 5 ? "moderate" : "low"), "☀️")}
        ${railTile("Feels", feels === null ? "—" : `${feels}°`, "feels like", "🧍")}
        <div class="railTile railTileWide">
          <div class="railLabel">Today’s extreme</div>
          <div class="railValue">${ex.title.replace("Today’s extreme: ", "")}</div>
          <div class="railSub">${ex.line}</div>
          ${ex.meta ? `<div class="railSub" style="opacity:.85">${ex.meta}</div>` : ""}
        </div>
      </aside>

      <div class="bottomMeta">
        Confidence: <strong>${conf}</strong> ·
        <a href="#" id="sourcesLink">Sources &gt;</a>
        <span style="opacity:.85"> · Sunrise ${sun.sunrise || "—"} · Sunset ${sun.sunset || "—"}</span>
      </div>
    </div>
  `;

  // Location dropdown behavior (mockup)
  el("#homeLocBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); navTo("search"); });

  // “Sources >” goes to settings for now
  el("#sourcesLink")?.addEventListener("click", (e)=>{ e.preventDefault(); navTo("settings"); });

  // Keep hidden meta updated for other views / accessibility
  el("#pageTitle").textContent = placeLabel;
  el("#pageSubtitle").textContent = phrase(cat, slot, fmtTempC(cur.tempC));
}

function renderHourly(data){
  el("#pageSubtitle").textContent = "Next 24 hours (3-hour steps).";

  const placeLabel = `${state.place.name}${state.place.country ? ", " + state.place.country : ""}`;

  const hours = (data.hourly || []).slice(0, 5);
  const pills = hours.map((h, i) => {
    const wind = Math.round(h.windKmh || 0);
    const gust = Math.round(h.gustKmh || 0);
    const rain = Math.round(h.precipProb || 0);
    return `
      <div class="hourTile ${i===0 ? "isNow" : ""}">
        <div class="hourTop">
          <div class="hourTime">${i===0 ? "Now" : fmtTime(h.time).replace(":00","h")}</div>
          <div class="hourIcon" aria-hidden="true">${(h.category==="rain" ? "💧" : h.category==="wind" ? "💨" : h.category==="storm" ? "⛈️" : h.category==="fog" ? "🌫️" : h.category==="heat" ? "☀️" : "☁️")}</div>
        </div>
        <div class="hourTemp">${fmtTempC(h.tempC).replace("°C","°").replace("°F","°")}</div>
        <div class="hourMeta">
          <div>${wind} km/h</div>
          <div class="muted">gusts ${gust} km/h</div>
          <div class="hourRain"><span aria-hidden="true">💧</span> ${rain}%</div>
        </div>
      </div>
    `;
  }).join("");

  const conf = (data.meta && data.meta.confidence) ? data.meta.confidence : "Medium";
  const sources = (data.meta && Array.isArray(data.meta.sources)) ? data.meta.sources : [];
  const sourcesText = sources.length ? sources.join(", ") : "3 sources";

  el("#main").innerHTML = `
    <div class="hourlyScreen">
      <div class="screenTop">
        <button class="locBtn" id="hourlyLocBtn" title="Change location">
          <span aria-hidden="true">📍</span>
          <span class="locText">${placeLabel}</span>
          <span aria-hidden="true" class="chev">▾</span>
        </button>
        <div class="screenTitle">Hourly</div>
      </div>

      <div class="glassCard hourCard">
        <div class="hourRow">
          ${pills || "<div class='empty'>No data</div>"}
        </div>

        <div class="confidenceRow">
          <div class="confLabel">Confidence:</div>
          <div class="confDot confHigh" aria-hidden="true"></div><div>High</div>
          <div class="confDot confMed" aria-hidden="true"></div><div>Medium</div>
          <div class="confDot confLow" aria-hidden="true"></div><div>Low</div>
          <div class="confSpacer"></div>
          <a href="#" id="hourSourcesLink">Sources &gt;</a>
        </div>
      </div>
    </div>
  `;

  el("#hourlyLocBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); navTo("search"); });
  el("#hourSourcesLink")?.addEventListener("click", (e)=>{ e.preventDefault(); navTo("settings"); });
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
  el("#pageSubtitle").textContent = "";

  const favs = state.favorites.slice(0,5);

  const favRows = await Promise.all(favs.map(async (p, idx) => {
    try{
      const d = await fetchForecast(p.lat, p.lon);
      const t = fmtTempC(d.current?.tempC).replace("°C","°").replace("°F","°");
      const cat = (d.current?.category || "");
      const icon = (cat==="rain" ? "💧" : cat==="wind" ? "💨" : cat==="storm" ? "⛈️" : cat==="fog" ? "🌫️" : cat==="heat" ? "☀️" : "☁️");
      return `
        <div class="iosFavRow">
          <button class="favMain" data-act="goFav" data-idx="${idx}">
            <span class="star" aria-hidden="true">★</span>
            <span class="favName">${p.name}${p.country ? ", " + p.country : ""}</span>
          </button>
          <div class="favRight">
            <span class="favIcon" aria-hidden="true">${icon}</span>
            <span class="favTemp">${t}</span>
            <button class="kebab" data-act="delFav" data-idx="${idx}" aria-label="Remove favourite">•••</button>
          </div>
        </div>
      `;
    }catch{
      return `
        <div class="iosFavRow">
          <button class="favMain" data-act="goFav" data-idx="${idx}">
            <span class="star" aria-hidden="true">★</span>
            <span class="favName">${p.name}</span>
          </button>
          <div class="favRight">
            <span class="favTemp">—</span>
            <button class="kebab" data-act="delFav" data-idx="${idx}" aria-label="Remove favourite">•••</button>
          </div>
        </div>
      `;
    }
  }));

  el("#main").innerHTML = `
    <div class="iosScreen">
      <div class="iosTitle">Search &amp; Favourites</div>

      <div class="searchBarRow">
        <div class="searchBar">
          <span class="searchIcon" aria-hidden="true">🔎</span>
          <input id="q" class="searchInput" placeholder="Search for a place" autocomplete="off" />
        </div>
        <button class="cancelBtn" id="cancelSearch" type="button">Cancel</button>
      </div>

      <div class="iosGroup">
        <div class="iosGroupLabel">Saved places</div>
        <div class="iosList">
          <div class="iosFavList">
            ${favRows.join("") || `<div class="iosEmpty">No saved places yet.</div>`}
          </div>
        </div>
      </div>

      <div class="iosGroup">
        <div class="iosGroupLabel">Search results</div>
        <div class="iosList">
          <div id="results" class="iosResults"></div>
        </div>
      </div>

      <div class="manageCard">
        <div class="manageText">You’ve saved ${favs.length} places.${favs.length>=5 ? " Remove one to add a new favourite." : ""}</div>
        <button class="manageBtn" type="button">Manage favourites</button>
      </div>
    </div>
  `;

  el("#cancelSearch")?.addEventListener("click", ()=> navTo("home"));

  // attach search
  const input = el("#q");
  const resultsEl = el("#results");

  input.addEventListener("input", debounce(async ()=>{
    const q = input.value.trim();
    if (!q){
      resultsEl.innerHTML = "";
      return;
    }
    try{
      const r = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`).then(r=>r.json());
      const list = (r.results || []).slice(0, 8);
      resultsEl.innerHTML = list.map((p, i)=>`
        <div class="iosResultRow">
          <div class="resLeft">
            <div class="resName">${p.name}${p.country ? ", " + p.country : ""}</div>
            <div class="resSub">${p.admin ? p.admin : ""}</div>
          </div>
          <div class="resActions">
            <button class="miniBtn" data-act="setPlace" data-idx="${i}">Set</button>
            <button class="miniBtn" data-act="addFav" data-idx="${i}">★</button>
          </div>
        </div>
      `).join("");
      resultsEl.querySelectorAll("button[data-act]").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const act = btn.dataset.act;
          const idx = Number(btn.dataset.idx);
          const pick = list[idx];
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
    }catch{
      resultsEl.innerHTML = `<div class="iosEmpty">Couldn’t search right now.</div>`;
    }
  }, 300));

  // attach fav actions
  el("#main").querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const act = btn.dataset.act;
      const idx = Number(btn.dataset.idx);
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
  el("#pageSubtitle").textContent = "";

  const unitsLabel = state.units === "metric" ? "Celsius" : "Fahrenheit";
  const sources = "Yr.no, SAWS, Open‑Meteo";

  el("#main").innerHTML = `
    <div class="iosScreen">
      <div class="iosTitle">Settings</div>

      <div class="iosGroup">
        <div class="iosGroupLabel">Units</div>

        <div class="iosList">
          <button class="iosRow" id="toggleUnits" type="button">
            <span class="iosLeft">Temperature</span>
            <span class="iosRight">${unitsLabel}</span>
            <span class="iosChevron" aria-hidden="true">›</span>
          </button>

          <div class="iosRow isStatic">
            <span class="iosLeft">Wind speed</span>
            <span class="iosRight">km/h</span>
            <span class="iosChevron" aria-hidden="true">›</span>
          </div>
        </div>
      </div>

      <div class="iosGroup">
        <div class="iosGroupLabel">Forecast display</div>
        <div class="iosList">
          <div class="iosRow isStatic">
            <span class="iosLeft">Show probability range</span>
            <span class="iosRight"><span class="iosSwitch isOn" aria-hidden="true"></span></span>
          </div>
          <div class="iosRow isStatic">
            <span class="iosLeft">Time format</span>
            <span class="iosRight">24‑hour</span>
            <span class="iosChevron" aria-hidden="true">›</span>
          </div>
        </div>
      </div>

      <div class="iosGroup">
        <div class="iosGroupLabel">Data sources</div>
        <div class="iosList">
          <div class="iosRow isStatic">
            <span class="iosLeft">${sources}</span>
            <span class="iosChevron" aria-hidden="true">›</span>
          </div>
          <div class="iosFoot">Combined into a median forecast</div>
        </div>
      </div>

      <div class="iosGroup">
        <div class="iosGroupLabel">Favourites</div>
        <div class="iosList">
          <button class="iosRow danger" id="clearFavs" type="button">
            <span class="iosLeft">Clear favourites</span>
            <span class="iosChevron" aria-hidden="true">›</span>
          </button>
        </div>
        <div class="iosFoot">You can save up to 5 favourite places.</div>
      </div>

      <div class="iosGroup">
        <div class="iosList">
          <div class="iosRow isStatic">
            <span class="iosLeft">About</span>
            <span class="iosRight">Version 1.1</span>
            <span class="iosChevron" aria-hidden="true">›</span>
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
    render();
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
  el("#settingsBtn").addEventListener("click", ()=> navTo("settings"));
  render();
});
