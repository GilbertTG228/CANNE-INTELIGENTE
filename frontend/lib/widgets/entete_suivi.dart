import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/theme.dart';
import '../controllers/suivi_controller.dart';
import '../models/canne.dart';
import '../screens/association_canne_screen.dart';
import '../screens/parametres_screen.dart';
import 'composants.dart';

/// Pastille flottante en haut de la carte : personne suivie, état, et accès
/// au choix d'une autre personne (inspirée des cercles de Life360).
class SelecteurPersonne extends StatelessWidget {
  const SelecteurPersonne({super.key});

  @override
  Widget build(BuildContext context) {
    final suivi = context.watch<SuiviController>();
    final canne = suivi.canne;
    final c = context.couleurs;
    final enDirect = suivi.positionEnDirect;
    final nb = suivi.cannes.length;
    return Semantics(
      button: true,
      label: canne == null
          ? 'Aucune personne suivie'
          : '${canne.nom}, ${enDirect ? 'en direct' : 'position non actualisée'}. '
              'Toucher pour changer de personne suivie.',
      excludeSemantics: true,
      child: Material(
        color: c.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(28),
        child: Ink(
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(28), boxShadow: Marque.ombreFlottante),
          child: InkWell(
            borderRadius: BorderRadius.circular(28),
            onTap: () => afficherSelecteurPersonnes(context),
            child: SizedBox(
              height: 56,
              child: Row(
                children: [
                  const SizedBox(width: 6),
                  AvatarInitiales(nom: canne?.nom ?? '?', taille: 44, actif: enDirect),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(canne?.nom ?? '—',
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: context.textes.titleSmall),
                        Text(
                          nb > 1 ? '$nb personnes suivies' : 'Personne suivie',
                          style: context.textes.bodySmall?.copyWith(color: c.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                  Icon(Icons.expand_more_rounded, color: c.onSurfaceVariant),
                  const SizedBox(width: 12),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Feuille du bas : liste des personnes suivies et ajout d'une canne.
Future<void> afficherSelecteurPersonnes(BuildContext context) {
  final suivi = context.read<SuiviController>();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.7),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
                child: Semantics(
                  header: true,
                  child: Text('Personnes suivies', style: ctx.textes.headlineSmall),
                ),
              ),
              for (final Canne canne in suivi.cannes)
                _LignePersonne(
                  canne: canne,
                  selectionnee: canne.id == suivi.canneId,
                  surAppui: () {
                    Navigator.pop(ctx);
                    suivi.selectionner(canne.id);
                  },
                ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.pop(ctx);
                  Navigator.of(context).push(
                    MaterialPageRoute<bool>(builder: (_) => const AssociationCanneScreen()),
                  );
                },
                icon: const Icon(Icons.add_rounded),
                label: const Text('Associer une autre canne'),
              ),
              const SizedBox(height: 4),
              TextButton.icon(
                onPressed: () {
                  Navigator.pop(ctx);
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const ParametresScreen()),
                  );
                },
                icon: const Icon(Icons.settings_outlined),
                label: const Text('Paramètres'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _LignePersonne extends StatelessWidget {
  const _LignePersonne({required this.canne, required this.selectionnee, required this.surAppui});
  final Canne canne;
  final bool selectionnee;
  final VoidCallback surAppui;

  @override
  Widget build(BuildContext context) {
    final c = context.couleurs;
    final s = context.statut;
    final (etat, couleur) = !canne.active
        ? ('Canne désactivée', c.onSurfaceVariant)
        : canne.enLigne
            ? ('En ligne', s.nominalTexte)
            : ('Hors ligne', s.avertTexte);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Semantics(
        selected: selectionnee,
        button: true,
        label: '${canne.nom}, $etat${canne.batterie != null ? ', batterie ${canne.batterie} pour cent' : ''}',
        excludeSemantics: true,
        child: Material(
          color: selectionnee ? c.primaryContainer : Colors.transparent,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: surAppui,
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: selectionnee ? c.primary : Colors.transparent, width: 1.5),
              ),
              child: Row(
                children: [
                  AvatarInitiales(nom: canne.nom, actif: canne.active && canne.enLigne),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(canne.nom, style: context.textes.titleSmall),
                        Text('${canne.identifiant} · $etat',
                            style: context.textes.bodySmall?.copyWith(color: couleur)),
                      ],
                    ),
                  ),
                  if (canne.batterie != null)
                    Text('${canne.batterie} %',
                        style: context.textes.labelLarge?.copyWith(
                          color: canne.batterie! < 20 ? s.critique : c.onSurface,
                        )),
                  if (selectionnee) ...[
                    const SizedBox(width: 8),
                    Icon(Icons.check_circle_rounded, color: c.primary),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
