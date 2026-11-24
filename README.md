# Canne Intelligente — application du proche aidant

Prototype complet d'un système de suivi pour **personnes malvoyantes équipées d'une canne
intelligente GPS**. Un proche aidant suit la position de la canne en temps réel, définit des
zones à éviter, consulte l'historique des déplacements et reçoit les alertes (SOS, chute,
entrée en zone, batterie faible, canne inactive).

| Partie | Technologie | Rôle |
|---|---|---|
| `frontend/` | **Flutter** (Dart, Provider, flutter_map/OpenStreetMap) | Application mobile / web du proche aidant (« Canne Proche »), interface inspirée de Life360 |
| `backend/` | **Node.js + Express**, base **SQLite** (module `node:sqlite` intégré), JWT, bcrypt | API REST, règles métier, détection des alertes |
| `backend/public/admin` | HTML/CSS/JS sans framework + Leaflet | Console d'administration inspirée de Traccar (tableau de bord, cartographie, cannes, zones, alertes, maintenance…) **et simulateur de canne** |
| `backend/public/suivi` | HTML/JS + Leaflet | Page publique ouverte par les liens de partage temporaires |
| `backend/public/canne` | HTML/JS (GPS du navigateur) | **Canne virtuelle** : un vrai téléphone remplace la canne pendant les tests |

### Identité visuelle et accessibilité

Indigo `#4338CA`, encre `#0F172A`, statuts vert / orange / rouge très contrastés, titres en
*Plus Jakarta Sans* et texte en *Inter* (identiques dans l'application et la console). Inspirée de
WeWALK pour l'accessibilité : cibles tactiles d'au moins 48 px, contrastes AA, libellés pour les
lecteurs d'écran, état jamais signalé par la seule couleur. **Une position qui n'est plus
actualisée est toujours affichée en gris avec un bandeau orange, jamais comme « en direct ».**

### Parcours de l'application mobile

1. **Présentation** (premier lancement uniquement, revoyable dans *Paramètres › Revoir la présentation*) :
   4 écrans — position en temps réel, historique, zones et alertes, assistance à distance —
   avec *Suivant*, *Passer* et points de pagination.
2. **Connexion** ou **création de compte** du proche.
3. **Association de la canne** (affichée automatiquement tant que le compte ne suit aucune canne) :
   identifiant + code à 6 chiffres de l'étiquette → vérification serveur → nom et téléphone de la
   personne malvoyante → association → SMS d'information à la personne → confirmation et
   redirection automatique vers le tableau de bord.
4. **Tableau de bord** : carte plein écran, panneau glissant, onglets Carte / Zones / Historique / Alertes.

---

## 0. Tests réels avec un téléphone (sans canne physique)

Un téléphone remplace la canne : il envoie **sa vraie position GPS**, sa batterie, des SOS et des
signes de vie au serveur, **exactement par la même API que la future canne**. L'application mobile
et la console affichent ces données en direct (console : flux temps réel ; application : toutes les 5 s).

```
 Téléphone « canne »                Serveur Express                 Proche + administrateur
 (page /canne ou Traccar Client) ─▶ /api/dispositif/*  ─▶ base ─▶  app Flutter (5 s)
   GPS, batterie, SOS, chute         clé X-Cle-Dispositif           console /admin (temps réel, SSE)
```

**Étapes**

1. **Démarrer le serveur sans données fictives** (facultatif, la démo peut rester) :
   ```bash
   cd backend
   npm run base:vierge -- --admin 90000000 MonMotDePasse123 "Administrateur"
   # puis dans .env : DONNEES_DEMO=false
   npm start
   ```
2. **Donner une adresse HTTPS au serveur.** Le navigateur du téléphone n'autorise le GPS que sur
   `https://` (ou sur le PC lui-même). Au choix :
   - *Tunnel (gratuit, pour une séance de test)* : installer `cloudflared`, puis
     `cloudflared tunnel --url http://localhost:3000` → une adresse `https://xxxx.trycloudflare.com`
     s'affiche. La mettre dans `.env` (`URL_PUBLIQUE=https://xxxx.trycloudflare.com`) et redémarrer.
   - *Hébergement permanent* : déployer sur Render avec le fichier `render.yaml` fourni
     (Render › New › Blueprint) ; renseigner `URL_PUBLIQUE`, `ADMIN_TELEPHONE`, `ADMIN_MOT_DE_PASSE`.
3. **Créer la canne** dans la console (`https://<adresse>/admin`) : *Cannes intelligentes › Enregistrer
   une canne*. La fenêtre *Brancher un appareil* s'ouvre avec :
   le **Cane ID**, le **code d'association** (pour le proche), le **code d'activation** et le
   **lien d'activation** (pour le téléphone-canne), et la configuration Traccar Client.
4. **Téléphone-canne** : ouvrir le lien d'activation (ou `https://<adresse>/canne/` puis saisir Cane ID +
   code d'activation) → *Activer* → *Démarrer l'émission* → autoriser la localisation. L'écran reste
   allumé ; sans réseau, les positions sont gardées puis envoyées au retour de la connexion.
   SOS : maintenir le bouton 2 s.
   *Pour émettre écran éteint* : application gratuite **Traccar Client** (Android/iOS) avec l'URL
   `https://<adresse>/api/dispositif/osmand` et, comme identifiant, la clé secrète affichée dans la console.
5. **Téléphone du proche** : `flutter run --dart-define=API_URL=https://<adresse>` (ou un APK construit
   avec la même option) → créer un compte → associer la canne avec Cane ID + code d'association →
   la carte montre la vraie position, avec le badge « Téléphone de test ».
6. **Tester** : marcher dehors, créer une zone sur le trajet (alerte à l'entrée), SOS, couper le réseau du
   téléphone-canne (« Position non actualisée » après 2 min, alerte « canne inactive » après 15 min),
   batterie faible, partage temporaire.

**Règles côté serveur utiles en conditions réelles**

- Une position dont l'imprécision dépasse `PRECISION_MAX_ZONE_M` (80 m par défaut, GPS en intérieur) est
  enregistrée et affichée mais **ne déclenche pas d'alerte de zone**.
- Un appareil immobile envoie un **signe de vie** toutes les 30 s : la position reste « en direct ».
  Sans aucune nouvelle depuis 2 min, l'application affiche « Dernière position connue ».
- La console indique pour chaque canne l'appareil qui émet : *Canne*, *Téléphone de test*,
  *Traccar Client* ou *Simulateur*.

### Passer à la vraie canne

Rien ne change dans l'application ni dans le serveur : le boîtier de la canne (ESP32 + GPS + module
réseau, par exemple) doit simplement respecter ce contrat :

| Requête | En-têtes | Corps |
|---|---|---|
| `POST /api/dispositif/activer` (une fois, à la mise en service) | — | `{identifiant, codeActivation, type: "canne"}` → `{cle}` à garder en mémoire |
| `POST /api/dispositif/positions` | `X-Cle-Dispositif: <clé>`, `X-Source-Dispositif: canne` | `{latitude, longitude, precision?, batterie?, horodatage?}` ou un lot `{positions: [...]}` |
| `POST /api/dispositif/alertes` | idem | `{type: "sos" \| "chute", latitude?, longitude?}` |
| `POST /api/dispositif/battement` | idem | `{batterie?}` toutes les 30 s environ |

---

## 1. Architecture

```
┌──────────────────────┐   HTTP + JWT    ┌───────────────────────────────────────┐
│ Application Flutter  │ ──────────────▶ │  Serveur Express  (backend/src)       │
│ (proche aidant)      │ ◀────────────── │                                       │
│ • carte, zones       │   JSON          │  routes/    → API REST                │
│ • historique         │                 │  middlewares/ → auth, rôles, erreurs, │
│ • alertes, partage   │                 │                limitation de débit    │
│ • cache hors ligne   │                 │  services/  → détection entrée zone,  │
└──────────────────────┘                 │               batterie, inactivité,   │
                                         │               notifications push      │
┌──────────────────────┐  X-Cle-Dispositif│  db/        → SQLite (schema.sql)     │
│ Canne GPS (boîtier)  │ ──────────────▶ │                                       │
│ ou simulateur        │  positions, SOS │                                       │
└──────────────────────┘                 └──────────────┬────────────────────────┘
                                                        │
┌──────────────────────┐   /admin  (JWT, rôle admin)    │    ┌─────────────────────┐
│ Console admin + démo │ ◀──────────────────────────────┤    │ Page /suivi/<jeton> │
└──────────────────────┘                                └──▶ │ (sans compte)       │
                                                             └─────────────────────┘
```

**Flux principal :** la canne envoie ses positions → le serveur les enregistre, compare chaque
position aux zones actives (alerte uniquement à l'**entrée** dans une zone), surveille la batterie
et l'inactivité, puis prévient les proches (notification push). L'application interroge le serveur
toutes les 10 s (positions) et 30 s (alertes) et garde un cache local pour le mode hors ligne.

### Modèle de données (SQLite, `backend/src/db/schema.sql`)

`utilisateurs` (rôle `proche` ou `admin`) ─< `suivis` >─ `cannes` ─< `positions`, `zones`, `alertes`,
`liens_partage` ; plus `etats_zone` (dedans/dehors, pour ne pas répéter les alertes),
`reinitialisations` (codes de mot de passe oublié, hachés) et `journal` (audit des actions sensibles).

---

## 2. Prérequis

| Outil | Version | Vérifier |
|---|---|---|
| Node.js | **22.13 ou plus récent** (LTS 22 ou 24 recommandée) | `node -v` |
| Flutter | 3.27 ou plus récent (projet créé avec 3.35) | `flutter --version` |
| Navigateur | Chrome ou Edge (pour lancer l'application en mode web) | |

Aucune base de données à installer : SQLite est intégré à Node.js (aucune compilation native,
fonctionne tel quel sous Windows, macOS et Linux).

---

## 3. Installation et lancement

### 3.1 Serveur (terminal n° 1)

```bash
cd backend
npm install
cp .env.example .env      # Windows : copy .env.example .env   (facultatif mais recommandé)
npm start
```

Au premier démarrage, la base `backend/data/canne.db` est créée et remplie avec les
**données de démonstration** (voir § 4). Le terminal affiche :

```
🚀 Serveur Canne Intelligente : http://localhost:3000
   Console admin/démo  : http://localhost:3000/admin/
```

Vérification rapide : <http://localhost:3000/api/sante> doit répondre `{"statut":"ok",…}`.

### 3.2 Application Flutter (terminal n° 2)

**Dans Chrome (le plus simple pour la soutenance) :**

```bash
cd frontend
flutter pub get
flutter run -d chrome



cloudflared.exe tunnel --url http://localhost:3000
```

L'application vise `http://localhost:3000` par défaut. Pour un autre serveur :
`flutter run -d chrome --dart-define=API_URL=http://192.168.1.20:3000`.

**Sur émulateur ou téléphone Android :** le dossier `android/` n'est pas versionné ; générez-le
une fois :

```bash
cd frontend
flutter create --org com.exemple --project-name canne_proche --platforms android .
flutter run --dart-define=API_URL=http://10.0.2.2:3000        # émulateur
flutter run --dart-define=API_URL=http://<IP-du-PC>:3000      # téléphone sur le même Wi-Fi
```

Puis, dans `android/app/src/main/AndroidManifest.xml`, ajoutez avant `<application>` :

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.VIBRATE"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<queries><intent><action android:name="android.intent.action.DIAL"/></intent></queries>
```

et `android:usesCleartextTraffic="true"` sur la balise `<application>` (serveur local en `http`).
Dans `android/app/build.gradle(.kts)` : `minSdk = 23`, `isCoreLibraryDesugaringEnabled = true`
et la dépendance `coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")`
(exigés par `flutter_local_notifications`). Sur un téléphone réel, mettez aussi
`URL_PUBLIQUE=http://<IP-du-PC>:3000` dans `backend/.env` pour que les liens de partage s'ouvrent.

### 3.3 Vérifier que tout fonctionne

```bash
cd backend && npm test          # 50 tests d'intégration de l'API
cd frontend && flutter analyze  # analyse statique du code Dart
cd frontend && flutter test     # tests unitaires des modèles
```

---

## 4. Données de démonstration

Elles sont **clairement identifiées** : comptes suffixés « (démo) », badge « démo » dans la
console, colonne `demo = 1` en base, clés de boîtier préfixées `demo-`. Elles ne sont créées que si
la base est vide et que `DONNEES_DEMO=true` (valeur par défaut hors production).

| Compte | Téléphone | Mot de passe | Rôle |
|---|---|---|---|
| Kossi Mensah (démo) | `0123456789` | `password123` | Proche principal des cannes d'Ama et de Yao |
| Afi Mensah (démo) | `91234567` | `Demo@2026` | Proche (suit la canne d'Ama) |
| Administrateur (démo) | `90000000` | `Admin@2026` | Administrateur (console `/admin`) |

| Canne | Identifiant | Code d'association | Particularité |
|---|---|---|---|
| Ama Mensah (Tokoin, Lomé) | `CANNE-0001` | `482913` | 30 jours d'historique, 3 zones, alertes passées |
| Yao Mensah (Bè, Lomé) | `CANNE-0002` | `275604` | Consentement pas encore donné → écran de consentement |
| Nouvelle canne | `CANNE-0003` | `135790` | Non attribuée → pour démontrer l'association réussie |
| Canne hors service | `CANNE-0004` | `246810` | Désactivée → message « canne désactivée » |

Pour montrer le message **« déjà associée à un autre compte »**, connectez-vous avec un nouveau
compte et saisissez `CANNE-0002` / `275604` (suivie par Kossi, partage non autorisé). La canne
d'Ama (`CANNE-0001`) a le partage autorisé : un autre proche peut la rejoindre.

**Remettre la démo à zéro** (serveur arrêté), par exemple juste avant la soutenance :

```bash
cd backend
npm run demo:reset
```

Les positions de démonstration sont générées par rapport à l'heure de création : relancez
`demo:reset` le jour J pour que l'historique « d'aujourd'hui » et la canne « en ligne » soient à jour.

---

## 5. Scénario de démonstration conseillé (≈ 10 minutes)

Disposez côte à côte l'**application** (Chrome, fenêtre étroite ou outils de développement en mode
mobile) et la **console** <http://localhost:3000/admin/> (compte admin).

1. **Présentation** : au premier lancement, parcourir les 4 écrans (*Suivant*, points, *Passer*).
2. **Création de compte et association** : *Créer un compte*, puis l'écran d'association s'affiche
   tout seul. Tester d'abord les erreurs : `CANNE-0003` / `000000` (code faux), `CANNE-0004` /
   `246810` (désactivée), `CANNE-0002` / `275604` (déjà associée). Puis `CANNE-0003` / `135790` :
   canne reconnue → saisir le nom et le téléphone de la personne → *Associer* → confirmation, SMS
   affiché dans le terminal du serveur (`[SMS simulé]`) et dans la console (*Journal › SMS*) →
   redirection automatique vers la carte.
3. **Connexion** avec Kossi (`0123456789` / `password123`) : la carte montre Ama « en direct »,
   le panneau donne batterie, précision GPS et distance du jour.
4. **Zones** : afficher les 3 zones, en créer une en touchant la carte, en désactiver une avec l'interrupteur.
5. **Historique** : chronologie des marches et des arrêts ; jour / mois / année ; toucher un trajet l'affiche sur la carte.
6. **Simulateur** (console → *Simulateur*, canne d'Ama) : *Promenade vers une zone à éviter*. La canne
   se déplace dans l'application ; à l'entrée dans le *Carrefour Déckon*, une alerte « Entrée en zone » apparaît.
7. **SOS** depuis le simulateur → écran rouge dans l'application (≤ 30 s, immédiat avec Firebase) :
   *Appeler*, *Voir sur la carte*, *Je prends en charge* (le nom du proche apparaît ensuite dans la console).
8. **Position non actualisée** : arrêter le simulateur et attendre (ou choisir Yao, hors ligne) :
   marqueur gris, bandeau orange « Position non actualisée depuis… ».
9. **Partage** : panneau de la carte → *Partager* → lien 1 h → page publique → *Révoquer*.
10. **Console** (`/admin`, compte admin) : tableau de bord, cartographie façon Traccar (liste + carte +
    fiche), cannes (activer/désactiver, autoriser le partage, codes), utilisateurs, zones, historique,
    alertes, maintenance (batterie, signal), administrateurs, journal (audit, SMS, notifications).
    Un compte *proche* est refusé par la console, et toute route `/api/admin` lui renvoie 403.

Variante en ligne de commande pour faire tourner une canne en continu :
`npm run simulateur` (promenade en boucle), `npm run simulateur -- --sos`, `npm run simulateur -- --chute`.

---

## 6. Sécurité et règles d'accès

- **Mots de passe** hachés avec bcrypt ; **sessions** par jeton JWT signé (`JWT_SECRET`), utilisateur
  relu en base à chaque requête (un compte désactivé ou un rôle modifié prend effet immédiatement).
- **Rôles** : `proche` (accès uniquement aux cannes qu'il suit) et `admin` (console, toutes les cannes).
  Le proche *principal* d'une canne peut la renommer ; le dernier administrateur ne peut être ni
  rétrogradé ni supprimé.
- **Boîtiers** authentifiés par une clé secrète propre à chaque canne (`X-Cle-Dispositif`), régénérable.
- **Association** d'une canne par identifiant + code à 6 chiffres imprimé sur l'étiquette (preuve que
  le proche a la canne en main). Le serveur vérifie, dans l'ordre : code correct (même réponse si
  l'identifiant n'existe pas, pour ne pas révéler quelles cannes existent), canne **active**, canne
  pas déjà suivie par ce proche, canne pas déjà associée à un autre compte sauf si le **partage**
  est autorisé (par l'administrateur ou le proche principal). Un SMS informe ensuite la personne
  malvoyante, au numéro enregistré pour la canne. Une canne désactivée ne peut plus émettre.
- **Codes de réinitialisation**
  hachés, valables 15 min, 5 essais maximum, usage unique ; réponses identiques que le compte existe
  ou non (pas d'énumération des comptes).
- **Limitation de débit** : connexion (10 essais / 15 min), inscription et codes, association, API boîtier.
- **Validation** systématique des entrées (erreur 422 avec la liste des champs invalides), requêtes
  SQL paramétrées, en-têtes de sécurité, CORS configurable, journal d'audit.
- **Liens de partage** : jeton aléatoire, durée limitée (72 h max), révocables ; la page publique
  n'expose que le nom, la batterie et la dernière position.

---

## 7. Référence de l'API

Toutes les réponses sont en JSON ; les erreurs ont la forme `{ "message", "code", "details"? }`.
Routes authentifiées : en-tête `Authorization: Bearer <jeton>`.

| Méthode et route | Accès | Description |
|---|---|---|
| `GET /api/sante` | public | État du serveur |
| `POST /api/auth/connexion` | public | `{telephone, motDePasse}` → `{jeton, utilisateur}` |
| `POST /api/auth/inscription` | public | `{nom, telephone, motDePasse}` → 201 `{jeton, utilisateur}` |
| `POST /api/auth/mot-de-passe-oublie` | public | `{telephone}` → envoie un code (SMS simulé) |
| `POST /api/auth/reinitialiser-mot-de-passe` | public | `{telephone, code, nouveauMotDePasse}` |
| `GET /api/auth/moi` | connecté | Utilisateur courant |
| `GET/PUT /api/utilisateur/profil` | connecté | Lire / modifier `{nom}` |
| `PUT /api/utilisateur/parametres` | connecté | `{delaiInactiviteMinutes, notificationsActives, fcmToken}` |
| `PUT /api/utilisateur/mot-de-passe` | connecté | `{ancienMotDePasse, nouveauMotDePasse}` |
| `GET /api/cannes` | proche | Cannes suivies (avec dernière position) |
| `POST /api/cannes/verifier` | proche | `{identifiant, codeAppairage}` → `{canne}` sans associer. Erreurs : `APPAIRAGE_INVALIDE` (400), `CANNE_DESACTIVEE` (403), `DEJA_SUIVIE` / `CANNE_DEJA_ASSOCIEE` (409) |
| `POST /api/cannes/associer` | proche | `{identifiant, codeAppairage, nomPersonne?, telephonePersonne?}` → 201 `{canne, smsEnvoye}` (mêmes erreurs) |
| `GET/PUT /api/cannes/:id` | suit la canne | Détail / modification `{nom?, telephonePersonne?, partageAutorise?}` (proche principal) |
| `DELETE /api/cannes/:id/association` | suit la canne | Ne plus suivre |
| `GET /api/cannes/:id/proches` | suit la canne | Proches qui suivent la canne |
| `GET /api/cannes/:id/position` | suit la canne | Dernière position |
| `GET /api/cannes/:id/historique?du=AAAA-MM-JJ&au=AAAA-MM-JJ` | suit la canne | Positions de la période |
| `POST /api/cannes/:id/sos` | suit la canne | SOS de test |
| `GET/POST /api/cannes/:id/zones` | suit la canne | Zones à éviter |
| `PUT/DELETE /api/cannes/:id/zones/:zoneId` | suit la canne | Modifier / supprimer une zone |
| `GET /api/cannes/:id/alertes?nonTraitees=true` | suit la canne | Journal d'alertes |
| `PUT /api/alertes/:id/traitee` | suit la canne | Marquer une alerte comme traitée |
| `POST /api/consentements` | proche | `{cannesId}` |
| `POST/GET /api/liens-partage`, `DELETE /api/liens-partage/:id` | proche | Liens temporaires `{cannesId, dureeHeures}` |
| `GET /api/public/suivi/:jeton` · page `GET /suivi/:jeton` | public | Suivi par lien de partage |
| `POST /api/dispositif/positions` | boîtier | Position ou lot `{positions: [...]}` |
| `POST /api/dispositif/alertes` | boîtier | `{type: "sos" \| "chute", latitude?, longitude?}` |
| `POST /api/dispositif/battement` | boîtier | Signe de vie `{batterie?}` |
| `POST /api/dispositif/activer` | public (code) | `{identifiant, codeActivation, type?}` → `{cle, canne, reglages}` |
| `GET\|POST /api/dispositif/osmand` | clé dans `id` | Format Traccar Client / OsmAnd (paramètres ou JSON) |
| `GET /api/admin/flux?jeton=` | admin | Flux temps réel (Server-Sent Events) : `position`, `etat`, `alerte` |
| `/api/admin/statistiques`, `/utilisateurs`, `/cannes` (dont `active`, `partageAutorise`), `/cannes/:id/proches`, `/cannes/:id/regenerer`, `/positions`, `/alertes`, `/journal`, `/sms`, `/notifications` | admin | Administration |

---

## 8. Structure du projet

```
canne-intelligente/
├── README.md                 ce document
├── backend/
│   ├── server.js             point d'entrée (npm start)
│   ├── .env.example          variables d'environnement commentées
│   ├── src/
│   │   ├── app.js            assemblage Express (middlewares, routes, pages)
│   │   ├── server.js         démarrage, données de démo, surveillance, arrêt propre
│   │   ├── config.js         lecture de la configuration
│   │   ├── db/               schema.sql, database.js (SQLite), demo.js (données de démo)
│   │   ├── middlewares/      auth.js (JWT, rôles, accès canne, clé boîtier), securite.js, erreurs.js
│   │   ├── routes/           auth, utilisateur, cannes, divers (alertes, partage, consentements, public), dispositif, admin
│   │   ├── services/         positions (zones, batterie), alertes, surveillance (inactivité), notifications (FCM), sms, presentation (JSON)
│   │   └── utils/            validation, erreurs, géo (haversine), outils
│   ├── public/admin/         console d'administration + simulateur
│   ├── public/suivi/         page publique des liens de partage
│   ├── public/canne/         canne virtuelle (téléphone de test)
│   ├── scripts/              reinitialiser-base.js, creer-admin.js, simulateur.js
│   └── tests/                tests d'intégration (node:test)
└── frontend/
    ├── pubspec.yaml
    ├── lib/
    │   ├── main.dart         assemblage, thème, routes
    │   ├── config/           app_config.dart (URL API…), theme.dart
    │   ├── models/           canne, position, zone, alerte, trajet, itinéraire, lien de partage
    │   ├── services/         api_client, auth_service, repository, cache (SQLite), routage OSRM, localisation, notifications
    │   ├── controllers/      suivi, alertes, zones, historique, association, paramètres, auth, navigation (Provider)
    │   ├── screens/          présentation (onboarding), connexion, inscription, association, consentement, accueil, zones,
    │   │                     historique, alertes, alerte en cours, partage, paramètres, association de canne…
    │   └── widgets/          composants (avatar, tuiles, boutons, marqueurs), sélecteur de personne, bandeaux, carte…
    ├── test/                 tests unitaires des modèles
    └── web/                  page d'accueil web
```

---

## 9. Configuration avancée

- **Carte Google Maps** (application mobile + console + page de suivi partagé) : ajoutez dans
  `backend/.env` la ligne `GOOGLE_MAPS_CLE=votre_cle`, puis redémarrez le serveur. La clé de
  démonstration Google (gratuite, sans carte bancaire : https://mapsplatform.google.com/maps-demo-key/)
  suffit. Elle couvre la Maps JavaScript API mais pas le SDK natif Android/iOS : l'application affiche
  donc la page `/carte-app/` du serveur dans une vue web (iframe en version web). Sans clé, si Google
  refuse la clé ou si le quota du jour est atteint, toutes les cartes repassent sur OpenStreetMap.
  Ne publiez jamais la clé (ni dans le code, ni sur GitHub) ; restreignez-la à vos adresses dans la
  console Google Cloud. Après l'ajout de la clé, relancez aussi `flutter pub get` (nouvelles
  dépendances `webview_flutter` et `web`).
- **Notifications push réelles (Firebase)** : côté serveur, placez le JSON du compte de service et
  définissez `FCM_COMPTE_SERVICE` dans `.env` ; côté application, ajoutez `google-services.json`
  dans `android/app/` (voir la documentation FlutterFire). Sans cela, l'application fonctionne
  normalement : les alertes arrivent par l'actualisation périodique et le serveur affiche
  `[push simulé]` dans sa console.
- **SMS** (code « mot de passe oublié », information de la personne lors d'une association) :
  sans configuration, ils sont écrits dans le terminal (`[SMS simulé]`) et visibles dans la console
  (*Journal › SMS*). Pour un vrai envoi, renseigner `SMS_PASSERELLE_URL` (et `SMS_PASSERELLE_CLE`)
  dans `.env` ; adapter si besoin le format de la requête dans `src/services/sms.js`.
- **Production** : `NODE_ENV=production`, `JWT_SECRET` long et aléatoire, `DONNEES_DEMO=false`,
  `CORS_ORIGINES` restreint, HTTPS via un proxy (Nginx, Caddy). Créer le premier administrateur :
  `node scripts/creer-admin.js <telephone> <motDePasse> "<Nom>"`.

## 10. Dépannage

| Symptôme | Solution |
|---|---|
| `Node.js … la version 22.13 ou supérieure est requise` | Installer Node.js LTS depuis nodejs.org |
| `EADDRINUSE` au démarrage | Le port 3000 est occupé : `PORT=3001` dans `.env` (et `--dart-define=API_URL=…:3001`) |
| L'application affiche « Serveur injoignable » | Serveur lancé ? Bonne `API_URL` ? (émulateur : `10.0.2.2`, téléphone : IP du PC + même Wi-Fi + pare-feu) |
| Sessions perdues à chaque redémarrage | Définir `JWT_SECRET` dans `.env` |
| Carte grise | Les tuiles OpenStreetMap nécessitent Internet |
| Historique vide « aujourd'hui » | Relancer `npm run demo:reset` (les données de démo sont datées du jour de création) |

## 11. Limites connues du prototype

- Pas de matériel réel : la canne est représentée par le simulateur, qui utilise exactement l'API
  prévue pour le boîtier GPS.
- Actualisation par interrogation (10 s / 30 s) plutôt que WebSocket ; suffisant à l'échelle du prototype.
- Le calcul d'itinéraire utilise l'instance publique OSRM (usage modéré) ; à héberger soi-même en production.
- Le mode hors ligne (cache SQLite) est disponible sur Android/iOS ; en mode web il est désactivé
  sans gêner le fonctionnement.
