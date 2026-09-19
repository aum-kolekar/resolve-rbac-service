describe('seeded permission catalog (Contract §9)', () => {
  let pool;

  beforeAll(() => {
    pool = require('../../src/db/pool').getPool();
  });

  afterAll(async () => {
    await require('../../src/db/pool').closePool();
  });

  it('seeds exactly the 24 documented permission codes', async () => {
    const { rows } = await pool.query('SELECT code FROM permissions ORDER BY code');
    expect(rows).toHaveLength(24);
    expect(rows.map((r) => r.code)).toContain('AUTH_SETTINGS_MANAGE');
    expect(rows.map((r) => r.code)).toContain('ROLE_MANAGE');
  });

  it('ORG_ADMIN holds every permission, CASE_MANAGER holds only its documented subset', async () => {
    const { rows: orgAdminPerms } = await pool.query(
      `SELECT p.code FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.name = 'ORG_ADMIN'`,
    );
    const { rows: caseManagerPerms } = await pool.query(
      `SELECT p.code FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.name = 'CASE_MANAGER'`,
    );

    expect(orgAdminPerms).toHaveLength(24);
    expect(caseManagerPerms.map((r) => r.code)).toContain('CASE_APPROVE');
    expect(caseManagerPerms.map((r) => r.code)).not.toContain('ROLE_MANAGE');
    expect(caseManagerPerms.map((r) => r.code)).not.toContain('AUTH_SETTINGS_MANAGE');
  });

  it('exactly two system roles exist, both global (organization_id IS NULL)', async () => {
    const { rows } = await pool.query('SELECT name, organization_id FROM roles WHERE is_system_role = TRUE');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.organization_id === null)).toBe(true);
  });
});
