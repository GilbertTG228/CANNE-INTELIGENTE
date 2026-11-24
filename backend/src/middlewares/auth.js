'use strict';

const jwt = require('jsonwebtoken');
const { ErreurHttp, nonAuthentifie, accesRefuse, introuvable } = require('../utils/erreurs');
const { egalSecurise } = require('../utils/outils');

const TYPES_DISPOSITIF = ['canne', 'telephone', 'traccar', 'simulateur'];

function signerJeton(config, utilisateur) {
  return jwt.sign({ sub: String(utilisateur.id), role: utilisateur.role }, config.secretJwt, {
    expiresIn: config.dureeJeton,
  });
}

/**
 * Vérifie le jeton « Authorization: Bearer … » et charge l'utilisateur.
 * L'utilisateur est relu en base à chaque requête : un compte désactivé ou
 * supprimé perd l'accès immédiatement, et un changement de rôle s'applique tout de suite.
 */
function authentifier({ db, config }) {
  return (req, _res, next) => {
    const entete = req.get('authorization') || '';
    const [schema, jeton] = entete.split(' ');
    if (schema !== 'Bearer' || !jeton) return next(nonAuthentifie());

    let charge;
    try {
      charge = jwt.verify(jeton, config.secretJwt);
    } catch (e) {
      const msg = e.name === 'TokenExpiredError' ? 'Session expirée. Reconnectez-vous.' : 'Jeton invalide.';
      return next(nonAuthentifie(msg));
    }
    const utilisateur = db.get(
      'SELECT id, telephone, nom, role, actif FROM utilisateurs WHERE id = ?',
      Number(charge.sub),
    );
    if (!utilisateur || !utilisateur.actif) return next(nonAuthentifie('Compte inexistant ou désactivé.'));
    req.utilisateur = utilisateur;
    next();
  };
}

/** Restreint une route à certains rôles (ex. exigerRole('admin')). */
function exigerRole(...roles) {
  return (req, _res, next) => {
    if (!req.utilisateur) return next(nonAuthentifie());
    if (!roles.includes(req.utilisateur.role)) return next(accesRefuse('Action réservée à l\'administrateur.'));
    next();
  };
}

/**
 * Charge la canne `:canneId` et vérifie que l'utilisateur la suit
 * (un administrateur a accès à toutes les cannes).
 * Ajoute req.canne et req.suivi (null pour un admin qui ne suit pas la canne).
 */
function exigerAccesCanne({ db }) {
  return (req, _res, next) => {
    const canne = db.get('SELECT * FROM cannes WHERE id = ?', req.params.canneId);
    if (!canne) return next(introuvable('Canne introuvable.'));
    const suivi = db.get(
      'SELECT * FROM suivis WHERE utilisateur_id = ? AND canne_id = ?',
      req.utilisateur.id,
      canne.id,
    );
    if (!suivi && req.utilisateur.role !== 'admin') {
      return next(accesRefuse('Vous ne suivez pas cette canne.'));
    }
    req.canne = canne;
    req.suivi = suivi || null;
    next();
  };
}

/**
 * Authentifie un boîtier GPS par sa clé secrète :
 *   en-tête « X-Cle-Dispositif: <clé> » (ou « Authorization: Dispositif <clé> »).
 */
function authentifierDispositif({ db }) {
  return (req, _res, next) => {
    let cle = req.get('x-cle-dispositif');
    const entete = req.get('authorization') || '';
    if (!cle && entete.startsWith('Dispositif ')) cle = entete.slice('Dispositif '.length);
    if (!cle) return next(nonAuthentifie('Clé de dispositif manquante.'));
    const canne = db.get('SELECT * FROM cannes WHERE cle_dispositif = ?', cle.trim());
    if (!canne || !egalSecurise(canne.cle_dispositif, cle.trim())) {
      return next(nonAuthentifie('Clé de dispositif invalide.'));
    }
    if (!canne.active) {
      return next(new ErreurHttp(403, 'Canne désactivée par l\'administrateur.', { code: 'CANNE_DESACTIVEE' }));
    }
    // L'appareil peut indiquer ce qu'il est (téléphone de test, simulateur, vraie canne) :
    // la console l'affiche pour distinguer les tests de la canne réelle.
    const source = String(req.get('x-source-dispositif') || '').toLowerCase();
    if (TYPES_DISPOSITIF.includes(source) && source !== canne.type_dispositif) {
      db.run('UPDATE cannes SET type_dispositif = ? WHERE id = ?', source, canne.id);
      canne.type_dispositif = source;
    }
    req.canne = canne;
    next();
  };
}

module.exports = { signerJeton, authentifier, exigerRole, exigerAccesCanne, authentifierDispositif };
