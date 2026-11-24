'use strict';

const { maintenant } = require('../utils/outils');

/** Trace une action sensible dans le journal d'audit. */
function tracer(db, utilisateurId, action, details) {
  db.run(
    'INSERT INTO journal (utilisateur_id, action, details, cree_le) VALUES (?, ?, ?, ?)',
    utilisateurId ?? null,
    action,
    details === undefined ? null : typeof details === 'string' ? details : JSON.stringify(details),
    maintenant(),
  );
}

module.exports = { tracer };
