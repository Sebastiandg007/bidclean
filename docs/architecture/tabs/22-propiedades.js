/**
 * 22-propiedades.js — PropertiesModule (PostGIS, fotos cifradas, geocodificación Mapbox) y pantallas móviles de propiedades.
 */
BidCleanArch.registerTab({
  id: 'propiedades',
  group: 'Dominios del negocio',
  order: 220,
  title: 'Propiedades',
  summary:
    'El Host registra los espacios que necesitan limpieza. Cada propiedad guarda su ubicación como <strong>geografía PostGIS</strong>, fotos cifradas en MinIO, '
    + 'checklist y requisitos especiales. La dirección exacta es privada: los Cleaners solo ven una vista pública armada con un SELECT de columnas explícitas. '
    + 'Una propiedad es apta para publicar ofertas cuando cumple el contrato <code>PropertyReadinessCheck</code> (datos obligatorios y al menos una foto).',
  diagrams: [
    {
      title: 'Alta y gestión de una propiedad',
      description: 'De las pantallas del Host a PostgreSQL/PostGIS, MinIO y Mapbox. Las consultas del repositorio siempre filtran por dueño y por deleted_at.',
      code: `flowchart TB
  subgraph MOVIL["App móvil (Host)"]
    S_LIST["PropertyListScreen<br/>lista y PropertyCard"]
    S_CREATE["CreatePropertyScreen<br/>formulario por pasos"]
    S_EDIT["EditPropertyScreen"]
    S_DETAIL["PropertyDetailScreen<br/>galería y mapa"]
    S_ADDR["AddressInput<br/>y PropertyMap"]
    S_PHOTOS["PhotoUploader<br/>y PropertyPhotoGallery"]
    S_CHECK["ChecklistEditor<br/>y RequirementsChips"]
    S_HOOK["useProperties<br/>store Zustand"]
  end
  subgraph API["PropertiesModule NestJS"]
    C_CTRL["PropertiesController<br/>/properties/*"]
    C_OWNER["PropertyOwnerGuard<br/>segunda capa de dueño"]
    C_SVC["PropertiesService<br/>validación y reglas"]
    C_REPO["PropertiesRepository<br/>WHERE user_id y deleted_at IS NULL"]
    C_PHOTO["PropertyPhotoService<br/>sharp + AES-256"]
    C_GEO["GeocodingService<br/>proxy con límite de uso"]
    C_READY["PropertyReadinessCheck<br/>contrato de aptitud"]
  end
  subgraph DATOS["Datos y servicios"]
    D_PG[("PostgreSQL + PostGIS<br/>properties<br/>property_photos")]
    D_MINIO[("MinIO<br/>fotos cifradas")]
    D_MAPBOX["Mapbox Geocoding v5<br/>directo e inverso"]
  end
  S_LIST --> S_HOOK
  S_CREATE --> S_HOOK
  S_EDIT --> S_HOOK
  S_DETAIL --> S_HOOK
  S_CREATE --> S_ADDR
  S_CREATE --> S_PHOTOS
  S_CREATE --> S_CHECK
  S_HOOK -->|HTTPS REST| C_CTRL
  C_CTRL --> C_OWNER
  C_CTRL --> C_SVC
  C_SVC --> C_REPO --> D_PG
  C_SVC --> C_PHOTO --> D_MINIO
  C_PHOTO --> D_PG
  C_SVC --> C_GEO --> D_MAPBOX
  C_SVC --> C_READY
  C_READY --> D_PG`,
    },
    {
      title: 'Privacidad de la dirección y aptitud para ofertas',
      description: 'Qué ve cada actor y cómo el módulo de ofertas decide si una propiedad puede publicarse.',
      code: `flowchart LR
  V_HOST["Host dueño<br/>GET /properties/:id"]
  V_CLEANER["Cleaner<br/>GET /properties/:id/public"]
  V_FULL["Vista completa<br/>calle, código postal,<br/>ubicación exacta, accesos"]
  V_PUBLIC["Vista pública<br/>SELECT con columnas explícitas,<br/>sin campos privados"]
  V_DB[("properties<br/>geografía Point 4326")]
  O_OFFERS["OffersService<br/>al crear una oferta"]
  O_CONTRACT["PROPERTY_READINESS<br/>token de inyección"]
  O_CHECK{"¿Apta para oferta?<br/>campos y 1+ foto"}
  O_OK(["Oferta en DRAFT"])
  O_FAIL(["Rechazo con motivos<br/>detallados"])
  V_HOST --> V_FULL --> V_DB
  V_CLEANER --> V_PUBLIC --> V_DB
  O_OFFERS --> O_CONTRACT --> O_CHECK
  O_CHECK -->|sí| O_OK
  O_CHECK -->|no| O_FAIL
  O_CHECK -.->|lee datos actuales| V_DB`,
    },
  ],
  nodes: {
    S_LIST: { title: 'PropertyListScreen', tipo: 'Pantalla móvil', descripcion: 'Lista paginada de las propiedades del Host con PropertyCard.', ubicacion: 'apps/mobile/src/screens/properties/PropertyListScreen.tsx', estado: 'hecho' },
    S_CREATE: { title: 'CreatePropertyScreen', tipo: 'Pantalla móvil', descripcion: 'Formulario de varios pasos: dirección, tipo, tamaño, fotos, checklist y requisitos.', ubicacion: 'apps/mobile/src/screens/properties/CreatePropertyScreen.tsx', estado: 'hecho' },
    S_EDIT: { title: 'EditPropertyScreen', tipo: 'Pantalla móvil', descripcion: 'Edición de los campos y las fotos de una propiedad existente.', ubicacion: 'apps/mobile/src/screens/properties/EditPropertyScreen.tsx', estado: 'hecho' },
    S_DETAIL: { title: 'PropertyDetailScreen', tipo: 'Pantalla móvil', descripcion: 'Detalle con galería de fotos y mapa.', ubicacion: 'apps/mobile/src/screens/properties/PropertyDetailScreen.tsx', estado: 'hecho' },
    S_ADDR: { title: 'AddressInput y PropertyMap', tipo: 'Componentes móviles', descripcion: 'Búsqueda de dirección con geocodificación y ajuste manual del pin en el mapa.', tecnologia: 'Mapbox', ubicacion: 'apps/mobile/src/screens/properties/components/AddressInput.tsx, apps/mobile/src/screens/properties/components/PropertyMap.tsx', adr: 'ADR-004', estado: 'hecho' },
    S_PHOTOS: { title: 'PhotoUploader y PropertyPhotoGallery', tipo: 'Componentes móviles', descripcion: 'Subida y reordenamiento de fotos.', ubicacion: 'apps/mobile/src/screens/properties/components/PhotoUploader.tsx, apps/mobile/src/screens/properties/components/PropertyPhotoGallery.tsx', estado: 'hecho' },
    S_CHECK: { title: 'ChecklistEditor y RequirementsChips', tipo: 'Componentes móviles', descripcion: 'Editor del checklist de tareas y de los requisitos especiales de la propiedad.', ubicacion: 'apps/mobile/src/screens/properties/components/ChecklistEditor.tsx, apps/mobile/src/screens/properties/components/RequirementsChips.tsx', estado: 'hecho' },
    S_HOOK: { title: 'useProperties', tipo: 'Store Zustand', descripcion: 'Estado y llamadas a la API de propiedades.', tecnologia: 'Zustand', ubicacion: 'apps/mobile/src/screens/properties/useProperties.ts', adr: 'ADR-003', estado: 'hecho' },
    C_CTRL: { title: 'PropertiesController', tipo: 'Controlador NestJS', descripcion: 'Rutas bajo /properties con JWT, validación de DTO e Idempotency-Key en la creación y la subida de fotos.', ubicacion: 'services/api/src/properties/properties.controller.ts', estado: 'hecho' },
    C_OWNER: { title: 'PropertyOwnerGuard', tipo: 'Guard NestJS', descripcion: 'Verifica que la propiedad pertenece al usuario. Es la segunda defensa; la primera está en las consultas.', ubicacion: 'services/api/src/properties/guards/property-owner.guard.ts', estado: 'hecho' },
    C_SVC: { title: 'PropertiesService', tipo: 'Servicio NestJS', descripcion: 'Orquesta validaciones (límites de m2, habitaciones, baños, ítems), creación idempotente y cálculo de aptitud.', ubicacion: 'services/api/src/properties/properties.service.ts', estado: 'hecho' },
    C_REPO: { title: 'PropertiesRepository', tipo: 'Repositorio', descripcion: 'Todas las consultas filtran por user_id y deleted_at IS NULL. La vista pública usa SQL crudo con columnas explícitas y parámetros posicionales.', tecnologia: 'TypeORM + SQL parametrizado', ubicacion: 'services/api/src/properties/properties.repository.ts', estado: 'hecho' },
    C_PHOTO: { title: 'PropertyPhotoService', tipo: 'Servicio NestJS', descripcion: 'Sube, borra y reordena fotos (orden transaccional). Redimensiona con sharp y cifra con AES-256 antes de guardar en MinIO.', tecnologia: 'sharp + MinIO', ubicacion: 'services/api/src/properties/photo/property-photo.service.ts', estado: 'hecho' },
    C_GEO: { title: 'GeocodingService', tipo: 'Servicio NestJS', descripcion: 'Proxy de servidor hacia Mapbox para geocodificación directa e inversa con límite de uso por usuario (PROPERTY_GEOCODING_RATE_LIMIT).', ubicacion: 'services/api/src/properties/geocoding/geocoding.service.ts', estado: 'hecho' },
    C_READY: { title: 'PropertyReadinessCheck', tipo: 'Contrato entre módulos', descripcion: 'Calcula la aptitud con datos actuales (no se guarda): no eliminada, campos obligatorios y al menos 1 foto. Devuelve una lista de motivos para la UI.', ubicacion: 'services/api/src/properties/contracts/property-readiness.service.ts, services/api/src/properties/contracts/offer-editability.interface.ts', estado: 'hecho' },
    D_PG: { title: 'PostgreSQL + PostGIS', tipo: 'Base de datos', descripcion: 'Tablas properties (geografía Point 4326, borrado lógico con deleted_at, restricciones CHECK, columna location_source) y property_photos.', tecnologia: 'PostgreSQL 16 + PostGIS', ubicacion: 'services/api/src/properties/entities/property.entity.ts, services/api/src/properties/entities/property-photo.entity.ts', estado: 'hecho' },
    D_MINIO: { title: 'MinIO', tipo: 'Almacenamiento de objetos', descripcion: 'Bucket de fotos de propiedades (MINIO_PROPERTY_PHOTOS_BUCKET) con URLs firmadas.', tecnologia: 'MinIO (S3 compatible)', estado: 'hecho' },
    D_MAPBOX: { title: 'Mapbox Geocoding v5', tipo: 'Servicio externo', descripcion: 'Convierte direcciones en coordenadas y viceversa. El token vive en el servidor (MAPBOX_ACCESS_TOKEN).', tecnologia: 'Mapbox', adr: 'ADR-004', estado: 'externo' },
    V_HOST: { title: 'Host dueño', tipo: 'Actor', descripcion: 'Consulta su propiedad con todos los datos mediante GET /properties/:id.', estado: 'hecho' },
    V_CLEANER: { title: 'Cleaner', tipo: 'Actor', descripcion: 'Solo puede ver la vista pública mediante GET /properties/:id/public.', estado: 'hecho' },
    V_FULL: { title: 'Vista completa', tipo: 'Respuesta', descripcion: 'Incluye calle, estado, código postal, dirección formateada, ubicación exacta, origen de la ubicación e instrucciones de acceso.', estado: 'hecho' },
    V_PUBLIC: { title: 'Vista pública', tipo: 'Respuesta', descripcion: 'Consulta dedicada que estructuralmente no puede devolver campos privados.', ubicacion: 'services/api/src/properties/properties.repository.ts', estado: 'hecho' },
    V_DB: { title: 'properties (PostGIS)', tipo: 'Base de datos', descripcion: 'Fuente única de los datos de la propiedad.', tecnologia: 'PostgreSQL + PostGIS', estado: 'hecho' },
    O_OFFERS: { title: 'OffersService', tipo: 'Servicio NestJS', descripcion: 'Antes de crear una oferta consulta el contrato de aptitud de la propiedad.', ubicacion: 'services/api/src/offers/offers.service.ts', estado: 'hecho' },
    O_CONTRACT: { title: 'PROPERTY_READINESS', tipo: 'Token de inyección', descripcion: 'Contrato desacoplado: Offers define la interfaz y Properties la implementa, sin importarse entre módulos.', ubicacion: 'services/api/src/offers/contracts/property-readiness.interface.ts, services/api/src/offers/contracts/property-readiness.service.ts', estado: 'hecho' },
    O_CHECK: { title: '¿Apta para oferta?', tipo: 'Decisión', descripcion: 'Campos obligatorios completos, propiedad no eliminada y al menos una foto.', estado: 'hecho' },
    O_OK: { title: 'Oferta en DRAFT', tipo: 'Resultado', descripcion: 'La oferta se crea en estado borrador (ver Ofertas y negociación).', estado: 'hecho' },
    O_FAIL: { title: 'Rechazo con motivos', tipo: 'Resultado', descripcion: 'La API devuelve la lista de razones por las que la propiedad no está lista.', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Endpoints de propiedades',
      html: `<table>
<thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
<tbody>
<tr><td>POST</td><td><code>/properties</code></td><td>Crea una propiedad (Idempotency-Key)</td></tr>
<tr><td>GET</td><td><code>/properties</code></td><td>Lista las propiedades propias, paginada y filtrable</td></tr>
<tr><td>GET</td><td><code>/properties/:id</code></td><td>Detalle completo para el dueño</td></tr>
<tr><td>PATCH</td><td><code>/properties/:id</code></td><td>Actualiza campos</td></tr>
<tr><td>DELETE</td><td><code>/properties/:id</code></td><td>Borrado lógico</td></tr>
<tr><td>GET</td><td><code>/properties/:id/public</code></td><td>Vista pública para Cleaners</td></tr>
<tr><td>POST</td><td><code>/properties/:id/photos</code></td><td>Sube una foto (Idempotency-Key)</td></tr>
<tr><td>DELETE</td><td><code>/properties/:id/photos/:photoId</code></td><td>Elimina una foto</td></tr>
<tr><td>PATCH</td><td><code>/properties/:id/photos/order</code></td><td>Reordena las fotos</td></tr>
<tr><td>POST</td><td><code>/properties/geocode</code></td><td>Geocodificación directa (dirección a coordenadas)</td></tr>
<tr><td>POST</td><td><code>/properties/reverse-geocode</code></td><td>Geocodificación inversa (coordenadas a dirección)</td></tr>
</tbody></table>`,
    },
    {
      title: 'Notas',
      html: `<ul>
<li>Spec: <code>.kiro/specs/property-management</code> (completado según el ROADMAP).</li>
<li>Variables clave: <code>MINIO_PROPERTY_PHOTOS_BUCKET</code>, <code>PROPERTY_MAX_PHOTOS</code>, <code>PROPERTY_PHOTO_URL_EXPIRY_SECONDS</code>, <code>MAPBOX_ACCESS_TOKEN</code>, <code>PROPERTY_GEOCODING_RATE_LIMIT</code>.</li>
<li>No se verificó con credenciales reales que Mapbox responda en producción; el token se lee del entorno.</li>
</ul>`,
    },
  ],
});
