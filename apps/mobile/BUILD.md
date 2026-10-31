# BidClean Mobile — EAS Build (APK para el teléfono)

Guía para generar un **APK instalable** de BidClean con todos los módulos nativos
(Mapbox, Stripe, LiveKit, AdMob, cámara, ubicación, biometría), sin instalar
Android Studio. El build se compila en la nube de Expo (EAS).

## Requisitos previos (una sola vez)

1. **Cuenta Expo gratis** en https://expo.dev (solo email + contraseña).
2. **Mapbox download token** (`sk.*`) — es el único bloqueante real del build:
   - Entra a https://account.mapbox.com/access-tokens/
   - Crea un token **Secret** con el scope **`DOWNLOADS:READ`** activado.
   - Empieza por `sk.` (distinto del token público `pk.*` que usa el mapa en runtime).
   - Es gratis. Sin él, Gradle falla con HTTP 401 al bajar el SDK nativo de Mapbox.

## Variables de entorno del build

El `app.config.js` lee estos valores del entorno al compilar (con valores por
defecto seguros para que el APK arranque). Para el primer APK "para ver cómo
quedó" solo necesitas el de Mapbox; el resto tiene defaults de test.

| Variable | Obligatoria | Default | Para qué |
|----------|-------------|---------|----------|
| `MAPBOX_DOWNLOAD_TOKEN` | **Sí** (build) | — | `sk.*` para que Gradle baje el SDK de Mapbox |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | No | vacío | `pk.*` para que el mapa se vea en runtime |
| `EXPO_PUBLIC_ADMOB_ANDROID_APP_ID` | No | AdMob test id | evita crash de arranque de ads |
| `EXPO_PUBLIC_API_URL` | No | `https://api.bidclean.tech` | backend que consume la app |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | vacío | pagos (runtime) |
| `EXPO_PUBLIC_LIVEKIT_URL` | No | vacío | video/VoIP (runtime) |

## Pasos para generar el APK

Desde `apps/mobile`:

```bash
# 1. Instalar EAS CLI (una vez)
npm install -g eas-cli

# 2. Iniciar sesión con tu cuenta Expo
eas login

# 3. Vincular el proyecto a tu cuenta (crea el projectId en eas.json/app.config)
eas init

# 4. Pasar el token de Mapbox como secreto del proyecto (una vez)
eas secret:create --name MAPBOX_DOWNLOAD_TOKEN --value "sk.TU_TOKEN_AQUI" --type string

# 5. Lanzar el build del APK (perfil preview)
eas build --platform android --profile preview
```

Al terminar (~10-20 min en la nube), EAS te da un **enlace + QR**. Abre el enlace
en tu teléfono Android/Samsung, descarga el APK e instálalo (activa "instalar de
fuentes desconocidas" si lo pide).

## Perfiles de build (`eas.json`)

- **development** — dev client (para desarrollo con hot reload en el dispositivo).
- **preview** — **APK** instalable directo, sin pasar por la store. Úsalo para ver la app.
- **production** — AAB firmado para subir a Google Play / Samsung Store.

## Qué funcionará en el primer APK

- Todo el flujo de UI, navegación, tema, i18n, biometría, cámara, ubicación.
- Mapas: se ven si pusiste también el `pk.*` (`EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`).
- Pagos / video / suscripciones: necesitan sus llaves reales (Stripe, LiveKit,
  RevenueCat) para operar; sin ellas la UI carga pero la acción falla al intentarse.
