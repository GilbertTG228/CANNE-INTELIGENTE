'use strict';

const express = require('express');

const { exigerAccesCanne } = require('../middlewares/auth');
const { introuvable, accesRefuse, ErreurHttp } = require('../utils/erreurs');
const { valider, v } = require('../utils/validation');
const { nouvelId, jetonAleatoire, maintenant } = require('../utils/outils');
const presenter = require('../services/presentation');
const { tracer } = require('../services/journal');

/** Vérifie l'accès à une canne dont l'id est dans le corps (cannesId). */
function accesCanneDuCorps(ctx) {
  const acces = exigerAccesCanne(ctx);
  return (req, res, next) => {
    const { cannesId } = valider(req.body, { cannesId: v.texte({ min: 1, max: 64, libelle: 'La canne' }) });
    req.params.canneId = cannesId;
    acces(req, res, next);
  };
}

/** POST /api/consentements {cannesId} */
function routesConsentements(ctx) {
  const { db } = ctx;
  const r = express.Router();
  r.post('/', accesCanneDuCorps(ctx), (req, res) => {
    if (!req.suivi) throw accesRefuse('Vous ne suivez pas cette canne.');
    const t = maintenant();
    db.run(
      'UPDATE suivis SET consentement = 1, consentement_le = ? WHERE utilisateur_id = ? AND canne_id = ?',
      t, req.utilisateur.id, req.canne.id,
    );
    tracer(db, req.utilisateur.id, 'consentement', { canneId: req.canne.id });
    res.status(201).json({ succes: true, message: 'Consentement enregistré.', consentementLe: t });
  });
  return r;
}

/** PUT /api/alertes/:alerteId/traitee */
function routesAlertes(ctx) {
  const { db } = ctx;
  const r = express.Router();

  const marquer = (req, res) => {
    const alerte = db.get('SELECT * FROM alertes WHERE id = ?', req.params.alerteId);
    if (!alerte) throw introuvable('Alerte introuvable.');
    const suit = db.get('SELECT 1 FROM suivis WHERE utilisateur_id = ? AND canne_id = ?', req.utilisateur.id, alerte.canne_id);
    if (!suit && req.utilisateur.role !== 'admin') throw accesRefuse();
    if (!alerte.traitee) {
      db.run('UPDATE alertes SET traitee = 1, traitee_par = ?, traitee_le = ? WHERE id = ?',
        req.utilisateur.id, maintenant(), alerte.id);
    }
    const maj = db.get(
      'SELECT a.*, u.nom AS traitee_par_nom FROM alertes a LEFT JOIN utilisateurs u ON u.id = a.traitee_par WHERE a.id = ?',
      alerte.id,
    );
    res.json({ succes: true, alerte: presenter.alerte(maj) });
  };
  r.put('/:alerteId/traitee', marquer);
  r.put('/:alerteId/traiter', marquer); // ancien nom de route (première version du serveur)
  return r;
}

/** Liens de partage temporaires : /api/liens-partage */
function routesPartage(ctx) {
  const { db, config } = ctx;
  const r = express.Router();

  /** POST {cannesId, dureeHeures} -> 201 {id, lien, expireLe} */
  r.post('/', accesCanneDuCorps(ctx), (req, res) => {
    if (!req.suivi) throw accesRefuse('Vous ne suivez pas cette canne.');
    const { dureeHeures } = valider(req.body, {
      dureeHeures: v.nombre({ min: 1, max: config.dureeMaxPartageH, entier: true, libelle: 'La durée' }),
    });
    const t = maintenant();
    const lien = {
      id: nouvelId('lp'),
      jeton: jetonAleatoire(18),
      canne_id: req.canne.id,
      utilisateur_id: req.utilisateur.id,
      expire_le: new Date(Date.now() + dureeHeures * 3_600_000).toISOString(),
      cree_le: t,
    };
    db.run(
      'INSERT INTO liens_partage (id, jeton, canne_id, utilisateur_id, expire_le, cree_le) VALUES (?, ?, ?, ?, ?, ?)',
      lien.id, lien.jeton, lien.canne_id, lien.utilisateur_id, lien.expire_le, t,
    );
    tracer(db, req.utilisateur.id, 'creation_lien_partage', { canneId: req.canne.id, dureeHeures });
    res.status(201).json(presenter.lienPartage(lien, config));
  });

  /** GET -> {liens} actifs (non expirés, non révoqués) créés par l'utilisateur */
  r.get('/', (req, res) => {
    const liens = db.all(
      `SELECT * FROM liens_partage WHERE utilisateur_id = ? AND revoque_le IS NULL AND expire_le > ?
        ORDER BY cree_le DESC`,
      req.utilisateur.id, maintenant(),
    );
    res.json({ liens: liens.map((l) => presenter.lienPartage(l, config)) });
  });

  /** DELETE /:id — révoque le lien */
  r.delete('/:id', (req, res) => {
    const lien = db.get('SELECT * FROM liens_partage WHERE id = ?', req.params.id);
    if (!lien || (lien.utilisateur_id !== req.utilisateur.id && req.utilisateur.role !== 'admin')) {
      throw introuvable('Lien introuvable.');
    }
    db.run('UPDATE liens_partage SET revoque_le = ? WHERE id = ?', maintenant(), lien.id);
    tracer(db, req.utilisateur.id, 'revocation_lien_partage', { lienId: lien.id });
    res.json({ succes: true });
  });
  return r;
}

/**
 * Accès public (sans compte) via un lien de partage :
 * GET /api/public/suivi/:jeton -> {canne: {nom}, position, enLigne, expireLe}
 * Ne révèle que le strict nécessaire : prénom de la canne et dernière position.
 */
function routesPublic(ctx) {
  const { db, config } = ctx;
  const r = express.Router();
  // Fond de carte à utiliser par la console, la page de suivi et l'application.
  // Une clé Maps JavaScript est publique par nature (elle part dans le navigateur) :
  // on la protège en la restreignant aux bons sites dans la console Google Cloud.
  r.get('/config-carte', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(config.googleMapsCle
      ? { fournisseur: 'google', cleGoogle: config.googleMapsCle }
      : { fournisseur: 'osm', cleGoogle: null });
  });
  r.get('/suivi/:jeton', (req, res) => {
    const lien = db.get('SELECT * FROM liens_partage WHERE jeton = ?', req.params.jeton);
    if (!lien) throw introuvable('Ce lien de suivi n\'existe pas.');
    if (lien.revoque_le) throw new ErreurHttp(410, 'Ce lien de suivi a été révoqué.');
    if (lien.expire_le <= maintenant()) throw new ErreurHttp(410, 'Ce lien de suivi a expiré.');
    const canne = db.get('SELECT * FROM cannes WHERE id = ?', lien.canne_id);
    const position = db.get(
      'SELECT * FROM positions WHERE canne_id = ? ORDER BY horodatage DESC LIMIT 1', lien.canne_id,
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      canne: { nom: canne.nom, batterie: canne.batterie },
      enLigne: presenter.enLigne(canne, config),
      position: presenter.position(position),
      expireLe: lien.expire_le,
    });
  });
  return r;
}

module.exports = { routesConsentements, routesAlertes, routesPartage, routesPublic };
