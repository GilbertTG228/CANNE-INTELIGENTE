'use strict';

const { nouvelId, maintenant } = require('../utils/outils');

const TYPES = ['sos', 'entree_zone', 'chute', 'batterie_faible', 'canne_inactive'];

/** Titre et texte de la notification, selon le type d'alerte. */
function libelles(type, canne, extra = {}) {
  const nom = canne.nom;
  switch (type) {
    case 'sos':
      return { titre: `SOS : ${nom}`, message: extra.message || `${nom} a appuyé sur le bouton SOS de sa canne.` };
    case 'chute':
      return { titre: `Chute détectée : ${nom}`, message: extra.message || `La canne de ${nom} a détecté une chute.` };
    case 'entree_zone':
      return {
        titre: `Entrée en zone : ${nom}`,
        message: extra.message || `La canne est entrée dans la zone « ${extra.zoneNom} ».`,
      };
    case 'batterie_faible':
      return {
        titre: `Batterie faible : ${nom}`,
        message: extra.message || `Batterie à ${extra.batterie ?? '?'} %. Pensez à recharger la canne.`,
      };
    case 'canne_inactive':
      return {
        titre: `Canne inactive : ${nom}`,
        message: extra.message || 'Aucune position reçue récemment. Vérifiez la batterie ou la couverture réseau.',
      };
    default:
      return { titre: `Alerte : ${nom}`, message: extra.message || '' };
  }
}

/** Proches à prévenir : ceux qui suivent la canne et ont activé les notifications. */
function destinataires(db, canneId) {
  return db.all(
    `SELECT u.id, u.nom, u.fcm_token
       FROM suivis s JOIN utilisateurs u ON u.id = s.utilisateur_id
      WHERE s.canne_id = ? AND u.actif = 1 AND u.notifications_actives = 1`,
    canneId,
  );
}

/**
 * Enregistre une alerte. La notification est envoyée par `notifier()`, à
 * appeler après la fin de la transaction (pour ne jamais notifier une alerte annulée).
 */
function creerAlerte(db, canne, { type, message, zone, latitude, longitude, horodatage, batterie }) {
  if (!TYPES.includes(type)) throw new Error(`Type d'alerte inconnu : ${type}`);
  // Position par défaut : la dernière connue de la canne.
  if (latitude == null || longitude == null) {
    const derniere = db.get(
      'SELECT latitude, longitude FROM positions WHERE canne_id = ? ORDER BY horodatage DESC LIMIT 1',
      canne.id,
    );
    if (derniere) ({ latitude, longitude } = derniere);
  }
  const { titre, message: texte } = libelles(type, canne, { message, zoneNom: zone?.nom, batterie });
  const alerte = {
    id: nouvelId('al'),
    canne_id: canne.id,
    type,
    message: texte,
    zone_id: zone?.id ?? null,
    zone_nom: zone?.nom ?? null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    horodatage: horodatage || maintenant(),
    traitee: 0,
  };
  db.run(
    `INSERT INTO alertes (id, canne_id, type, message, zone_id, zone_nom, latitude, longitude, horodatage, traitee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    alerte.id, alerte.canne_id, alerte.type, alerte.message, alerte.zone_id, alerte.zone_nom,
    alerte.latitude, alerte.longitude, alerte.horodatage,
  );
  return { ...alerte, titre };
}

/** Envoie la notification push correspondant à une alerte créée (et la publie en temps réel). */
function notifier(ctx, canne, alerte) {
  require('./evenements').publier(ctx, 'alerte', {
    canneId: canne.id,
    canneNom: canne.nom,
    alerte: require('./presentation').alerte(alerte),
  });
  const liste = destinataires(ctx.db, canne.id);
  // Charge utile identique à celle que lit l'application (notification_service.dart).
  const data = {
    type: alerte.type,
    titre: alerte.titre,
    message: alerte.message,
    canneId: canne.id,
    alerteId: alerte.id,
    latitude: alerte.latitude,
    longitude: alerte.longitude,
    zoneNom: alerte.zone_nom,
    horodatage: alerte.horodatage,
  };
  return ctx.notifications.envoyer(liste, alerte.titre, alerte.message, data).catch((e) => {
    console.warn('[push] erreur :', e.message);
  });
}

module.exports = { TYPES, creerAlerte, notifier, libelles };
