-- =============================================================================
-- SASI — Seed.sql
-- Datos semilla base: roles, servicios, sedes y flujo de aprobación activo
-- =============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- =============================================================================
-- ROLES
-- =============================================================================

INSERT INTO public.roles (id, codigo, nombre, activo)
VALUES
  (1, 'usuario_solicitante',  'Usuario Solicitante', true),
  (2, 'coordinador_proyecto', 'Coordinador de Proyecto', true),
  (3, 'seguridad_accesos',    'Seguridad de Accesos', true),
  (4, 'equipo_redes',         'Equipo de Redes', true),
  (5, 'dba',                  'Administrador de Base de Datos', true),
  (6, 'soporte_tecnico',      'Soporte Técnico', true),
  (7, 'jefe_supervisor',      'Jefe / Supervisor', true),
  (8, 'administrador_sasi',   'Administrador SASI', true)
ON CONFLICT (id) DO UPDATE SET
  codigo = EXCLUDED.codigo,
  nombre = EXCLUDED.nombre,
  activo = EXCLUDED.activo;

-- =============================================================================
-- SERVICIOS
-- =============================================================================

INSERT INTO public.servicios (id, codigo, nombre, descripcion, icono, color, orden, activo)
VALUES
  (
    1,
    'c1',
    'Cuenta de Red / Internet / Correo',
    'Creación o modificación de cuenta de red, acceso a Internet y correo institucional',
    '🖧',
    '#6c8aff',
    1,
    true
  ),
  (
    2,
    'c4',
    'Acceso Remoto (VPN)',
    'Habilitación de acceso VPN a la red institucional desde ubicaciones externas',
    '🔗',
    '#fb923c',
    2,
    true
  ),
  (
    3,
    'c5',
    'Desbloqueo de USB',
    'Habilitación temporal del puerto USB en el equipo del usuario',
    '🔌',
    '#f59e0b',
    3,
    true
  ),
  (
    4,
    'c6',
    'Carpeta FTP',
    'Generación o acceso a carpetas FTP en servidores del INEI',
    '📁',
    '#fbbf24',
    4,
    true
  ),
  (
    5,
    'c7',
    'Recursos Compartidos',
    'Acceso a carpetas compartidas en red con niveles de permiso',
    '📂',
    '#2dd4bf',
    5,
    true
  ),
  (
    6,
    'c8',
    'Base de Datos',
    'Acceso a bases de datos del INEI con los permisos requeridos',
    '🗄️',
    '#ec4899',
    6,
    true
  ),
  (
    7,
    'c9',
    'Sistemas / Aplicativos',
    'Acceso a sistemas y aplicativos internos del INEI',
    '⚙️',
    '#818cf8',
    7,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  codigo = EXCLUDED.codigo,
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  icono = EXCLUDED.icono,
  color = EXCLUDED.color,
  orden = EXCLUDED.orden,
  activo = EXCLUDED.activo;

-- =============================================================================
-- SEDES
-- =============================================================================

INSERT INTO public.sedes (id, nombre, region, activo)
VALUES
  (1, 'Lima - Sede Central', 'Lima', true),
  (2, 'Arequipa', 'Arequipa', true),
  (3, 'Trujillo', 'La Libertad', true),
  (4, 'Chiclayo', 'Lambayeque', true),
  (5, 'Cusco', 'Cusco', true),
  (6, 'Iquitos', 'Loreto', true),
  (7, 'Huancayo', 'Junín', true),
  (8, 'Piura', 'Piura', true)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  region = EXCLUDED.region,
  activo = EXCLUDED.activo;

-- =============================================================================
-- CONFIGURACIÓN DE FLUJO ACTIVA
-- =============================================================================
-- Convención actual:
-- orden 0 : Validación inicial / atención inicial
-- orden 1 : Revisión de área especializada
-- orden 2 : Ejecución técnica
-- orden 3 : Cierre soporte

INSERT INTO public.config_flujo
  (id, id_servicio, orden, id_rol, nombre_etapa, sla_horas, sla_alerta, activo)
VALUES
  -- C1: Cuenta de Red / Internet / Correo
  (17, 1, 0, 6, 'Validación inicial Soporte', 4.00, 3.00, true),
  (18, 1, 1, 3, 'Revisión Seguridad', 24.00, 16.00, true),
  (19, 1, 2, 4, 'Ejecución Redes', 8.00, 6.00, true),
  (20, 1, 3, 6, 'Cierre Soporte', 4.00, 3.00, true),

  -- C4: Acceso Remoto VPN
  (21, 2, 0, 6, 'Validación inicial Soporte', 4.00, 3.00, true),
  (22, 2, 1, 3, 'Revisión Seguridad', 24.00, 16.00, true),
  (23, 2, 2, 4, 'Ejecución Redes', 8.00, 6.00, true),
  (24, 2, 3, 6, 'Cierre Soporte', 4.00, 3.00, true),

  -- C5: Desbloqueo de USB
  (25, 3, 0, 6, 'Validación inicial Soporte', 4.00, 3.00, true),
  (26, 3, 1, 3, 'Revisión Seguridad', 24.00, 16.00, true),
  (27, 3, 2, 4, 'Ejecución Redes', 8.00, 6.00, true),
  (28, 3, 3, 6, 'Cierre Soporte', 4.00, 3.00, true),

  -- C6: Carpeta FTP
  (29, 4, 0, 6, 'Validación inicial Soporte', 4.00, 3.00, true),
  (30, 4, 1, 3, 'Revisión Seguridad', 24.00, 16.00, true),
  (31, 4, 2, 4, 'Configuración Redes', 8.00, 6.00, true),
  (32, 4, 3, 6, 'Cierre Soporte', 4.00, 3.00, true),

  -- C7: Recursos Compartidos
  (33, 5, 0, 6, 'Atención Soporte', 8.00, 6.00, true),

  -- C8: Base de Datos
  (34, 6, 0, 6, 'Validación inicial Soporte', 4.00, 3.00, true),
  (35, 6, 1, 5, 'Revisión DBA', 48.00, 36.00, true),
  (36, 6, 2, 6, 'Cierre Soporte', 4.00, 3.00, true),

  -- C9: Sistemas / Aplicativos
  (37, 7, 0, 6, 'Gestión Soporte', 8.00, 6.00, true)
ON CONFLICT (id) DO UPDATE SET
  id_servicio = EXCLUDED.id_servicio,
  orden = EXCLUDED.orden,
  id_rol = EXCLUDED.id_rol,
  nombre_etapa = EXCLUDED.nombre_etapa,
  sla_horas = EXCLUDED.sla_horas,
  sla_alerta = EXCLUDED.sla_alerta,
  activo = EXCLUDED.activo;

-- =============================================================================
-- AJUSTE DE SECUENCIAS
-- =============================================================================

SELECT pg_catalog.setval('public.roles_id_seq', 8, true);
SELECT pg_catalog.setval('public.servicios_id_seq', 7, true);
SELECT pg_catalog.setval('public.sedes_id_seq', 8, true);
SELECT pg_catalog.setval('public.config_flujo_id_seq', 37, true);

-- =============================================================================
-- FIN
-- =============================================================================