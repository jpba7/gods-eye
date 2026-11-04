- Zooming over a city sharpens again. A Google 3D tile that failed to load
  once (network blip, rate limit, or a Google session that expired after a
  few hours) used to freeze its area at a blurry level for the rest of the
  session; failed tiles are now retried with a backoff and an expired session
  is renewed. Google tiles also stream with more requests in flight, so the
  view is sharp in roughly half the time after a zoom. The globe renders at
  the screen's pixel ratio (up to 1.5), and Performance mode now also draws
  CSS pixels and caps the tile cache at 1 GB. The Visual drawer opens with a
  clear map-source list (Google 3D, Bing, Esri, OSM), each with what it is or
  why it is unavailable (jpba7, #10).
