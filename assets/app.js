document.addEventListener('DOMContentLoaded', () => {
  const bgImg = document.getElementById('bgImg');
  const body = document.body;
  const headline = document.getElementById('headline');
  const temp = document.getElementById('temp');
  const description = document.getElementById('description');
  const extremeLabel = document.getElementById('extremeLabel');
  const extremeValue = document.getElementById('extremeValue');
  const rainValue = document.getElementById('rainValue');
  const uvValue = document.getElementById('uvValue');
  const confidenceValue = document.getElementById('confidenceValue');
  const location = document.getElementById('location');
  const particles = document.getElementById('particles');

  // Humor variants by timeOfDay
  const humor = {
    cold: {
      dawn: 'Chilly start—coffee and blankets time!',
      day: 'Time to build a snowman',
      dusk: 'Freezing evening—rug up tight!',
      night: 'Polar bear weather—stay warm!'
    },
    heat: {
      dawn: 'Warm start—early braai?',
      day: 'Frying an egg is a real option',
      dusk: 'Hot evening—ice cream time!',
      night: 'Sizzling night—fan on full!'
    },
    storm: {
      dawn: 'Stormy dawn—stay in bed!',
      day: 'Thunder\'s rolling—don\'t get zapped!',
      dusk: 'Evening storm—lights out?',
      night: 'Night thunder—sweet dreams?'
    },
    rain: {
      dawn: 'Rainy morning—lazy day ahead',
      day: 'The clouds are crying like NZ at the \'23 World Cup!',
      dusk: 'Evening downpour—cozy inside!',
      night: 'Night rain—sleep to the pitter-patter'
    },
    wind: {
      dawn: 'Windy dawn—hairdo beware!',
      day: 'Gale force—your bakkie might fly!',
      dusk: 'Evening gusts—secure the bins!',
      night: 'Howling night—close the windows'
    },
    fog: {
      dawn: 'Foggy dawn—ghostly start',
      day: 'Misty mayhem—can\'t see your braai from the stoep!',
      dusk: 'Evening fog—early lights on',
      night: 'Foggy night—watch your step!'
    },
    clear: {
      dawn: 'Clear dawn—beautiful sunrise ahead',
      day: 'Braai weather, boet!',
      dusk: 'Clear evening—starry night coming',
      night: 'Clear night—perfect for stargazing'
    }
  };

  // Get real timeOfDay
  const hour = new Date().getHours();
  let timeOfDay;
  if (hour < 6) timeOfDay = 'night';
  else if (hour < 12) timeOfDay = 'dawn';
  else if (hour < 18) timeOfDay = 'day';
  else timeOfDay = 'dusk';

  // Geolocation
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const place = await reverseGeocode(lat, lon);
    location.innerText = place || 'Strand, WC';
    await fetchWeather(lat, lon);
  }, async () => {
    console.log('Geolocation denied - falling back to Strand');
    location.innerText = 'Strand, WC';
    await fetchWeather(-34.104, 18.817);
  });

  async function reverseGeocode(lat, lon) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
      const data = await res.json();
      return data.display_name.split(',')[0] + ', ' + (data.address.state || data.address.country_code.toUpperCase());
    } catch (e) {
      console.error('Reverse geocode error:', e);
      return null;
    }
  }

  async function fetchWeather(lat, lon) {
    const weatherApiKey = 'a98886bfef6c4dcd8bf111514251512';
    const sources = [
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,precipitation_probability,uv_index,wind_speed_10m`,
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
      `https://api.weatherapi.com/v1/current.json?key=${weatherApiKey}&q=${lat},${lon}`,
      `http://www.7timer.info/bin/astro.php?lon=${lon}&lat=${lat}&ac=0&unit=metric&output=json&tzshift=0`,
      `https://api.brightsky.dev/current_weather?lat=${lat}&lon=${lon}`
    ];

    try {
      const responses = await Promise.all(sources.map(url => fetch(url).then(res => res.json()).catch(e => (console.error('API error for ' + url, e), null))));
      const validResponses = responses.filter(r => r !== null);
      console.log('Valid responses:', validResponses.length);

      if (validResponses.length < 3) throw new Error('Too few valid responses');

      // Parse temps
      const temps = validResponses.map((r, i) => {
        if (i === 0) return r.current_weather.temperature;
        if (i === 1) return r.timeseries[0].data.instant.details.air_temperature;
        if (i === 2) return r.current.temp_c;
        if (i === 3) return r.dataseries[0].temp2m;
        if (i === 4) return r.temperature;
      }).filter(t => t !== undefined && !isNaN(t));
      const medianTemp = temps.sort((a,b) => a-b)[Math.floor(temps.length/2)] || 20;
      const tempRange = `${Math.floor(medianTemp - 2)}–${Math.ceil(medianTemp + 2)}°`;

      // Parse rain probability (0-100%)
      const rainProbs = validResponses.map((r, i) => {
        if (i === 0) return r.hourly.precipitation_probability[0];
        if (i === 1) return r.timeseries[0].data.instant.details.probability_of_precipitation;
        if (i === 2) return r.current.chance_of_rain;
        if (i === 3) return r.dataseries[0].prec_amount * 10; // Approximate
        if (i === 4) return r.precipitation ? 50 : 0; // Binary approx
      }).filter(p => p !== undefined && !isNaN(p));
      const medianRain = rainProbs.sort((a,b) => a-b)[Math.floor(rainProbs.length/2)] || 0;

      // Parse UV
      const uvIndexes = validResponses.map((r, i) => {
        if (i === 0) return r.hourly.uv_index[0];
        if (i === 2) return r.current.uv;
        if (i === 3) return r.dataseries[0].uv;
        // Others fallback 0
      }).filter(u => u !== undefined && !isNaN(u));
      const medianUV = uvIndexes.sort((a,b) => a-b)[Math.floor(uvIndexes.length/2)] || 0;

      // Parse wind (km/h)
      const windSpeeds = validResponses.map((r, i) => {
        if (i === 0) return r.hourly.wind_speed_10m[0];
        if (i === 1) return r.timeseries[0].data.instant.details.wind_speed * 3.6; // m/s to km/h
        if (i === 2) return r.current.wind_kph;
        if (i === 3) return r.dataseries[0].wind10m.speed;
        if (i === 4) return r.wind_speed;
      }).filter(w => w !== undefined && !isNaN(w));
      const medianWind = windSpeeds.sort((a,b) => a-b)[Math.floor(windSpeeds.length/2)] || 0;

      // Condition priority
      let condition = 'clear';
      if (medianRain > 50) condition = 'storm';
      else if (medianRain > 10) condition = 'rain';
      if (medianWind > 40) condition = 'wind';
      if (medianUV < 2 && medianTemp < 15) condition = 'fog';
      if (medianTemp < 10) condition = 'cold';
      if (medianTemp > 30) condition = 'heat';

      // Confidence
      const tempVariance = Math.max(...temps) - Math.min(...temps);
      let confLevel = tempVariance < 5 ? 'High' : tempVariance < 10 ? 'Medium' : 'Low';
      confVal = `${confLevel}<br>Based on ${validResponses.length} forecasts →`;

      // Update
      body.classList.add(`weather-${condition}`);
      bgImg.src = `assets/images/bg/${condition}/${timeOfDay}.jpg` || 'assets/images/bg/clear/day.jpg';
      headline.innerText = `This is ${condition}.`;
      temp.innerText = tempRange;
      description.innerText = humor[condition][timeOfDay] || humor[condition]['day'];
      extremeLabel.innerText = "Today's extreme: " + condition.charAt(0).toUpperCase() + condition.slice(1);
      extremeValue.innerText = tempRange;
      rainValue.innerText = medianRain > 10 ? 'Likely' : 'Unlikely';
      uvValue.innerText = medianUV > 6 ? 'High' : medianUV > 3 ? 'Moderate' : 'Low';
      confidenceValue.innerHTML = confVal;

      addParticles(condition);

      confidenceValue.addEventListener('click', () => {
        alert(`${confLevel}: Sources vary by ${tempVariance}°.`);
      });
    } catch (e) {
      console.error('Fetch error:', e);
      fallbackUI();
    }
  }

  // ... (previous fallbackUI, addParticles, screen toggle, search logic)
});