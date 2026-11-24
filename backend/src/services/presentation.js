'use strict';

/**
 * Conversion des lignes SQL en objets JSON de l'API.
 * Les noms de champs suivent exactement ceux qu'attend l'application Flutter
 * (lib/models/*.dart) : camelCase français, dates ISO 8601, booléens.
 */

function position(p) {
  if (!p) return null;
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    precision: p.precision,
    batterie: p.batterie,
    horodatage: p.horodatage,
  };
}

function enLigne(canne, config) {
  if (!canne.derniere_communication) return false;
  const age = Date.now() - new Date(canne.derniere_communication).getTime();
  return age <= config.seuilEnLigneMin * 60_000;
}

/** Canne vue par un proche (suivi = sa ligne dans « suivis », ou null pour un admin). */
function canne(c, { derniere, suivi, config, nbProches }) {
  return {
    id: c.id,
    identifiant: c.identifiant,
    nom: c.nom,
    enLigne: enLigne(c, config),
    batterie: c.batterie,
    derniereCommunication: c.derniere_communication,
    dernierePosition: position(derniere),
    telephonePersonne: c.telephone_personne,
    active: c.active === undefined ? true : !!c.active,
    partageAutorise: !!c.partage_autorise,
    typeDispositif: c.type_dispositif || 'canne',
    consentement: suivi ? !!suivi.consentement : false,
    principal: suivi ? !!suivi.principal : false,
    ...(nbProches !== undefined ? { nombreProches: nbProches } : {}),
  };
}

function zone(z) {
  return {
    id: z.id,
    cannesId: z.canne_id,
    nom: z.nom,
    latitude: z.latitude,
    longitude: z.longitude,
    rayon: z.rayon,
    actif: !!z.actif,
    creeLe: z.cree_le,
    majLe: z.maj_le,
  };
}

function alerte(a) {
  return {
    id: a.id,
    cannesId: a.canne_id,
    type: a.type,
    message: a.message,
    zoneId: a.zone_id,
    zoneNom: a.zone_nom,
    latitude: a.latitude,
    longitude: a.longitude,
    horodatage: a.horodatage,
    traitee: !!a.traitee,
    traiteeLe: a.traitee_le,
    traiteePar: a.traitee_par_nom || null,
  };
}

function lienPartage(l, config) {
  return {
    id: l.id,
    lien: `${config.urlPublique}/suivi/${l.jeton}`,
    cannesId: l.canne_id,
    expireLe: l.expire_le,
    creeLe: l.cree_le,
  };
}

function utilisateur(u) {
  return {
    id: u.id,
    nom: u.nom,
    telephone: u.telephone,
    role: u.role,
    actif: u.actif === undefined ? true : !!u.actif,
    delaiInactiviteMinutes: u.delai_inactivite_min,
    notificationsActives: u.notifications_actives === undefined ? undefined : !!u.notifications_actives,
    demo: u.demo === undefined ? undefined : !!u.demo,
    creeLe: u.cree_le,
  };
}

module.exports = { position, canne, zone, alerte, lienPartage, utilisateur, enLigne };
