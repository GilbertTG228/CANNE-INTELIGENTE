'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const { signerJeton, authentifier } = require('../middlewares/auth');
const { limiteur } = require('../middlewares/securite');
const { ErreurHttp, conflit, nonAuthentifie } = require('../utils/erreurs');
const { valider, v } = require('../utils/validation');
const { codeNumerique, sha256, maintenant, dansMinutes } = require('../utils/outils');
const presenter = require('../services/presentation');
const { tracer } = require('../services/journal');

const COUT_BCRYPT = 10;
const DUREE_CODE_MIN = 15;
const ESSAIS_MAX_CODE = 5;

function reponseSession(config, u) {
  const utilisateur = presenter.utilisateur(u);
  // « user » est conservé pour compatibilité avec la première version du serveur.
  return { jeton: signerJeton(config, u), utilisateur, user: utilisateur };
}

module.exports = function routesAuth(ctx) {
  const { db, config } = ctx;
  const r = express.Router();

  // 10 essais de connexion par quart d'heure et par (IP + numéro).
  const limiteConnexion = limiteur({
    fenetreMs: 15 * 60_000,
    max: 10,
    cle: (req) => `${req.ip}|${String(req.body?.telephone || '').replace(/\D/g, '')}`,
    message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
  });
  const limiteSensible = limiteur({ fenetreMs: 15 * 60_000, max: 20 });
  ctx.limiteurs.push(limiteConnexion, limiteSensible);

  /** POST /api/auth/connexion {telephone, motDePasse} -> {jeton, utilisateur} */
  r.post('/connexion', limiteConnexion, (req, res) => {
    const { telephone, motDePasse } = valider(req.body, {
      telephone: v.telephone(),
      motDePasse: v.texte({ min: 1, max: 128, libelle: 'Le mot de passe' }),
    });
    const u = db.get('SELECT * FROM utilisateurs WHERE telephone = ?', telephone);
    // Même message dans tous les cas pour ne pas révéler l'existence d'un compte.
    if (!u || !bcrypt.compareSync(motDePasse, u.mot_de_passe_hash)) {
      throw nonAuthentifie('Numéro ou mot de passe incorrect.');
    }
    if (!u.actif) throw new ErreurHttp(403, 'Ce compte a été désactivé. Contactez l\'administrateur.');
    tracer(db, u.id, 'connexion');
    res.json(reponseSession(config, u));
  });

  /** POST /api/auth/inscription {nom, telephone, motDePasse} -> 201 {jeton, utilisateur} */
  r.post('/inscription', limiteSensible, (req, res) => {
    const d = valider(req.body, {
      nom: v.texte({ min: 2, max: 80, libelle: 'Le nom' }),
      telephone: v.telephone(),
      motDePasse: v.motDePasse(),
    });
    if (db.get('SELECT 1 FROM utilisateurs WHERE telephone = ?', d.telephone)) {
      throw conflit('Un compte existe déjà avec ce numéro.');
    }
    const t = maintenant();
    const { lastInsertRowid } = db.run(
      `INSERT INTO utilisateurs (telephone, nom, mot_de_passe_hash, role, cree_le, maj_le)
       VALUES (?, ?, ?, 'proche', ?, ?)`,
      d.telephone, d.nom, bcrypt.hashSync(d.motDePasse, COUT_BCRYPT), t, t,
    );
    const u = db.get('SELECT * FROM utilisateurs WHERE id = ?', lastInsertRowid);
    tracer(db, u.id, 'inscription');
    res.status(201).json(reponseSession(config, u));
  });

  /**
   * POST /api/auth/mot-de-passe-oublie {telephone}
   * Génère un code à 6 chiffres valable 15 minutes. Il est « envoyé par SMS » :
   * sans passerelle SMS configurée, il est affiché dans la console du serveur.
   * La réponse est identique que le compte existe ou non.
   */
  r.post('/mot-de-passe-oublie', limiteSensible, (req, res) => {
    const { telephone } = valider(req.body, { telephone: v.telephone() });
    const u = db.get('SELECT id, nom FROM utilisateurs WHERE telephone = ? AND actif = 1', telephone);
    if (u) {
      const code = codeNumerique(6);
      db.run('UPDATE reinitialisations SET utilise = 1 WHERE utilisateur_id = ? AND utilise = 0', u.id);
      db.run(
        'INSERT INTO reinitialisations (utilisateur_id, code_hash, expire_le, cree_le) VALUES (?, ?, ?, ?)',
        u.id, sha256(code), dansMinutes(DUREE_CODE_MIN), maintenant(),
      );
      ctx.sms.envoyer(telephone, `Votre code Canne Proche est ${code} (valable ${DUREE_CODE_MIN} min).`, {
        motif: 'reinitialisation',
      });
      tracer(db, u.id, 'demande_reinitialisation');
    }
    res.json({ message: 'Si ce numéro correspond à un compte, un code de vérification a été envoyé par SMS.' });
  });

  /** POST /api/auth/reinitialiser-mot-de-passe {telephone, code, nouveauMotDePasse} */
  r.post('/reinitialiser-mot-de-passe', limiteSensible, (req, res) => {
    const d = valider(req.body, {
      telephone: v.telephone(),
      code: v.texte({ min: 6, max: 6, motif: /^\d{6}$/, messageMotif: '6 chiffres attendus.', libelle: 'Le code' }),
      nouveauMotDePasse: v.motDePasse({ libelle: 'Le nouveau mot de passe' }),
    });
    const invalide = () => new ErreurHttp(400, 'Code invalide ou expiré. Refaites une demande.', { code: 'CODE_INVALIDE' });
    const u = db.get('SELECT id FROM utilisateurs WHERE telephone = ? AND actif = 1', d.telephone);
    if (!u) throw invalide();
    const demande = db.get(
      `SELECT * FROM reinitialisations WHERE utilisateur_id = ? AND utilise = 0 AND expire_le > ?
        ORDER BY id DESC LIMIT 1`,
      u.id, maintenant(),
    );
    if (!demande || demande.essais >= ESSAIS_MAX_CODE) throw invalide();
    if (demande.code_hash !== sha256(d.code)) {
      db.run('UPDATE reinitialisations SET essais = essais + 1 WHERE id = ?', demande.id);
      throw invalide();
    }
    db.transaction(() => {
      db.run('UPDATE reinitialisations SET utilise = 1 WHERE id = ?', demande.id);
      db.run(
        'UPDATE utilisateurs SET mot_de_passe_hash = ?, maj_le = ? WHERE id = ?',
        bcrypt.hashSync(d.nouveauMotDePasse, COUT_BCRYPT), maintenant(), u.id,
      );
      tracer(db, u.id, 'reinitialisation_mot_de_passe');
    });
    res.json({ message: 'Mot de passe modifié. Vous pouvez vous connecter.' });
  });

  /** GET /api/auth/moi -> utilisateur connecté */
  r.get('/moi', authentifier(ctx), (req, res) => {
    const u = db.get('SELECT * FROM utilisateurs WHERE id = ?', req.utilisateur.id);
    res.json({ utilisateur: presenter.utilisateur(u) });
  });

  return r;
};

module.exports.COUT_BCRYPT = COUT_BCRYPT;
