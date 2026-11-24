/// Vue qui héberge la page « carte Google » du serveur.
///
///  - Android / iOS : vue web intégrée (webview_flutter) ;
///  - version web   : cadre <iframe>.
///
/// Les deux implémentations exposent la même classe [VueCarteGoogle].
library;

export 'vue_carte_google_mobile.dart' if (dart.library.js_interop) 'vue_carte_google_web.dart';
