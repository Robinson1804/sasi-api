-- =============================================================================
-- SASI — Sistema Unificado de Accesos y Servicios Informáticos
-- INEI / OTIN — Base de Datos PostgreSQL v2
-- =============================================================================
-- 15 tablas + 3 vistas + datos semilla (catálogos + usuarios base)
-- Alineado 1:1 con el frontend Next.js (sasi-web)
-- =============================================================================

-- Drop all existing objects for clean reset
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- =============================================================================
-- 1. CATÁLOGOS (sedes, servicios, roles)
-- =============================================================================

CREATE TABLE sedes (
    id          SERIAL       PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    region      VARCHAR(50),
    activo      BOOLEAN      NOT NULL DEFAULT true
);

CREATE TABLE servicios (
    id          SERIAL       PRIMARY KEY,
    codigo      VARCHAR(10)  NOT NULL UNIQUE,          -- c1, c4, c5, c6, c7, c8, c9
    nombre      VARCHAR(150) NOT NULL,
    descripcion TEXT,
    icono       VARCHAR(10),                           -- emoji
    color       VARCHAR(20),                           -- hex
    orden       SMALLINT     NOT NULL DEFAULT 0,
    activo      BOOLEAN      NOT NULL DEFAULT true
);

CREATE TABLE roles (
    id          SERIAL       PRIMARY KEY,
    codigo      VARCHAR(50)  NOT NULL UNIQUE,
    nombre      VARCHAR(100) NOT NULL,
    activo      BOOLEAN      NOT NULL DEFAULT true
);

-- =============================================================================
-- 2. PERSONAL Y USUARIOS
-- =============================================================================

CREATE TABLE personal (
    id                    SERIAL       PRIMARY KEY,
    dni                   CHAR(8)      NOT NULL UNIQUE,
    apellidos             VARCHAR(100) NOT NULL,
    nombres               VARCHAR(100) NOT NULL,
    tipo_vinculo          VARCHAR(30)  NOT NULL
                          CHECK (tipo_vinculo IN (
                              'Nombrado','CAS','Locador','Orden de Servicio','Practicante'
                          )),
    cargo                 VARCHAR(150),
    correo                VARCHAR(100),
    telefono              VARCHAR(20),
    oficina               VARCHAR(200),
    id_sede               INT          REFERENCES sedes(id),
    num_orden_servicio    VARCHAR(50),                  -- solo OS/Locador
    fecha_inicio_contrato DATE,
    fecha_fin_contrato    DATE,
    estado                VARCHAR(20)  NOT NULL DEFAULT 'ACTIVO'
                          CHECK (estado IN ('ACTIVO','INACTIVO','SUSPENDIDO')),
    created_at            TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE usuarios (
    id                SERIAL       PRIMARY KEY,
    id_personal       INT          NOT NULL UNIQUE REFERENCES personal(id),
    password_hash     VARCHAR(255) NOT NULL,
    activo            BOOLEAN      NOT NULL DEFAULT true,
    ultimo_login      TIMESTAMP,
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE usuario_roles (
    id               SERIAL    PRIMARY KEY,
    id_usuario       INT       NOT NULL REFERENCES usuarios(id),
    id_rol           INT       NOT NULL REFERENCES roles(id),
    activo           BOOLEAN   NOT NULL DEFAULT true,
    fecha_asignacion TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (id_usuario, id_rol)
);

-- =============================================================================
-- 3. FLUJO DE APROBACIÓN (configurable por servicio)
-- =============================================================================

CREATE TABLE config_flujo (
    id          SERIAL       PRIMARY KEY,
    id_servicio INT          NOT NULL REFERENCES servicios(id),
    orden       SMALLINT     NOT NULL,
    id_rol      INT          NOT NULL REFERENCES roles(id),
    nombre_etapa VARCHAR(100),
    sla_horas   NUMERIC(5,2) NOT NULL,                 -- horas máximas
    sla_alerta  NUMERIC(5,2) NOT NULL,                 -- horas para alerta previa
    activo      BOOLEAN      NOT NULL DEFAULT true,
    UNIQUE (id_servicio, orden)
);

-- =============================================================================
-- 4. SOLICITUDES
-- =============================================================================

CREATE TABLE solicitudes (
    id                   SERIAL       PRIMARY KEY,
    numero               VARCHAR(20)  NOT NULL UNIQUE,  -- SASI-2026-000001
    id_solicitante       INT          NOT NULL REFERENCES personal(id),
    id_usuario_creador   INT          REFERENCES usuarios(id),
    estado               VARCHAR(30)  NOT NULL DEFAULT 'borrador'
                         CHECK (estado IN (
                             'borrador','enviada','en_proceso',
                             'completada','rechazada','observada','cancelada'
                         )),
    tipo                 VARCHAR(20)  NOT NULL DEFAULT 'individual'
                         CHECK (tipo IN ('individual','masiva')),

    -- Para solicitudes hijas de una masiva
    id_solicitud_padre   INT          REFERENCES solicitudes(id),

    -- Snapshot inmutable del solicitante al enviar
    snap_nombres         VARCHAR(200),
    snap_dni             CHAR(8),
    snap_cargo           VARCHAR(150),
    snap_vinculo         VARCHAR(50),
    snap_correo          VARCHAR(100),
    snap_oficina         VARCHAR(200),
    snap_sede            VARCHAR(100),

    -- Compromiso aceptado (condiciones de uso)
    compromiso_aceptado  BOOLEAN      NOT NULL DEFAULT false,

    -- Fechas
    fecha_creacion       TIMESTAMP    NOT NULL DEFAULT NOW(),
    fecha_envio          TIMESTAMP,
    fecha_cierre         TIMESTAMP,

    -- Cancelación
    motivo_cancelacion   TEXT,

    -- PDF y documento firmado
    pdf_url              VARCHAR(500),
    firmado_url          VARCHAR(500),

    updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 5. SERVICIOS DENTRO DE UNA SOLICITUD
-- Una solicitud puede tener C1 + C4 + C7, etc.
-- Los datos específicos de cada servicio van en JSONB (ver comentarios abajo)
-- =============================================================================

CREATE TABLE solicitud_servicios (
    id             SERIAL       PRIMARY KEY,
    id_solicitud   INT          NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    id_servicio    INT          NOT NULL REFERENCES servicios(id),
    estado         VARCHAR(30)  NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN (
                       'pendiente','en_revision','aprobado',
                       'observado','rechazado','atendido'
                   )),
    -- ══════════════════════════════════════════════════════════════
    -- JSONB `datos` — estructura varía según el servicio:
    --
    -- C1: { tipoOperacion, redSolicitar, redTipoCuenta, redNombreGenerico,
    --        internetSolicitar, internetPerfil, internetRedesSociales,
    --        internetJustificacion, correoSolicitar, correoTipo,
    --        correoCapacidad }
    --
    -- C4: { usuarioRed, direccionIP, correoPersonal, nombreHost,
    --        telefonoContacto, fechaInicio, fechaTermino, justificacion }
    --
    -- C5: { fechaInicio, fechaTermino, justificacion }
    --
    -- C6: { tipoSolicitud(generacion|acceso),
    --        jefeArea, proposito, usuarios[{area,proyecto,dni,nombres,
    --        apellidos,lectura,escritura}],
    --        tipoAcceso, servidor, carpeta, permiso, justificacion }
    --
    -- C7: { tipoSolicitud, servidor, carpeta, nivelPermiso, justificacion }
    --
    -- C8: { servidor, nombreBD, ambiente, tipoAcceso, fechaInicio, fechaFin,
    --        permisoLectura, permisoEscritura, permisoEjecucion, permisoDDL,
    --        objetosEspecificos, justificacion }
    --
    -- C9: { nombreSistema, modulo, fechaAlta, fechaBaja, tipoAcceso,
    --        especificar, sustento, usuarios[{dni,nombresApellidos,cargo,
    --        correo,fechaAlta,fechaBaja,modulo,tipoAcceso,especificar,
    --        sustento}] }
    --
    -- Masiva (justificaciones grupales):
    --   Se almacenan con key 'masiva_c1' o 'masiva_c4' como registros
    --   adicionales en esta misma tabla con datos: { justificacion: "..." }
    -- ══════════════════════════════════════════════════════════════
    datos          JSONB        NOT NULL DEFAULT '{}',
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE (id_solicitud, id_servicio)
);

-- =============================================================================
-- 6. USUARIOS DE SOLICITUD MASIVA
-- Personas que aún no tienen cuenta — sus datos se capturan en el formulario
-- =============================================================================

CREATE TABLE usuarios_masivos (
    id                  SERIAL       PRIMARY KEY,
    id_solicitud        INT          NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
    dni                 CHAR(8)      NOT NULL,
    nombres             VARCHAR(100) NOT NULL,
    apellidos           VARCHAR(100) NOT NULL,
    cargo               VARCHAR(150),

    -- Campos C1 (si C1 fue seleccionado)
    internet_perfil     VARCHAR(5),                    -- '1','2','3','4','5'

    -- Campos C4 (si C4 fue seleccionado)
    correo_personal     VARCHAR(100),
    telefono_contacto   VARCHAR(20),
    nombre_host         VARCHAR(100),

    -- Referencia a solicitud hija generada (se llena al procesar)
    id_solicitud_hija   INT          REFERENCES solicitudes(id),

    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE (id_solicitud, dni)
);

-- =============================================================================
-- 7. ETAPAS DE APROBACIÓN
-- =============================================================================

CREATE TABLE etapas_aprobacion (
    id                    SERIAL       PRIMARY KEY,
    id_solicitud_servicio INT          NOT NULL REFERENCES solicitud_servicios(id) ON DELETE CASCADE,
    id_config             INT          REFERENCES config_flujo(id),
    orden                 SMALLINT     NOT NULL,
    id_rol                INT          NOT NULL REFERENCES roles(id),
    id_aprobador          INT          REFERENCES usuarios(id),
    estado                VARCHAR(30)  NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN (
                              'pendiente','en_revision','aprobado',
                              'observado','rechazado','atendido'
                          )),
    comentario            TEXT,
    fecha_inicio          TIMESTAMP    NOT NULL DEFAULT NOW(),
    fecha_accion          TIMESTAMP,
    horas_transcurridas   NUMERIC(6,2),
    sla_horas             NUMERIC(5,2),
    vencio_sla            BOOLEAN      NOT NULL DEFAULT false,
    alerta_enviada        BOOLEAN      NOT NULL DEFAULT false
);

-- =============================================================================
-- 8. HISTORIAL (append-only, nunca se modifica)
-- =============================================================================

CREATE TABLE historial (
    id                    BIGSERIAL    PRIMARY KEY,
    id_solicitud          INT          NOT NULL REFERENCES solicitudes(id),
    id_solicitud_servicio INT          REFERENCES solicitud_servicios(id),
    tipo_evento           VARCHAR(50)  NOT NULL,
    -- CREACION, ENVIO, APROBACION, OBSERVACION, RECHAZO, ATENCION,
    -- CANCELACION, REASIGNACION, SLA_VENCIDO
    estado_nuevo          VARCHAR(30)  NOT NULL,
    comentario            TEXT,
    id_usuario            INT          REFERENCES usuarios(id),
    usuario_nombre        VARCHAR(200),                -- denormalizado para lectura rápida
    created_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 9. DOCUMENTOS (PDF generado + firmado subido)
-- =============================================================================

CREATE TABLE documentos (
    id              SERIAL       PRIMARY KEY,
    id_solicitud    INT          NOT NULL REFERENCES solicitudes(id),
    tipo            VARCHAR(30)  NOT NULL
                    CHECK (tipo IN ('solicitud_pdf','firmado_usuario')),
    nombre_archivo  VARCHAR(255) NOT NULL,
    url             VARCHAR(500) NOT NULL,
    tamano_bytes    BIGINT,
    id_usuario_subio INT         REFERENCES usuarios(id),
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 10. NOTIFICACIONES
-- =============================================================================

CREATE TABLE notificaciones (
    id                  BIGSERIAL    PRIMARY KEY,
    id_solicitud        INT          REFERENCES solicitudes(id),
    id_personal_destino INT          NOT NULL REFERENCES personal(id),
    tipo                VARCHAR(50)  NOT NULL,
    -- solicitud_recibida, pendiente_aprobacion, aprobada, observada,
    -- rechazada, completada, sla_alerta, sla_vencido
    asunto              VARCHAR(200),
    cuerpo              TEXT,
    leida               BOOLEAN      NOT NULL DEFAULT false,
    fecha_lectura       TIMESTAMP,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 11. AUDITORÍA (append-only)
-- =============================================================================

CREATE TABLE auditoria (
    id             BIGSERIAL    PRIMARY KEY,
    id_usuario     INT          REFERENCES usuarios(id),
    accion         VARCHAR(100) NOT NULL,
    tabla_afectada VARCHAR(100),
    id_registro    VARCHAR(50),
    datos_antes    JSONB,
    datos_despues  JSONB,
    ip             VARCHAR(45),
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ÍNDICES
-- =============================================================================

-- personal
CREATE INDEX idx_personal_dni            ON personal (dni);
CREATE INDEX idx_personal_estado         ON personal (estado);
CREATE INDEX idx_personal_sede           ON personal (id_sede);

-- usuarios
CREATE INDEX idx_usuarios_activo         ON usuarios (activo);

-- usuario_roles
CREATE INDEX idx_uroles_usuario_activo   ON usuario_roles (id_usuario, activo);
CREATE INDEX idx_uroles_rol              ON usuario_roles (id_rol);

-- solicitudes
CREATE INDEX idx_sol_solicitante         ON solicitudes (id_solicitante);
CREATE INDEX idx_sol_estado              ON solicitudes (estado);
CREATE INDEX idx_sol_fecha               ON solicitudes (fecha_creacion DESC);
CREATE INDEX idx_sol_padre               ON solicitudes (id_solicitud_padre)
                                         WHERE id_solicitud_padre IS NOT NULL;
CREATE INDEX idx_sol_tipo                ON solicitudes (tipo);

-- solicitud_servicios
CREATE INDEX idx_ss_solicitud            ON solicitud_servicios (id_solicitud);
CREATE INDEX idx_ss_servicio_estado      ON solicitud_servicios (id_servicio, estado);

-- etapas_aprobacion
CREATE INDEX idx_etapas_ss               ON etapas_aprobacion (id_solicitud_servicio);
CREATE INDEX idx_etapas_rol_estado       ON etapas_aprobacion (id_rol, estado);
CREATE INDEX idx_etapas_aprobador        ON etapas_aprobacion (id_aprobador)
                                         WHERE id_aprobador IS NOT NULL;
CREATE INDEX idx_etapas_sla_vencido      ON etapas_aprobacion (vencio_sla)
                                         WHERE vencio_sla = true;

-- historial
CREATE INDEX idx_historial_solicitud     ON historial (id_solicitud, created_at DESC);

-- notificaciones
CREATE INDEX idx_notif_destino_leida     ON notificaciones (id_personal_destino, leida);
CREATE INDEX idx_notif_solicitud         ON notificaciones (id_solicitud);

-- usuarios_masivos
CREATE INDEX idx_umasivos_solicitud      ON usuarios_masivos (id_solicitud);

-- documentos
CREATE INDEX idx_docs_solicitud          ON documentos (id_solicitud);

-- auditoria
CREATE INDEX idx_audit_usuario           ON auditoria (id_usuario, created_at DESC);

-- =============================================================================
-- VISTAS — Consultas frecuentes del frontend
-- =============================================================================

-- Vista: "Mis Solicitudes" del portal usuario
CREATE OR REPLACE VIEW v_mis_solicitudes AS
SELECT
    s.id,
    s.numero,
    s.estado,
    s.tipo,
    s.fecha_creacion,
    s.fecha_envio,
    s.fecha_cierre,
    s.id_solicitante,
    s.snap_nombres,
    s.snap_dni,
    s.snap_oficina,
    s.snap_sede,
    -- Servicios como array de códigos
    ARRAY_AGG(DISTINCT sv.codigo ORDER BY sv.codigo) AS servicios_codigos,
    ARRAY_AGG(DISTINCT sv.nombre ORDER BY sv.nombre) AS servicios_nombres,
    -- Etapa activa (trazabilidad)
    (
        SELECT json_build_object(
            'rol', r.nombre,
            'aprobador', pa.nombres || ' ' || pa.apellidos,
            'horas', ea.horas_transcurridas
        )
        FROM etapas_aprobacion ea
        JOIN solicitud_servicios ss2 ON ea.id_solicitud_servicio = ss2.id
        JOIN roles r ON ea.id_rol = r.id
        LEFT JOIN usuarios ua ON ea.id_aprobador = ua.id
        LEFT JOIN personal pa ON ua.id_personal = pa.id
        WHERE ss2.id_solicitud = s.id
          AND ea.estado = 'en_revision'
        ORDER BY ea.orden
        LIMIT 1
    ) AS etapa_activa
FROM solicitudes s
JOIN solicitud_servicios ss ON ss.id_solicitud = s.id
JOIN servicios sv ON ss.id_servicio = sv.id
WHERE s.id_solicitud_padre IS NULL                     -- excluir hijas de masiva
GROUP BY s.id;

-- Vista: Bandeja de aprobación (para roles aprobadores)
CREATE OR REPLACE VIEW v_bandeja_aprobacion AS
SELECT
    ea.id AS etapa_id,
    s.id AS solicitud_id,
    s.numero,
    s.snap_nombres AS solicitante,
    s.snap_sede AS sede,
    s.tipo,
    ea.id_rol,
    r.codigo AS rol_codigo,
    r.nombre AS rol_nombre,
    ea.estado AS etapa_estado,
    ea.fecha_inicio,
    ea.sla_horas,
    ea.horas_transcurridas,
    ea.vencio_sla,
    -- Servicios de la solicitud
    ARRAY_AGG(DISTINCT sv.codigo) AS servicios_codigos,
    -- Horas restantes SLA
    GREATEST(0, ea.sla_horas - COALESCE(ea.horas_transcurridas,
        EXTRACT(EPOCH FROM (NOW() - ea.fecha_inicio)) / 3600
    )) AS horas_restantes_sla
FROM etapas_aprobacion ea
JOIN solicitud_servicios ss ON ea.id_solicitud_servicio = ss.id
JOIN solicitudes s ON ss.id_solicitud = s.id
JOIN servicios sv ON ss.id_servicio = sv.id
JOIN roles r ON ea.id_rol = r.id
WHERE ea.estado IN ('pendiente', 'en_revision')
GROUP BY ea.id, s.id, r.id;

-- Vista: Dashboard admin — KPIs
CREATE OR REPLACE VIEW v_dashboard_kpis AS
SELECT
    COUNT(*) FILTER (WHERE estado IN ('enviada','en_proceso'))        AS solicitudes_activas,
    COUNT(*) FILTER (WHERE estado = 'completada'
                     AND fecha_cierre >= DATE_TRUNC('month', NOW()))  AS completadas_mes,
    COUNT(*) FILTER (WHERE estado = 'rechazada'
                     AND fecha_cierre >= DATE_TRUNC('month', NOW()))  AS rechazadas_mes,
    (SELECT COUNT(*) FROM etapas_aprobacion
     WHERE vencio_sla = true
       AND estado IN ('pendiente','en_revision'))                    AS sla_vencidos,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE estado = 'completada')
        / NULLIF(COUNT(*) FILTER (WHERE estado IN ('completada','rechazada')), 0)
    , 1)                                                             AS tasa_aprobacion,
    (SELECT ROUND(AVG(
        EXTRACT(EPOCH FROM (fecha_cierre - fecha_envio)) / 3600
     ), 1)
     FROM solicitudes
     WHERE fecha_cierre IS NOT NULL
       AND fecha_envio IS NOT NULL
       AND fecha_cierre >= DATE_TRUNC('month', NOW()))               AS tiempo_promedio_horas
FROM solicitudes
WHERE id_solicitud_padre IS NULL;

-- =============================================================================
-- FUNCIÓN: Generar número de solicitud
-- =============================================================================

CREATE OR REPLACE FUNCTION generar_numero_solicitud()
RETURNS VARCHAR(20) AS $$
DECLARE
    anio TEXT;
    seq INT;
BEGIN
    anio := EXTRACT(YEAR FROM NOW())::TEXT;
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(numero FROM 10) AS INT)
    ), 0) + 1
    INTO seq
    FROM solicitudes
    WHERE numero LIKE 'SASI-' || anio || '-%';

    RETURN 'SASI-' || anio || '-' || LPAD(seq::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- FUNCIÓN: Calcular horas transcurridas (para job/trigger)
-- =============================================================================

CREATE OR REPLACE FUNCTION actualizar_horas_etapas()
RETURNS void AS $$
BEGIN
    UPDATE etapas_aprobacion
    SET horas_transcurridas = ROUND(
            EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600, 2
        ),
        vencio_sla = CASE
            WHEN sla_horas IS NOT NULL
             AND EXTRACT(EPOCH FROM (NOW() - fecha_inicio)) / 3600 > sla_horas
            THEN true
            ELSE vencio_sla
        END
    WHERE estado IN ('pendiente', 'en_revision')
      AND fecha_accion IS NULL;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TRIGGER: updated_at automático
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_personal_updated     BEFORE UPDATE ON personal            FOR EACH ROW EXECUTE FUNCTION trigger_updated_at();
CREATE TRIGGER trg_usuarios_updated     BEFORE UPDATE ON usuarios            FOR EACH ROW EXECUTE FUNCTION trigger_updated_at();
CREATE TRIGGER trg_solicitudes_updated  BEFORE UPDATE ON solicitudes         FOR EACH ROW EXECUTE FUNCTION trigger_updated_at();
CREATE TRIGGER trg_sol_serv_updated     BEFORE UPDATE ON solicitud_servicios FOR EACH ROW EXECUTE FUNCTION trigger_updated_at();

-- =============================================================================
-- DATOS SEMILLA — CATÁLOGOS
-- =============================================================================

INSERT INTO sedes (nombre, region) VALUES
    ('Lima - Sede Central', 'Lima'),
    ('Arequipa',            'Arequipa'),
    ('Trujillo',            'La Libertad'),
    ('Chiclayo',            'Lambayeque'),
    ('Cusco',               'Cusco'),
    ('Iquitos',             'Loreto'),
    ('Huancayo',            'Junín'),
    ('Piura',               'Piura');

INSERT INTO servicios (codigo, nombre, descripcion, icono, color, orden) VALUES
    ('c1', 'Cuenta de Red / Internet / Correo',
     'Creación o modificación de cuenta de red, acceso a Internet y correo institucional',
     '🖧', '#6c8aff', 1),
    ('c4', 'Acceso Remoto (VPN)',
     'Habilitación de acceso VPN a la red institucional desde ubicaciones externas',
     '🔗', '#fb923c', 2),
    ('c5', 'Desbloqueo de USB',
     'Habilitación temporal del puerto USB en el equipo del usuario',
     '🔌', '#f59e0b', 3),
    ('c6', 'Carpeta FTP',
     'Generación o acceso a carpetas FTP en servidores del INEI',
     '📁', '#fbbf24', 4),
    ('c7', 'Recursos Compartidos',
     'Acceso a carpetas compartidas en red con niveles de permiso',
     '📂', '#2dd4bf', 5),
    ('c8', 'Base de Datos',
     'Acceso a bases de datos del INEI con los permisos requeridos',
     '🗄️', '#ec4899', 6),
    ('c9', 'Sistemas / Aplicativos',
     'Acceso a sistemas y aplicativos internos del INEI',
     '⚙️', '#818cf8', 7);

INSERT INTO roles (codigo, nombre) VALUES
    ('usuario_solicitante',  'Usuario Solicitante'),
    ('coordinador_proyecto', 'Coordinador de Proyecto'),
    ('seguridad_accesos',    'Seguridad de Accesos'),
    ('equipo_redes',         'Equipo de Redes'),
    ('dba',                  'Administrador de Base de Datos'),
    ('soporte_tecnico',      'Soporte Técnico'),
    ('jefe_supervisor',      'Jefe / Supervisor'),
    ('administrador_sasi',   'Administrador SASI');

-- Flujos de aprobación:
-- C1, C4, C5 → Seguridad (24h) → Redes (8h)
-- C6, C7     → Redes directo (8h)
-- C8         → DBA directo (48h)
-- C9         → Soporte deriva (4h)

INSERT INTO config_flujo (id_servicio, orden, id_rol, nombre_etapa, sla_horas, sla_alerta)
VALUES
    -- C1
    ((SELECT id FROM servicios WHERE codigo='c1'), 1,
     (SELECT id FROM roles WHERE codigo='seguridad_accesos'),
     'Revisión Seguridad', 24, 16),
    ((SELECT id FROM servicios WHERE codigo='c1'), 2,
     (SELECT id FROM roles WHERE codigo='equipo_redes'),
     'Ejecución Redes', 8, 6),
    -- C4
    ((SELECT id FROM servicios WHERE codigo='c4'), 1,
     (SELECT id FROM roles WHERE codigo='seguridad_accesos'),
     'Revisión Seguridad', 24, 16),
    ((SELECT id FROM servicios WHERE codigo='c4'), 2,
     (SELECT id FROM roles WHERE codigo='equipo_redes'),
     'Ejecución Redes', 8, 6),
    -- C5
    ((SELECT id FROM servicios WHERE codigo='c5'), 1,
     (SELECT id FROM roles WHERE codigo='seguridad_accesos'),
     'Revisión Seguridad', 24, 16),
    ((SELECT id FROM servicios WHERE codigo='c5'), 2,
     (SELECT id FROM roles WHERE codigo='equipo_redes'),
     'Ejecución Redes', 8, 6),
    -- C6
    ((SELECT id FROM servicios WHERE codigo='c6'), 1,
     (SELECT id FROM roles WHERE codigo='equipo_redes'),
     'Configuración Redes', 8, 6),
    -- C7
    ((SELECT id FROM servicios WHERE codigo='c7'), 1,
     (SELECT id FROM roles WHERE codigo='equipo_redes'),
     'Configuración Redes', 8, 6),
    -- C8
    ((SELECT id FROM servicios WHERE codigo='c8'), 1,
     (SELECT id FROM roles WHERE codigo='dba'),
     'Revisión DBA', 48, 36),
    -- C9
    ((SELECT id FROM servicios WHERE codigo='c9'), 1,
     (SELECT id FROM roles WHERE codigo='soporte_tecnico'),
     'Derivación Soporte', 4, 3);

-- =============================================================================
-- DATOS SEMILLA — USUARIOS BASE
-- =============================================================================
-- Passwords: hash placeholder (se corrige al iniciar con bcrypt(dni))

INSERT INTO personal (dni, apellidos, nombres, tipo_vinculo, cargo, correo, telefono, oficina, id_sede, fecha_inicio_contrato, fecha_fin_contrato, estado)
VALUES
    ('12345678', 'Ramírez', 'Juan', 'CAS',
     'Analista TI', 'jramirez@inei.gob.pe', '2345',
     'Oficina Técnica de Informática',
     (SELECT id FROM sedes WHERE nombre='Lima - Sede Central'),
     '2026-01-01', '2026-12-31', 'ACTIVO'),

    ('99999999', 'Castro', 'Roberto', 'Nombrado',
     'Jefe OTIN', 'rcastro@inei.gob.pe', '1001',
     'Oficina Técnica de Informática',
     (SELECT id FROM sedes WHERE nombre='Lima - Sede Central'),
     '2020-01-01', NULL, 'ACTIVO'),

    ('88888888', 'Ávila', 'Mario', 'Nombrado',
     'Especialista en Seguridad', 'mavila@inei.gob.pe', '1050',
     'Oficina Técnica de Informática',
     (SELECT id FROM sedes WHERE nombre='Lima - Sede Central'),
     '2021-03-01', NULL, 'ACTIVO');

-- Usuarios (login) — password placeholder (se corrige al iniciar)
INSERT INTO usuarios (id_personal, password_hash, activo)
SELECT id, '$2b$10$placeholder.hash.sasi2026.para.desarrollo', true
FROM personal WHERE dni IN ('12345678', '99999999', '88888888');

-- Asignar roles
-- Juan (12345678) → solicitante
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id, r.id FROM usuarios u
JOIN personal p ON u.id_personal = p.id
CROSS JOIN roles r
WHERE p.dni = '12345678' AND r.codigo = 'usuario_solicitante';

-- Roberto (99999999) → admin + jefe
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id, r.id FROM usuarios u
JOIN personal p ON u.id_personal = p.id
CROSS JOIN roles r
WHERE p.dni = '99999999' AND r.codigo IN ('administrador_sasi', 'jefe_supervisor');

-- Mario (88888888) → seguridad
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id, r.id FROM usuarios u
JOIN personal p ON u.id_personal = p.id
CROSS JOIN roles r
WHERE p.dni = '88888888' AND r.codigo = 'seguridad_accesos';

-- =============================================================================
-- FIN
-- =============================================================================
