/**
 * 34-favoritos.js — favoritos Host a Cleaner: CRUD con tope por plan bajo bloqueo asesor y ventana de prioridad en la entrega de ofertas.
 */
BidCleanArch.registerTab({
  id: 'favoritos',
  group: 'Experiencia',
  order: 340,
  title: 'Favoritos',
  summary:
    'Relación <b>dirigida Host a Cleaner</b> con su CRUD y consulta. Es la capa de datos que la entrega por niveles del Radar de ofertas ya asume: responde si un Cleaner es favorito de un Host y lista los ids favoritos. '
    + 'El tope depende del plan del Host (FREE limitado, PRO ilimitado o con tope), leído del contrato <code>SUBSCRIPTION_TIER</code> de suscripciones. '
    + 'El alta corre en una transacción con <code>pg_advisory_xact_lock</code> por Host: primero se revisa si ya existe (204) y solo después el tope (422), de modo que el tope es una garantía <b>dura</b> bajo concurrencia (ADR-021). '
    + 'La <b>ventana de prioridad</b> pertenece al Radar: los favoritos reciben la oferta de inmediato y los niveles PRO y FREE se programan tras <code>OFFER_FAVORITES_WINDOW_MS</code>. '
    + 'Estado: CRUD y app implementados; el Radar aún no consume <code>FAVORITES_QUERY</code> (clasifica por nivel desde el descubrimiento) y el worker <code>FavoritesWindowProcessor</code> es un esqueleto con TODO.',
  diagrams: [
    {
      title: 'Alta, lista y baja de favoritos',
      description: 'El Host agrega o quita favoritos. El servicio resuelve el tope por plan y el alta se serializa con un bloqueo asesor por Host dentro de una sola transacción.',
      code: `flowchart TB
  subgraph SG_APP_F["App del Host"]
    LISTA_F["FavoritesListScreen<br/>lista paginada de favoritos"]
    TOGGLE_F["FavoriteToggle<br/>corazón en perfil del Cleaner"]
    CARD_F["FavoriteCard<br/>datos seguros y no disponible"]
    BANNER_F["FavoritesLimitBanner<br/>aviso del tope del plan"]
    STORE_F["useFavoritesStore<br/>Zustand"]
    API_F["favorites.api<br/>cliente REST"]
  end
  subgraph SG_API_F["API · FavoritesModule"]
    CTRL_F["FavoritesController<br/>/favorites, JWT y rol Host"]
    SVC_F["FavoritesService<br/>add, remove, tope por plan"]
    POLI_F["FavoriteEligibilityPolicy<br/>FAVORITES_ALLOW_ADD_WITHOUT_SERVICE"]
    REPO_F["FavoritesRepository<br/>SQL parametrizado"]
    CACHE_F["FavoritesCacheService<br/>no-op, lee PostgreSQL"]
  end
  TIER_F["SUBSCRIPTION_TIER<br/>getRoleTier del Host"]
  DEC_ROL{"¿Cleaner válido<br/>y elegible?"}
  LOCK_F["pg_advisory_xact_lock<br/>por host_id"]
  DEC_EXISTE{"¿Ya existe<br/>el favorito?"}
  DEC_TOPE{"¿Se alcanzó el tope?"}
  INSERT_F["INSERT ON CONFLICT<br/>DO NOTHING"]
  R_201(["201 creado"])
  R_204(["204 ya existía"])
  R_422(["422 sobre el límite"])
  R_4XX(["404 o 422 Cleaner inválido"])
  TABLA_F[("favorites<br/>host_id, cleaner_id, FK CASCADE")]
  CONT_F["GET aggregate-count<br/>solo Cleaner y con bandera"]

  LISTA_F --> CARD_F
  LISTA_F --> BANNER_F
  LISTA_F --> STORE_F
  TOGGLE_F --> STORE_F
  STORE_F --> API_F
  API_F -->|POST DELETE GET| CTRL_F
  CTRL_F --> SVC_F
  SVC_F --> POLI_F
  SVC_F --> TIER_F
  SVC_F --> CACHE_F
  SVC_F --> DEC_ROL
  DEC_ROL -->|no| R_4XX
  DEC_ROL -->|sí| LOCK_F
  LOCK_F --> DEC_EXISTE
  DEC_EXISTE -->|sí| R_204
  DEC_EXISTE -->|no| DEC_TOPE
  DEC_TOPE -->|sí| R_422
  DEC_TOPE -->|no o plan sin tope| INSERT_F
  INSERT_F --> TABLA_F
  INSERT_F --> R_201
  SVC_F --> REPO_F
  REPO_F --> TABLA_F
  CTRL_F --> CONT_F
  CONT_F --> REPO_F`,
    },
    {
      title: 'Ventana de prioridad en la entrega de ofertas',
      description: 'La entrega por niveles pertenece al Radar. Los favoritos reciben la oferta de inmediato y PRO y FREE se programan tras la ventana. El puerto FAVORITES_QUERY existe pero aún no se consume.',
      code: `flowchart LR
  OFERTA_W["Oferta publicada<br/>favoritesFirst activo"]
  ENTREGA_W["DeliverySchedulerService<br/>particiona por nivel"]
  DEC_FAV{"¿Hay Cleaners<br/>favoritos?"}
  FAV_YA["Entrega inmediata<br/>nivel FAVORITE"]
  PRO_YA["PRO inmediato<br/>sin ventana"]
  COLA_W["Cola offer-favorites-window<br/>retraso OFFER_FAVORITES_WINDOW_MS"]
  PROC_W["FavoritesWindowProcessor<br/>guardia de oferta vencida"]
  TIER_W["TierDeliveryProcessor<br/>entrega PRO y luego FREE"]
  PUERTO_W["FAVORITES_QUERY<br/>listFavoriteCleanerIds e isFavorite"]
  SVC_W["FavoritesService<br/>exporta el puerto"]

  OFERTA_W --> ENTREGA_W
  ENTREGA_W --> DEC_FAV
  DEC_FAV -->|sí| FAV_YA
  DEC_FAV -->|no| PRO_YA
  FAV_YA -->|programa PRO tras la ventana| TIER_W
  FAV_YA -.->|diseño previsto| COLA_W
  COLA_W --> PROC_W
  PROC_W -.->|TODO BID-OFFER| TIER_W
  SVC_W --> PUERTO_W
  PUERTO_W -.->|aún sin consumir| ENTREGA_W`,
    },
  ],
  nodes: {
    LISTA_F: { title: 'FavoritesListScreen', tipo: 'Pantalla móvil', descripcion: 'Lista paginada con cursor de los Cleaners favoritos del Host.', ubicacion: 'apps/mobile/src/screens/favorites/FavoritesListScreen.tsx', estado: 'hecho' },
    TOGGLE_F: { title: 'FavoriteToggle', tipo: 'Componente móvil', descripcion: 'Botón de corazón que consulta GET /favorites/is-favorite/:cleanerId y agrega o quita el favorito.', ubicacion: 'apps/mobile/src/screens/favorites/components/FavoriteToggle.tsx', estado: 'hecho' },
    CARD_F: { title: 'FavoriteCard', tipo: 'Componente móvil', descripcion: 'Tarjeta con campos seguros del Cleaner y la señal solo visual de no disponible.', ubicacion: 'apps/mobile/src/screens/favorites/components/FavoriteCard.tsx', estado: 'hecho' },
    BANNER_F: { title: 'FavoritesLimitBanner', tipo: 'Componente móvil', descripcion: 'Aviso cuando el Host FREE llega al tope; invita al plan PRO (flujo de suscripciones).', ubicacion: 'apps/mobile/src/screens/favorites/components/FavoritesLimitBanner.tsx', estado: 'hecho' },
    STORE_F: { title: 'useFavoritesStore', tipo: 'Store Zustand', descripcion: 'Estado de favoritos y paginación en el cliente.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/screens/favorites/useFavoritesStore.ts', adr: 'ADR-003', estado: 'hecho' },
    API_F: { title: 'favorites.api', tipo: 'Cliente REST', descripcion: 'Llamadas a /favorites con el token del usuario.', ubicacion: 'apps/mobile/src/screens/favorites/favorites.api.ts', estado: 'hecho' },
    CTRL_F: { title: 'FavoritesController', tipo: 'Controlador NestJS', descripcion: 'La identidad se resuelve en el servidor (keycloakId a userId). Las rutas de Host exigen rol Host (403 en otro caso); aggregate-count exige rol Cleaner y la bandera. El alta responde 201 o 204.', ubicacion: 'services/api/src/favorites/favorites.controller.ts', estado: 'hecho' },
    SVC_F: { title: 'FavoritesService', tipo: 'Servicio NestJS', descripcion: 'add y remove, resolución del tope por plan, invalidación de caché y la superficie de consulta para la entrega (listFavoriteCleanerIds, isFavorite).', ubicacion: 'services/api/src/favorites/favorites.service.ts', adr: 'ADR-021', estado: 'hecho' },
    POLI_F: { title: 'FavoriteEligibilityPolicy', tipo: 'Política', descripcion: 'Compuerta de alta configurable. Con FAVORITES_ALLOW_ADD_WITHOUT_SERVICE = false consulta el predicado de servicio calificante del Cierre; por defecto no lo consulta.', ubicacion: 'services/api/src/favorites/favorite-eligibility.policy.ts', estado: 'parcial', nota: 'El predicado hasQualifyingService está ligado a DenyQualifyingServiceQuery hasta conectar el Cierre.' },
    REPO_F: { title: 'FavoritesRepository', tipo: 'Repositorio', descripcion: 'SQL parametrizado: addUnderLock, delete, exists, list con keyset, listCleanerIds, countByCleaner e isCleaner.', ubicacion: 'services/api/src/favorites/favorites.repository.ts', estado: 'hecho' },
    CACHE_F: { title: 'FavoritesCacheService', tipo: 'Costura de caché', descripcion: 'En v1 es un pase directo sin efecto (NoopFavoritesCacheService): lee PostgreSQL, que es la membresía autoritativa. Un caché futuro debe usar invalidación durable o ser no autoritativo.', ubicacion: 'services/api/src/favorites/favorites.cache.ts', estado: 'parcial', nota: 'Intencionalmente sin caché en v1.' },
    TIER_F: { title: 'SUBSCRIPTION_TIER', tipo: 'Contrato de suscripciones', descripcion: 'getRoleTier(hostId, HOST) define el tope: FREE con FAVORITES_FREE_MAX, PRO ilimitado o con FAVORITES_PRO_MAX. Una baja de PRO a FREE no borra nada: solo bloquea nuevas altas.', ubicacion: 'services/api/src/subscriptions', adr: 'ADR-007', estado: 'hecho' },
    DEC_ROL: { title: '¿Cleaner válido y elegible?', tipo: 'Decisión', descripcion: 'Verifica que el destino tenga rol Cleaner y que la política permita el alta.', ubicacion: 'services/api/src/favorites/favorites.service.ts', estado: 'hecho' },
    LOCK_F: { title: 'pg_advisory_xact_lock', tipo: 'Bloqueo PostgreSQL', descripcion: 'hashtextextended(host_id, 0) serializa las altas concurrentes del mismo Host dentro de una transacción.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/favorites/favorites.repository.ts', adr: 'ADR-021', estado: 'hecho' },
    DEC_EXISTE: { title: '¿Ya existe el favorito?', tipo: 'Decisión', descripcion: 'Se revisa primero: un duplicado devuelve ALREADY_EXISTS (204) antes de cualquier chequeo de tope, así un re-alta en el tope nunca da 422.', ubicacion: 'services/api/src/favorites/favorites.repository.ts', estado: 'hecho' },
    DEC_TOPE: { title: '¿Se alcanzó el tope?', tipo: 'Decisión', descripcion: 'Solo cuando el plan tiene tope (limit distinto de null) cuenta los favoritos y aborta con OVER_LIMIT si count es mayor o igual al tope. PRO sin tope omite el conteo.', ubicacion: 'services/api/src/favorites/favorites.repository.ts', estado: 'hecho' },
    INSERT_F: { title: 'INSERT ON CONFLICT DO NOTHING', tipo: 'Operación SQL', descripcion: 'Inserción con respaldo adicional contra la restricción única (host_id, cleaner_id).', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/favorites/favorites.repository.ts', estado: 'hecho' },
    R_201: { title: '201 creado', tipo: 'Respuesta', descripcion: 'El favorito se creó.', estado: 'hecho' },
    R_204: { title: '204 ya existía', tipo: 'Respuesta', descripcion: 'Alta idempotente: ya era favorito.', estado: 'hecho' },
    R_422: { title: '422 sobre el límite', tipo: 'Respuesta de error', descripcion: 'El Host alcanzó el tope de su plan.', estado: 'hecho' },
    R_4XX: { title: '404 o 422 Cleaner inválido', tipo: 'Respuesta de error', descripcion: 'El destino no existe o no es Cleaner.', estado: 'hecho' },
    TABLA_F: { title: 'favorites', tipo: 'Tabla PostgreSQL', descripcion: 'Una tabla con borrado definitivo, sin updated_at ni deleted_at. Ambas FK con ON DELETE CASCADE: un favorito es una relación viva, no historial compartido. Migración reversible 1700000046000-CreateFavorites.', tecnologia: 'PostgreSQL', ubicacion: 'services/api/src/favorites/entities/favorite.entity.ts', adr: 'ADR-021', estado: 'hecho' },
    CONT_F: { title: 'GET /favorites/aggregate-count', tipo: 'Endpoint', descripcion: 'Número de Hosts que marcaron al Cleaner, solo con FAVORITES_EXPOSE_AGGREGATE_COUNT activo (404 si no). Nunca expone identidades.', ubicacion: 'services/api/src/favorites/favorites.controller.ts', estado: 'hecho' },
    OFERTA_W: { title: 'Oferta con favoritesFirst', tipo: 'Entrada', descripcion: 'Oferta publicada con la preferencia de entregar primero a favoritos.', ubicacion: 'services/api/src/offers', estado: 'hecho' },
    ENTREGA_W: { title: 'DeliverySchedulerService', tipo: 'Servicio NestJS', descripcion: 'Particiona los Cleaners descubiertos en FAVORITE, PRO y FREE. Con favoritos entrega ya a los favoritos y programa PRO tras OFFER_FAVORITES_WINDOW_MS y FREE tras esa ventana más OFFER_PRO_FREE_DELAY_MS.', ubicacion: 'services/api/src/offers/delivery/delivery-scheduler.service.ts', estado: 'hecho' },
    DEC_FAV: { title: '¿Hay Cleaners favoritos?', tipo: 'Decisión', descripcion: 'Si favoritesFirst está activo pero no hay favoritos, se entrega a PRO de inmediato.', ubicacion: 'services/api/src/offers/delivery/delivery-scheduler.service.ts', estado: 'hecho' },
    FAV_YA: { title: 'Entrega inmediata a favoritos', tipo: 'Acción', descripcion: 'deliverToFavoritesFirst: entrega con nivel FAVORITE y programa los niveles siguientes.', ubicacion: 'services/api/src/offers/delivery/delivery-scheduler.service.ts', estado: 'hecho' },
    PRO_YA: { title: 'PRO inmediato', tipo: 'Acción', descripcion: 'Sin favoritos o sin favoritesFirst: entrega a PRO ya y FREE después.', ubicacion: 'services/api/src/offers/delivery/delivery-scheduler.service.ts', estado: 'hecho' },
    COLA_W: { title: 'Cola offer-favorites-window', tipo: 'Cola BullMQ', descripcion: 'Cola de trabajos retrasados para el vencimiento de la ventana de favoritos.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers/offers.constants.ts', estado: 'parcial', nota: 'El retraso real hoy se programa en las colas de entrega por nivel; esta cola está definida pero el procesador no se ha implementado.' },
    PROC_W: { title: 'FavoritesWindowProcessor', tipo: 'Worker BullMQ', descripcion: 'Debe validar el estado de la oferta (guardia de trabajo vencido) y disparar la entrega PRO al expirar la ventana. Hoy solo registra el trabajo.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers/delivery/favorites-window.processor.ts', estado: 'parcial', nota: 'Esqueleto con TODO(BID-OFFER): falta la guardia de oferta vencida y el disparo de PRO.' },
    TIER_W: { title: 'TierDeliveryProcessor', tipo: 'Worker BullMQ', descripcion: 'Entrega diferida a los niveles PRO y luego FREE una vez vencida la ventana.', tecnologia: 'BullMQ', ubicacion: 'services/api/src/offers/delivery/tier-delivery.processor.ts', estado: 'hecho' },
    PUERTO_W: { title: 'FAVORITES_QUERY', tipo: 'Puerto de DI', descripcion: 'Token exportado por FavoritesModule con listFavoriteCleanerIds e isFavorite, pensado para el Radar. Acoplamiento unidireccional sin ciclos.', ubicacion: 'services/api/src/favorites/favorites.module.ts', estado: 'parcial', nota: 'Ningún módulo de ofertas lo inyecta todavía.' },
    SVC_W: { title: 'FavoritesService (puerto)', tipo: 'Servicio NestJS', descripcion: 'Implementa el puerto con useExisting; lee siempre PostgreSQL.', ubicacion: 'services/api/src/favorites/favorites.service.ts', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de favorites',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/favorites</code></td><td>Host: agrega { cleanerId } bajo bloqueo y tope. 201 creado, 204 ya existía, 422 sobre el límite, 404 o 422 Cleaner inválido.</td></tr>
<tr><td>DELETE</td><td><code>/favorites/:cleanerId</code></td><td>Host: borrado definitivo e idempotente, siempre 204.</td></tr>
<tr><td>GET</td><td><code>/favorites?limit&amp;cursor</code></td><td>Host: favoritos con paginación keyset, orden determinista y campos seguros más la señal no disponible.</td></tr>
<tr><td>GET</td><td><code>/favorites/is-favorite/:cleanerId</code></td><td>Host: { isFavorite } para el estado del corazón.</td></tr>
<tr><td>GET</td><td><code>/favorites/aggregate-count</code></td><td>Cleaner: { count } de Hosts que lo marcaron, solo con FAVORITES_EXPOSE_AGGREGATE_COUNT (si no, 404).</td></tr>
</tbody></table>`,
    },
    {
      title: 'Configuración',
      html: `<p>Validada al arrancar (omitida con NODE_ENV=test): <code>FAVORITES_FREE_MAX</code>, <code>FAVORITES_PRO_MAX</code> (vacío = ilimitado), <code>FAVORITES_EXPOSE_AGGREGATE_COUNT</code> (false), <code>FAVORITES_ALLOW_ADD_WITHOUT_SERVICE</code> (true), <code>FAVORITES_LIST_MAX_LIMIT</code> (50), <code>FAVORITES_LIST_DEFAULT_LIMIT</code> (20) y <code>FAVORITES_CACHE_TTL_MS</code> (sin uso en el caché no-op). La ventana de prioridad usa <code>OFFER_FAVORITES_WINDOW_MS</code> y <code>OFFER_PRO_FREE_DELAY_MS</code> del Radar.</p>`,
    },
  ],
});
