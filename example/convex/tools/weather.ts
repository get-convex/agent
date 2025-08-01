// See the docs at https://docs.convex.dev/agents/tools
import { tool } from "ai";
import { z } from "zod";

export const getGeocoding = tool({
  description: "Get the latitude and longitude of a location",
  inputSchema: z.object({
    location: z
      .string()
      .describe("The location to get the geocoding for, e.g. 'San Francisco'"),
  }),
});

export const getWeather = tool({
  description: "Get the weather for a location",
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
});

/**
 * Weather from https://open-meteo.com/en/docs?hourly=temperature_2m,weather_code
 * @param code WMO code
 * @returns text description of the weather
 */
function nameOfWeatherCode(code: number) {
  switch (code) {
    case 0:
      return "Clear";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
      return "Fog and depositing rime fog";
    case 48:
      return "Fog and depositing rime fog";
    case 51:
      return "Drizzle: Light";
    case 53:
      return "Drizzle: Moderate";
    case 55:
      return "Drizzle: Dense intensity";
    case 56:
      return "Freezing Drizzle: Light and dense intensity";
    case 57:
      return "Freezing Drizzle: Dense intensity";
    case 61:
      return "Light Rain";
    case 63:
      return "Moderate Rain";
    case 65:
      return "Heavy Rain";
    case 66:
      return "Light Freezing Rain";
    case 67:
      return "Heavy Freezing Rain";
    case 71:
      return "Lightly Snow";
    case 73:
      return "Snowing";
    case 75:
      return "Snowing heavily";
    case 77:
      return "Snow grains";
    case 80:
      return "Rain showers: Slight";
    case 81:
      return "Rain showers: Moderate";
    case 82:
      return "Rain showers: Violent";
    case 85:
      return "Snow showers: Slight";
    case 86:
      return "Snow showers: Heavy";
    case 95:
      return "Thunderstorm";
    case 96:
      return "Thunderstorm with light hail";
    case 99:
      return "Thunderstorm with heavy hail";
    default:
      return "Unknown";
  }
}
