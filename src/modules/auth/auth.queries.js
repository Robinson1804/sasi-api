const { query } = require('../../config/db');

const SQL_FIND_USUARIO_BY_DNI = `
  SELECT u.id, u.password_hash, u.activo,
         p.id AS id_personal, p.dni, p.apellidos, p.nombres,
         p.tipo_vinculo, p.cargo, p.correo, p.telefono, p.oficina,
         s.nombre AS sede,
         p.num_orden_servicio, p.fecha_inicio_contrato,
         p.fecha_fin_contrato, p.estado
    FROM usuarios u
    JOIN personal p ON u.id_personal = p.id
    LEFT JOIN sedes s ON p.id_sede = s.id
   WHERE p.dni = $1
`;

const SQL_FIND_ROLES_BY_USUARIO = `
  SELECT r.codigo
    FROM usuario_roles ur
    JOIN roles r ON ur.id_rol = r.id
   WHERE ur.id_usuario = $1
     AND ur.activo = true
`;

const SQL_UPDATE_ULTIMO_LOGIN = `
  UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1
`;

async function findUsuarioByDni(dni) {
  const { rows } = await query(SQL_FIND_USUARIO_BY_DNI, [dni]);
  return rows[0] || null;
}

async function findRolesByUsuarioId(usuarioId) {
  const { rows } = await query(SQL_FIND_ROLES_BY_USUARIO, [usuarioId]);
  return rows.map((r) => r.codigo);
}

async function updateUltimoLogin(usuarioId) {
  await query(SQL_UPDATE_ULTIMO_LOGIN, [usuarioId]);
}

module.exports = {
  findUsuarioByDni,
  findRolesByUsuarioId,
  updateUltimoLogin,
};
