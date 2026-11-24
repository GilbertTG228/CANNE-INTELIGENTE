'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const { ErreurHttp } = require('../utils/erreurs');
const { valider, v } = require('../utils/validation');
const { maintenant } = require('../utils/outils');
const presenter = require('../services/presentation');
const { tracer } = require('../services/journal');
const { COUT_BCRYPT } = require('./auth');

/** Routes du compte connecté : /api/utilisateur/* */
module.exports = function routesUtilisateur(ctx) {
  const { db } = ctx;
  const r = express.Router();

  const lire = (id) => db.get('SELECT * FROM utilisateurs WHERE id = ?', id);

  /** GET /api/utilisateur/profil */
  r.get('/profil', (req, res) => {
    res.json({ utilisateur: presenter.utilisateur(lire(req.utilisateur.id)) });
  });

  /** PUT /api/utilisateur/profil {nom} */
  r.put('/profil', (req, res) => {
    const { nom } = valider(req.body, { nom: v.texte({ min: 2, max: 80, libelle: 'Le nom' }) });
    db.run('UPDATE utilisateurs SET nom = ?, maj_le = ? WHERE id = ?', nom, maintenant(), req.utilisateur.id);
    res.json({ utilisateur: presenter.utilisateur(lire(req.utilisateur.id)) });
  });

  /**
   * PUT /api/utilisateur/parametres
   * {delaiInactiviteMinutes?, notificationsActives?, fcmToken?}
   */
  r.put('/parametres', (req, res) => {
    const d = valider(
      req.body,
      {
        delaiInactiviteMinutes: v.nombre({ min: 1, max: 1440, entier: true, libelle: 'Le délai d\'inactivité' }),
        notificationsActives: v.booleen({ libelle: 'Les notifications' }),
        fcmToken: v.texte({ min: 10, max: 4096, libelle: 'Le jeton push' }),
      },
      { partiel: true },
    );
    const u = lire(req.utilisateur.id);
    db.run(
      `UPDATE utilisateurs SET delai_inactivite_min = ?, notifications_actives = ?, fcm_token = ?, maj_le = ?
        WHERE id = ?`,
      d.delaiInactiviteMinutes ?? u.delai_inactivite_min,
      d.notificationsActives ?? !!u.notifications_actives,
      d.fcmToken ?? u.fcm_token,
      maintenant(),
      u.id,
    );
    res.json({ succes: true, utilisateur: presenter.utilisateur(lire(u.id)) });
  });

  /** PUT /api/utilisateur/mot-de-passe {ancienMotDePasse, nouveauMotDePasse} */
  r.put('/mot-de-passe', (req, res) => {
    const d = valider(req.body, {
      ancienMotDePasse: v.texte({ min: 1, max: 128, libelle: 'L\'ancien mot de passe' }),
      nouveauMotDePasse: v.motDePasse({ libelle: 'Le nouveau mot de passe' }),
    });
    const u = lire(req.utilisateur.id);
    if (!bcrypt.compareSync(d.ancienMotDePasse, u.mot_de_passe_hash)) {
      throw new ErreurHttp(400, 'L\'ancien mot de passe est incorrect.');
    }
    db.run(
      'UPDATE utilisateurs SET mot_de_passe_hash = ?, maj_le = ? WHERE id = ?',
      bcrypt.hashSync(d.nouveauMotDePasse, COUT_BCRYPT), maintenant(), u.id,
    );
    tracer(db, u.id, 'changement_mot_de_passe');
    res.json({ succes: true, message: 'Mot de passe modifié.' });
  });

  return r;
};
