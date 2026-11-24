import 'package:flutter/foundation.dart';

import '../models/canne.dart';
import '../services/api_client.dart';
import '../services/repository.dart';

/// Étapes du parcours d'association d'une canne.
enum EtapeAssociation {
  /// Saisie de l'identifiant et du code imprimés sur l'étiquette.
  identification,

  /// Canne vérifiée : nom et téléphone de la personne malvoyante.
  personne,

  /// Association enregistrée : confirmation puis redirection.
  terminee,
}

/// Nature d'un échec, pour afficher un message adapté.
enum ErreurAssociation {
  /// Identifiant inexistant ou code faux (le serveur ne distingue pas les deux
  /// pour ne pas révéler quelles cannes existent).
  identifiantInvalide,

  /// Canne désactivée par l'administrateur.
  canneDesactivee,

  /// Canne déjà associée à un autre compte et partage non autorisé.
  dejaAssocieeAutreCompte,

  /// Ce proche suit déjà cette canne.
  dejaSuivie,

  /// Trop d'essais : limitation de débit du serveur.
  tropDEssais,

  /// Pas de réseau ou délai dépassé.
  reseau,

  /// Erreur 5xx : serveur en panne ou indisponible.
  serveur,

  /// Saisie refusée par la validation du serveur (422).
  saisie,

  /// Tout autre cas.
  autre,
}

/// État centralisé du parcours « associer une canne » :
/// vérification (POST /api/cannes/verifier) puis association
/// (POST /api/cannes/associer). L'écran ne fait qu'afficher cet état.
class AssociationController extends ChangeNotifier {
  AssociationController(this._repo);

  final Repository _repo;

  EtapeAssociation _etape = EtapeAssociation.identification;
  bool _enCours = false;
  ErreurAssociation? _erreur;
  String? _messageErreur;
  String _identifiant = '';
  String _code = '';
  CanneVerifiee? _verifiee;
  ResultatAssociation? _resultat;

  EtapeAssociation get etape => _etape;
  bool get enCours => _enCours;
  ErreurAssociation? get erreur => _erreur;
  String? get messageErreur => _messageErreur;
  String get identifiant => _identifiant;
  CanneVerifiee? get verifiee => _verifiee;
  ResultatAssociation? get resultat => _resultat;
  Canne? get canneAssociee => _resultat?.canne;

  /// Numéro de l'étape (1 à 3) pour l'indicateur de progression.
  int get numeroEtape => _etape.index + 1;

  /// Normalise « canne 0003 » → « CANNE-0003 ».
  static String normaliserIdentifiant(String brut) {
    final s = brut.trim().toUpperCase().replaceAll(RegExp(r'\s+'), '-');
    final m = RegExp(r'^CANNE-?(\d+)$').firstMatch(s);
    return m != null ? 'CANNE-${m.group(1)!.padLeft(4, '0')}' : s;
  }

  /// Étape 1 : vérifie la canne auprès du serveur.
  Future<bool> verifier(String identifiant, String code) async {
    if (_enCours) return false;
    _identifiant = normaliserIdentifiant(identifiant);
    _code = code.trim();
    _demarrer();
    try {
      _verifiee = await _repo.verifierCanne(_identifiant, _code);
      _etape = EtapeAssociation.personne;
      return true;
    } on ApiException catch (e) {
      _echec(e);
      return false;
    } catch (_) {
      _erreur = ErreurAssociation.autre;
      _messageErreur = 'Une erreur inattendue est survenue.';
      return false;
    } finally {
      _terminer();
    }
  }

  /// Étape 2 : enregistre l'association (et, pour le premier proche,
  /// le nom et le numéro de la personne malvoyante).
  Future<bool> associer({String? nomPersonne, String? telephonePersonne}) async {
    if (_enCours || _verifiee == null) return false;
    _demarrer();
    try {
      final principal = _verifiee!.seraPrincipal;
      _resultat = await _repo.associerCanne(
        _identifiant,
        _code,
        nomPersonne: principal ? nomPersonne?.trim() : null,
        telephonePersonne: principal ? telephonePersonne?.trim() : null,
      );
      _etape = EtapeAssociation.terminee;
      return true;
    } on ApiException catch (e) {
      _echec(e);
      return false;
    } catch (_) {
      _erreur = ErreurAssociation.autre;
      _messageErreur = 'Une erreur inattendue est survenue.';
      return false;
    } finally {
      _terminer();
    }
  }

  /// Retour à la saisie de l'identifiant (autre canne, erreur de saisie).
  void recommencer() {
    _etape = EtapeAssociation.identification;
    _verifiee = null;
    _resultat = null;
    _effacerErreur();
    notifyListeners();
  }

  void effacerErreur() {
    if (_erreur == null) return;
    _effacerErreur();
    notifyListeners();
  }

  void _effacerErreur() {
    _erreur = null;
    _messageErreur = null;
  }

  void _demarrer() {
    _enCours = true;
    _effacerErreur();
    notifyListeners();
  }

  void _terminer() {
    _enCours = false;
    notifyListeners();
  }

  void _echec(ApiException e) {
    _messageErreur = e.message;
    if (e.reseau) {
      _erreur = ErreurAssociation.reseau;
      _messageErreur = 'Impossible de joindre le serveur. Vérifiez votre connexion Internet puis réessayez.';
      return;
    }
    final statut = e.statusCode ?? 0;
    if (statut >= 500) {
      _erreur = ErreurAssociation.serveur;
      _messageErreur = 'Le serveur est momentanément indisponible. Réessayez dans quelques instants.';
      return;
    }
    _erreur = switch (e.code) {
      'APPAIRAGE_INVALIDE' => ErreurAssociation.identifiantInvalide,
      'CANNE_DESACTIVEE' => ErreurAssociation.canneDesactivee,
      'CANNE_DEJA_ASSOCIEE' => ErreurAssociation.dejaAssocieeAutreCompte,
      'DEJA_SUIVIE' => ErreurAssociation.dejaSuivie,
      _ => switch (statut) {
          429 => ErreurAssociation.tropDEssais,
          422 => ErreurAssociation.saisie,
          400 => ErreurAssociation.identifiantInvalide,
          _ => ErreurAssociation.autre,
        },
    };
  }
}
