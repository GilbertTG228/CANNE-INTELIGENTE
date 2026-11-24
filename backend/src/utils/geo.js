'use strict';

const RAYON_TERRE_M = 6_371_000;

const enRadians = (deg) => (deg * Math.PI) / 180;

/** Distance en mètres entre deux points GPS (formule de haversine). */
function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = enRadians(lat2 - lat1);
  const dLon = enRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(enRadians(lat1)) * Math.cos(enRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** La position est-elle à l'intérieur de la zone circulaire ? */
function dansZone(position, zone) {
  return distanceM(position.latitude, position.longitude, zone.latitude, zone.longitude) <= zone.rayon;
}

module.exports = { distanceM, dansZone };
