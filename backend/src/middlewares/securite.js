'use strict';

const { ErreurHttp } = require('../utils/erreurs');

/** En-têtes de sécurité de base (équivalent minimal de « helmet »). */
function entetesSecurite(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    // La page /carte-app/ est la seule à pouvoir être intégrée dans une autre page :
    // l'application Flutter en version web l'affiche dans un cadre (iframe).
    ...(req.path.startsWith('/carte-app/') ? {} : { 'X-Frame-Options': 'DENY' }),
    // Les serveurs de tuiles OpenStreetMap refusent les requêtes sans en-tête
    // Referer (« Access blocked »). « strict-origin-when-cross-origin » n'envoie
    // aux autres sites que l'origine (https://serveur), jamais le chemin : les
    // jetons des liens de partage (/suivi/<jeton>) ne fuitent donc pas.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  next();
}

/**
 * Limiteur de débit en mémoire (fenêtre fixe), suffisant pour un serveur
 * unique. `cle(req)` choisit ce qui est compté (IP, IP + téléphone…).
 */
function limiteur({ fenetreMs, max, cle = (req) => req.ip, message }) {
  const compteurs = new Map();
  const nettoyage = setInterval(() => {
    const t = Date.now();
    for (const [k, e] of compteurs) if (e.fin <= t) compteurs.delete(k);
  }, fenetreMs);
  nettoyage.unref();

  const middleware = (req, res, next) => {
    const k = cle(req);
    const t = Date.now();
    let e = compteurs.get(k);
    if (!e || e.fin <= t) {
      e = { n: 0, fin: t + fenetreMs };
      compteurs.set(k, e);
    }
    e.n++;
    if (e.n > max) {
      res.set('Retry-After', String(Math.ceil((e.fin - t) / 1000)));
      return next(new ErreurHttp(429, message || 'Trop de tentatives. Réessayez dans quelques minutes.'));
    }
    next();
  };
  middleware.reinitialiser = () => compteurs.clear();
  return middleware;
}

module.exports = { entetesSecurite, limiteur };
