/**
 * 42-selfhosted.js — infraestructura self-hosted: lo que ya corre en docker-compose y lo que falta.
 */
BidCleanArch.registerTab({
  id: 'selfhosted',
  group: 'Plataforma',
  order: 420,
  title: 'Infraestructura self-hosted',
  summary:
    'infra/docker-compose.yml levanta seis servicios para desarrollo local. Faltan en el compose la API, la IA, LiveKit, Whisper, Piper, '
    + 'Traefik y el stack de monitoreo. Destino: un VPS de 8 núcleos y 32 GB con cinco subdominios de bidclean.tech.',
  diagrams: [
    {
      title: 'Compose actual y servicios pendientes',
      description: 'Verde = ya está en docker-compose. Rojo = falta agregarlo o desplegarlo.',
      code: `flowchart TB
  INTERNET(["Internet"])
  subgraph VPS["VPS 8 núcleos 32 GB"]
    TRAEFIK["Traefik<br/>SSL Let's Encrypt"]
    subgraph APLICACION["Aplicación"]
      API["API NestJS"]
      AI["Servicio IA<br/>FastAPI"]
    end
    subgraph COMPOSE["docker-compose.yml actual"]
      PG[("postgres<br/>postgis 16-3.4<br/>puerto 15432")]
      REDIS[("redis 7<br/>puerto 16379")]
      MINIO[("minio<br/>9000 y 9001")]
      KC["keycloak 25.0<br/>puerto 8080"]
      CENT["centrifugo v5<br/>8001 a 8000"]
      LT["libretranslate<br/>puerto 5000"]
    end
    subgraph PENDIENTES["Aún no desplegados"]
      LIVEKIT["LiveKit"]
      WHISPER["Whisper.cpp"]
      PIPER["Piper"]
    end
    subgraph OBSERVABILIDAD["Observabilidad"]
      PROM["Prometheus"]
      GRAFANA["Grafana"]
      LOKI["Loki"]
    end
  end
  INTERNET --> TRAEFIK
  TRAEFIK -->|api.bidclean.tech| API
  TRAEFIK -->|ws.bidclean.tech| CENT
  TRAEFIK -->|rtc.bidclean.tech| LIVEKIT
  TRAEFIK -->|storage.bidclean.tech| MINIO
  TRAEFIK -->|auth.bidclean.tech| KC
  API --> PG
  API --> REDIS
  API --> MINIO
  API --> KC
  API --> CENT
  API --> LT
  API --> AI
  API --> LIVEKIT
  AI --> WHISPER
  AI --> PIPER
  KC --> PG
  PROM -.-> API
  GRAFANA --> PROM
  GRAFANA --> LOKI`,
    },
    {
      title: 'Dominios públicos',
      description: 'Cada subdominio apunta a un servicio a través de Traefik.',
      code: `flowchart LR
  TRAEFIK2["Traefik"]
  D_API["api.bidclean.tech"]
  D_WS["ws.bidclean.tech"]
  D_RTC["rtc.bidclean.tech"]
  D_STORAGE["storage.bidclean.tech"]
  D_AUTH["auth.bidclean.tech"]
  S_API["API NestJS"]
  S_CENT["Centrifugo"]
  S_LIVEKIT["LiveKit"]
  S_MINIO["MinIO"]
  S_KC["Keycloak"]
  TRAEFIK2 --> D_API --> S_API
  TRAEFIK2 --> D_WS --> S_CENT
  TRAEFIK2 --> D_RTC --> S_LIVEKIT
  TRAEFIK2 --> D_STORAGE --> S_MINIO
  TRAEFIK2 --> D_AUTH --> S_KC`,
    },
  ],
  nodes: {
    INTERNET: { title: 'Internet', tipo: 'Origen del tráfico', descripcion: 'App móvil y webhooks de Stripe y RevenueCat.', estado: 'externo' },
    TRAEFIK: { title: 'Traefik', tipo: 'Reverse proxy', descripcion: 'Terminación TLS con certificados automáticos y enrutamiento por subdominio. No existe en el compose.', tecnologia: 'Traefik', ubicacion: 'infra/ (pendiente)', adr: 'ADR-001 a 022 sin ADR dedicado', estado: 'falta' },
    API: { title: 'API NestJS', tipo: 'Backend', descripcion: 'Funciona en local con npm, pero no tiene servicio ni Dockerfile en docker-compose.yml.', tecnologia: 'NestJS', ubicacion: 'services/api', estado: 'falta', nota: 'Falta contenerizarla y agregarla al compose.' },
    AI: { title: 'Servicio IA', tipo: 'Backend Python', descripcion: 'Se ejecuta con poetry y uvicorn. No está en docker-compose.yml.', tecnologia: 'FastAPI', ubicacion: 'services/ai', estado: 'falta', nota: 'Falta contenerizarlo y agregarlo al compose.' },
    PG: { title: 'postgres', tipo: 'Base de datos', descripcion: 'Imagen postgis/postgis:16-3.4. Puerto 15432 en el host porque Windows reserva rangos con WinNAT. Con healthcheck pg_isready.', tecnologia: 'PostgreSQL 16 + PostGIS 3.4', ubicacion: 'infra/docker-compose.yml', estado: 'hecho' },
    REDIS: { title: 'redis', tipo: 'Cache y colas', descripcion: 'redis:7-alpine, puerto 16379 en el host y 6379 dentro del contenedor.', tecnologia: 'Redis 7', ubicacion: 'infra/docker-compose.yml', estado: 'hecho' },
    MINIO: { title: 'minio', tipo: 'Almacenamiento', descripcion: 'Puertos 9000 (API S3) y 9001 (consola). Usa la imagen cloudpirates/image-minio.', tecnologia: 'MinIO', ubicacion: 'infra/docker-compose.yml', estado: 'hecho' },
    KC: { title: 'keycloak', tipo: 'Identidad', descripcion: 'Versión 25.0 en modo start-dev e importación del realm desde keycloak/realm-export.json. Usa la misma base postgres.', tecnologia: 'Keycloak 25.0', ubicacion: 'infra/docker-compose.yml, puerto 8080', estado: 'hecho', nota: 'start-dev no es apto para producción.' },
    CENT: { title: 'centrifugo', tipo: 'Tiempo real', descripcion: 'Imagen centrifugo/centrifugo:v5. Puerto 8001 en el host apunta al 8000 del contenedor.', tecnologia: 'Centrifugo v5', ubicacion: 'infra/docker-compose.yml', estado: 'hecho' },
    LT: { title: 'libretranslate', tipo: 'Traducción', descripcion: 'Carga solo en, es, fr, de, it, pt y nl. Puerto 5000.', tecnologia: 'LibreTranslate', ubicacion: 'infra/docker-compose.yml', estado: 'hecho' },
    LIVEKIT: { title: 'LiveKit', tipo: 'VoIP y video', descripcion: 'La API ya emite tokens de sala; falta el servidor.', tecnologia: 'LiveKit', ubicacion: 'pendiente', estado: 'falta' },
    WHISPER: { title: 'Whisper.cpp', tipo: 'Voz a texto', descripcion: 'Transcripción en CPU, aún sin desplegar.', tecnologia: 'Whisper.cpp', ubicacion: 'pendiente', estado: 'falta' },
    PIPER: { title: 'Piper', tipo: 'Texto a voz', descripcion: 'Síntesis de voz en CPU, aún sin desplegar.', tecnologia: 'Piper', ubicacion: 'pendiente', estado: 'falta' },
    PROM: { title: 'Prometheus', tipo: 'Métricas', descripcion: 'Recolección de métricas de la API y los contenedores.', tecnologia: 'Prometheus', ubicacion: 'pendiente', estado: 'falta' },
    GRAFANA: { title: 'Grafana', tipo: 'Tableros', descripcion: 'Visualización de métricas y logs.', tecnologia: 'Grafana', ubicacion: 'pendiente', estado: 'falta' },
    LOKI: { title: 'Loki', tipo: 'Logs', descripcion: 'Agregación de logs.', tecnologia: 'Loki', ubicacion: 'pendiente', estado: 'falta' },
    TRAEFIK2: { title: 'Traefik (rutas)', tipo: 'Reverse proxy', descripcion: 'Enruta cada subdominio al servicio correspondiente.', ubicacion: 'infra/ (pendiente)', estado: 'falta' },
    D_API: { title: 'api.bidclean.tech', tipo: 'Dominio', descripcion: 'API REST.', estado: 'falta', nota: 'DNS y certificado pendientes.' },
    D_WS: { title: 'ws.bidclean.tech', tipo: 'Dominio', descripcion: 'WebSocket de Centrifugo.', estado: 'falta', nota: 'DNS y certificado pendientes.' },
    D_RTC: { title: 'rtc.bidclean.tech', tipo: 'Dominio', descripcion: 'Señalización y medios de LiveKit.', estado: 'falta', nota: 'DNS y certificado pendientes.' },
    D_STORAGE: { title: 'storage.bidclean.tech', tipo: 'Dominio', descripcion: 'Descargas y subidas firmadas hacia MinIO.', estado: 'falta', nota: 'DNS y certificado pendientes.' },
    D_AUTH: { title: 'auth.bidclean.tech', tipo: 'Dominio', descripcion: 'Keycloak.', estado: 'falta', nota: 'DNS y certificado pendientes.' },
    S_API: { title: 'API NestJS', tipo: 'Destino', descripcion: 'Destino de api.bidclean.tech.', estado: 'falta' },
    S_CENT: { title: 'Centrifugo', tipo: 'Destino', descripcion: 'Destino de ws.bidclean.tech.', estado: 'hecho' },
    S_LIVEKIT: { title: 'LiveKit', tipo: 'Destino', descripcion: 'Destino de rtc.bidclean.tech.', estado: 'falta' },
    S_MINIO: { title: 'MinIO', tipo: 'Destino', descripcion: 'Destino de storage.bidclean.tech.', estado: 'hecho' },
    S_KC: { title: 'Keycloak', tipo: 'Destino', descripcion: 'Destino de auth.bidclean.tech.', estado: 'hecho' },
  },
  sections: [
    {
      title: 'Capacidad objetivo',
      html: '<p>VPS único con 8 núcleos y 32 GB de RAM, todo en Docker Compose. Whisper y Piper corren en CPU. Bedrock es el único servicio en la nube de IA.</p>',
    },
  ],
});
