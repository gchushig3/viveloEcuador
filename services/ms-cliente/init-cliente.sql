-- Esquema propietario de ms-cliente para Neon/PostgreSQL.
-- Ejecutar sobre la base de datos ms_cliente seleccionada en Neon.
-- El UUID permanece estable porque las reservas de Booking lo guardan como referencia.

BEGIN;

CREATE TABLE IF NOT EXISTS cliente (
    cli_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cli_uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    cli_nombre VARCHAR(200) NOT NULL,
    cli_email VARCHAR(200) NOT NULL,
    cli_identificacion VARCHAR(30),
    cli_telefono VARCHAR(30),
    cli_usuario_id BIGINT,
    cli_origenes TEXT[] NOT NULL DEFAULT ARRAY['TIENDA']::TEXT[],
    cli_creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    cli_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_cliente_nombre_no_vacio CHECK (btrim(cli_nombre) <> ''),
    CONSTRAINT ck_cliente_email_normalizado CHECK (
        cli_email = lower(btrim(cli_email))
        AND cli_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
    CONSTRAINT ck_cliente_identificacion_normalizada CHECK (
        cli_identificacion IS NULL OR (
            cli_identificacion = btrim(cli_identificacion)
            AND cli_identificacion = upper(cli_identificacion)
        )
    ),
    CONSTRAINT ck_cliente_origenes CHECK (
        cardinality(cli_origenes) > 0
        AND cli_origenes <@ ARRAY['TIENDA', 'BOOKING']::TEXT[]
    ),
    CONSTRAINT ck_cliente_usuario_id CHECK (cli_usuario_id IS NULL OR cli_usuario_id > 0)
);

-- La identidad es canónica por correo e identificación; ambas pueden faltar
-- de forma individual salvo el correo, que Booking requiere.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_email
    ON cliente (lower(cli_email));

CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_identificacion
    ON cliente (cli_identificacion)
    WHERE cli_identificacion IS NOT NULL;

-- Relación lógica con Identity: usuario vive en otra base de datos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_usuario_id
    ON cliente (cli_usuario_id)
    WHERE cli_usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_cliente_creado_en
    ON cliente (cli_creado_en DESC, cli_id DESC);

CREATE INDEX IF NOT EXISTS ix_cliente_origenes
    ON cliente USING GIN (cli_origenes);

COMMENT ON TABLE cliente IS
    'Perfil canónico de turistas de la tienda web y Booking; no almacena credenciales.';
COMMENT ON COLUMN cliente.cli_uuid IS
    'UUID público y estable usado por las reservas de Booking.';
COMMENT ON COLUMN cliente.cli_identificacion IS
    'Identificación única (cédula/RUC) normalizada en mayúsculas; obligatoria para TIENDA y opcional para Booking.';
COMMENT ON COLUMN cliente.cli_origenes IS
    'Canales en que el cliente ha comprado: TIENDA y/o BOOKING.';
COMMENT ON COLUMN cliente.cli_usuario_id IS
    'ID lógico de Identity para relacionar compras locales; no es una FK entre bases.';

COMMIT;
