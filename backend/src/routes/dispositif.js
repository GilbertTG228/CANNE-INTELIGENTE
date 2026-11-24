'use strict';

const express = require('express');

const { authentifierDispositif } = require('../middlewares/auth');
const { limiteur } = require('../middlewares/securite');
const { ErreurHttp, requeteInvalide, nonAuthentifie } = require('../utils/erreurs');
const { valider, v } = require('../utils/validation');
const { maintenant, egalSecurise, normaliserCode } = require('../utils/outils');
const { publier } = require('../services/evenements');
const { tracer } = require('../services/journal');
const presenter = require('../services/presentation');
const { enregistrerPositions } = require('../services/positions');
const { creerAlerte, notifier } = require('../services/alertes');

const MAX_LOT = 500;

const schemaPosition = {
  latitude: v.nombre({ min: -90, max: 90, libelle: 'La latitude' }),
  longitude: v.nombre({ min: -180, max: 180, libelle: 'La longitude' }),
  precision: v.nombre({ min: 0, max: 100_000, optionnel: true, libelle: 'La précision' }),
  batterie: v.nombre({ min: 0, max: 100, entier: true, optionnel: true, libelle: 'La batterie' }),
  horodatage: v.horodatage({ optionnel: true, libelle: 'L\'horodatage' }),
};

/**
 * API appelée par le boîtier GPS de la canne (ou par le simulateur).
 * Authentification : en-tête « X-Cle-Dispositif: <clé secrète de la canne> ».
 */
module.exports = function routesDispositif(ctx) {
  const { db } = ctx;
  const r = express.Router();
  r.use(limiteur({ fenetreMs: 60_000, max: 240, cle: (req) => `dispositif|${req.get('x-cle-dispositif') || req.query.id || req.ip}` }));

  // --- Activation d'un appareil (avant l'authentification par clé) --------------

  const limiteActivation = limiteur({
    fenetreMs: 15 * 60_000,
    max: 10,
    cle: (req) => `activation|${req.ip}`,
    message: 'Trop d\'essais d\'activation. Réessayez dans 15 minutes.',
  });
  ctx.limiteurs.push(limiteActivation);

  /**
   * POST /api/dispositif/activer {identifiant, codeActivation, type?, appareil?}
   * Branche un appareil sur une canne enregistrée par l'administrateur : le
   * téléphone de test (page /canne) ou, plus tard, le boîtier de la vraie canne
   * lors de sa mise en service. Renvoie la clé secrète que l'appareil enverra
   * ensuite à chaque requête (en-tête X-Cle-Dispositif).
   */
  r.post('/activer', limiteActivation, (req, res) => {
    const d = valider(req.body, {
      identifiant: v.texte({ min: 3, max: 40, libelle: 'L\'identifiant de la canne' }),
      codeActivation: v.texte({ min: 8, max: 12, libelle: 'Le code d\'activation' }),
      type: v.choix(['telephone', 'canne'], { optionnel: true, defaut: 'telephone', libelle: 'Le type d\'appareil' }),
      appareil: v.texte({ max: 120, optionnel: true, libelle: 'L\'appareil' }),
    });
    const canne = db.get('SELECT * FROM cannes WHERE upper(identifiant) = upper(?)', d.identifiant);
    if (!canne || !egalSecurise(normaliserCode(canne.code_activation), normaliserCode(d.codeActivation))) {
      throw new ErreurHttp(400, 'Identifiant ou code d\'activation incorrect.', { code: 'ACTIVATION_INVALIDE' });
    }
    if (!canne.active) {
      throw new ErreurHttp(403, 'Cette canne est désactivée par l\'administrateur.', { code: 'CANNE_DESACTIVEE' });
    }
    const t = maintenant();
    db.run('UPDATE cannes SET type_dispositif = ?, dispositif_active_le = ?, maj_le = ? WHERE id = ?', d.type, t, t, canne.id);
    tracer(db, null, 'activation_dispositif', { canneId: canne.id, type: d.type, appareil: d.appareil });
    res.json({
      cle: canne.cle_dispositif,
      canne: { id: canne.id, identifiant: canne.identifiant, nom: canne.nom },
      // Rythme conseillé : une position toutes les 5 s en mouvement, un signe de vie toutes les 30 s.
      reglages: {
        intervallePositionS: 5,
        intervalleBattementS: 30,
        seuilInactiviteMin: ctx.config.seuilInactiviteMin,
        precisionMaxZoneM: ctx.config.precisionMaxZoneM,
      },
    });
  });

  // --- Format Traccar Client / OsmAnd ----------------------------------------------

  /**
   * GET|POST /api/dispositif/osmand
   * Compatible avec l'application gratuite « Traccar Client » (Android, iOS),
   * qui envoie la position même écran éteint. Dans l'application, mettre :
   *   URL du serveur : https://<serveur>/api/dispositif/osmand
   *   Identifiant de l'appareil : la clé du boîtier (affichée dans la console).
   * Deux formats acceptés : paramètres OsmAnd (?id=&lat=&lon=&timestamp=&accuracy=&batt=)
   * et JSON des versions récentes ({device_id, location: {coords, battery, timestamp}}).
   */
  function osmand(req, res) {
    const corps = req.body && typeof req.body === 'object' ? req.body : {};
    const loc = corps.location && typeof corps.location === 'object' ? corps.location : null;
    const cle = String(req.query.id || req.query.deviceid || corps.device_id || corps.id || '').trim();
    if (!cle) throw nonAuthentifie('Identifiant d\'appareil manquant.');
    const canne = db.get('SELECT * FROM cannes WHERE cle_dispositif = ?', cle);
    if (!canne || !egalSecurise(canne.cle_dispositif, cle)) throw nonAuthentifie('Identifiant d\'appareil inconnu.');
    if (!canne.active) throw new ErreurHttp(403, 'Canne désactivée par l\'administrateur.', { code: 'CANNE_DESACTIVEE' });

    const q = { ...corps, ...req.query };
    const coords = loc?.coords || {};
    const niveau = loc?.battery?.level;
    const brut = {
      latitude: coords.latitude ?? q.lat,
      longitude: coords.longitude ?? q.lon,
      precision: coords.accuracy ?? q.accuracy ?? q.hdop,
      batterie: niveau != null ? Math.round(Number(niveau) * 100) : q.batt != null ? Math.round(Number(q.batt)) : undefined,
      horodatage: loc?.timestamp ?? q.timestamp,
    };
    // OsmAnd envoie l'heure en secondes Unix sous forme de texte.
    if (typeof brut.horodatage === 'string' && /^\d+(\.\d+)?$/.test(brut.horodatage)) {
      brut.horodatage = Number(brut.horodatage);
    }
    if (brut.batterie != null && !(brut.batterie >= 0 && brut.batterie <= 100)) delete brut.batterie;
    const p = valider(brut, schemaPosition);
    p.horodatage = p.horodatage && p.horodatage <= maintenant() ? p.horodatage : maintenant();
    if (canne.type_dispositif !== 'traccar') {
      db.run('UPDATE cannes SET type_dispositif = ? WHERE id = ?', 'traccar', canne.id);
      canne.type_dispositif = 'traccar';
    }
    enregistrerPositions(ctx, canne, [p]);
    res.status(200).end();
  }
  r.get('/osmand', osmand);
  r.post('/osmand', osmand);

  // --- Routes authentifiées par la clé de l'appareil ------------------------------

  r.use(authentifierDispositif(ctx));

  /**
   * POST /api/dispositif/positions
   * Corps : une position {latitude, longitude, precision?, batterie?, horodatage?}
   *         ou un lot {positions: [...]} (envoi différé après une coupure réseau).
   */
  r.post('/positions', (req, res) => {
    const brutes = Array.isArray(req.body?.positions) ? req.body.positions : [req.body];
    if (!brutes.length) throw requeteInvalide('Aucune position fournie.');
    if (brutes.length > MAX_LOT) throw requeteInvalide(`Au plus ${MAX_LOT} positions par envoi.`);
    const positions = brutes.map((p) => {
      const d = valider(p, schemaPosition);
      d.horodatage = d.horodatage || maintenant();
      // Une horloge de boîtier en avance ne doit pas produire de positions « futures ».
      if (d.horodatage > maintenant()) d.horodatage = maintenant();
      return d;
    });
    const { enregistrees, alertes } = enregistrerPositions(ctx, req.canne, positions);
    res.status(201).json({ enregistrees, alertes: alertes.map(presenter.alerte) });
  });

  /** POST /api/dispositif/alertes {type: sos|chute, latitude?, longitude?, message?} */
  r.post('/alertes', (req, res) => {
    const d = valider(req.body, {
      type: v.choix(['sos', 'chute'], { libelle: 'Le type' }),
      latitude: v.nombre({ min: -90, max: 90, optionnel: true }),
      longitude: v.nombre({ min: -180, max: 180, optionnel: true }),
      message: v.texte({ max: 200, optionnel: true }),
    });
    // La position jointe à l'alerte est d'abord enregistrée comme une position normale.
    if (d.latitude != null && d.longitude != null) {
      enregistrerPositions(ctx, req.canne, [{ latitude: d.latitude, longitude: d.longitude, horodatage: maintenant() }]);
    }
    const alerte = creerAlerte(db, req.canne, d);
    notifier(ctx, req.canne, alerte);
    res.status(201).json({ alerte: presenter.alerte(alerte) });
  });

  /** POST /api/dispositif/battement {batterie?} — signe de vie sans position GPS */
  r.post('/battement', (req, res) => {
    const d = valider(req.body || {}, {
      batterie: v.nombre({ min: 0, max: 100, entier: true, optionnel: true }),
    });
    db.run(
      'UPDATE cannes SET derniere_communication = ?, inactivite_signalee = 0, batterie = COALESCE(?, batterie), maj_le = ? WHERE id = ?',
      maintenant(), d.batterie ?? null, maintenant(), req.canne.id,
    );
    publier(ctx, 'etat', {
      canneId: req.canne.id,
      typeDispositif: req.canne.type_dispositif,
      batterie: d.batterie ?? req.canne.batterie ?? null,
      derniereCommunication: maintenant(),
    });
    res.json({ succes: true });
  });

  return r;
};
