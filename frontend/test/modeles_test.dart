// Tests unitaires des modèles : vérifient que l'application lit correctement
// les réponses JSON du serveur (exemples copiés depuis l'API réelle).
//
// Lancer : flutter test

import 'package:flutter_test/flutter_test.dart';

import 'package:canne_proche/controllers/association_controller.dart';
import 'package:canne_proche/models/alerte.dart';
import 'package:canne_proche/models/canne.dart';
import 'package:canne_proche/models/lien_partage.dart';
import 'package:canne_proche/models/position_canne.dart';
import 'package:canne_proche/models/zone.dart';
import 'package:canne_proche/services/repository.dart';
import 'package:canne_proche/utils/geo.dart';
import 'package:canne_proche/utils/json.dart';
import 'package:canne_proche/widgets/composants.dart';

void main() {
  group('Canne', () {
    test('lit la réponse de GET /api/cannes', () {
      final canne = Canne.fromJson({
        'id': 'cn_demo_ama',
        'identifiant': 'CANNE-0001',
        'nom': 'Ama Mensah',
        'enLigne': true,
        'batterie': 76,
        'dernierePosition': {
          'latitude': 6.145,
          'longitude': 1.219,
          'precision': 13,
          'batterie': 76,
          'horodatage': '2026-11-06T09:55:52.915Z',
        },
        'telephonePersonne': '+22890112233',
        'consentement': true,
        'principal': true,
      });
      expect(canne.id, 'cn_demo_ama');
      expect(canne.nomCourt, 'Ama');
      expect(canne.enLigne, isTrue);
      expect(canne.batterie, 76);
      expect(canne.dernierePosition!.latitude, closeTo(6.145, 1e-9));
      expect(canne.telephonePersonne, '+22890112233');
      expect(canne.consentement, isTrue);
    });

    test('la liste peut être enveloppée dans {cannes: [...]}', () {
      final liste = versListe({
        'cannes': [
          {'id': 'a'},
          {'id': 'b'},
        ],
      }, ['cannes']);
      expect(liste, hasLength(2));
    });
  });

  group('Zone', () {
    test('lit une zone et produit le corps attendu par POST/PUT', () {
      final zone = Zone.essayer({
        'id': 'zn_1',
        'cannesId': 'cn_demo_ama',
        'nom': 'Carrefour Déckon',
        'latitude': 6.1318,
        'longitude': 1.2232,
        'rayon': 120,
        'actif': true,
      })!;
      expect(zone.rayon, 120);
      expect(zone.actif, isTrue);
      expect(zone.toApi(), {
        'nom': 'Carrefour Déckon',
        'latitude': 6.1318,
        'longitude': 1.2232,
        'rayon': 120,
        'actif': true,
      });
    });

    test('ignore une zone sans coordonnées', () {
      expect(Zone.essayer({'id': 'x', 'nom': 'Sans centre'}), isNull);
    });
  });

  group('Alerte', () {
    test('lit une entrée en zone', () {
      final a = Alerte.fromJson({
        'id': 'al_1',
        'cannesId': 'cn_demo_ama',
        'type': 'entree_zone',
        'message': 'La canne est entrée dans la zone « Carrefour Déckon ».',
        'zoneNom': 'Carrefour Déckon',
        'latitude': 6.1318,
        'longitude': 1.2232,
        'horodatage': '2026-11-03T04:56:52.915Z',
        'traitee': false,
      });
      expect(a.type, TypeAlerte.entreeZone);
      expect(a.urgente, isTrue);
      expect(a.critique, isFalse);
      expect(a.canneId, 'cn_demo_ama');
      expect(a.position, isNotNull);
    });

    test('lit la charge utile d\'une notification push (valeurs en chaînes)', () {
      final a = Alerte.fromJson({
        'type': 'sos',
        'alerteId': 'al_2',
        'canneId': 'cn_demo_ama',
        'latitude': '6.1449',
        'longitude': '1.2191',
        'horodatage': '2026-11-06T09:00:00.000Z',
      });
      expect(a.id, 'al_2');
      expect(a.type, TypeAlerte.sos);
      expect(a.critique, isTrue);
      expect(a.latitude, closeTo(6.1449, 1e-9));
    });

    test('tous les types du serveur sont reconnus', () {
      for (final code in ['sos', 'entree_zone', 'chute', 'batterie_faible', 'canne_inactive']) {
        expect(typeAlerteDepuis(code), isNot(TypeAlerte.inconnu), reason: code);
      }
    });
  });

  group('Lien de partage', () {
    test('lit la réponse de POST /api/liens-partage', () {
      final l = LienPartage.fromJson({
        'id': 'lp_1',
        'lien': 'http://localhost:3000/suivi/abc',
        'cannesId': 'cn_demo_ama',
        'expireLe': DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String(),
      });
      expect(l.lien, endsWith('/suivi/abc'));
      expect(l.expire, isFalse);
    });
  });

  group('Historique', () {
    PositionCanne p(int minute, double lat) => PositionCanne(
          latitude: lat,
          longitude: 1.22,
          horodatage: DateTime(2026, 11, 6, 9, minute),
        );

    test('un écart de plus de 10 min ouvre un nouveau trajet', () {
      final trajets = decouperEnTrajets([
        p(0, 6.1300),
        p(1, 6.1310),
        p(2, 6.1320),
        p(30, 6.1400),
        p(31, 6.1410),
      ]);
      expect(trajets, hasLength(2));
      expect(trajets.first.distanceM, greaterThan(200));
    });

    test('un trajet trop court (bruit GPS) est ignoré', () {
      expect(decouperEnTrajets([p(0, 6.13000), p(1, 6.13001)]), isEmpty);
    });
  });

  group('Conversions JSON tolérantes', () {
    test('nombres, booléens et dates', () {
      expect(versDouble('6,5'), 6.5);
      expect(versBool('t'), isTrue);
      expect(versBool(0), isFalse);
      expect(versDate(1700000000)!.year, 2023);
      expect(versDate('2026-11-06T09:00:00Z'), isNotNull);
    });
  });

  group('Association de canne', () {
    test('normalise l\'identifiant saisi', () {
      expect(AssociationController.normaliserIdentifiant(' canne 3 '), 'CANNE-0003');
      expect(AssociationController.normaliserIdentifiant('canne-0012'), 'CANNE-0012');
      expect(AssociationController.normaliserIdentifiant('ab-77'), 'AB-77');
    });

    test('lit la réponse de POST /api/cannes/verifier', () {
      final v = CanneVerifiee.fromJson({
        'identifiant': 'CANNE-0003',
        'nom': 'Nouvelle canne',
        'telephonePersonne': null,
        'nombreProches': 0,
        'seraPrincipal': true,
      });
      expect(v.identifiant, 'CANNE-0003');
      expect(v.seraPrincipal, isTrue);
      expect(v.nomAPreciser, isTrue);
      expect(v.telephonePersonne, isNull);
    });

    test('état actif et partage de la canne', () {
      final defaut = Canne.fromJson({'id': 'c1', 'nom': 'Ama'});
      expect(defaut.active, isTrue);
      expect(defaut.partageAutorise, isFalse);
      final desactivee = Canne.fromJson({'id': 'c2', 'nom': 'Yao', 'active': false, 'partageAutorise': true});
      expect(desactivee.active, isFalse);
      expect(desactivee.partageAutorise, isTrue);
    });

    test('appareil de test et dernier contact', () {
      final tel = Canne.fromJson({
        'id': 'c3',
        'nom': 'Test terrain',
        'typeDispositif': 'telephone',
        'derniereCommunication': '2026-11-10T00:53:50.880Z',
      });
      expect(tel.appareilDeTest, isTrue);
      expect(tel.libelleAppareil, 'Téléphone de test');
      expect(tel.derniereCommunication, isNotNull);
      expect(Canne.fromJson({'id': 'c4', 'nom': 'Vraie'}).appareilDeTest, isFalse);
    });

    test('initiales affichées dans les avatars', () {
      expect(initialesDe('Ama Mensah (démo)'), 'AM');
      expect(initialesDe('yao'), 'Y');
      expect(initialesDe('Élodie de la Tour'), 'ÉT');
    });
  });
}
