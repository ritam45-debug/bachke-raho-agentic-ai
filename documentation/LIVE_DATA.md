# Live data, maps and route risk

The Route & Risk Map and the Weather Forecast tool use free public services, called **from the user's browser, only when a
user asks** (opening the page, pressing *Check*, searching a place). Responses are cached for 10 minutes. Nothing polls in the
background.

## Sources and their terms

| Service | Used for | Key? | Terms that matter |
|---|---|---|---|
| [Open-Meteo forecast](https://open-meteo.com/en/docs) | Daily weather along routes and at sites (up to 16 days) | No | Free tier is **non-commercial only**; limits 600/min, 5,000/hour, 10,000/day; CC BY 4.0 ([terms](https://open-meteo.com/en/terms)) |
| Open-Meteo marine | Maximum wave height on sea routes | No | Same as above |
| Open-Meteo geocoding | Place search (cities, ports) | No | Same as above |
| [USGS earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | M4.5+ earthquakes, past 7 days (updated every minute) | No | US Government public data |
| [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3) | Open natural events: severe storms, floods, wildfires, volcanoes… | No | Public API |
| [OSRM demo server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) | Road route geometry | No | **Non-commercial**, **max 1 request/second** (the app throttles to this), no uptime guarantee |
| [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) | Base map | No | Visible attribution; browser must send a Referer (the nginx config uses `strict-origin-when-cross-origin`); normal interactive viewing only |

**Commercial use:** before charging customers, move to Open-Meteo's paid API (or self-host it), self-host OSRM, and use a
commercial or self-hosted tile provider. The adapters are isolated in `frontend/src/lib/liveData.ts` for this.

**Inside Claude artifacts** the page sandbox blocks calls to other sites and remote map tiles, so live features only work on
GitHub Pages or a real deployment. The app says so when a source can't be reached.

## Route risk score (rules v1.0)

Every check samples 6 points along the route (road routes follow the OSRM road path; sea, air and rail use a great-circle
line, which **does not model real shipping lanes or rail networks yet**). It then adds points per hazard type, capped at 100.
Each point awarded is stored with its reason, source and date, and the server rejects any check whose score doesn't
equal its factors. **The score is a rule-based indicator, not a probability of disruption.**

| Hazard | Threshold | Points | Basis |
|---|---|---|---|
| Wind gusts | ≥ 62 km/h · ≥ 89 km/h | 20 · 35 | Beaufort scale: gale 62–74 km/h, storm 89–102 km/h ([Britannica](https://www.britannica.com/science/Beaufort-scale), [Met Office](https://weather.metoffice.gov.uk/guides/coast-and-sea/beaufort-scale)) |
| Daily rain | ≥ 64.5 · ≥ 115.6 · ≥ 204.5 mm | 12 · 25 · 35 | IMD categories: heavy, very heavy, extremely heavy ([IMD/MoES](https://www.moes.gov.in/sites/default/files/RS-in-25-27-07-2023.pdf)) |
| Thunderstorm | WMO code 95/97 · 96/99 (hail) | 10 · 15 | WMO weather codes as reported by Open-Meteo |
| Snow (non-sea) | WMO 71–77, 85 · 75, 86 | 8 · 15 | WMO weather codes |
| Waves (sea) | ≥ 4 m · ≥ 6 m | 15 · 30 | **Platform default** |
| Earthquake ≤ 300 km | M < 5.5 · ≥ 5.5 · ≥ 6.5 | 5 · 12 · 25 | **Platform default** |
| EONET event near route | storms 500 km, floods 300, volcanoes 300, wildfires 150, other 150–300 | 30 · 25 · 20 · 15 · 5–10 | **Platform default** |

Weather and sea values take the worst day over the next 3 days and the worst sampled point (they are not summed across
points). Hazard categories add together. Bands: low < 25 ≤ moderate < 50 ≤ elevated < 75 ≤ high.

The **Weather Forecast** tool flags each day with the same wind, rain, thunderstorm and snow thresholds. The weather
watch covers every mapped location and every route end that isn't a saved location, in **one** Open-Meteo request.

Points and the "platform default" thresholds are design assumptions to be calibrated against each company's own
disruption history once Phase 5 (organisational memory) records outcomes.
