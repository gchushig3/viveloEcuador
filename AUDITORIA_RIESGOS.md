# Auditoría técnica de riesgos — Descubre EC

**Fecha:** 15 de noviembre de 2026.  
**Resultado:** 2 riesgos críticos, 6 medios y 2 bajos.

## Alcance y metodología

Revisión estática del estado local del repositorio, incluidos cambios pendientes: Gateway, frontend, clientes, reservas B2B de Catalog, infraestructura compartida y automatización de despliegue. Se contrastó la documentación con el código. Esta es una auditoría focalizada, no una certificación integral de todos los microservicios.

No se consultaron servicios remotos, bases de datos ni configuraciones efectivas de Azure. No se ejecutaron pruebas, ataques ni análisis actualizado de vulnerabilidades de dependencias. La evidencia confirma comportamientos del código; la exposición efectiva en producción requiere comprobar el despliegue. No se modificó código funcional ni los cambios existentes del usuario.

**Criterios:** crítico = permite operaciones de negocio no autorizadas o compromete identidad e integridad de clientes con una entrada accesible; medio = afecta confidencialidad, integridad o disponibilidad bajo condiciones adicionales o fallos operativos; bajo = debilidad documental o de exposición auxiliar con impacto limitado. La prioridad considera impacto y facilidad de acceso; no se asignó puntuación CVSS.

## Matriz de riesgos

| ID | Nivel | Hallazgo | Prioridad sugerida |
| --- | --- | --- | --- |
| C-01 | Crítico | Creación y cancelación B2B sin autenticación ni autorización por reserva | Antes de mantener exposición pública |
| C-02 | Crítico | Registro público puede fusionar identidades de clientes y eliminar registros | Antes de aceptar nuevas altas públicas |
| M-01 | Medio | Consulta pública de datos personales por correo o identificación | Próxima corrección de seguridad |
| M-02 | Medio | PostgreSQL compartido sin validación del certificado del servidor | Próxima corrección de infraestructura |
| M-03 | Medio | Access token y refresh token persistidos en localStorage | Próxima iteración de autenticación |
| M-04 | Medio | Idempotencia opcional al crear reservas B2B | Próxima corrección de reservas |
| M-05 | Medio | Cancelación calcula importe con tarifa actual y depende de ella | Próxima corrección de reservas |
| M-06 | Medio | Pipeline de Catalog despliega sin ejecutar pruebas | Antes del siguiente despliegue |
| B-01 | Bajo | Documentación arquitectónica contradice la implementación | Próxima actualización documental |
| B-02 | Bajo | Swagger del Gateway disponible públicamente | Según política de publicación de API |

## Riesgos críticos

### C-01 — Operaciones B2B sin identidad ni propiedad

**Evidencia:** `services/ms-catalog/src/modules/attractions/booking-contract.controller.ts:246` declara pública la creación; las cancelaciones también llevan `@PublicEndpoint()` en las líneas 279 y 319. `services/ms-catalog/src/common/guards/administrative-access.guard.ts` omite la autenticación para ese decorador. `services/ms-catalog/src/booking/booking-reservations.service.ts:159` permite buscar la reserva por UUID **o ID numérico**, sin comprobar solicitante, cliente ni socio. `infrastructure/deployment/azure/deploy.ps1:51` configura Catalog con ingreso público.

**Impacto:** un solicitante con acceso directo a Catalog puede consumir cupos creando reservas y cancelar reservas ajenas que cumplan las reglas de cancelación. Aceptar IDs numéricos facilita la enumeración. Los guards del Gateway no protegen llamadas directas al servicio. Las restricciones de plazo y check-in limitan las cancelaciones, pero no acreditan autorización.

**Corrección:** autenticar al socio B2B en el propio servicio, asignar reservas al socio y verificar autorización en cada operación; limitar el ingreso directo cuando sea posible. Mantener rate limiting específico para escrituras. Eliminar el ID numérico del contrato público si la compatibilidad lo permite; usar UUID no sustituye la autorización.

**Verificación de cierre:** peticiones anónimas rechazadas en creación y ambos alias de cancelación; un socio no puede cancelar reservas de otro; el flujo autorizado conserva idempotencia y liberación única de cupos. Comprobar también el acceso directo al origen desplegado.

### C-02 — Fusión destructiva de identidades desde un registro público

**Evidencia:** `services/ms-cliente/src/clients.service.ts:129` fusiona registros cuando correo, identificación o usuario coinciden con varios clientes; la línea 146 elimina el registro absorbido. La selección usa datos aportados por el solicitante y no acredita que controle ambas identidades. `services/ms-cliente/src/clients.controller.ts:28` expone el registro que invoca esta lógica. `apps/gateway/src/common/guards/jwt-auth.guard.ts`, en `isPublicRoute`, permite `POST /api/v[123]/clients` sin JWT.

**Impacto:** combinar el correo de un cliente con la identificación de otro puede activar un intento de fusión no autorizado. Si las restricciones de unicidad permiten completar la transacción, se elimina un UUID existente y se pueden conservar o mezclar vínculos de usuario incorrectos; referencias externas a ese UUID pueden quedar sin resolver. En otros casos, las restricciones pueden abortar la transacción: no se afirma que toda combinación complete la fusión.

**Corrección:** responder con conflicto ante coincidencias entre clientes distintos. Separar la fusión en una operación privilegiada, auditable y con verificación de identidad, reasignación explícita de referencias y conservación de alias de UUID. No vincular cuentas existentes basándose solo en correo o documento introducido.

**Verificación de cierre:** probar dos clientes existentes y una entrada que cruza sus identificadores; debe rechazarse sin cambios ni eliminación. Probar que un usuario no puede apropiarse de un cliente preexistente mediante `web/register`. Usar base aislada.

## Riesgos medios

### M-01 — Exposición de datos personales por consulta pública

**Evidencia:** el Gateway permite `GET /api/v[123]/clients` anónimo. `services/ms-cliente/src/clients.controller.ts:10` devuelve UUID, nombre, correo e identificación tras una búsqueda exacta por correo o documento.

**Impacto:** quien conozca uno de esos datos puede consultar los restantes y confirmar la existencia de clientes. El hallazgo no implica que el listado administrativo sea público: el Gateway sí exige ADMIN para ese listado.

**Corrección:** exigir identidad de integración o sesión y autorización; reducir la respuesta al mínimo necesario, evitar búsquedas públicas con datos personales y aplicar límites por solicitante.

**Cierre:** consultas anónimas rechazadas; usuarios sin relación con el cliente no reciben sus datos.

### M-02 — Conexiones PostgreSQL sin comprobar certificado

**Evidencia:** `packages/shared-infrastructure/src/neon.module.ts:28` fija `ssl: { rejectUnauthorized: false }` y elimina parámetros SSL de la URL antes de construir la conexión.

**Impacto:** existe cifrado, pero no se valida la autenticidad del servidor con esta configuración. Un atacante con capacidad de interceptar o redirigir el tráfico podría suplantarlo. Afecta a servicios que usen estas opciones sin sobrescribirlas; no se extrapola a todas las conexiones del monorepo.

**Corrección:** activar validación de certificado y configurar la CA cuando corresponda, manteniendo comprobación del nombre del servidor.

**Cierre:** conexión válida exitosa y certificados no confiables rechazados en una prueba aislada.

### M-03 — Tokens persistentes accesibles a JavaScript

**Evidencia:** `apps/booking-web/src/app/services/auth.service.ts:49` y línea 50 guardan access token y refresh token en `localStorage`.

**Impacto:** una eventual ejecución de JavaScript malicioso en el origen puede extraer ambos tokens. Esta revisión no encontró ni demuestra una vulnerabilidad XSS explotable; el almacenamiento amplifica su impacto si ocurre.

**Corrección:** evaluar refresh token en cookie HttpOnly, Secure y con SameSite adecuado, acceso de corta duración en memoria y protección CSRF si se usan cookies para autenticar. Complementar con CSP y rotación/revocación.

**Cierre:** ningún refresh token queda accesible desde JavaScript; renovación, cierre de sesión y revocación conservan su comportamiento.

### M-04 — La protección de duplicados depende del consumidor

**Evidencia:** `services/ms-catalog/src/booking/booking-reservations.service.ts:38` valida la clave solo si se envía; la búsqueda previa ocurre bajo `if (key)` y la línea 94 permite persistir `null`.

**Impacto:** ante una respuesta perdida, reenviar la misma solicitud sin clave crea otro UUID y puede consumir cupos adicionales. La idempotencia de Inventory por reserva no deduplica dos reservas con UUID diferentes.

**Corrección:** exigir una clave estable para nuevas integraciones y acordar la transición con consumidores existentes. Documentar alcance y retención; no deduplicar por datos personales, pues dos reservas iguales pueden ser legítimas.

**Cierre:** solicitud sin clave rechazada según el contrato acordado; reintentos con la misma clave generan una sola reserva y una sola asignación.

### M-05 — Cancelación dependiente del precio vigente

**Evidencia:** `services/ms-catalog/src/booking/booking-reservations.service.ts:156` y línea 194 calculan el importe con `booking_attraction_profile.payload.price.adult` multiplicado por personas. La cancelación falla si no hay tarifa válida, antes de completar la liberación.

**Impacto:** editar la tarifa después de reservar cambia el importe simulado de cancelación; eliminarla o invalidarla puede impedir cancelar y liberar cupos. El proyecto declara pagos simulados: no se afirma pérdida monetaria real.

**Corrección:** persistir tarifa, moneda y condiciones aplicadas como instantánea de la reserva; definir recuperación de reservas antiguas sin instantánea y separar liberación de inventario del cálculo de una compensación simulada.

**Cierre:** cambiar o retirar la tarifa de catálogo tras reservar no altera el importe acordado ni impide una cancelación válida.

### M-06 — Despliegue de Catalog sin pruebas como barrera

**Evidencia:** `.github/workflows/deploy-azure.yml` compila infraestructura y Catalog, empaqueta y despliega. No ejecuta pruebas; para Catalog usa `npm install --no-audit --no-fund` en lugar de `npm ci`. El workflow de frontend sí contiene pruebas, pero no valida por ello Catalog ni las sagas.

**Impacto:** una regresión de autorización, reservas o integración puede compilar y desplegarse. La instalación no exige la consistencia estricta entre manifiesto y lockfile que proporciona `npm ci`.

**Corrección:** usar instalación reproducible y exigir pruebas relevantes de Catalog, autorización y reservas antes del despliegue; incorporar la suite de saga aislada cuando cambien sus componentes. Comprobar las reglas de protección de rama y entorno en GitHub, que no se inspeccionaron aquí.

**Cierre:** un fallo deliberado de prueba bloquea el despliegue y la instalación rechaza un lockfile incoherente.

## Riesgos bajos

### B-01 — Documentación desactualizada

**Evidencia:** `ARCHITECTURE_ANALYSIS.md`, fechado el 6 de noviembre, afirma que `apps/gateway` está vacío; el repositorio contiene Gateway implementado. También enlaza `DATABASE_MIGRATION_PLAN.md`, `BOOKING_EXTRACTION_ROADMAP.md` y `FRONTEND_IMPACT.md`, ausentes del inventario revisado. `services/ms-cliente/README.md` describe la API administrativa como solo lectura, mientras el controlador incluye `POST admin`.

**Impacto:** decisiones de integración, soporte o extracción basadas en una arquitectura anterior o documentos no disponibles.

**Corrección y cierre:** identificar el análisis como histórico, actualizar el estado vigente y reparar enlaces y descripción de las operaciones administrativas; verificar que cada enlace resuelva.

### B-02 — Documentación de API pública

**Evidencia:** `apps/gateway/src/main.ts` publica Swagger en `/docs`; `JwtAuthGuard.isPublicRoute` permite `/docs` y `/docs-json` sin JWT.

**Impacto:** facilita conocer la superficie de la API. Puede ser una decisión válida para una API pública y no constituye por sí sola acceso a datos ni evasión de autorización.

**Corrección y cierre:** acordar si la documentación debe ser pública; si contiene operaciones internas, restringirla por entorno o publicar un contrato reducido. Verificar la política elegida en producción.

## Controles existentes observados

- El Gateway valida firma RS256, issuer, audience y claims, normaliza roles y registra guards de JWT, roles y rate limiting.
- El proxy elimina cabeceras `x-user-*` aportadas por el cliente y las genera a partir del usuario verificado.
- La administración de Catalog consulta Identity y exige ADMIN para operaciones no públicas.
- Booking conserva estados intermedios y usa operaciones idempotentes de Inventory; con clave, controla reutilización del payload.
- Clientes utiliza consultas parametrizadas, transacciones, índices únicos y bloqueos consultivos. Estos controles no sustituyen la verificación de identidad requerida para fusionar registros.
- El script configura `ms-cliente` con ingreso interno. Esto reduce el acceso directo externo, pero no elimina los riesgos de las rutas públicas reenviadas por el Gateway.

## Plan de remediación

1. **Contención inmediata — responsables de Catalog, Clientes e infraestructura:** autenticar escrituras B2B y autorizar cancelaciones; deshabilitar fusión automática en altas; restringir consulta pública de clientes. Verificar ingress real y rutas alternativas al Gateway.
2. **Siguiente entrega — responsables de reservas y plataforma:** validar certificados, exigir idempotencia según contrato, conservar precios de reserva y bloquear despliegues con pruebas fallidas.
3. **Siguiente iteración — frontend e identidad:** revisar almacenamiento y renovación de tokens, con pruebas de sesión completas.
4. **Mantenimiento — responsables técnicos:** actualizar documentos y acordar publicación de Swagger.

Antes de cerrar la auditoría, ejecutar las verificaciones indicadas en entornos aislados y contrastar el código con Azure y GitHub. Revisar aparte dependencias con fuentes actualizadas, restauración de respaldos, gestión de secretos, permisos efectivos de bases de datos y recuperación de estados intermedios. Esos aspectos quedan **pendientes de evaluación**, no clasificados como fallos confirmados.
