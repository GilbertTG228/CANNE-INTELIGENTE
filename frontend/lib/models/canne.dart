import '../utils/json.dart';
import 'position_canne.dart';

/// Une canne suivie par le proche.
class Canne {
  const Canne({
    required this.id,
    required this.identifiant,
    required this.nom,
    required this.enLigne,
    this.batterie,
    this.dernierePosition,
    this.telephonePersonne,
    this.consentement = false,
    this.active = true,
    this.partageAutorise = false,
    this.principal = false,
    this.derniereCommunication,
    this.typeDispositif = 'canne',
  });

  final String id;
  final String identifiant;
  final String nom;
  final bool enLigne;
  final int? batterie;
  final PositionCanne? dernierePosition;

  /// Numéro de la personne qui utilise la canne (pour le bouton « Appeler »).
  /// Hypothèse : fourni par l'API sous `telephonePersonne`.
  final String? telephonePersonne;

  /// Le consentement de suivi a déjà été enregistré pour ce proche.
  final bool consentement;

  /// false : canne désactivée par l'administrateur (perdue, hors service).
  final bool active;

  /// Plusieurs proches peuvent s'associer à cette canne avec son code.
  final bool partageAutorise;

  /// Ce proche est le proche principal (il peut renommer la canne et gérer le partage).
  final bool principal;

  /// Dernier contact de l'appareil (position ou simple signe de vie).
  final DateTime? derniereCommunication;

  /// Appareil qui émet : « canne », ou un substitut de test (« telephone »,
  /// « traccar », « simulateur ») en attendant la canne physique.
  final String typeDispositif;

  /// Les données viennent d'un appareil de test et non de la vraie canne.
  bool get appareilDeTest => typeDispositif != 'canne';

  String get libelleAppareil => switch (typeDispositif) {
        'telephone' => 'Téléphone de test',
        'traccar' => 'Traccar Client (test)',
        'simulateur' => 'Simulateur',
        _ => 'Canne',
      };

  /// Prénom ou nom court pour les phrases (« La canne de Michel… »).
  String get nomCourt => nom.split(RegExp(r'[\s\-–]+')).firstWhere(
        (m) => m.isNotEmpty,
        orElse: () => nom,
      );

  factory Canne.fromJson(Map<String, dynamic> json) {
    final position = PositionCanne.essayer(json['dernierePosition']);
    final id = json['id'].toString();
    return Canne(
      id: id,
      identifiant: (json['identifiant'] ?? id).toString(),
      nom: (json['nom'] ?? json['identifiant'] ?? 'Canne $id').toString(),
      enLigne: versBool(json['enLigne']),
      batterie: versInt(json['batterie']) ?? position?.batterie,
      dernierePosition: position,
      telephonePersonne: json['telephonePersonne']?.toString(),
      consentement: versBool(json['consentement']),
      active: json.containsKey('active') ? versBool(json['active']) : true,
      partageAutorise: versBool(json['partageAutorise']),
      principal: versBool(json['principal']),
      derniereCommunication: versDate(json['derniereCommunication']),
      typeDispositif: (json['typeDispositif'] ?? 'canne').toString(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'identifiant': identifiant,
        'nom': nom,
        'enLigne': enLigne,
        'batterie': batterie,
        'dernierePosition': dernierePosition?.toJson(),
        'telephonePersonne': telephonePersonne,
        'consentement': consentement,
        'active': active,
        'partageAutorise': partageAutorise,
        'principal': principal,
        'derniereCommunication': derniereCommunication?.toUtc().toIso8601String(),
        'typeDispositif': typeDispositif,
      };
}
