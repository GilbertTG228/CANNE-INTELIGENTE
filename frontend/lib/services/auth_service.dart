import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';

/// Stockage sécurisé du jeton JWT (Keystore Android / Keychain iOS).
class AuthService {
  AuthService(this._api);

  static const _cleJeton = 'jeton_jwt';
  final ApiClient _api;
  final FlutterSecureStorage _stockage = const FlutterSecureStorage();

  Future<String?> lireJeton() async {
    try {
      return await _stockage.read(key: _cleJeton);
    } catch (_) {
      return null; // stockage corrompu : on repart sur une connexion propre
    }
  }

  /// POST /api/auth/connexion {telephone, motDePasse} -> {jeton, utilisateur}
  /// Renvoie le nom du compte (pour l'affichage), ou null s'il est absent.
  Future<String?> connexion(String telephone, String motDePasse) async {
    final reponse = await _api.post(
      '/api/auth/connexion',
      corps: {'telephone': telephone, 'motDePasse': motDePasse},
      authentifie: false,
    );
    return _ouvrirSession(reponse);
  }

  /// POST /api/auth/inscription {nom, telephone, motDePasse} -> {jeton, utilisateur}
  Future<String?> inscription(String nom, String telephone, String motDePasse) async {
    final reponse = await _api.post(
      '/api/auth/inscription',
      corps: {'nom': nom, 'telephone': telephone, 'motDePasse': motDePasse},
      authentifie: false,
    );
    return _ouvrirSession(reponse);
  }

  Future<String?> _ouvrirSession(dynamic reponse) async {
    final jeton = reponse is Map ? reponse['jeton'] : null;
    if (jeton is! String || jeton.isEmpty) {
      throw ApiException('Réponse de connexion invalide.');
    }
    await _stockage.write(key: _cleJeton, value: jeton);
    final utilisateur = reponse['utilisateur'];
    final nom = utilisateur is Map ? utilisateur['nom'] : null;
    return nom is String ? nom : null;
  }

  /// POST /api/auth/mot-de-passe-oublie {telephone} : le serveur envoie un code par SMS.
  Future<void> motDePasseOublie(String telephone) async {
    await _api.post('/api/auth/mot-de-passe-oublie',
        corps: {'telephone': telephone}, authentifie: false);
  }

  /// POST /api/auth/reinitialiser-mot-de-passe {telephone, code, nouveauMotDePasse}
  Future<void> reinitialiserMotDePasse(
      String telephone, String code, String nouveauMotDePasse) async {
    await _api.post(
      '/api/auth/reinitialiser-mot-de-passe',
      corps: {
        'telephone': telephone,
        'code': code,
        'nouveauMotDePasse': nouveauMotDePasse,
      },
      authentifie: false,
    );
  }

  Future<void> supprimerJeton() async {
    try {
      await _stockage.delete(key: _cleJeton);
    } catch (_) {}
  }
}
