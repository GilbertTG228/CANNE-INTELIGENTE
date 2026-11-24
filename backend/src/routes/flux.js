'use strict';

const jwt = require('jsonwebtoken');

const INTERVALLE_BATTEMENT_MS = 25_000;

/**
 * GET /api/admin/flux?jeton=<JWT>
 * Flux « Server-Sent Events » : la console reçoit chaque position, signe de vie
 * et alerte dès leur arrivée, sans attendre l'actualisation périodique.
 * Le jeton passe dans l'URL car l'API EventSource du navigateur ne permet pas
 * d'ajouter l'en-tête Authorization ; le compte est relu et doit être admin actif.
 */
function fluxAdmin(ctx) {
  const { db, config, evenements } = ctx;
  return (req, res) => {
    const jeton = String(req.query.jeton || '');
    let charge;
    try {
      charge = jwt.verify(jeton, config.secretJwt);
    } catch {
      res.status(401).json({ message: 'Jeton invalide ou expiré.', code: 'NON_AUTHENTIFIE' });
      return;
    }
    const u = db.get('SELECT id, role, actif FROM utilisateurs WHERE id = ?', Number(charge.sub));
    if (!u || !u.actif || u.role !== 'admin') {
      res.status(403).json({ message: 'Action réservée à l\'administrateur.', code: 'ACCES_REFUSE' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // pas de mise en tampon derrière un proxy Nginx
    });
    res.write('retry: 3000\n\n');

    const envoyer = (e) => {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const types = ['position', 'etat', 'alerte'];
    for (const t of types) evenements.on(t, envoyer);

    // Commentaire périodique : garde la connexion ouverte à travers les proxys et tunnels.
    const battement = setInterval(() => res.write(`: battement ${Date.now()}\n\n`), INTERVALLE_BATTEMENT_MS);

    const fermer = () => {
      clearInterval(battement);
      for (const t of types) evenements.off(t, envoyer);
    };
    req.on('close', fermer);
    res.on('error', fermer);
  };
}

module.exports = { fluxAdmin };
