# Canne Proche — application du proche aidant (Flutter)

Suivi d'une ou plusieurs cannes intelligentes GPS : position en temps réel, zones à éviter,
historique, alertes (SOS, zone, chute, batterie, inactivité), partage temporaire, notifications.
Interface en français, système de design « Vigilance & Care » (thèmes clair et sombre).

> Installation complète, comptes de démonstration et scénario de soutenance : voir le
> [README principal](../README.md).

## Lancement rapide

```bash
# Terminal 1 — serveur
cd ../backend && npm install && npm start

# Terminal 2 — application
flutter pub get
flutter run -d chrome                                   # API par défaut : http://localhost:3000
flutter run --dart-define=API_URL=http://10.0.2.2:3000  # émulateur Android
```

Identifiants de démonstration : `0123456789` / `password123`.

Vérifications : `flutter analyze` puis `flutter test`.

## Structure

```
lib/
  main.dart               assemblage, thème, routes
  config/                 app_config.dart (URL API, routage, délais) · theme.dart
  models/                 canne, position_canne, zone, alerte, trajet, itineraire, lien_partage
  services/               api_client, auth_service (JWT sécurisé), repository (toutes les routes
                          + repli cache), cache_service (SQLite), routing_service (OSRM),
                          location_service, notification_service (FCM + locales)
  controllers/            suivi, alertes, zones, historique, settings, auth, navigation (Provider)
  screens/                connexion, inscription, mot de passe oublié (2 étapes), consentement,
                          accueil_shell, accueil, zones, édition de zone, historique, alertes,
                          alerte en cours, partage, paramètres, association de canne,
                          protection des données, sélection d'un point
  widgets/                en-tête/sélecteur de canne, bandeaux, carte, pastilles, états vides…
test/                     tests unitaires des modèles (formats JSON du serveur)
```

## Choix importants
- **Provider + ChangeNotifier** : simple à lire et à expliquer, suffisant ici.
- **Actualisation par interrogation** (positions 10 s, alertes 30 s), arrêtée en arrière-plan.
- **Mode hors ligne** : chaque lecture réussie est stockée dans SQLite ; si le serveur est
  injoignable, le cache est affiché avec un bandeau (Android/iOS ; désactivé en web).
- **Canne inactive** : affichée par l'application (âge de la dernière position > délai réglé) ;
  le serveur crée aussi une alerte « canne inactive » dans le journal.
- **Cartes** : Google Maps si le serveur a une clé (`GOOGLE_MAPS_CLE` dans `backend/.env`, lue au
  démarrage via `GET /api/public/config-carte`) : la page `/carte-app/` du serveur est affichée
  dans une vue web (`webview_flutter`) ou un iframe (web). Sinon, ou en cas d'échec : flutter_map +
  OpenStreetMap. Les écrans décrivent seulement ce qu'il faut dessiner (`CouchesCarte` dans
  `lib/widgets/carte_base.dart`).
- **Routage** : OSRM piéton (instance publique) ; `--dart-define=ROUTAGE_URL=...` pour une instance dédiée.

## Contrat avec le serveur (implémenté dans `../backend`)
- Listes enveloppées : `{cannes}`, `{zones}`, `{alertes}`, `{positions}`, `{liens}` ; dates ISO 8601 UTC.
- Canne : `{id, identifiant, nom, enLigne, batterie, dernierePosition, telephonePersonne, consentement}`.
- Alerte : `{id, cannesId, type (sos|entree_zone|chute|batterie_faible|canne_inactive), horodatage,
  zoneNom, latitude, longitude, traitee, message}`.
- Push FCM : bloc `notification` + `data` {type, titre, message, canneId, alerteId, latitude,
  longitude, zoneNom, horodatage}. SOS et entrée en zone ouvrent l'écran « alerte en cours ».
- `PUT /api/utilisateur/parametres` reçoit `{delaiInactiviteMinutes, notificationsActives, fcmToken}`.
- Les trajets sont reconstitués côté application : un écart > 10 min entre positions ouvre un trajet.
- Le domicile (itinéraire de retour) est stocké sur le téléphone ; le nom affiché est synchronisé
  avec le serveur.
