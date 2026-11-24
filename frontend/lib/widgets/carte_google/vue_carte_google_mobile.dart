import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Android / iOS : la page de carte est affichée dans une vue web intégrée.
///
/// [surMessage] reçoit chaque message JSON (texte) envoyé par la page.
/// [surEnvoyeur] reçoit, une fois la vue créée, la fonction qui envoie une
/// commande JSON (texte) à la page.
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
  late final WebViewController _controleur;

  @override
  void initState() {
    super.initState();
    _controleur = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFE5E7EB))
      ..addJavaScriptChannel('Flutter', onMessageReceived: (message) => widget.surMessage(message.message))
      ..loadRequest(widget.url);
    widget.surEnvoyeur(_envoyer);
  }

  void _envoyer(String commande) {
    // La commande est un JSON : on la passe telle quelle comme littéral JavaScript.
    _controleur.runJavaScript('window.recevoir && window.recevoir($commande);').catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    return WebViewWidget(
      controller: _controleur,
      // La carte reçoit tous les gestes (glisser, pincer), même dans une page qui défile.
      gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
        Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer()),
      },
    );
  }
}
