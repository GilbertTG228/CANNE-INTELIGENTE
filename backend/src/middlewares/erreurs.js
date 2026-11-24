'use strict';

const { ErreurHttp } = require('../utils/erreurs');

function routeInconnue(req, _res, next) {
  next(new ErreurHttp(404, `Route inconnue : ${req.method} ${req.path}`));
}

/**
 * Gestionnaire d'erreurs final : toujours une réponse JSON
 *   { message, code, details? }
 * Les erreurs inattendues sont journalisées et renvoyées sans détail interne.
 */
function gestionnaireErreurs(journal = console) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    let statut = 500;
    let corps = { message: 'Erreur interne du serveur.', code: 'ERREUR_SERVEUR' };

    if (err instanceof ErreurHttp) {
      statut = err.statut;
      corps = { message: err.message, code: err.code };
      if (err.details) corps.details = err.details;
    } else if (err && err.type === 'entity.parse.failed') {
      statut = 400;
      corps = { message: 'Corps de requête JSON invalide.', code: 'JSON_INVALIDE' };
    } else if (err && err.type === 'entity.too.large') {
      statut = 413;
      corps = { message: 'Requête trop volumineuse.', code: 'TROP_VOLUMINEUX' };
    } else if (err && /UNIQUE constraint failed/.test(err.message || '')) {
      statut = 409;
      corps = { message: 'Cet élément existe déjà.', code: 'CONFLIT' };
    } else {
      journal.error(`[erreur] ${req.method} ${req.originalUrl}`, err);
    }
    res.status(statut).json(corps);
  };
}

module.exports = { routeInconnue, gestionnaireErreurs };
