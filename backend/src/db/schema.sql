-- Schéma de la base Canne Intelligente (SQLite).
-- Les dates sont stockées en texte ISO 8601 UTC (ex. 2026-11-06T09:30:00.000Z),
-- ce qui permet de les trier et de les comparer directement.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS utilisateurs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  telephone              TEXT    NOT NULL UNIQUE,
  nom                    TEXT    NOT NULL,
  mot_de_passe_hash      TEXT    NOT NULL,
  role                   TEXT    NOT NULL DEFAULT 'proche' CHECK (role IN ('proche', 'admin')),
  actif                  INTEGER NOT NULL DEFAULT 1,
  delai_inactivite_min   INTEGER NOT NULL DEFAULT 15,
  notifications_actives  INTEGER NOT NULL DEFAULT 1,
  fcm_token              TEXT,
  demo                   INTEGER NOT NULL DEFAULT 0,
  cree_le                TEXT    NOT NULL,
  maj_le                 TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS cannes (
  id                      TEXT    PRIMARY KEY,
  identifiant             TEXT    NOT NULL UNIQUE,   -- numéro de série imprimé sur la canne
  nom                     TEXT    NOT NULL,
  telephone_personne      TEXT,                      -- numéro de la personne qui utilise la canne
  cle_dispositif          TEXT    NOT NULL UNIQUE,   -- clé secrète du boîtier GPS (API dispositif)
  code_appairage          TEXT    NOT NULL,          -- code à 6 chiffres pour associer un proche
  active                  INTEGER NOT NULL DEFAULT 1, -- 0 = canne désactivée (hors service, perdue…)
  partage_autorise        INTEGER NOT NULL DEFAULT 0, -- 1 = plusieurs proches peuvent s'associer
  code_activation         TEXT,                      -- code pour brancher un appareil (téléphone de test, boîtier)
  type_dispositif         TEXT    NOT NULL DEFAULT 'canne', -- canne | telephone | traccar | simulateur
  dispositif_active_le    TEXT,                      -- dernière activation d'un appareil
  batterie                INTEGER,
  derniere_communication  TEXT,
  inactivite_signalee     INTEGER NOT NULL DEFAULT 0,
  batterie_signalee       INTEGER NOT NULL DEFAULT 0,
  demo                    INTEGER NOT NULL DEFAULT 0,
  cree_le                 TEXT    NOT NULL,
  maj_le                  TEXT    NOT NULL
);

-- Proches qui suivent une canne (plusieurs proches par canne, plusieurs cannes par proche).
CREATE TABLE IF NOT EXISTS suivis (
  utilisateur_id   INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  canne_id         TEXT    NOT NULL REFERENCES cannes(id) ON DELETE CASCADE,
  principal        INTEGER NOT NULL DEFAULT 0,       -- le proche principal peut renommer la canne
  consentement     INTEGER NOT NULL DEFAULT 0,
  consentement_le  TEXT,
  cree_le          TEXT    NOT NULL,
  PRIMARY KEY (utilisateur_id, canne_id)
);

CREATE TABLE IF NOT EXISTS positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  canne_id    TEXT    NOT NULL REFERENCES cannes(id) ON DELETE CASCADE,
  latitude    REAL    NOT NULL,
  longitude   REAL    NOT NULL,
  precision   REAL,
  batterie    INTEGER,
  horodatage  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_positions_canne_date ON positions (canne_id, horodatage);

CREATE TABLE IF NOT EXISTS zones (
  id         TEXT    PRIMARY KEY,
  canne_id   TEXT    NOT NULL REFERENCES cannes(id) ON DELETE CASCADE,
  nom        TEXT    NOT NULL,
  latitude   REAL    NOT NULL,
  longitude  REAL    NOT NULL,
  rayon      REAL    NOT NULL,
  actif      INTEGER NOT NULL DEFAULT 1,
  cree_par   INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le    TEXT    NOT NULL,
  maj_le     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zones_canne ON zones (canne_id);

-- Dernier état connu (dedans / dehors) de la canne pour chaque zone :
-- une alerte n'est créée qu'au moment de l'entrée, pas à chaque position.
CREATE TABLE IF NOT EXISTS etats_zone (
  canne_id     TEXT    NOT NULL REFERENCES cannes(id) ON DELETE CASCADE,
  zone_id      TEXT    NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  a_l_interieur INTEGER NOT NULL,
  PRIMARY KEY (canne_id, zone_id)
);

CREATE TABLE IF NOT EXISTS alertes (
  id           TEXT    PRIMARY KEY,
  canne_id     TEXT    NOT NULL REFERENCES cannes(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL CHECK (type IN ('sos', 'entree_zone', 'chute', 'batterie_faible', 'canne_inactive')),
  message      TEXT,
  zone_id      TEXT    REFERENCES zones(id) ON DELETE SET NULL,
  zone_nom     TEXT,
  latitude     REAL,
  longitude    REAL,
  horodatage   TEXT    NOT NULL,
  traitee      INTEGER NOT NULL DEFAULT 0,
  traitee_par  INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  traitee_le   TEXT
);
CREATE INDEX IF NOT EXISTS idx_alertes_canne_date ON alertes (canne_id, horodatage);

CREATE TABLE IF NOT EXISTS liens_partage (
  id              TEXT    PRIMARY KEY,
  jeton           TEXT    NOT NULL UNIQUE,
  canne_id        TEXT    NOT NULL REFERENCES cannes(id) ON DELETE CASCADE,
  utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  expire_le       TEXT    NOT NULL,
  revoque_le      TEXT,
  cree_le         TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reinitialisations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  code_hash       TEXT    NOT NULL,
  essais          INTEGER NOT NULL DEFAULT 0,
  expire_le       TEXT    NOT NULL,
  utilise         INTEGER NOT NULL DEFAULT 0,
  cree_le         TEXT    NOT NULL
);

-- Journal d'audit (actions sensibles), consultable par l'administrateur.
CREATE TABLE IF NOT EXISTS journal (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur_id  INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  action          TEXT    NOT NULL,
  details         TEXT,
  cree_le         TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal (cree_le);
