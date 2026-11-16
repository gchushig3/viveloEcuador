import { Pool } from 'pg';

const sourceUrl = process.env.LEGACY_DATABASE_URL;
if (!sourceUrl) throw new Error('Configure LEGACY_DATABASE_URL con la base de ms-catalog.');
const source = new Pool({ connectionString: sourceUrl, max: 2 });
const localIdentity = process.env.LOCAL_IDENTITY_DATABASE_URL
  ? new Pool({ connectionString: process.env.LOCAL_IDENTITY_DATABASE_URL, max: 2 })
  : null;
const localCart = process.env.LOCAL_CART_DATABASE_URL
  ? new Pool({ connectionString: process.env.LOCAL_CART_DATABASE_URL, max: 2 })
  : null;
const target = new Pool({
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5448),
    user: process.env.DB_USERNAME ?? 'cliente_local',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE ?? 'ms_cliente',
  }),
  max: 2,
});

try {
  const { rows } = await source.query(`SELECT cli_uuid::text AS id, cli_nombre AS nombre,
    lower(cli_email) AS email, upper(cli_identificacion) AS identificacion, cli_telefono AS telefono,
    cli_creado_en AS creado_en FROM cliente_atraccion ORDER BY cli_id`);
  const db = await target.connect();
  try {
    await db.query('BEGIN');
    for (const row of rows) {
      await db.query(`INSERT INTO cliente
        (cli_uuid,cli_nombre,cli_email,cli_identificacion,cli_telefono,cli_origenes,cli_creado_en,cli_actualizado_en)
        VALUES($1::uuid,$2,$3,$4,$5,ARRAY['BOOKING']::text[],$6,now())
        ON CONFLICT (cli_uuid) DO NOTHING`,
      [row.id,row.nombre,row.email,row.identificacion,row.telefono,row.creado_en]);
    }
    let tiendaCount = 0;
    if (localIdentity && localCart) {
      const buyers = await localCart.query(`SELECT DISTINCT user_id::text AS user_id
        FROM saga_cart_reservation WHERE state='CONFIRMED' AND paid=true`);
      const ids = buyers.rows.map((buyer) => buyer.user_id);
      if (ids.length) {
        const users = await localIdentity.query(`SELECT usu_id::text AS user_id,
          concat_ws(' ', usu_nombre, usu_apellido) AS nombre, lower(usu_correo) AS email,
          upper(usu_documento) AS identificacion, usu_telefono AS telefono, usu_creado_en AS creado_en
          FROM usuario WHERE usu_id=ANY($1::bigint[])`, [ids]);
        for (const user of users.rows) {
          const existing = await db.query(`SELECT cli_uuid FROM cliente
            WHERE cli_usuario_id=$1 OR lower(cli_email)=$2 LIMIT 1`, [user.user_id,user.email]);
          if (existing.rows[0]) {
            await db.query(`UPDATE cliente SET cli_usuario_id=COALESCE(cli_usuario_id,$2),
              cli_origenes=ARRAY(SELECT DISTINCT unnest(cli_origenes || ARRAY['TIENDA']::text[])),
              cli_identificacion=COALESCE(cli_identificacion,$3),cli_telefono=COALESCE(cli_telefono,$4),
              cli_actualizado_en=now() WHERE cli_uuid=$1::uuid`,
            [existing.rows[0].cli_uuid,user.user_id,user.identificacion,user.telefono]);
          } else {
            await db.query(`INSERT INTO cliente
              (cli_nombre,cli_email,cli_identificacion,cli_telefono,cli_usuario_id,cli_origenes,cli_creado_en)
              VALUES($1,$2,$3,$4,$5,ARRAY['TIENDA']::text[],$6)`,
            [user.nombre,user.email,user.identificacion,user.telefono,user.user_id,user.creado_en]);
          }
          tiendaCount++;
        }
      }
    }
    await db.query('COMMIT');
    process.stdout.write(`Clientes Booking: ${rows.length}; clientes de tienda: ${tiendaCount}\n`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
} finally {
  await Promise.all([source.end(), target.end(), localIdentity?.end(), localCart?.end()].filter(Boolean));
}
