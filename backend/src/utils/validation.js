'use strict';

const { ErreurHttp } = require('./erreurs');

/**
 * Validation déclarative minimaliste (sans dépendance) :
 *
 *   const donnees = valider(req.body, {
 *     nom: v.texte({ min: 1, max: 80 }),
 *     rayon: v.nombre({ min: 10, max: 2000 }),
 *     actif: v.booleen({ optionnel: true, defaut: true }),
 *   });
 *
 * Renvoie un objet ne contenant que les champs déclarés, convertis et nettoyés.
 * Lève une erreur 422 listant tous les champs invalides.
 */
function valider(source, schema, { partiel = false } = {}) {
  const entree = source && typeof source === 'object' ? source : {};
  const sortie = {};
  const erreurs = [];

  for (const [champ, regle] of Object.entries(schema)) {
    const brut = entree[champ];
    const absent = brut === undefined || brut === null || brut === '';
    if (absent) {
      if (partiel) continue;
      if (regle.optionnel) {
        if (regle.defaut !== undefined) sortie[champ] = regle.defaut;
        continue;
      }
      erreurs.push({ champ, message: `${regle.libelle || champ} est obligatoire.` });
      continue;
    }
    const r = regle.verifier(brut);
    if (r.erreur) erreurs.push({ champ, message: `${regle.libelle || champ} : ${r.erreur}` });
    else sortie[champ] = r.valeur;
  }

  if (erreurs.length) {
    throw new ErreurHttp(422, erreurs[0].message, { details: erreurs });
  }
  return sortie;
}

function regle(verifier, options = {}) {
  return { verifier, optionnel: !!options.optionnel, defaut: options.defaut, libelle: options.libelle };
}

const v = {
  texte({ min = 0, max = 255, motif, messageMotif, ...o } = {}) {
    return regle((x) => {
      if (typeof x !== 'string' && typeof x !== 'number') return { erreur: 'texte attendu.' };
      const s = String(x).trim();
      if (s.length < min) return { erreur: `au moins ${min} caractère(s).` };
      if (s.length > max) return { erreur: `au plus ${max} caractères.` };
      if (motif && !motif.test(s)) return { erreur: messageMotif || 'format invalide.' };
      return { valeur: s };
    }, o);
  },

  /** Numéro de téléphone : on garde les chiffres et un « + » initial. */
  telephone(o = {}) {
    return regle((x) => {
      const s = String(x).trim().replace(/[\s.\-()]/g, '');
      if (!/^\+?\d{6,15}$/.test(s)) return { erreur: 'numéro invalide (6 à 15 chiffres).' };
      return { valeur: s };
    }, { libelle: 'Le numéro de téléphone', ...o });
  },

  motDePasse(o = {}) {
    return regle((x) => {
      if (typeof x !== 'string') return { erreur: 'texte attendu.' };
      if (x.length < 8) return { erreur: 'au moins 8 caractères.' };
      if (x.length > 128) return { erreur: 'au plus 128 caractères.' };
      return { valeur: x };
    }, { libelle: 'Le mot de passe', ...o });
  },

  nombre({ min = -Infinity, max = Infinity, entier = false, ...o } = {}) {
    return regle((x) => {
      const n = typeof x === 'number' ? x : Number(String(x).replace(',', '.'));
      if (!Number.isFinite(n)) return { erreur: 'nombre attendu.' };
      if (entier && !Number.isInteger(n)) return { erreur: 'nombre entier attendu.' };
      if (n < min || n > max) return { erreur: `doit être compris entre ${min} et ${max}.` };
      return { valeur: n };
    }, o);
  },

  booleen(o = {}) {
    return regle((x) => {
      if (typeof x === 'boolean') return { valeur: x };
      if (x === 1 || x === '1' || x === 'true') return { valeur: true };
      if (x === 0 || x === '0' || x === 'false') return { valeur: false };
      return { erreur: 'vrai ou faux attendu.' };
    }, o);
  },

  choix(valeurs, o = {}) {
    return regle((x) => {
      const s = String(x);
      if (!valeurs.includes(s)) return { erreur: `valeur attendue : ${valeurs.join(', ')}.` };
      return { valeur: s };
    }, o);
  },

  /** Date ISO 8601 complète (horodatage) — renvoyée en ISO UTC. */
  horodatage(o = {}) {
    return regle((x) => {
      const d = typeof x === 'number' ? new Date(x > 1e11 ? x : x * 1000) : new Date(String(x));
      if (Number.isNaN(d.getTime())) return { erreur: 'date invalide.' };
      return { valeur: d.toISOString() };
    }, o);
  },

  /** Date du jour au format AAAA-MM-JJ. */
  jour(o = {}) {
    return regle((x) => {
      const s = String(x);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return { erreur: 'format AAAA-MM-JJ attendu.' };
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (d.getMonth() !== Number(m[2]) - 1) return { erreur: 'date inexistante.' };
      return { valeur: d };
    }, o);
  },
};

module.exports = { valider, v };
