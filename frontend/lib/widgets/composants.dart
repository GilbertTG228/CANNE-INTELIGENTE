import 'package:flutter/material.dart';

import '../config/theme.dart';
import 'carte_base.dart';
import '../utils/format.dart';

/// Composants visuels réutilisables du système de design « Canne Proche ».
/// Chaque composant porte ses propres libellés pour les lecteurs d'écran.

/// « Ama Mensah (démo) » → « AM ».
String initialesDe(String nom) {
  final mots = nom
      .replaceAll(RegExp(r'\(.*?\)'), '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((m) => m.isNotEmpty)
      .toList();
  if (mots.isEmpty) return '?';
  String premiereLettre(String mot) => String.fromCharCode(mot.runes.first);
  final premiere = premiereLettre(mots.first);
  final derniere = mots.length > 1 ? premiereLettre(mots.last) : '';
  return (premiere + derniere).toUpperCase();
}

/// Pastille ronde avec les initiales de la personne. Grise si la position
/// n'est plus actualisée (jamais présentée comme « en direct »).
class AvatarInitiales extends StatelessWidget {
  const AvatarInitiales({
    super.key,
    required this.nom,
    this.taille = 48,
    this.actif = true,
    this.bordure = false,
  });

  final String nom;
  final double taille;
  final bool actif;
  final bool bordure;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Container(
        width: taille,
        height: taille,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: actif ? context.couleurs.primary : Marque.gris,
          shape: BoxShape.circle,
          border: bordure ? Border.all(color: Colors.white, width: taille > 40 ? 4 : 3) : null,
        ),
        child: Text(
          initialesDe(nom),
          style: context.textes.titleSmall?.copyWith(
            fontSize: taille * 0.34,
            fontWeight: FontWeight.w800,
            color: actif ? context.couleurs.onPrimary : Colors.white,
          ),
        ),
      ),
    );
  }
}

/// Indique si la position affichée est en direct ou seulement la dernière
/// position connue (règle : une position ancienne n'est jamais « en direct »).
class PuceFraicheur extends StatelessWidget {
  const PuceFraicheur({super.key, required this.horodatage, required this.enDirect, this.flottante = true});

  final DateTime? horodatage;
  final bool enDirect;

  /// Fond blanc et ombre pour être posée sur la carte.
  final bool flottante;

  @override
  Widget build(BuildContext context) {
    final s = context.statut;
    final h = horodatage;
    final texte = h == null
        ? 'Aucune position reçue'
        : enDirect
            ? 'En direct · mis à jour ${ilYa(h)}'
            : 'Dernière position connue · ${ilYa(h)}';
    final couleur = h == null ? context.couleurs.onSurfaceVariant : (enDirect ? s.nominalTexte : s.avertTexte);
    final point = h == null ? context.couleurs.outline : (enDirect ? s.nominal : s.avert);
    return Semantics(
      liveRegion: true,
      label: texte,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: flottante ? context.couleurs.surfaceContainerLowest : (enDirect ? s.nominalFond : s.avertFond),
          borderRadius: BorderRadius.circular(999),
          boxShadow: flottante ? Marque.ombreFlottante : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 8, height: 8, decoration: BoxDecoration(color: point, shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                texte,
                overflow: TextOverflow.ellipsis,
                style: context.textes.labelMedium?.copyWith(color: couleur, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Petite tuile « libellé / valeur » (batterie, précision, distance…).
class TuileStat extends StatelessWidget {
  const TuileStat({super.key, required this.libelle, required this.valeur, this.couleurValeur, this.fond});

  final String libelle;
  final String valeur;
  final Color? couleurValeur;

  /// Fond de la tuile : gris clair par défaut, blanc sur une page grise.
  final Color? fond;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$libelle : $valeur',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: fond ?? context.statut.surfaceDouce,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(libelle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.textes.bodySmall?.copyWith(color: context.couleurs.onSurfaceVariant)),
            const SizedBox(height: 2),
            Text(
              valeur,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.textes.titleMedium?.copyWith(
                color: couleurValeur,
                fontWeight: FontWeight.w800,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Rangée de tuiles de même largeur.
class RangeeTuiles extends StatelessWidget {
  const RangeeTuiles({super.key, required this.tuiles});
  final List<Widget> tuiles;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 0; i < tuiles.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: tuiles[i]),
        ],
      ],
    );
  }
}

/// Action rapide : pastille d'icône arrondie et libellé dessous.
class BoutonActionRond extends StatelessWidget {
  const BoutonActionRond({
    super.key,
    required this.icone,
    required this.libelle,
    required this.surAppui,
    this.critique = false,
    this.enCours = false,
  });

  final IconData icone;
  final String libelle;
  final VoidCallback? surAppui;
  final bool critique;
  final bool enCours;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    final s = context.statut;
    final fond = critique ? s.critiqueFond : c.primaryContainer;
    final premier = critique ? s.critique : c.primary;
    return Semantics(
      button: true,
      enabled: surAppui != null,
      label: libelle,
      excludeSemantics: true,
      child: InkWell(
        onTap: surAppui,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedOpacity(
                duration: const Duration(milliseconds: 150),
                opacity: surAppui == null ? 0.45 : 1,
                child: Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(18)),
                  child: enCours
                      ? Padding(
                          padding: const EdgeInsets.all(16),
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: premier),
                        )
                      : Icon(icone, color: premier, size: 26),
                ),
              ),
              const SizedBox(height: 6),
              Text(libelle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.textes.labelMedium?.copyWith(color: c.onSurface, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Bouton rond blanc posé sur la carte (recentrer, alertes…).
class BoutonFlottant extends StatelessWidget {
  const BoutonFlottant({
    super.key,
    required this.icone,
    required this.libelle,
    required this.surAppui,
    this.couleurIcone,
    this.badge,
    this.taille = 52,
  });

  final IconData icone;
  final String libelle;
  final VoidCallback? surAppui;
  final Color? couleurIcone;
  final int? badge;
  final double taille;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    return Semantics(
      button: true,
      label: libelle,
      excludeSemantics: true,
      child: Tooltip(
        message: libelle,
        child: Material(
          color: c.surfaceContainerLowest,
          shape: const CircleBorder(),
          elevation: 0,
          child: Ink(
            decoration: const BoxDecoration(shape: BoxShape.circle, boxShadow: Marque.ombreFlottante),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: surAppui,
              child: SizedBox(
                width: taille,
                height: taille,
                child: Badge(
                  isLabelVisible: (badge ?? 0) > 0,
                  backgroundColor: context.statut.critique,
                  label: Text('${badge ?? 0}'),
                  offset: const Offset(-2, 4),
                  alignment: AlignmentDirectional.topEnd,
                  child: Center(child: Icon(icone, color: couleurIcone ?? c.onSurface)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// En-tête blanc à grand titre (Historique, Zones, Alertes…).
class EnteteGrandTitre extends StatelessWidget {
  const EnteteGrandTitre({super.key, required this.titre, this.sousTitre, this.action, this.bas});

  final String titre;
  final String? sousTitre;
  final Widget? action;
  final Widget? bas;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: context.couleurs.surfaceContainerLowest,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Semantics(
                      header: true,
                      child: Text(titre, style: context.textes.headlineLarge),
                    ),
                  ),
                  if (sousTitre != null)
                    Flexible(
                      child: Text(
                        sousTitre!,
                        textAlign: TextAlign.end,
                        overflow: TextOverflow.ellipsis,
                        style: context.textes.labelMedium?.copyWith(color: context.couleurs.onSurfaceVariant),
                      ),
                    ),
                  if (action != null) ...[const SizedBox(width: 8), action!],
                ],
              ),
              if (bas != null) ...[const SizedBox(height: 12), bas!],
            ],
          ),
        ),
      ),
    );
  }
}

/// Bloc blanc arrondi (sections de formulaires, listes).
class CarteBlanche extends StatelessWidget {
  const CarteBlanche({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.bordure});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? bordure;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: context.couleurs.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(Marque.rayonCarte),
        border: Border.all(color: bordure ?? context.statut.bordure, width: bordure == null ? 1 : 2),
      ),
      child: child,
    );
  }
}

/// Marqueur de carte : initiales de la personne, anneau vert si en direct,
/// gris et pointillé (bordure fine) si la position n'est plus actualisée.
class MarqueurPersonne extends StatelessWidget {
  const MarqueurPersonne({super.key, required this.nom, required this.enDirect, this.taille = 52, this.critique = false});

  final String nom;
  final bool enDirect;
  final double taille;
  final bool critique;

  /// Même marqueur pour la carte Google (dessiné en HTML par la page /carte-app/).
  /// [etiquette] : texte affiché sous la pastille (heure de la dernière position).
  static DessinMarqueur dessin(BuildContext context,
      {required String nom, required bool enDirect, double taille = 52, bool critique = false, String? etiquette}) {
    final couleur = critique ? context.statut.critique : (enDirect ? context.couleurs.primary : Marque.gris);
    return DessinMarqueur.personne(
      initiales: initialesDe(nom),
      couleur: couleur,
      taille: taille,
      enDirect: enDirect,
      pastille: enDirect && !critique ? context.statut.nominal : null,
      etiquette: etiquette,
    );
  }

  @override
  Widget build(BuildContext context) {
    final couleur = critique ? context.statut.critique : (enDirect ? context.couleurs.primary : Marque.gris);
    return Semantics(
      label: enDirect ? 'Position en direct de $nom' : 'Dernière position connue de $nom',
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: taille,
            height: taille,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: couleur,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: enDirect ? 4 : 3),
              boxShadow: const [BoxShadow(color: Color(0x4D0F172A), blurRadius: 10, offset: Offset(0, 3))],
            ),
            child: ExcludeSemantics(
              child: Text(
                initialesDe(nom),
                style: context.textes.titleSmall?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: taille * 0.3,
                ),
              ),
            ),
          ),
          if (enDirect && !critique)
            Positioned(
              right: -1,
              bottom: -1,
              child: Container(
                width: taille * 0.3,
                height: taille * 0.3,
                decoration: BoxDecoration(
                  color: context.statut.nominal,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 3),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Section de formulaire : petit titre au-dessus d'un contenu.
class TitreSection extends StatelessWidget {
  const TitreSection(this.texte, {super.key, this.action});
  final String texte;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
      child: Row(
        children: [
          Expanded(
            child: Semantics(
              header: true,
              child: Text(texte, style: context.textes.titleMedium),
            ),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}
