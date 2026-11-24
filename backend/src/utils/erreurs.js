'use strict';

/**
 * Erreur métier avec code HTTP et message lisible par l'utilisateur final
 * (l'application Flutter affiche directement `message`).
 */
class ErreurHttp extends Error {
  constructor(statut, message, { code, details } = {}) {
    super(message);
    this.statut = statut;
    this.code = code || codeParDefaut(statut);
    this.details = details;
  }
}

function codeParDefaut(statut) {
  return (
    {
      400: 'REQUETE_INVALIDE',
      401: 'NON_AUTHENTIFIE',
      403: 'ACCES_REFUSE',
      404: 'INTROUVABLE',
      409: 'CONFLIT',
      410: 'EXPIRE',
      422: 'VALIDATION',
      429: 'TROP_DE_REQUETES',
    }[statut] || 'ERREUR_SERVEUR'
  );
}

const requeteInvalide = (message, details) => new ErreurHttp(400, message, { details });
const nonAuthentifie = (message = 'Authentification requise.') => new ErreurHttp(401, message);
const accesRefuse = (message = 'Accès refusé.') => new ErreurHttp(403, message);
const introuvable = (message = 'Élément introuvable.') => new ErreurHttp(404, message);
const conflit = (message) => new ErreurHttp(409, message);

/** Express 4 ne capture pas les rejets de promesses : on les transmet à next(). */
const asynchrone = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  ErreurHttp,
  requeteInvalide,
  nonAuthentifie,
  accesRefuse,
  introuvable,
  conflit,
  asynchrone,
};
