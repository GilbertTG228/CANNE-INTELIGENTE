'use strict';

require('../utils/silence-sqlite');

const fs = require('node:fs');
const path = require('node:path');

// Module SQLite intégré à Node.js (>= 22.13) : aucune compilation native ni
// installation supplémentaire, ce qui rend le projet portable (Windows, Linux, macOS).
const { DatabaseSync } = require('node:sqlite');

/** node:sqlite n'accepte ni booléens ni undefined : on convertit. */
function normaliser(valeur) {
  if (valeur === undefined) return null;
  if (typeof valeur === 'boolean') return valeur ? 1 : 0;
  if (valeur instanceof Date) return valeur.toISOString();
  return valeur;
}

/**
 * Petite enveloppe autour de DatabaseSync :
 *   db.get(sql, ...params)   -> une ligne ou undefined
 *   db.all(sql, ...params)   -> tableau de lignes
 *   db.run(sql, ...params)   -> { changes, lastInsertRowid }
 *   db.transaction(fn)       -> exécute fn dans BEGIN/COMMIT (ROLLBACK si erreur)
 */
class Base {
  constructor(chemin) {
    if (chemin !== ':memory:') fs.mkdirSync(path.dirname(chemin), { recursive: true });
    this.chemin = chemin;
    this.sqlite = new DatabaseSync(chemin);
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    if (chemin !== ':memory:') this.sqlite.exec('PRAGMA journal_mode = WAL;');
    this._cache = new Map();
    this._profondeurTransaction = 0;
  }

  _preparer(sql) {
    let stmt = this._cache.get(sql);
    if (!stmt) {
      stmt = this.sqlite.prepare(sql);
      this._cache.set(sql, stmt);
    }
    return stmt;
  }

  get(sql, ...params) {
    const ligne = this._preparer(sql).get(...params.map(normaliser));
    return ligne === undefined ? undefined : { ...ligne };
  }

  all(sql, ...params) {
    return this._preparer(sql).all(...params.map(normaliser)).map((l) => ({ ...l }));
  }

  run(sql, ...params) {
    const r = this._preparer(sql).run(...params.map(normaliser));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql) {
    this.sqlite.exec(sql);
  }

  transaction(fn) {
    // Les transactions imbriquées sont simplement fusionnées dans la plus externe.
    if (this._profondeurTransaction > 0) return fn();
    this._profondeurTransaction++;
    this.sqlite.exec('BEGIN');
    try {
      const resultat = fn();
      this.sqlite.exec('COMMIT');
      return resultat;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    } finally {
      this._profondeurTransaction--;
    }
  }

  fermer() {
    this.sqlite.close();
  }
}

/**
 * Colonnes ajoutées après la première version : une base existante les reçoit
 * par ALTER TABLE (CREATE TABLE IF NOT EXISTS ne modifie pas une table existante).
 */
const COLONNES_AJOUTEES = [
  ['cannes', 'active', 'INTEGER NOT NULL DEFAULT 1'],
  ['cannes', 'partage_autorise', 'INTEGER NOT NULL DEFAULT 0'],
  ['cannes', 'code_activation', 'TEXT'],
  ['cannes', 'type_dispositif', "TEXT NOT NULL DEFAULT 'canne'"],
  ['cannes', 'dispositif_active_le', 'TEXT'],
];

function migrer(db) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  for (const [table, colonne, definition] of COLONNES_AJOUTEES) {
    const existantes = db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
    if (!existantes.includes(colonne)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
  }
  // Chaque canne doit avoir un code d'activation (bases créées avant cette colonne).
  const { codeActivation } = require('../utils/outils');
  for (const c of db.all('SELECT id FROM cannes WHERE code_activation IS NULL')) {
    db.run('UPDATE cannes SET code_activation = ? WHERE id = ?', codeActivation(), c.id);
  }
}

function ouvrirBase(chemin) {
  const db = new Base(chemin);
  migrer(db);
  return db;
}

module.exports = { ouvrirBase, Base };
