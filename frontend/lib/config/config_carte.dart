import 'dart:convert';

import 'package:http/http.dart' as http;

import 'app_config.dart';

/// Fond de carte choisi par le serveur.
///
/// Le serveur répond à `GET /api/public/config-carte` :
///   { "fournisseur": "google", "cleGoogle": "…" }  → carte Google Maps
///   { "fournisseur": "osm",    "cleGoogle": null }  → carte OpenStreetMap
///
/// La clé reste ainsi à un seul endroit (le fichier .env du serveur) : on peut la
/// changer sans recompiler l'application. Sans réponse du serveur au démarrage
/// (hors ligne), l'application utilise OpenStreetMap.
class ConfigCarte {
  ConfigCarte._();

  static bool _google = false;

  /// Vrai si la carte Google Maps doit être utilisée.
  static bool get google => _google;

  /// Page web du serveur qui affiche la carte Google (vue web intégrée).
  static String get urlPageCarte => '${AppConfig.apiBaseUrl}/carte-app/';

  static Future<void> charger() async {
    try {
      final reponse = await http
          .get(Uri.parse('${AppConfig.apiBaseUrl}/api/public/config-carte'))
          .timeout(const Duration(seconds: 4));
      if (reponse.statusCode != 200) return;
      final json = jsonDecode(reponse.body);
      _google = json is Map && json['fournisseur'] == 'google' && json['cleGoogle'] != null;
    } catch (_) {
      _google = false;
    }
  }
}
