import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/app_config.dart';
import '../config/theme.dart';
import '../controllers/alertes_controller.dart';
import '../controllers/navigation_controller.dart';
import '../controllers/settings_controller.dart';
import '../controllers/suivi_controller.dart';
import '../models/alerte.dart';
import '../services/notification_service.dart';
import '../services/repository.dart';
import '../widgets/bandeau_hors_ligne.dart';
import '../widgets/etat_vide.dart';
import 'accueil_screen.dart';
import 'alerte_en_cours_screen.dart';
import 'alertes_screen.dart';
import 'association_canne_screen.dart';
import 'consentement_screen.dart';
import 'historique_screen.dart';
import 'zones_screen.dart';

/// Structure principale une fois connecté : en-tête, bandeau hors ligne,
/// quatre onglets et barre de navigation. Gère l'actualisation périodique,
/// la pause en arrière-plan et les notifications.
class AccueilShell extends StatefulWidget {
  const AccueilShell({super.key, required this.navigatorKey});

  final GlobalKey<NavigatorState> navigatorKey;

  @override
  State<AccueilShell> createState() => _AccueilShellState();
}

class _AccueilShellState extends State<AccueilShell> with WidgetsBindingObserver {
  Timer? _minuteur;
  int _tic = 0;
  late final NotificationService _notifications;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _notifications = context.read<NotificationService>();
    _notifications
      ..surOuverture = _surOuvertureNotification
      ..surMessageAuPremierPlan = _surMessage
      ..surJeton = _enregistrerJeton;
    _notifications.demarrer();
    context.read<SuiviController>().rafraichir();
    _demarrerMinuteur();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _minuteur?.cancel();
    _notifications
      ..surOuverture = null
      ..surMessageAuPremierPlan = null
      ..surJeton = null;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState etat) {
    if (etat == AppLifecycleState.resumed) {
      context.read<SuiviController>().rafraichir();
      context.read<AlertesController>().recharger();
      _demarrerMinuteur();
    } else if (etat == AppLifecycleState.paused) {
      _minuteur?.cancel();
      _minuteur = null;
    }
  }

  void _demarrerMinuteur() {
    _minuteur?.cancel();
    _minuteur = Timer.periodic(AppConfig.intervalleRafraichissement, (_) {
      if (!mounted) return;
      _tic++;
      context.read<SuiviController>().rafraichir();
      if (_tic % AppConfig.rafraichissementsParRechargementAlertes == 0) {
        context.read<AlertesController>().recharger();
      }
    });
  }

  // --- Notifications ----------------------------------------------------------------

  Future<void> _enregistrerJeton(String jeton) async {
    final reglages = context.read<SettingsController>();
    final repo = context.read<Repository>();
    try {
      await repo.enregistrerParametres(
        delaiInactiviteMinutes: reglages.delaiInactiviteMin,
        notificationsActives: reglages.notificationsActives,
        jetonPush: jeton,
      );
    } catch (_) {
      // Sera retenté au prochain démarrage ou renouvellement du jeton.
    }
  }

  /// Message reçu application ouverte : on actualise et, pour un SOS ou une
  /// entrée en zone, on affiche l'écran d'alerte.
  void _surMessage(Map<String, dynamic> data) {
    context.read<AlertesController>().recharger();
    context.read<SuiviController>().rafraichir();
    final alerte = Alerte.fromJson(data);
    if (alerte.urgente) _ouvrirAlerte(alerte);
  }

  /// Notification touchée (appli ouverte, en arrière-plan ou fermée).
  void _surOuvertureNotification(Map<String, dynamic> data) {
    final alerte = Alerte.fromJson(data);
    if (alerte.urgente) {
      _ouvrirAlerte(alerte);
    } else {
      context.read<NavigationController>().aller(3);
    }
  }

  void _ouvrirAlerte(Alerte alerte) {
    final navigateur = widget.navigatorKey.currentState;
    if (navigateur == null) return;
    // Sélectionne la canne concernée si le proche en suit plusieurs.
    final suivi = context.read<SuiviController>();
    final id = alerte.canneId;
    if (id != null && id != suivi.canneId && suivi.cannes.any((c) => c.id == id)) {
      suivi.selectionner(id);
    }
    navigateur.push(
      MaterialPageRoute<void>(builder: (_) => AlerteEnCoursScreen(alerte: alerte)),
    );
  }

  // --- Affichage --------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final nav = context.watch<NavigationController>();
    final reglages = context.watch<SettingsController>();
    final nonTraitees = context.watch<AlertesController>().nonTraitees;

    if (suivi.chargementInitial) return const _EcranChargement();

    if (suivi.cannes.isEmpty) {
      // Erreur de chargement : on ne peut pas savoir si le compte a des cannes.
      if (suivi.erreur != null) {
        return Scaffold(
          body: SafeArea(
            child: EtatVide(
              icone: Icons.cloud_off_rounded,
              titre: 'Chargement impossible',
              message: suivi.erreur,
              libelleBouton: 'Réessayer',
              surBouton: suivi.rafraichir,
            ),
          ),
        );
      }
      // Premier usage : le compte ne suit encore aucune canne.
      return const AssociationCanneScreen(key: ValueKey('association_initiale'), integre: true);
    }

    final canne = suivi.canne!;
    if (!reglages.aConsenti(canne.id) && !canne.consentement) {
      return ConsentementScreen(key: ValueKey('consentement_${canne.id}'), canne: canne);
    }

    const onglets = <Widget>[
      AccueilScreen(),
      ZonesScreen(),
      HistoriqueScreen(),
      AlertesScreen(),
    ];

    final horsLigne = suivi.reseauIndisponible;
    return Scaffold(
      body: Column(
        children: [
          if (horsLigne) const SafeArea(bottom: false, child: BandeauHorsLigne()),
          Expanded(
            child: MediaQuery.removePadding(
              context: context,
              removeTop: horsLigne,
              // StackFit.expand : chaque onglet reçoit toute la hauteur disponible.
              // Sans cela, une page construite en pile (Zones) se réduisait à la
              // hauteur de son en-tête : carte coupée et liste invisible.
              child: IndexedStack(index: nav.onglet, sizing: StackFit.expand, children: onglets),
            ),
          ),
        ],
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: context.statut.bordure))),
        child: NavigationBar(
          selectedIndex: nav.onglet,
          onDestinationSelected: (i) => nav.aller(i),
          destinations: [
            const NavigationDestination(
              icon: Icon(Icons.map_outlined),
              selectedIcon: Icon(Icons.map_rounded),
              label: 'Carte',
            ),
            const NavigationDestination(
              icon: Icon(Icons.shield_outlined),
              selectedIcon: Icon(Icons.shield_rounded),
              label: 'Zones',
            ),
            const NavigationDestination(
              icon: Icon(Icons.schedule_outlined),
              selectedIcon: Icon(Icons.schedule_rounded),
              label: 'Historique',
            ),
            NavigationDestination(
              icon: Badge(
                isLabelVisible: nonTraitees > 0,
                backgroundColor: context.statut.critique,
                label: Text('$nonTraitees'),
                child: const Icon(Icons.notifications_outlined),
              ),
              selectedIcon: Badge(
                isLabelVisible: nonTraitees > 0,
                backgroundColor: context.statut.critique,
                label: Text('$nonTraitees'),
                child: const Icon(Icons.notifications_rounded),
              ),
              label: 'Alertes',
              tooltip: nonTraitees > 0 ? 'Alertes, $nonTraitees à traiter' : 'Alertes',
            ),
          ],
        ),
      ),
    );
  }
}

/// Écran d'attente aux couleurs de l'application pendant le premier chargement.
class _EcranChargement extends StatelessWidget {
  const _EcranChargement();

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Scaffold(
      backgroundColor: c.surfaceContainerLowest,
      body: Center(
        child: Semantics(
          label: 'Chargement de vos données',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: c.primary, borderRadius: BorderRadius.circular(20)),
                child: Text('CP',
                    style: context.textes.titleLarge?.copyWith(color: c.onPrimary, fontWeight: FontWeight.w800)),
              ),
              const SizedBox(height: 24),
              const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3)),
            ],
          ),
        ),
      ),
    );
  }
}
