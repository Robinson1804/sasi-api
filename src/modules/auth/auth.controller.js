const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ok, error } = require('../../utils/response');
const { registrarAuditoria } = require('../../utils/audit');
const {
  findUsuarioByDni,
  findRolesByUsuarioId,
  updateUltimoLogin,
} = require('./auth.queries');

async function login(req, res) {
  try {
    const { dni, password } = req.body;

    // --- validaciones ---
    if (!dni || String(dni).length !== 8) {
      return error(res, 400, 'El DNI es obligatorio y debe tener 8 caracteres');
    }
    if (!password) {
      return error(res, 400, 'La contraseña es obligatoria');
    }

    // --- buscar usuario ---
    const user = await findUsuarioByDni(dni);

    if (!user || !user.activo) {
      return error(res, 401, 'Credenciales inválidas');
    }

    // --- verificar contraseña ---
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return error(res, 401, 'Credenciales inválidas');
    }

    // --- roles ---
    const roles = await findRolesByUsuarioId(user.id);

    // --- generar JWT ---
    const payload = {
      id: user.id,
      idPersonal: user.id_personal,
      dni: user.dni,
      rol: roles[0] || null,
      roles,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });

    // --- actualizar ultimo_login ---
    await updateUltimoLogin(user.id);

    // --- auditoría ---
    await registrarAuditoria({
      idUsuario: user.id,
      accion: 'LOGIN',
      detalle: `Inicio de sesión exitoso — DNI ${user.dni}`,
    });

    // --- respuesta (snake_case → camelCase) ---
    const usuario = {
      id: user.id,
      dni: user.dni,
      apellidos: user.apellidos,
      nombres: user.nombres,
      tipoVinculo: user.tipo_vinculo,
      cargo: user.cargo,
      correo: user.correo,
      telefono: user.telefono,
      oficina: user.oficina,
      sede: user.sede,
      numOrdenServicio: user.num_orden_servicio,
      fechaInicioContrato: user.fecha_inicio_contrato,
      fechaFinContrato: user.fecha_fin_contrato,
      estado: user.estado,
    };

    return ok(res, { token, usuario, rol: roles[0] || null, roles });
  } catch (err) {
    console.error('auth.login:', err);
    return error(res, 500, 'Error interno en el inicio de sesión');
  }
}

async function logout(req, res) {
  try {
    await registrarAuditoria({
      idUsuario: req.user.id,
      accion: 'LOGOUT',
      detalle: 'Cierre de sesión',
    });

    return ok(res, { message: 'Sesión cerrada correctamente' });
  } catch (err) {
    console.error('auth.logout:', err);
    return error(res, 500, 'Error interno al cerrar sesión');
  }
}

module.exports = { login, logout };
