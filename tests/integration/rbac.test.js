const { randomUUID } = require('crypto');
const request = require('supertest');

describe('rbac-service integration (Contract §6-7)', () => {
  let app;
  let jwksServer;
  let signMockAccessToken;
  let pool;

  const ORG_ID = randomUUID();
  const ADMIN_USER_ID = randomUUID();
  const PLAIN_USER_ID = randomUUID();

  async function tokenFor(userId, tenantId = ORG_ID) {
    return signMockAccessToken({ sub: userId, tenantId, email: `${userId}@test.local` });
  }

  beforeAll(async () => {
    const config = require('../../src/config');

    const mocks = require('../../mocks/server');
    signMockAccessToken = mocks.signMockAccessToken;
    jwksServer = await new Promise((resolve) => {
      const s = mocks.buildJwksApp().listen(0, () => resolve(s));
    });
    config.auth.authenticationServiceUrl = `http://127.0.0.1:${jwksServer.address().port}`;

    const createApp = require('../../src/app');
    app = createApp();

    pool = require('../../src/db/pool').getPool();

    // Give ADMIN_USER_ID the ORG_ADMIN system role so it can exercise every
    // ROLE_MANAGE-gated endpoint below.
    const { rows } = await pool.query('SELECT id FROM roles WHERE name = $1', ['ORG_ADMIN']);
    await pool.query(
      'INSERT INTO user_roles (user_id, organization_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [ADMIN_USER_ID, ORG_ID, rows[0].id],
    );
  });

  afterAll(async () => {
    // Clean up everything this suite created, leaving seeded system
    // data (permissions, ORG_ADMIN/CASE_MANAGER roles) untouched.
    await pool.query('DELETE FROM user_roles WHERE organization_id = $1', [ORG_ID]);
    await pool.query('DELETE FROM roles WHERE organization_id = $1', [ORG_ID]);
    await require('../../src/db/pool').closePool();
    await require('../../src/cache/client').closeRedisClient();
    await new Promise((resolve) => jwksServer.close(resolve));
  });

  describe('authentication', () => {
    it('rejects a request with no token', async () => {
      const res = await request(app).get('/api/v1/rbac/permissions');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHZ_INVALID_TOKEN');
    });

    it('accepts a valid token signed by the (mock) Authentication Service', async () => {
      const token = await tokenFor(ADMIN_USER_ID);
      const res = await request(app).get('/api/v1/rbac/permissions').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.permissions.length).toBeGreaterThan(0);
    });
  });

  describe('role CRUD (Contract §6)', () => {
    let adminToken;
    let plainToken;

    beforeAll(async () => {
      adminToken = await tokenFor(ADMIN_USER_ID);
      plainToken = await tokenFor(PLAIN_USER_ID);
    });

    it('a user without ROLE_MANAGE cannot create a role', async () => {
      const res = await request(app)
        .post('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${plainToken}`)
        .send({ name: 'Should Fail', permissionCodes: ['CASE_READ'] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTHZ_FORBIDDEN');
    });

    it('ORG_ADMIN can create a custom role', async () => {
      const res = await request(app)
        .post('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Regional Reviewer', permissionCodes: ['CASE_READ', 'CASE_APPROVE'] });
      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBe(ORG_ID);
      expect(res.body.isSystemRole).toBe(false);
      expect(res.body.permissions.sort()).toEqual(['CASE_APPROVE', 'CASE_READ']);
    });

    it('rejects an unknown permission code', async () => {
      const res = await request(app)
        .post('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bad Role', permissionCodes: ['NOT_REAL'] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AUTHZ_UNKNOWN_PERMISSION');
    });

    it('rejects a duplicate role name in the same tenant', async () => {
      const res = await request(app)
        .post('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Regional Reviewer', permissionCodes: [] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('AUTHZ_ROLE_NAME_CONFLICT');
    });

    it('cannot create a role with the same name as a system role', async () => {
      const res = await request(app)
        .post('/api/v1/rbac/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'ORG_ADMIN', permissionCodes: [] });
      expect(res.status).toBe(409);
    });

    it('system roles cannot be edited', async () => {
      const {
        rows: [orgAdmin],
      } = await pool.query('SELECT id FROM roles WHERE name = $1', ['ORG_ADMIN']);
      const res = await request(app)
        .patch(`/api/v1/rbac/roles/${orgAdmin.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Hacked Admin' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTHZ_SYSTEM_ROLE_IMMUTABLE');
    });

    it('system roles cannot be deleted', async () => {
      const {
        rows: [caseManager],
      } = await pool.query('SELECT id FROM roles WHERE name = $1', ['CASE_MANAGER']);
      const res = await request(app)
        .delete(`/api/v1/rbac/roles/${caseManager.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it('a custom role from another tenant is invisible (anti-enumeration, 404 not 403)', async () => {
      const otherOrgToken = await tokenFor(randomUUID(), randomUUID());
      const {
        rows: [regionalReviewer],
      } = await pool.query('SELECT id FROM roles WHERE name = $1 AND organization_id = $2', [
        'Regional Reviewer',
        ORG_ID,
      ]);
      const res = await request(app)
        .get(`/api/v1/rbac/roles/${regionalReviewer.id}`)
        .set('Authorization', `Bearer ${otherOrgToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('user-role assignment + cache invalidation (Contract §6, §10)', () => {
    let adminToken;
    let customRoleId;

    beforeAll(async () => {
      adminToken = await tokenFor(ADMIN_USER_ID);
      const {
        rows: [role],
      } = await pool.query('SELECT id FROM roles WHERE name = $1 AND organization_id = $2', [
        'Regional Reviewer',
        ORG_ID,
      ]);
      customRoleId = role.id;
    });

    it('assigns a role to a user', async () => {
      const res = await request(app)
        .post(`/api/v1/rbac/users/${PLAIN_USER_ID}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: customRoleId });
      expect(res.status).toBe(201);
      expect(res.body.assignedBy).toBe(ADMIN_USER_ID);
    });

    it('rejects assigning the same role twice', async () => {
      const res = await request(app)
        .post(`/api/v1/rbac/users/${PLAIN_USER_ID}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: customRoleId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('AUTHZ_ROLE_ALREADY_ASSIGNED');
    });

    it('the internal check endpoint now reflects the new assignment (cache correctly populated fresh)', async () => {
      const res = await request(app)
        .post('/internal/v1/authz/check')
        .set('X-Internal-Service-Token', 'dev-internal-service-token')
        .send({ userId: PLAIN_USER_ID, organizationId: ORG_ID, permission: 'CASE_APPROVE' });
      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(true);
    });

    it('revoking the role invalidates the cache immediately, not after the TTL', async () => {
      const revokeRes = await request(app)
        .delete(`/api/v1/rbac/users/${PLAIN_USER_ID}/roles/${customRoleId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(revokeRes.status).toBe(204);

      // If invalidation didn't happen, this would incorrectly return true
      // for up to 60 seconds (Contract §10) - checking immediately proves
      // the invalidation path actually ran, not just that it eventually expires.
      const checkRes = await request(app)
        .post('/internal/v1/authz/check')
        .set('X-Internal-Service-Token', 'dev-internal-service-token')
        .send({ userId: PLAIN_USER_ID, organizationId: ORG_ID, permission: 'CASE_APPROVE' });
      expect(checkRes.body.allowed).toBe(false);
    });

    it('editing a role permission set invalidates cache for every user holding that role', async () => {
      await request(app)
        .post(`/api/v1/rbac/users/${PLAIN_USER_ID}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: customRoleId });

      // Warm the cache first.
      await request(app)
        .post('/internal/v1/authz/check')
        .set('X-Internal-Service-Token', 'dev-internal-service-token')
        .send({ userId: PLAIN_USER_ID, organizationId: ORG_ID, permission: 'CASE_APPROVE' });

      // Narrow the role down to just CASE_READ.
      await request(app)
        .patch(`/api/v1/rbac/roles/${customRoleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionCodes: ['CASE_READ'] });

      const res = await request(app)
        .post('/internal/v1/authz/check')
        .set('X-Internal-Service-Token', 'dev-internal-service-token')
        .send({ userId: PLAIN_USER_ID, organizationId: ORG_ID, permission: 'CASE_APPROVE' });
      expect(res.body.allowed).toBe(false); // would be stale-true if the cache wasn't invalidated on edit
    });
  });

  describe('deny-by-default (FR-AUZ-02/03)', () => {
    it('a user with zero role assignments is denied everything, not erroring', async () => {
      const freshUser = randomUUID();
      const res = await request(app)
        .post('/internal/v1/authz/check')
        .set('X-Internal-Service-Token', 'dev-internal-service-token')
        .send({ userId: freshUser, organizationId: ORG_ID, permission: 'CASE_READ' });
      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(false);
    });
  });

  describe('internal endpoint auth', () => {
    it('rejects a missing X-Internal-Service-Token', async () => {
      const res = await request(app)
        .post('/internal/v1/authz/check')
        .send({ userId: ADMIN_USER_ID, organizationId: ORG_ID, permission: 'CASE_READ' });
      expect(res.status).toBe(401);
    });

    it('rejects an unknown permission code with 400, not a silent false', async () => {
      const res = await request(app)
        .post('/internal/v1/authz/check')
        .set('X-Internal-Service-Token', 'dev-internal-service-token')
        .send({ userId: ADMIN_USER_ID, organizationId: ORG_ID, permission: 'TOTALLY_MADE_UP' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AUTHZ_UNKNOWN_PERMISSION');
    });

    it('maps a malformed (non-UUID) identifier to a clean 400, not a raw 500', async () => {
      const res = await request(app)
        .post('/internal/v1/authz/check')
        .set('X-Internal-Service-Token', 'dev-internal-service-token')
        .send({ userId: 'not-a-uuid', organizationId: 'also-not-a-uuid', permission: 'CASE_READ' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AUTHZ_VALIDATION_ERROR');
    });
  });
});
