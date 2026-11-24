'use strict';

const { ilYaMinutes } = require('../utils/outils');
const { creerAlerte, notifier } = require('./alertes');

/**
 * Tâche périodique : une canne qui n'a rien transmis depuis
 * SEUIL_INACTIVITE_MIN minutes génère UNE alerte « canne inactive »
 * (réarmée dès qu'une nouvelle position arrive).
 */
function verifierInactivite(ctx) {
  const { db, config } = ctx;
  const limite = ilYaMinutes(config.seuilInactiviteMin);
  const inactives = db.all(
    `SELECT * FROM cannes
      WHERE active = 1 AND derniere_communication IS NOT NULL AND derniere_communication < ? AND inactivite_signalee = 0`,
    limite,
  );
  const creees = [];
  for (const canne of inactives) {
    const alerte = db.transaction(() => {
      db.run('UPDATE cannes SET inactivite_signalee = 1 WHERE id = ?', canne.id);
      return creerAlerte(db, canne, { type: 'canne_inactive' });
    });
    notifier(ctx, canne, alerte);
    creees.push(alerte);
  }
  return creees;
}

function demarrerSurveillance(ctx) {
  const minuteur = setInterval(() => {
    try {
      verifierInactivite(ctx);
    } catch (e) {
      console.error('[surveillance] erreur :', e);
    }
  }, ctx.config.intervalleSurveillanceS * 1000);
  minuteur.unref();
  return () => clearInterval(minuteur);
}

module.exports = { verifierInactivite, demarrerSurveillance };
