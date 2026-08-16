# ADR-004: Mapbox for Maps and Navigation

## Status
Accepted

## Context
BidClean needs: a custom-styled dark map matching the brand palette, real-time pin rendering for offers, GPS tracking visualization, route navigation to properties, and geofencing for arrival detection. Must work globally (Colombia, USA, Canada, Europe).

## Decision
We chose Mapbox as the maps provider.

## Reasoning
- **Full style control** — Mapbox Studio allows pixel-perfect dark theme matching our Mint & Obsidian palette. No other provider offers this level of visual customization.
- **Free tier** — 25,000 map loads/month + 100,000 direction requests/month (covers hackathon + early months).
- **Global coverage** — All our target markets fully covered.
- **@rnmapbox/maps** — Official React Native library, well-maintained.
- **Directions API** — Turn-by-turn navigation with traffic data.
- **Performance** — Vector tiles render smoothly even with many pins.

## Alternatives Considered
- **Google Maps:** Less style customization (limited JSON styling). More expensive after free tier. Better traffic data but we don't need Waze-level navigation.
- **MapLibre + OSM (full open source):** Free but requires self-hosting tiles (adds VPS load), less visual polish, no built-in directions with traffic.
- **Hybrid (MapLibre frontend + Mapbox tiles):** Possible but adds complexity with minimal benefit.

## Consequences
- Dependency on Mapbox cloud for tiles (not self-hosted).
- Pay-as-you-go after free tier (~$0.50/1000 loads).
- Custom dark map style must be created in Mapbox Studio and maintained.
- Geofencing logic runs in our backend, not in Mapbox.
