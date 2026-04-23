// Seaford Rise, South Australia — -35.183, 138.483
// Uses Open-Meteo: free, no API key required

const LAT = -35.183;
const LON = 138.483;
const TZ  = 'Australia/Adelaide';

const WMO: Record<number, { label: string; icon: string }> = {
  0:  { label: 'Clear sky',       icon: '☀️'  },
  1:  { label: 'Mainly clear',    icon: '🌤'  },
  2:  { label: 'Partly cloudy',   icon: '⛅'  },
  3:  { label: 'Overcast',        icon: '☁️'  },
  45: { label: 'Foggy',           icon: '🌫'  },
  48: { label: 'Icy fog',         icon: '🌫'  },
  51: { label: 'Light drizzle',   icon: '🌦'  },
  53: { label: 'Drizzle',         icon: '🌦'  },
  55: { label: 'Heavy drizzle',   icon: '🌦'  },
  61: { label: 'Light rain',      icon: '🌧'  },
  63: { label: 'Rain',            icon: '🌧'  },
  65: { label: 'Heavy rain',      icon: '🌧'  },
  71: { label: 'Light snow',      icon: '🌨'  },
  73: { label: 'Snow',            icon: '🌨'  },
  75: { label: 'Heavy snow',      icon: '❄️'  },
  80: { label: 'Showers',         icon: '🌦'  },
  81: { label: 'Rain showers',    icon: '🌧'  },
  82: { label: 'Violent showers', icon: '🌧'  },
  95: { label: 'Thunderstorm',    icon: '⛈'  },
  96: { label: 'Thunderstorm',    icon: '⛈'  },
  99: { label: 'Thunderstorm',    icon: '⛈'  },
};

function decode(code: number) {
  return WMO[code] ?? { label: 'Unknown', icon: '🌡' };
}

export async function GET() {
  const params = new URLSearchParams({
    latitude:  String(LAT),
    longitude: String(LON),
    timezone:  TZ,
    current:   [
      'temperature_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'relative_humidity_2m',
      'precipitation',
    ].join(','),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'weather_code',
      'precipitation_probability_max',
    ].join(','),
    forecast_days: '5',
    wind_speed_unit: 'kmh',
  });

  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params}`,
    { next: { revalidate: 600 } }   // cache 10 min server-side
  );

  if (!res.ok) {
    return Response.json({ error: 'fetch_failed' }, { status: 502 });
  }

  const raw = await res.json();
  const c   = raw.current;
  const d   = raw.daily;

  const current = {
    temp:      Math.round(c.temperature_2m),
    feelsLike: Math.round(c.apparent_temperature),
    humidity:  c.relative_humidity_2m,
    wind:      Math.round(c.wind_speed_10m),
    ...decode(c.weather_code),
  };

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const forecast = (d.time as string[]).map((date: string, i: number) => ({
    day:      DAYS[new Date(date).getDay()],
    high:     Math.round(d.temperature_2m_max[i]),
    low:      Math.round(d.temperature_2m_min[i]),
    rain:     d.precipitation_probability_max[i],
    ...decode(d.weather_code[i]),
  }));

  return Response.json({ current, forecast });
}
