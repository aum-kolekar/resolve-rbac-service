exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('permissions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'varchar(64)', notNull: true, unique: true },
    description: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('roles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    organization_id: { type: 'uuid', notNull: false }, // NULL = global system role
    name: { type: 'varchar(100)', notNull: true },
    description: { type: 'text' },
    is_system_role: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // A plain UNIQUE(organization_id, name) constraint would NOT catch
  // duplicate global system roles: Postgres treats every NULL as distinct
  // for uniqueness purposes, so two rows with organization_id = NULL and
  // the same name would never conflict. Two partial unique indexes instead:
  // one scoped to global roles (organization_id IS NULL), one scoped to
  // tenant-owned roles (organization_id IS NOT NULL).
  pgm.createIndex('roles', 'name', {
    unique: true,
    where: 'organization_id IS NULL',
    name: 'roles_global_name_unique',
  });
  pgm.createIndex('roles', ['organization_id', 'name'], {
    unique: true,
    where: 'organization_id IS NOT NULL',
    name: 'roles_org_name_unique',
  });
  pgm.createIndex('roles', 'organization_id');

  pgm.createTable('role_permissions', {
    role_id: {
      type: 'uuid',
      notNull: true,
      references: 'roles',
      onDelete: 'CASCADE',
    },
    permission_id: {
      type: 'uuid',
      notNull: true,
      references: 'permissions',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('role_permissions', 'role_permissions_pkey', {
    primaryKey: ['role_id', 'permission_id'],
  });

  pgm.createTable('user_roles', {
    user_id: { type: 'uuid', notNull: true }, // not a real FK - cross-service reference
    organization_id: { type: 'uuid', notNull: true },
    role_id: {
      type: 'uuid',
      notNull: true,
      references: 'roles',
      onDelete: 'CASCADE',
    },
    assigned_by: { type: 'uuid', notNull: false },
    assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('user_roles', 'user_roles_pkey', {
    primaryKey: ['user_id', 'organization_id', 'role_id'],
  });
  pgm.createIndex('user_roles', ['organization_id', 'user_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('user_roles');
  pgm.dropTable('role_permissions');
  pgm.dropTable('roles');
  pgm.dropTable('permissions');
};
