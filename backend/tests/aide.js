'use strict';

const { chargerConfig } = require('../src/config');
const { ouvrirBase } = require('../src/db/database');
const { creerApplication } = require('../src/app');
const { peuplerDemo } = require('../src/db/demo');

const silencieux = { log() {}, warn() {}, error: console.error };

/**
 * Démarre une instance isolée du serveur (base SQLite en mémoire, port libre).
 * Renvoie { url, db, ctx, requete, connexion, fermer }.
 */
async function demarrer({ demo = true, config: surcharges = {} } = {}) {
  const config = chargerConfig({
    cheminBase: ':memory:',
    secretJwt: 'secret-de-test',
    journalRequetes: false,
    urlPublique: 'http://test.local',
    ...surcharges,
  });
  const db = ouvrirBase(':memory:');
  if (demo) peuplerDemo(db);
  const app = creerApplication({ db, config, journal: silencieux });
  const serveur = await new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  const url = `http://127.0.0.1:${serveur.address().port}`;

  async function requete(methode, chemin, { corps, jeton, entetes = {} } = {}) {
    const r = await fetch(url + chemin, {
      method: methode,
      headers: {
        ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
        ...entetes,
      },
      body: corps === undefined ? undefined : typeof corps === 'string' ? corps : JSON.stringify(corps),
    });
    const texte = await r.text();
    let json = null;
    try {
      json = texte ? JSON.parse(texte) : null;
    } catch {
      json = null;
    }
    return { statut: r.status, json, texte, entetes: r.headers };
  }

  async function connexion(telephone, motDePasse) {
    const r = await requete('POST', '/api/auth/connexion', { corps: { telephone, motDePasse } });
    if (r.statut !== 200) throw new Error(`Connexion ${telephone} impossible : ${r.statut} ${r.texte}`);
    return r.json.jeton;
  }

  const ctx = app.locals.ctx;
  return {
    url,
    db,
    ctx,
    requete,
    connexion,
    fermer: () =>
      new Promise((ok) => {
        serveur.closeAllConnections?.();
        serveur.close(() => {
          db.fermer();
          ok();
        });
      }),
  };
}

module.exports = { demarrer };
