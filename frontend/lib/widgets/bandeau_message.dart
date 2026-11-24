import 'package:flutter/material.dart';

import '../config/theme.dart';

/// Message d'erreur (rouge), d'avertissement (orange) ou de succès (vert),
/// annoncé aux lecteurs d'écran.
enum TypeBandeau { erreur, avertissement, succes }

class BandeauMessage extends StatelessWidget {
  const BandeauMessage({super.key, required this.message, this.type = TypeBandeau.erreur});

  final String message;
  final TypeBandeau type;

  @override
  Widget build(BuildContext context) {
    final s = context.statut;
    final (fond, texte, icone) = switch (type) {
      TypeBandeau.erreur => (s.critiqueFond, s.critiqueTexte, Icons.error_outline_rounded),
      TypeBandeau.avertissement => (s.avertFond, s.avertTexte, Icons.info_outline_rounded),
      TypeBandeau.succes => (s.nominalFond, s.nominalTexte, Icons.check_circle_outline_rounded),
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(12)),
        child: Row(
          children: [
            Icon(icone, color: texte),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: context.textes.bodyMedium?.copyWith(color: texte, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Indicateur de chargement à placer dans un bouton pendant un envoi.
class ChargementBouton extends StatelessWidget {
  const ChargementBouton({super.key});

  @override
  Widget build(BuildContext context) {
    return const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 3));
  }
}
