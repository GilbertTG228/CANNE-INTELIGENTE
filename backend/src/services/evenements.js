'use strict';

const { EventEmitter } = require('node:events');

/**
 * Bus d'événements interne : chaque position, signe de vie ou alerte reçus
 * d'un appareil y est publié. Le flux temps réel (routes/flux.js) le relaie
 * aux pages ouvertes (console d'administration) sans attendre l'interrogation
 * périodique.
 *
 * Événements :
 *   « position » {canneId, position, batterie, typeDispositif}
 *   « etat »     {canneId, batterie, derniereCommunication, typeDispositif}
 *   « alerte »   {canneId, canneNom, alerte}
 */
function creerBusEvenements() {
  const bus = new EventEmitter();
  bus.setMaxListeners(200);
  return bus;
}

/** Publie sans jamais faire échouer l'appelant. */
function publier(ctx, type, donnees) {
  try {
    ctx.evenements?.emit(type, { type, le: new Date().toISOString(), ...donnees });
  } catch (e) {
    console.warn(`[événements] ${type} : ${e.message}`);
  }
}

module.exports = { creerBusEvenements, publier };
