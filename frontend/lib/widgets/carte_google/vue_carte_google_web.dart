import 'dart:js_interop';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

/// Version web : la page de carte est affichée dans un cadre <iframe>.
/// Les échanges passent par window.postMessage (texte JSON).
class VueCarteGoogle extends StatefulWidget {
  const VueCarteGoogle({
    super.key,
    required this.url,
    required this.surMessage,
    required this.surEnvoyeur,
  });

  final Uri url;
  final void Function(String message) surMessage;
  final void Function(void Function(String commande) envoyer) surEnvoyeur;

  @override
  State<VueCarteGoogle> createState() => _VueCarteGoogleState();
}

class _VueCarteGoogleState extends State<VueCarteGoogle> {
  static int _compteur = 0;
  late final String _typeVue;
  late final web.HTMLIFrameElement _cadre;
  JSFunction? _ecouteur;

  @override
  void initState() {
    super.initState();
    _typeVue = 'carte-google-${_compteur++}';
    _cadre = web.HTMLIFrameElement()
      ..src = widget.url.toString()
      ..style.border = 'none'
      ..style.width = '100%'
      ..style.height = '100%';
    ui_web.platformViewRegistry.registerViewFactory(_typeVue, (int _) => _cadre);

    // Les messages de toutes les cartes arrivent sur la même fenêtre : chaque message
    // porte l'identifiant de sa carte, filtré ensuite par CarteBase.
    _ecouteur = ((web.MessageEvent evenement) {
      final donnees = evenement.data.dartify();
      if (donnees is String) widget.surMessage(donnees);
    }).toJS;
    web.window.addEventListener('message', _ecouteur);
    widget.surEnvoyeur(_envoyer);
  }

  void _envoyer(String commande) {
    _cadre.contentWindow?.postMessage(commande.toJS, '*'.toJS);
  }

  @override
  void dispose() {
    final ecouteur = _ecouteur;
    if (ecouteur != null) web.window.removeEventListener('message', ecouteur);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HtmlElementView(viewType: _typeVue);
}
