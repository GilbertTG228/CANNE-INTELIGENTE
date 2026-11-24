import 'package:flutter/foundation.dart';

import '../services/auth_service.dart';
import '../services/cache_service.dart';
import 'settings_controller.dart';

/// État de connexion du proche.
class AuthController extends ChangeNotifier {
  AuthController(this._auth, this._cache, this._reglages);

  final AuthService _auth;
  final CacheService _cache;
  final SettingsController _reglages;

  bool _connecte = false;
  String? _messageSession;

  /// Appelé à chaque déconnexion (volontaire ou 401) pour que les autres
  /// contrôleurs oublient les données de la session.
  VoidCallback? surDeconnexion;

  bool get connecte => _connecte;

  /// Message affiché sur l'écran de connexion après une session expirée.
  String? get messageSession => _messageSession;

  Future<void> initialiser() async {
    _connecte = (await _auth.lireJeton()) != null;
  }

  Future<void> connexion(String telephone, String motDePasse) async {
    final nom = await _auth.connexion(telephone, motDePasse);
    await _ouvrir(telephone, nom);
  }

  /// Création de compte : le serveur renvoie directement une session.
  Future<void> inscription(String nom, String telephone, String motDePasse) async {
    final nomServeur = await _auth.inscription(nom, telephone, motDePasse);
    await _ouvrir(telephone, nomServeur ?? nom);
  }

  Future<void> _ouvrir(String telephone, String? nom) async {
    await _reglages.definirTelephone(telephone);
    if (nom != null && nom.isNotEmpty) await _reglages.definirNomAffiche(nom);
    _messageSession = null;
    _connecte = true;
    notifyListeners();
  }

  /// Réponse 401 du serveur sur une requête authentifiée.
  Future<void> sessionExpiree() async {
    if (!_connecte) return;
    await _deconnecter('Votre session a expiré. Veuillez vous reconnecter.');
  }

  Future<void> deconnexion() => _deconnecter(null);

  Future<void> _deconnecter(String? message) async {
    await _auth.supprimerJeton();
    await _cache.vider();
    await _reglages.reinitialiserCompte();
    _messageSession = message;
    _connecte = false;
    surDeconnexion?.call();
    notifyListeners();
  }
}
