const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ok, error } = require('../../utils/response');
const { registrarAuditoria } = require('../../utils/audit');
const {
  findUsuarioByDni,
  findRolesByUsuarioId,
  updateUltimoLogin,
  findUsuarioById,
  updatePasswordHash,
} = require('./auth.queries');

async function login(req, res) {
  try {
    const dni = String(req.body.dni || '').trim();
    const { password } = req.body;

    if (!/^\d{8}$/.test(dni)) {
      return error(res, 400, 'El DNI debe tener exactamente 8 dígitos');
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
    await registrarAuditoria(
      user.id,
      'LOGIN',
      'usuarios',
      user.id,
      null,
      {
        dni: user.dni,
        evento: 'Inicio de sesión exitoso',
      },
      req.ip
    );

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

    return ok(res, {
      token,
      usuario,
      rol: roles[0] || null,
      roles,
    });
  } catch (err) {
    console.error('auth.login:', err);
    return error(res, 500, 'Error interno en el inicio de sesión');
  }
}

async function logout(req, res) {
  try {
    await registrarAuditoria(
      req.user.id,
      'LOGOUT',
      'usuarios',
      req.user.id,
      null,
      {
        dni: req.user.dni,
        evento: 'Cierre de sesión',
      },
      req.ip
    );

    return ok(res, { message: 'Sesión cerrada correctamente' });
  } catch (err) {
    console.error('auth.logout:', err);
    return error(res, 500, 'Error interno al cerrar sesión');
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword) {
      return error(res, 400, 'La contraseña actual es obligatoria');
    }

    if (!newPassword) {
      return error(res, 400, 'La nueva contraseña es obligatoria');
    }

    if (!confirmPassword) {
      return error(res, 400, 'Debe confirmar la nueva contraseña');
    }

    if (newPassword !== confirmPassword) {
      return error(res, 400, 'La confirmación no coincide con la nueva contraseña');
    }

    if (newPassword.length < 8) {
      return error(res, 400, 'La nueva contraseña debe tener al menos 8 caracteres');
    }

    if (newPassword === currentPassword) {
      return error(res, 400, 'La nueva contraseña debe ser diferente a la actual');
    }

    const user = await findUsuarioById(req.user.id);

    if (!user || !user.activo) {
      return error(res, 401, 'Usuario no válido o inactivo');
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);

    if (!match) {
      return error(res, 401, 'La contraseña actual es incorrecta');
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await updatePasswordHash(user.id, newHash);

    await registrarAuditoria(
      user.id,
      'CAMBIO_PASSWORD',
      'usuarios',
      user.id,
      null,
      {
        dni: user.dni,
        evento: 'Cambio de contraseña realizado',
      },
      req.ip
    );

    return ok(res, {
      message: 'Contraseña actualizada correctamente',
    });
  } catch (err) {
    console.error('auth.changePassword:', err);
    return error(res, 500, 'Error interno al cambiar la contraseña');
  }
}

module.exports = {
  login,
  logout,
  changePassword,
};