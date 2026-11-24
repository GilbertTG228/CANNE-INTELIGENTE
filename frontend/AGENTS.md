# AGENTS.md

## Developer Commands
- **Dependencies**: `flutter pub get`
- **Analysis**: `flutter analyze`
- **Tests**: `flutter test`
- **Run (web)**: `flutter run -d chrome` (API defaults to `http://localhost:3000`)
- **Run (Android emulator)**: `flutter run --dart-define=API_URL=http://10.0.2.2:3000`
- **Routing Override**: `flutter run --dart-define=ROUTAGE_URL=...`
- **Backend**: `cd ../backend && npm install && npm start` (tests: `npm test`)

## Architecture & Patterns
- **State Management**: Provider + ChangeNotifier.
- **Data Flow**: `Service` (API/Local) → `Controller` (Provider) → `Screen/Widget`.
- **Offline Mode**: SQLite cache via `cache_service`. If API fails, app displays cached data with an offline banner.
- **Polling**: positions every 10 s, alerts every 30 s (no WebSockets).
- **Map/Routing**: `flutter_map` (OpenStreetMap) and OSRM pedestrian routing.

## Infrastructure Quirks
- Only the `web/` platform folder is versioned; generate Android with `flutter create --platforms android .`.
- **Android**: `minSdk = 23`; `isCoreLibraryDesugaringEnabled = true` for `flutter_local_notifications`;
  local `http` servers require `android:usesCleartextTraffic="true"`.
- **Firebase**: Push notifications require `google-services.json` in `android/app/`. App remains functional without it.

## Key Implementation Details
- **Trips**: Reconstructed on the client; a gap > 10 min between positions starts a new trip.
- **Local Storage**: Home location stored locally; display name synced via `PUT /api/utilisateur/profil`.
- **Consent**: `POST /api/consentements`, also remembered locally.
- **Account flows**: sign-up (`/api/auth/inscription`), 2-step password reset, cane pairing (`/api/cannes/associer`).
