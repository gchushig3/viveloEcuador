# ms-cliente

Servicio propietario de la identidad comercial del turista. Booking y la tienda
deben registrar clientes aquí; la cédula/RUC normalizada identifica al mismo
cliente entre canales. La API administrativa es de solo lectura.

## API

La tienda solicita cédula/RUC en el checkout y rechaza el registro si falta o
no tiene 10 o 13 dígitos. El índice único evita asociar el mismo documento a
dos clientes. En el contrato de Booking sigue siendo opcional para turistas
que no tengan cédula o RUC ecuatoriano.

- Contrato OpenAPI: [`contract/ms-cliente-openapi-v1.yaml`](./contract/ms-cliente-openapi-v1.yaml).
- `GET /api/v2/clientes?identificacion=...` o `?email=...`: búsqueda exacta por uno o ambos campos.
- `GET /api/v2/clientes/id/:id`: perfil completo por UUID.
- `POST /api/v2/clientes`: registro idempotente para Booking; responde 201 al crear y 200 al reutilizar.
- `POST /api/v2/clientes/integration/register`: registro de integración; responde 201 y señala `reused` cuando aplica.
- `POST /api/v2/clientes/web/register`: registro de tienda; requiere `x-user-id` inyectado por el Gateway y fija el origen `TIENDA`.
- `GET /api/v2/clientes/admin`: lista paginada; acepta `page`, `limit` y `q`.
- `GET /api/v2/clientes/admin/:id`: perfil completo por UUID.
- `GET /api/v2/health/live` y `/api/v2/health/ready`: liveness y disponibilidad de la base de datos.

La base de datos es Neon. Copia la URL pooled desde Neon Console > Connect a DATABASE_URL y conserva sslmode=require.
DB_POOL_MAX limita las conexiones que abre cada instancia. El servicio expone su API solo en la red privada; el Gateway es la entrada publica.
El servicio no valida tokens ni roles por sí mismo. El Gateway debe autorizar las
rutas y agregar `x-user-id` solo después de verificar la identidad.

El esquema está en `init-cliente.sql`. Puedes ejecutarlo desde el SQL Editor de
Neon después de seleccionar la base `ms_cliente`; el servicio también prepara
la tabla e índices al iniciar.

Antes de dirigir Booking a este servicio por primera vez, importa la tabla
existente para mantener los UUID enlazados desde reservas: inicia ms-cliente,
configura `LEGACY_DATABASE_URL` en `services/ms-cliente/.env` apuntando a la BD
de ms-catalog y ejecuta `npm run migrate:legacy`. Hazlo antes de aceptar altas
nuevas en ms-cliente.

Para incluir compras locales previas, configura también
`LOCAL_IDENTITY_DATABASE_URL` y `LOCAL_CART_DATABASE_URL`; el script importa
solo reservas locales confirmadas y pagadas, con el ID de Identity para poder
consultar su historial.
