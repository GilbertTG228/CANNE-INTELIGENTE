import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../controllers/alertes_controller.dart';
import '../controllers/navigation_controller.dart';
import '../controllers/suivi_controller.dart';
import '../models/alerte.dart';
import '../services/api_client.dart';
import '../utils/format.dart';
import '../widgets/alerte_visuel.dart';
import '../widgets/composants.dart';
import '../widgets/etat_vide.dart';
import 'alerte_en_cours_screen.dart';

enum _Filtre { aTraiter, toutes, urgentes }

/// Onglet « Alertes » : centre de notifications regroupé par jour, avec
/// filtres et actions rapides (ouvrir, voir sur la carte, prendre en charge).
class AlertesScreen extends StatefulWidget {
  const AlertesScreen({super.key});

  @override
  State<AlertesScreen> createState() => _AlertesScreenState();
}

class _AlertesScreenState extends State<AlertesScreen> {
  _Filtre _filtre = _Filtre.aTraiter;

  Future<void> _traiter(Alerte a) async {
    final controleur = context.read<AlertesController>();
    final messager = ScaffoldMessenger.of(context);
    try {
      await controleur.marquerTraitee(a.id);
      messager.showSnackBar(const SnackBar(content: Text('Alerte prise en charge. Les autres proches sont informés.')));
    } on ApiException catch (e) {
      messager.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  void _ouvrir(Alerte a) => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => AlerteEnCoursScreen(alerte: a)),
      );

  void _voirSurCarte(Alerte a) => context.read<NavigationController>().aller(0, focus: a.position);

  String _titreJour(DateTime t) {
    final maintenant = DateTime.now();
    if (memeJour(t, maintenant)) return 'Aujourd\'hui';
    if (memeJour(t, maintenant.subtract(const Duration(days: 1)))) return 'Hier';
    return dateLongue(t);
  }

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final alertes = context.watch<AlertesController>();
    final canneId = suivi.canneId;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<AlertesController>().synchroniser(canneId);
    });

    final liste = alertes.alertes.where((a) {
      switch (_filtre) {
        case _Filtre.aTraiter:
          return !a.traitee;
        case _Filtre.urgentes:
          return a.critique;
        case _Filtre.toutes:
          return true;
      }
    }).toList();
    final nonTraitees = alertes.nonTraitees;
    final s = context.statut;

    Widget corps;
    if (alertes.chargement && alertes.alertes.isEmpty) {
      corps = const Center(child: CircularProgressIndicator());
    } else if (alertes.erreur != null && alertes.alertes.isEmpty) {
      corps = EtatVide(
        icone: Icons.cloud_off_rounded,
        titre: 'Alertes indisponibles',
        message: alertes.erreur,
        libelleBouton: 'Réessayer',
        surBouton: alertes.recharger,
      );
    } else if (liste.isEmpty) {
      corps = EtatVide(
        icone: Icons.notifications_none_rounded,
        titre: _filtre == _Filtre.aTraiter ? 'Aucune alerte à traiter' : 'Aucune alerte',
        message: 'Tout est calme. Les nouvelles alertes apparaîtront ici.',
      );
    } else {
      final elements = <Widget>[];
      DateTime? jourCourant;
      for (final a in liste) {
        if (jourCourant == null || !memeJour(jourCourant, a.horodatage)) {
          jourCourant = a.horodatage;
          elements.add(Padding(
            padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
            child: Semantics(
              header: true,
              child: Text(
                _titreJour(a.horodatage).toUpperCase(),
                style: context.textes.labelMedium?.copyWith(
                  color: context.couleurs.onSurfaceVariant,
                  letterSpacing: 0.8,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ));
        }
        elements.add(Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: _CarteAlerte(
            alerte: a,
            nomPersonne: suivi.canne?.nomCourt ?? '',
            surOuvrir: () => _ouvrir(a),
            surTraiter: () => _traiter(a),
            surCarte: a.position == null ? null : () => _voirSurCarte(a),
          ),
        ));
      }
      corps = ListView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        physics: const AlwaysScrollableScrollPhysics(),
        children: elements,
      );
    }

    return Column(
      children: [
        EnteteGrandTitre(
          titre: 'Alertes',
          action: nonTraitees > 0
              ? Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: s.critiqueFond, borderRadius: BorderRadius.circular(999)),
                  child: Text('$nonTraitees à traiter',
                      style: context.textes.labelMedium?.copyWith(color: s.critiqueTexte, fontWeight: FontWeight.w800)),
                )
              : null,
          bas: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final (f, libelle) in const [
                  (_Filtre.aTraiter, 'À traiter'),
                  (_Filtre.toutes, 'Toutes'),
                  (_Filtre.urgentes, 'SOS et chutes'),
                ]) ...[
                  ChoiceChip(
                    label: Text(libelle),
                    selected: _filtre == f,
                    showCheckmark: false,
                    labelStyle: context.textes.labelLarge?.copyWith(
                      color: _filtre == f ? context.couleurs.surface : context.couleurs.onSurface,
                    ),
                    onSelected: (_) => setState(() => _filtre = f),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
        ),
        if (alertes.depuisCache)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Journal enregistré sur ce téléphone (hors ligne).',
                  style: context.textes.bodySmall?.copyWith(color: s.avertTexte)),
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => context.read<AlertesController>().recharger(),
            child: corps is ListView
                ? corps
                : LayoutBuilder(
                    // Permet le « tirer pour actualiser » même sur un état vide.
                    builder: (context, contraintes) => SingleChildScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      child: SizedBox(height: contraintes.maxHeight, child: corps),
                    ),
                  ),
          ),
        ),
      ],
    );
  }
}

class _CarteAlerte extends StatelessWidget {
  const _CarteAlerte({
    required this.alerte,
    required this.nomPersonne,
    required this.surOuvrir,
    required this.surTraiter,
    required this.surCarte,
  });

  final Alerte alerte;
  final String nomPersonne;
  final VoidCallback surOuvrir;
  final VoidCallback surTraiter;
  final VoidCallback? surCarte;

  /// Titres courts des maquettes : « SOS déclenché », « Batterie faible · 15 % »…
  String get _titre {
    final m = alerte.message ?? '';
    String? extrait(RegExp re) => re.firstMatch(m)?.group(0);
    switch (alerte.type) {
      case TypeAlerte.sos:
        return 'SOS déclenché';
      case TypeAlerte.chute:
        return 'Chute détectée';
      case TypeAlerte.entreeZone:
        return 'Entrée en zone';
      case TypeAlerte.batterieFaible:
        final pct = extrait(RegExp(r'\d+\s?%'));
        return pct == null ? 'Batterie faible' : 'Batterie faible · ${pct.replaceAll(' ', '').replaceAll('%', ' %')}';
      case TypeAlerte.canneInactive:
        final duree = extrait(RegExp(r'\d+\s?(min|h)'));
        return duree == null ? 'Canne inactive' : 'Canne inactive · $duree';
      case TypeAlerte.inconnu:
        return titreAlerte(alerte);
    }
  }

  String get _description {
    switch (alerte.type) {
      case TypeAlerte.sos:
        return '$nomPersonne a appuyé sur le bouton d\'urgence de sa canne.';
      case TypeAlerte.chute:
        return 'La canne de $nomPersonne a détecté une chute.';
      case TypeAlerte.entreeZone:
        return alerte.zoneNom != null
            ? '$nomPersonne est entré·e dans « ${alerte.zoneNom} ».'
            : '$nomPersonne est entré·e dans une zone à éviter.';
      case TypeAlerte.batterieFaible:
        return alerte.message ?? 'La batterie de la canne est presque vide.';
      case TypeAlerte.canneInactive:
        return alerte.message ?? 'La canne n\'envoie plus de position.';
      case TypeAlerte.inconnu:
        return alerte.message ?? '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    final s = context.statut;
    final a = alerte;
    final aTraiter = !a.traitee;
    final bordure = aTraiter ? couleurAlerte(context, a) : s.bordure;
    final titre = _titre;

    return Semantics(
      container: true,
      label: '$titre, ${heure(a.horodatage)}, ${aTraiter ? 'à traiter' : 'traitée'}',
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: c.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: bordure, width: aTraiter ? 2 : 1),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: aTraiter && a.critique ? s.critique : (aTraiter ? fondAlerte(context, a) : c.surfaceContainer),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                iconeAlerte(a.type),
                color: aTraiter && a.critique
                    ? Colors.white
                    : (aTraiter ? couleurAlerte(context, a) : c.onSurfaceVariant),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: Text(titre, style: context.textes.titleSmall)),
                      const SizedBox(width: 8),
                      Text(heure(a.horodatage),
                          style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant)),
                    ],
                  ),
                  if (!aTraiter) ...[
                    const SizedBox(height: 2),
                    Text(
                      a.traiteePar != null ? 'Traitée par ${a.traiteePar}' : 'Traitée',
                      style: context.textes.labelMedium?.copyWith(color: s.nominalTexte, fontWeight: FontWeight.w700),
                    ),
                  ] else ...[
                    const SizedBox(height: 2),
                    Text(_description, style: context.textes.bodyMedium?.copyWith(color: c.onSurfaceVariant)),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (a.critique)
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: a.critique ? s.critique : c.primary,
                              minimumSize: const Size(0, 44),
                            ),
                            onPressed: surOuvrir,
                            child: const Text('Ouvrir l\'alerte'),
                          )
                        else
                          OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
                            onPressed: surTraiter,
                            icon: const Icon(Icons.check_rounded, size: 20),
                            label: const Text('Pris en charge'),
                          ),
                        if (surCarte != null && a.critique)
                          OutlinedButton(
                            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
                            onPressed: surCarte,
                            child: const Text('Voir sur la carte'),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
