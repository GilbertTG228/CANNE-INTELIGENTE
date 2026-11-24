'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const { ErreurHttp, introuvable, conflit } = require('../utils/erreurs');
const { valider, v } = require('../utils/validation');
const { nouvelId, jetonAleatoire, codeNumerique, codeActivation, maintenant, ilYaMinutes } = require('../utils/outils');
const presenter = require('../services/presentation');
const { tracer } = require('../services/journal');
const { COUT_BCRYPT } = require('./auth');

/** Canne vue par l'administrateur : inclut les secrets du boîtier. */
function canneAdmin(ctx, c) {
  const derniere = ctx.db.get('SELECT * FROM positions WHERE canne_id = ? ORDER BY horodatage DESC LIMIT 1', c.id);
  const proches = ctx.db.all(
    `SELECT u.id, u.nom, u.telephone, s.principal, s.consentement FROM suivis s
       JOIN utilisateurs u ON u.id = s.utilisateur_id WHERE s.canne_id = ? ORDER BY s.principal DESC, s.cree_le`,
    c.id,
  );
  return {
    ...presenter.canne(c, { derniere, suivi: null, config: ctx.config }),
    cleDispositif: c.cle_dispositif,
    codeAppairage: c.code_appairage,
    codeActivation: c.code_activation,
    dispositifActiveLe: c.dispositif_active_le,
    demo: !!c.demo,
    creeLe: c.cree_le,
    proches: proches.map((p) => ({ ...p, principal: !!p.principal, consentement: !!p.consentement })),
  };
}

/** Routes /api/admin/* — réservées au rôle « admin ». */
module.exports = function routesAdmin(ctx) {
  const { db } = ctx;
  const r = express.Router();

  const lireUtilisateur = (id) => {
    const u = db.get('SELECT * FROM utilisateurs WHERE id = ?', Number(id));
    if (!u) throw introuvable('Utilisateur introuvable.');
    return u;
  };
  const lireCanne = (id) => {
    const c = db.get('SELECT * FROM cannes WHERE id = ?', id);
    if (!c) throw introuvable('Canne introuvable.');
    return c;
  };
  /** Empêche de retirer le dernier administrateur actif (sinon plus personne ne peut administrer). */
  const verifierDernierAdmin = (u, { nouveauRole, nouvelActif, suppression }) => {
    if (u.role !== 'admin') return;
    const perdAdmin = suppression || (nouveauRole && nouveauRole !== 'admin') || nouvelActif === false;
    if (!perdAdmin) return;
    const autres = db.get("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin' AND actif = 1 AND id != ?", u.id).n;
    if (autres === 0) throw new ErreurHttp(409, 'Impossible : c\'est le dernier administrateur actif.');
  };

  // --- Tableau de bord ---------------------------------------------------------

  r.get('/statistiques', (_req, res) => {
    const n = (sql, ...p) => db.get(sql, ...p).n;
    const seuil = ilYaMinutes(ctx.config.seuilEnLigneMin);
    res.json({
      utilisateurs: n('SELECT COUNT(*) AS n FROM utilisateurs'),
      administrateurs: n("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin'"),
      cannes: n('SELECT COUNT(*) AS n FROM cannes'),
      cannesEnLigne: n('SELECT COUNT(*) AS n FROM cannes WHERE active = 1 AND derniere_communication >= ?', seuil),
      cannesDesactivees: n('SELECT COUNT(*) AS n FROM cannes WHERE active = 0'),
      cannesNonAttribuees: n('SELECT COUNT(*) AS n FROM cannes c WHERE NOT EXISTS (SELECT 1 FROM suivis s WHERE s.canne_id = c.id)'),
      cannesBatterieFaible: n('SELECT COUNT(*) AS n FROM cannes WHERE active = 1 AND batterie IS NOT NULL AND batterie < ?',
        ctx.config.seuilBatterieFaible),
      proches: n("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'proche'"),
      sosNonTraites: n("SELECT COUNT(*) AS n FROM alertes WHERE traitee = 0 AND type IN ('sos', 'chute')"),
      alertesNonTraitees: n('SELECT COUNT(*) AS n FROM alertes WHERE traitee = 0'),
      alertes24h: n('SELECT COUNT(*) AS n FROM alertes WHERE horodatage >= ?', ilYaMinutes(24 * 60)),
      positions: n('SELECT COUNT(*) AS n FROM positions'),
      zones: n('SELECT COUNT(*) AS n FROM zones'),
      liensActifs: n('SELECT COUNT(*) AS n FROM liens_partage WHERE revoque_le IS NULL AND expire_le > ?', maintenant()),
      pushReel: ctx.notifications.modeReel,
      smsReel: ctx.sms.modeReel,
      urlPublique: ctx.config.urlPublique,
      precisionMaxZoneM: ctx.config.precisionMaxZoneM,
      seuilBatterieFaible: ctx.config.seuilBatterieFaible,
    });
  });

  // --- Utilisateurs ------------------------------------------------------------

  r.get('/utilisateurs', (_req, res) => {
    const lignes = db.all(
      `SELECT u.*, (SELECT COUNT(*) FROM suivis s WHERE s.utilisateur_id = u.id) AS nb_cannes
         FROM utilisateurs u ORDER BY u.role, u.nom`,
    );
    res.json({ utilisateurs: lignes.map((u) => ({ ...presenter.utilisateur(u), nombreCannes: u.nb_cannes })) });
  });

  r.post('/utilisateurs', (req, res) => {
    const d = valider(req.body, {
      nom: v.texte({ min: 2, max: 80, libelle: 'Le nom' }),
      telephone: v.telephone(),
      motDePasse: v.motDePasse(),
      role: v.choix(['proche', 'admin'], { optionnel: true, defaut: 'proche', libelle: 'Le rôle' }),
    });
    if (db.get('SELECT 1 FROM utilisateurs WHERE telephone = ?', d.telephone)) {
      throw conflit('Un compte existe déjà avec ce numéro.');
    }
    const t = maintenant();
    const { lastInsertRowid } = db.run(
      'INSERT INTO utilisateurs (telephone, nom, mot_de_passe_hash, role, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?)',
      d.telephone, d.nom, bcrypt.hashSync(d.motDePasse, COUT_BCRYPT), d.role, t, t,
    );
    tracer(db, req.utilisateur.id, 'admin_creation_utilisateur', { id: lastInsertRowid, role: d.role });
    res.status(201).json({ utilisateur: presenter.utilisateur(lireUtilisateur(lastInsertRowid)) });
  });

  r.put('/utilisateurs/:id', (req, res) => {
    const u = lireUtilisateur(req.params.id);
    const d = valider(
      req.body,
      {
        nom: v.texte({ min: 2, max: 80, libelle: 'Le nom' }),
        role: v.choix(['proche', 'admin'], { libelle: 'Le rôle' }),
        actif: v.booleen({ libelle: 'L\'état du compte' }),
        motDePasse: v.motDePasse(),
      },
      { partiel: true },
    );
    verifierDernierAdmin(u, { nouveauRole: d.role, nouvelActif: d.actif });
    db.run(
      'UPDATE utilisateurs SET nom = ?, role = ?, actif = ?, mot_de_passe_hash = ?, maj_le = ? WHERE id = ?',
      d.nom ?? u.nom,
      d.role ?? u.role,
      d.actif ?? !!u.actif,
      d.motDePasse ? bcrypt.hashSync(d.motDePasse, COUT_BCRYPT) : u.mot_de_passe_hash,
      maintenant(),
      u.id,
    );
    const champs = Object.keys(d).map((k) => (k === 'motDePasse' ? 'motDePasse(modifié)' : k));
    tracer(db, req.utilisateur.id, 'admin_modification_utilisateur', { id: u.id, champs });
    res.json({ utilisateur: presenter.utilisateur(lireUtilisateur(u.id)) });
  });

  r.delete('/utilisateurs/:id', (req, res) => {
    const u = lireUtilisateur(req.params.id);
    if (u.id === req.utilisateur.id) throw new ErreurHttp(409, 'Vous ne pouvez pas supprimer votre propre compte.');
    verifierDernierAdmin(u, { suppression: true });
    db.run('DELETE FROM utilisateurs WHERE id = ?', u.id);
    tracer(db, req.utilisateur.id, 'admin_suppression_utilisateur', { id: u.id, telephone: u.telephone });
    res.json({ succes: true });
  });

  // --- Cannes ------------------------------------------------------------------

  r.get('/cannes', (_req, res) => {
    const cannes = db.all('SELECT * FROM cannes ORDER BY cree_le, identifiant');
    res.json({ cannes: cannes.map((c) => canneAdmin(ctx, c)) });
  });

  r.post('/cannes', (req, res) => {
    const d = valider(req.body, {
      identifiant: v.texte({
        min: 3, max: 40, motif: /^[A-Za-z0-9_-]+$/, messageMotif: 'lettres, chiffres, « - » et « _ » uniquement.',
        libelle: 'L\'identifiant',
      }),
      nom: v.texte({ min: 2, max: 80, libelle: 'Le nom' }),
      telephonePersonne: v.telephone({ optionnel: true, libelle: 'Le téléphone de la personne' }),
      partageAutorise: v.booleen({ optionnel: true, defaut: false, libelle: 'Le partage' }),
    });
    if (db.get('SELECT 1 FROM cannes WHERE upper(identifiant) = upper(?)', d.identifiant)) {
      throw conflit('Une canne porte déjà cet identifiant.');
    }
    const t = maintenant();
    const id = nouvelId('cn');
    db.run(
      `INSERT INTO cannes (id, identifiant, nom, telephone_personne, cle_dispositif, code_appairage, code_activation,
                           partage_autorise, cree_le, maj_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, d.identifiant.toUpperCase(), d.nom, d.telephonePersonne ?? null, jetonAleatoire(24), codeNumerique(6),
      codeActivation(), d.partageAutorise, t, t,
    );
    tracer(db, req.utilisateur.id, 'admin_creation_canne', { id, identifiant: d.identifiant });
    res.status(201).json({ canne: canneAdmin(ctx, lireCanne(id)) });
  });

  r.put('/cannes/:id', (req, res) => {
    const c = lireCanne(req.params.id);
    const d = valider(
      req.body,
      {
        nom: v.texte({ min: 2, max: 80, libelle: 'Le nom' }),
        telephonePersonne: v.telephone({ libelle: 'Le téléphone de la personne' }),
        active: v.booleen({ libelle: 'L\'état de la canne' }),
        partageAutorise: v.booleen({ libelle: 'Le partage' }),
      },
      { partiel: true },
    );
    db.run(
      'UPDATE cannes SET nom = ?, telephone_personne = ?, active = ?, partage_autorise = ?, maj_le = ? WHERE id = ?',
      d.nom ?? c.nom,
      d.telephonePersonne ?? c.telephone_personne,
      d.active ?? !!c.active,
      d.partageAutorise ?? !!c.partage_autorise,
      maintenant(),
      c.id,
    );
    if (d.active !== undefined || d.partageAutorise !== undefined) {
      tracer(db, req.utilisateur.id, 'admin_modification_canne', { id: c.id, active: d.active, partageAutorise: d.partageAutorise });
    }
    res.json({ canne: canneAdmin(ctx, lireCanne(c.id)) });
  });

  /** Régénère la clé du boîtier et/ou le code d'appairage (en cas de fuite ou de revente). */
  r.post('/cannes/:id/regenerer', (req, res) => {
    const c = lireCanne(req.params.id);
    const { cle, code, activation } = valider(req.body || {}, {
      cle: v.booleen({ optionnel: true, defaut: false }),
      code: v.booleen({ optionnel: true, defaut: true }),
      activation: v.booleen({ optionnel: true, defaut: false }),
    });
    db.run('UPDATE cannes SET cle_dispositif = ?, code_appairage = ?, code_activation = ?, maj_le = ? WHERE id = ?',
      cle ? jetonAleatoire(24) : c.cle_dispositif,
      code ? codeNumerique(6) : c.code_appairage,
      activation ? codeActivation() : c.code_activation,
      maintenant(), c.id);
    tracer(db, req.utilisateur.id, 'admin_regeneration_secrets', { id: c.id, cle, code, activation });
    res.json({ canne: canneAdmin(ctx, lireCanne(c.id)) });
  });

  r.delete('/cannes/:id', (req, res) => {
    const c = lireCanne(req.params.id);
    db.run('DELETE FROM cannes WHERE id = ?', c.id);
    tracer(db, req.utilisateur.id, 'admin_suppression_canne', { id: c.id, identifiant: c.identifiant });
    res.json({ succes: true });
  });

  /** POST /api/admin/cannes/:id/proches {utilisateurId, principal?} — attribue la canne à un proche */
  r.post('/cannes/:id/proches', (req, res) => {
    const c = lireCanne(req.params.id);
    const d = valider(req.body, {
      utilisateurId: v.nombre({ min: 1, entier: true, libelle: 'L\'utilisateur' }),
      principal: v.booleen({ optionnel: true }),
    });
    const u = lireUtilisateur(d.utilisateurId);
    if (db.get('SELECT 1 FROM suivis WHERE utilisateur_id = ? AND canne_id = ?', u.id, c.id)) {
      throw conflit('Ce proche suit déjà cette canne.');
    }
    const principal = d.principal ?? !db.get('SELECT 1 FROM suivis WHERE canne_id = ?', c.id);
    db.transaction(() => {
      if (principal) db.run('UPDATE suivis SET principal = 0 WHERE canne_id = ?', c.id);
      db.run('INSERT INTO suivis (utilisateur_id, canne_id, principal, cree_le) VALUES (?, ?, ?, ?)',
        u.id, c.id, principal, maintenant());
    });
    tracer(db, req.utilisateur.id, 'admin_attribution_canne', { canneId: c.id, utilisateurId: u.id });
    res.status(201).json({ canne: canneAdmin(ctx, lireCanne(c.id)) });
  });

  r.delete('/cannes/:id/proches/:utilisateurId', (req, res) => {
    const c = lireCanne(req.params.id);
    const { changes } = db.run('DELETE FROM suivis WHERE canne_id = ? AND utilisateur_id = ?', c.id, Number(req.params.utilisateurId));
    if (!changes) throw introuvable('Ce proche ne suit pas cette canne.');
    tracer(db, req.utilisateur.id, 'admin_retrait_canne', { canneId: c.id, utilisateurId: Number(req.params.utilisateurId) });
    res.json({ canne: canneAdmin(ctx, lireCanne(c.id)) });
  });

  // --- Supervision -------------------------------------------------------------

  r.get('/alertes', (req, res) => {
    const { limite } = valider(req.query, { limite: v.nombre({ min: 1, max: 500, entier: true, optionnel: true, defaut: 100 }) });
    const lignes = db.all(
      `SELECT a.*, c.nom AS canne_nom, u.nom AS traitee_par_nom FROM alertes a
         JOIN cannes c ON c.id = a.canne_id LEFT JOIN utilisateurs u ON u.id = a.traitee_par
        ORDER BY a.horodatage DESC LIMIT ?`,
      limite,
    );
    res.json({ alertes: lignes.map((a) => ({ ...presenter.alerte(a), canneNom: a.canne_nom })) });
  });

  r.get('/journal', (req, res) => {
    const { limite } = valider(req.query, { limite: v.nombre({ min: 1, max: 500, entier: true, optionnel: true, defaut: 100 }) });
    const lignes = db.all(
      `SELECT j.*, u.nom AS utilisateur_nom FROM journal j LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id
        ORDER BY j.id DESC LIMIT ?`,
      limite,
    );
    res.json({
      journal: lignes.map((j) => ({
        id: j.id, action: j.action, details: j.details, le: j.cree_le, utilisateur: j.utilisateur_nom,
      })),
    });
  });

  /** Derniers SMS émis (simulés ou réels). */
  r.get('/sms', (_req, res) => {
    res.json({ sms: [...ctx.sms.envoyes].reverse().slice(0, 50), modeReel: ctx.sms.modeReel });
  });

  /** Dernières positions de toutes les cannes (carte d'ensemble de la console). */
  r.get('/positions', (_req, res) => {
    const lignes = db.all(
      `SELECT c.id, c.nom, c.identifiant, c.active, c.batterie, c.derniere_communication, c.type_dispositif,
              p.latitude, p.longitude, p.precision, p.horodatage
         FROM cannes c JOIN positions p ON p.id = (SELECT id FROM positions WHERE canne_id = c.id ORDER BY horodatage DESC LIMIT 1)`,
    );
    res.json({
      positions: lignes.map((l) => ({
        canneId: l.id, nom: l.nom, identifiant: l.identifiant, active: !!l.active, batterie: l.batterie,
        typeDispositif: l.type_dispositif,
        enLigne: presenter.enLigne(l, ctx.config), latitude: l.latitude, longitude: l.longitude,
        precision: l.precision, horodatage: l.horodatage,
      })),
    });
  });

  /** Dernières notifications émises (utile en démonstration, mode push simulé). */
  r.get('/notifications', (_req, res) => {
    res.json({ notifications: [...ctx.notifications.envoyees].reverse().slice(0, 50), modeReel: ctx.notifications.modeReel });
  });

  return r;
};
