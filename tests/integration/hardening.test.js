const { randomUUID } = require('crypto');
const request = require('supertest');

/**
 * Regression tests for bugs found by the exhaustive end-to-end run:
 * malformed/oversized bodies and non-UUID identifiers surfacing as 500,
 * duplicate permission codes, check-then-insert races, forged-kid tokens.
 */
describe('rbac hardening regressions', () => {
  let app;
  let jwksServer;
  let mocks;
  let pool;
  const ORG_ID = randomUUID();
  const ADMIN = randomUUID();
  let token;

  beforeAll(async () => {
    const config = require('../../src/config');
    mocks = require('../../mocks/server');
    jwksServer = await new Promise((resolve) => {
      const s = mocks.buildJwksApp().listen(0, () => resolve(s));
    });
    config.auth.authenticationServiceUrl = `http://127.0.0.1:${jwksServer.address().port}`;
    app = require('../../src/app')();
    pool = require('../../src/db/pool').getPool();
    const { rows } = await pool.query("SELECT id FROM roles WHERE name = 'ORG_ADMIN'");
    await pool.query('INSERT INTO user_roles (user_id, organization_id, role_id) VALUES ($1,$2,$3)', [
      ADMIN,
      ORG_ID,
      rows[0].id,
    ]);
    token = await mocks.signMockAccessToken({ sub: ADMIN, tenantId: ORG_ID, email: 'a@x.test' });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM user_roles WHERE organization_id = $1', [ORG_ID]);
    await pool.query('DELETE FROM roles WHERE organization_id = $1', [ORG_ID]);
    await require('../../src/db/pool').closePool();
    await require('../../src/cache/client').closeRedisClient();
    await new Promise((resolve) => jwksServer.close(resolve));
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('malformed JSON -> 400 with a requestId; oversized body -> 413', async () => {
    const bad = await request(app)
      .post('/api/v1/rbac/roles')
      .set(auth())
      .set('Content-Type', 'application/json')
      .send('{oops');
    expect(bad.status).toBe(400);
    expect(bad.body.error.requestId).toBeTruthy();
    const big = await request(app)
      .post('/api/v1/rbac/roles')
      .set(auth())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'z'.repeat(200000) }));
    expect(big.status).toBe(413);
  });

  it('non-UUID identifiers in paths -> 400, never a raw 500', async () => {
    expect((await request(app).get('/api/v1/rbac/roles/not-a-uuid').set(auth())).status).toBe(400);
    expect((await request(app).delete('/api/v1/rbac/roles/xyz').set(auth())).status).toBe(400);
    expect((await request(app).get('/api/v1/rbac/users/nope/roles').set(auth())).status).toBe(400);
  });

  it('duplicate permission codes are silently de-duplicated', async () => {
    const res = await request(app)
      .post('/api/v1/rbac/roles')
      .set(auth())
      .send({ name: 'Dupes', permissionCodes: ['CASE_READ', 'CASE_READ'] });
    expect(res.status).toBe(201);
    expect(res.body.permissions).toEqual(['CASE_READ']);
  });

  it('simultaneous identical assignments: exactly one 201, the rest 409, no 5xx', async () => {
    const role = await request(app).post('/api/v1/rbac/roles').set(auth()).send({ name: 'RaceAssign' });
    const user = randomUUID();
    const rs = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).post(`/api/v1/rbac/users/${user}/roles`).set(auth()).send({ roleId: role.body.id }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect(rs.filter((r) => r.status >= 500)).toHaveLength(0);
  });

  it('simultaneous creates of one role name: exactly one 201, the rest 409, no 5xx', async () => {
    const rs = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app).post('/api/v1/rbac/roles').set(auth()).send({ name: 'RaceCreate' }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect(rs.filter((r) => r.status >= 500)).toHaveLength(0);
  });
});
