'use strict';

const express = require('express');

const { exigerAccesCanne } = require('../middlewares/auth');
const { limiteur } = require('../middlewares/securite');
const { ErreurHttp, accesRefuse, introuvable, conflit, asynchrone } = require('../utils/erreurs');
const { valider, v } = require('../utils/validation');
const { nouvelId, maintenant, egalSecurise } = require('../utils/outils');
const presenter = require('../services/presentation');
const { creerAlerte, notifier } = require('../services/alertes');
const { initialiserEtatZone } = require('../services/positions');
const { tracer } = require('../services/journal');

const MAX_POINTS_HISTORIQUE = 5000;
const MAX_ALERTES = 300;

/** Dernière position connue d'une canne. */
function dernierePosition(db, canneId) {
  return db.get('SELECT * FROM positions WHERE canne_id = ? ORDER BY horodatage DESC LIMIT 1', canneId);
}

function presenterCanne(ctx, canne, suivi) {
  return presenter.canne(canne, { derniere: dernierePosition(ctx.db, canne.id), suivi, config: ctx.config });
}

const schemaZone = {
  nom: v.texte({ min: 1, max: 80, libelle: 'Le nom de la zone' }),
  latitude: v.nombre({ min: -90, max: 90, libelle: 'La latitude' }),
  longitude: v.nombre({ min: -180, max: 180, libelle: 'La longitude' }),
  rayon: v.nombre({ min: 10, max: 5000, libelle: 'Le rayon' }),
  actif: v.booleen({ optionnel: true, defaut: true, libelle: 'L\'état' }),
};

/** Routes /api/cannes/* (utilisateur authentifié). */
module.exports = function routesCannes(ctx) {
  const { db } = ctx;
  const r = express.Router();
  const acces = exigerAccesCanne(ctx);
  const limiteAppairage = limiteur({
    fenetreMs: 15 * 60_000,
    max: 20, // vérification + association = 2 requêtes par tentative
    cle: (req) => `appairage|${req.utilisateur.id}`,
    message: 'Trop d\'essais d\'association. Réessayez dans 15 minutes.',
  });
  ctx.limiteurs.push(limiteAppairage);

  // --- Cannes ------------------------------------------------------------------

  /** GET /api/cannes -> {cannes: [...]} (cannes suivies par l'utilisateur) */
  r.get('/', (req, res) => {
    const lignes = db.all(
      `SELECT c.*, s.principal AS s_principal, s.consentement AS s_consentement
         FROM suivis s JOIN cannes c ON c.id = s.canne_id
        WHERE s.utilisateur_id = ? ORDER BY s.cree_le, c.nom`,
      req.utilisateur.id,
    );
    const cannes = lignes.map((c) =>
      presenterCanne(ctx, c, { principal: c.s_principal, consentement: c.s_consentement }),
    );
    res.json({ cannes });
  });

  const schemaAppairage = {
    identifiant: v.texte({ min: 3, max: 40, libelle: 'L\'identifiant de la canne' }),
    codeAppairage: v.texte({ min: 6, max: 6, motif: /^\d{6}$/, messageMotif: '6 chiffres attendus.', libelle: 'Le code d\'association' }),
  };

  /**
   * Contrôles communs à la vérification et à l'association, dans cet ordre :
   *  1. identifiant + code corrects        sinon 400 APPAIRAGE_INVALIDE (même réponse si l'identifiant
   *                                         n'existe pas : on ne révèle pas quelles cannes existent) ;
   *  2. canne active                        sinon 403 CANNE_DESACTIVEE ;
   *  3. pas déjà suivie par ce proche       sinon 409 DEJA_SUIVIE ;
   *  4. pas suivie par un autre compte,
   *     sauf si le partage est autorisé     sinon 409 CANNE_DEJA_ASSOCIEE.
   */
  function controlerAppairage(req, d) {
    const canne = db.get('SELECT * FROM cannes WHERE upper(identifiant) = upper(?)', d.identifiant);
    if (!canne || !egalSecurise(canne.code_appairage, d.codeAppairage)) {
      throw new ErreurHttp(400, 'Identifiant ou code d\'association incorrect. Vérifiez l\'étiquette de la canne.', {
        code: 'APPAIRAGE_INVALIDE',
      });
    }
    if (!canne.active) {
      throw new ErreurHttp(403, 'Cette canne est désactivée. Contactez l\'administrateur.', { code: 'CANNE_DESACTIVEE' });
    }
    if (db.get('SELECT 1 FROM suivis WHERE utilisateur_id = ? AND canne_id = ?', req.utilisateur.id, canne.id)) {
      throw new ErreurHttp(409, 'Vous suivez déjà cette canne.', { code: 'DEJA_SUIVIE' });
    }
    const nbProches = db.get('SELECT COUNT(*) AS n FROM suivis WHERE canne_id = ?', canne.id).n;
    if (nbProches > 0 && !canne.partage_autorise) {
      throw new ErreurHttp(
        409,
        'Cette canne est déjà associée à un autre compte. Demandez au proche principal d\'autoriser le partage.',
        { code: 'CANNE_DEJA_ASSOCIEE' },
      );
    }
    return { canne, nbProches };
  }

  /**
   * POST /api/cannes/verifier {identifiant, codeAppairage}
   * Vérifie la canne sans l'associer et renvoie ce qu'il faut pour pré-remplir
   * le formulaire (nom et numéro enregistrés par l'administrateur, s'il y en a).
   */
  r.post('/verifier', limiteAppairage, (req, res) => {
    const d = valider(req.body, schemaAppairage);
    const { canne, nbProches } = controlerAppairage(req, d);
    res.json({
      canne: {
        identifiant: canne.identifiant,
        nom: canne.nom,
        telephonePersonne: canne.telephone_personne,
        nombreProches: nbProches,
        seraPrincipal: nbProches === 0,
      },
    });
  });

  /**
   * POST /api/cannes/associer {identifiant, codeAppairage, nomPersonne?, telephonePersonne?}
   * Le proche saisit l'identifiant et le code à 6 chiffres imprimés sur l'étiquette de la canne.
   * Le premier proche associé devient « principal » et renseigne le nom et le numéro
   * de la personne. Un SMS informe ensuite la personne malvoyante (transparence).
   */
  r.post('/associer', limiteAppairage, asynchrone(async (req, res) => {
    const d = valider(req.body, {
      ...schemaAppairage,
      nomPersonne: v.texte({ min: 2, max: 80, optionnel: true, libelle: 'Le nom de la personne' }),
      telephonePersonne: v.telephone({ optionnel: true, libelle: 'Le téléphone de la personne' }),
    });
    const { canne, nbProches } = controlerAppairage(req, d);
    const principal = nbProches === 0;

    db.transaction(() => {
      db.run(
        'INSERT INTO suivis (utilisateur_id, canne_id, principal, consentement, cree_le) VALUES (?, ?, ?, 0, ?)',
        req.utilisateur.id, canne.id, principal, maintenant(),
      );
      // Seul le proche principal fixe le nom et le numéro de la personne.
      if (principal && (d.nomPersonne || d.telephonePersonne)) {
        db.run('UPDATE cannes SET nom = ?, telephone_personne = ?, maj_le = ? WHERE id = ?',
          d.nomPersonne ?? canne.nom, d.telephonePersonne ?? canne.telephone_personne, maintenant(), canne.id);
      }
    });
    tracer(db, req.utilisateur.id, 'association_canne', { canneId: canne.id, principal });

    const aJour = db.get('SELECT * FROM cannes WHERE id = ?', canne.id);
    const smsEnvoye = await ctx.sms.envoyer(
      aJour.telephone_personne,
      `Canne Proche : ${req.utilisateur.nom} suit désormais la position de votre canne ${aJour.identifiant}. ` +
        'Vous pouvez demander l\'arrêt du suivi à tout moment.',
      { motif: 'association' },
    );
    const suivi = db.get('SELECT * FROM suivis WHERE utilisateur_id = ? AND canne_id = ?', req.utilisateur.id, canne.id);
    res.status(201).json({ canne: presenterCanne(ctx, aJour, suivi), smsEnvoye });
  }));

  /** GET /api/cannes/:canneId */
  r.get('/:canneId', acces, (req, res) => {
    res.json({ canne: presenterCanne(ctx, req.canne, req.suivi) });
  });

  /** PUT /api/cannes/:canneId {nom?, telephonePersonne?} — proche principal ou admin */
  r.put('/:canneId', acces, (req, res) => {
    if (!(req.suivi?.principal || req.utilisateur.role === 'admin')) {
      throw accesRefuse('Seul le proche principal peut modifier la canne.');
    }
    const d = valider(
      req.body,
      {
        nom: v.texte({ min: 2, max: 80, libelle: 'Le nom' }),
        telephonePersonne: v.telephone({ libelle: 'Le téléphone de la personne' }),
        partageAutorise: v.booleen({ libelle: 'Le partage' }),
      },
      { partiel: true },
    );
    db.run(
      'UPDATE cannes SET nom = ?, telephone_personne = ?, partage_autorise = ?, maj_le = ? WHERE id = ?',
      d.nom ?? req.canne.nom,
      d.telephonePersonne ?? req.canne.telephone_personne,
      d.partageAutorise ?? !!req.canne.partage_autorise,
      maintenant(),
      req.canne.id,
    );
    const canne = db.get('SELECT * FROM cannes WHERE id = ?', req.canne.id);
    res.json({ canne: presenterCanne(ctx, canne, req.suivi) });
  });

  /** DELETE /api/cannes/:canneId/association — ne plus suivre cette canne */
  r.delete('/:canneId/association', acces, (req, res) => {
    if (!req.suivi) throw introuvable('Vous ne suivez pas cette canne.');
    db.transaction(() => {
      db.run('DELETE FROM suivis WHERE utilisateur_id = ? AND canne_id = ?', req.utilisateur.id, req.canne.id);
      // Si le principal part, le plus ancien proche restant le devient.
      if (req.suivi.principal) {
        const suivant = db.get('SELECT utilisateur_id FROM suivis WHERE canne_id = ? ORDER BY cree_le LIMIT 1', req.canne.id);
        if (suivant) {
          db.run('UPDATE suivis SET principal = 1 WHERE utilisateur_id = ? AND canne_id = ?', suivant.utilisateur_id, req.canne.id);
        }
      }
      db.run('UPDATE liens_partage SET revoque_le = ? WHERE canne_id = ? AND utilisateur_id = ? AND revoque_le IS NULL',
        maintenant(), req.canne.id, req.utilisateur.id);
    });
    tracer(db, req.utilisateur.id, 'dissociation_canne', { canneId: req.canne.id });
    res.json({ succes: true });
  });

  /** GET /api/cannes/:canneId/proches — proches qui suivent la canne */
  r.get('/:canneId/proches', acces, (req, res) => {
    const proches = db.all(
      `SELECT u.id, u.nom, s.principal, s.cree_le FROM suivis s JOIN utilisateurs u ON u.id = s.utilisateur_id
        WHERE s.canne_id = ? ORDER BY s.principal DESC, s.cree_le`,
      req.canne.id,
    ).map((p) => ({ id: p.id, nom: p.nom, principal: !!p.principal, depuis: p.cree_le }));
    res.json({ proches });
  });

  // --- Positions ----------------------------------------------------------------

  /** GET /api/cannes/:canneId/position -> {position} (null si aucune) */
  r.get('/:canneId/position', acces, (req, res) => {
    res.json({ position: presenter.position(dernierePosition(db, req.canne.id)) });
  });

  /**
   * GET /api/cannes/:canneId/historique?du=AAAA-MM-JJ&au=AAAA-MM-JJ
   * Bornes incluses, en heure locale du serveur. Au-delà de 5 000 points,
   * l'historique est sous-échantillonné régulièrement (le premier et le dernier point sont gardés).
   */
  r.get('/:canneId/historique', acces, (req, res) => {
    const aujourdhui = new Date();
    const q = valider(req.query, {
      du: v.jour({ optionnel: true, defaut: new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate()) }),
      au: v.jour({ optionnel: true, defaut: new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate()) }),
    });
    if (q.au < q.du) throw new ErreurHttp(422, 'La date de fin précède la date de début.');
    const debut = q.du.toISOString();
    const fin = new Date(q.au.getFullYear(), q.au.getMonth(), q.au.getDate() + 1).toISOString();
    let positions = db.all(
      `SELECT latitude, longitude, precision, batterie, horodatage FROM positions
        WHERE canne_id = ? AND horodatage >= ? AND horodatage < ? ORDER BY horodatage`,
      req.canne.id, debut, fin,
    );
    const total = positions.length;
    if (total > MAX_POINTS_HISTORIQUE) {
      const pas = total / MAX_POINTS_HISTORIQUE;
      const echantillon = [];
      for (let i = 0; i < MAX_POINTS_HISTORIQUE - 1; i++) echantillon.push(positions[Math.floor(i * pas)]);
      echantillon.push(positions[total - 1]);
      positions = echantillon;
    }
    res.json({ positions: positions.map(presenter.position), total, echantillonne: total > positions.length });
  });

  /** POST /api/cannes/:canneId/sos — SOS de test déclenché depuis l'application */
  r.post('/:canneId/sos', acces, (req, res) => {
    const alerte = creerAlerte(db, req.canne, {
      type: 'sos',
      message: `SOS de test déclenché par ${req.utilisateur.nom} depuis l'application.`,
    });
    notifier(ctx, req.canne, alerte);
    tracer(db, req.utilisateur.id, 'sos_test', { canneId: req.canne.id });
    res.status(201).json({ alerte: presenter.alerte(alerte) });
  });

  // --- Zones à éviter ----------------------------------------------------------

  /** GET /api/cannes/:canneId/zones -> {zones} */
  r.get('/:canneId/zones', acces, (req, res) => {
    const zones = db.all('SELECT * FROM zones WHERE canne_id = ? ORDER BY cree_le', req.canne.id);
    res.json({ zones: zones.map(presenter.zone) });
  });

  /** POST /api/cannes/:canneId/zones {nom, latitude, longitude, rayon, actif} */
  r.post('/:canneId/zones', acces, (req, res) => {
    const d = valider(req.body, schemaZone);
    const t = maintenant();
    const zone = {
      id: nouvelId('zn'), canne_id: req.canne.id, ...d, actif: d.actif ? 1 : 0, cree_par: req.utilisateur.id, cree_le: t, maj_le: t,
    };
    db.transaction(() => {
      db.run(
        `INSERT INTO zones (id, canne_id, nom, latitude, longitude, rayon, actif, cree_par, cree_le, maj_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        zone.id, zone.canne_id, zone.nom, zone.latitude, zone.longitude, zone.rayon, zone.actif, zone.cree_par, t, t,
      );
      initialiserEtatZone(db, zone);
    });
    tracer(db, req.utilisateur.id, 'creation_zone', { canneId: req.canne.id, zone: zone.nom });
    res.status(201).json({ zone: presenter.zone(zone) });
  });

  /** PUT /api/cannes/:canneId/zones/:zoneId (corps complet ou partiel) */
  r.put('/:canneId/zones/:zoneId', acces, (req, res) => {
    const existante = db.get('SELECT * FROM zones WHERE id = ? AND canne_id = ?', req.params.zoneId, req.canne.id);
    if (!existante) throw introuvable('Zone introuvable.');
    const d = valider(req.body, schemaZone, { partiel: true });
    const zone = { ...existante, ...d, actif: (d.actif ?? !!existante.actif) ? 1 : 0, maj_le: maintenant() };
    db.transaction(() => {
      db.run(
        'UPDATE zones SET nom = ?, latitude = ?, longitude = ?, rayon = ?, actif = ?, maj_le = ? WHERE id = ?',
        zone.nom, zone.latitude, zone.longitude, zone.rayon, zone.actif, zone.maj_le, zone.id,
      );
      const geometrieModifiee = zone.latitude !== existante.latitude || zone.longitude !== existante.longitude
        || zone.rayon !== existante.rayon || (zone.actif && !existante.actif);
      if (geometrieModifiee) initialiserEtatZone(db, zone);
    });
    res.json({ zone: presenter.zone(zone) });
  });

  /** DELETE /api/cannes/:canneId/zones/:zoneId */
  r.delete('/:canneId/zones/:zoneId', acces, (req, res) => {
    const { changes } = db.run('DELETE FROM zones WHERE id = ? AND canne_id = ?', req.params.zoneId, req.canne.id);
    if (!changes) throw introuvable('Zone introuvable.');
    tracer(db, req.utilisateur.id, 'suppression_zone', { canneId: req.canne.id, zoneId: req.params.zoneId });
    res.json({ succes: true });
  });

  // --- Alertes -----------------------------------------------------------------

  /** GET /api/cannes/:canneId/alertes?nonTraitees=true&limite=100 -> {alertes} */
  r.get('/:canneId/alertes', acces, (req, res) => {
    const q = valider(req.query, {
      nonTraitees: v.booleen({ optionnel: true, defaut: false }),
      limite: v.nombre({ min: 1, max: MAX_ALERTES, entier: true, optionnel: true, defaut: 100 }),
    });
    const alertes = db.all(
      `SELECT a.*, u.nom AS traitee_par_nom FROM alertes a LEFT JOIN utilisateurs u ON u.id = a.traitee_par
        WHERE a.canne_id = ? ${q.nonTraitees ? 'AND a.traitee = 0' : ''}
        ORDER BY a.horodatage DESC LIMIT ?`,
      req.canne.id, q.limite,
    );
    res.json({ alertes: alertes.map(presenter.alerte) });
  });

  return r;
};
