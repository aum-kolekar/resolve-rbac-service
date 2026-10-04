// Grounded in the SRS's documented entities (Case, Task, Document, Approval,
// Team, Organization, Audit) - see Contracts/RBAC_Service.md §9 for the full
// reasoning and explicit flag that this is a reasonable starting catalog,
// not a frozen enumeration Case/Workflow/Document services must conform to.
const PERMISSIONS = [
  ['CASE_CREATE', 'Create a new case.'],
  ['CASE_READ', 'View case details and case lists.'],
  ['CASE_UPDATE', 'Update case fields.'],
  ['CASE_ASSIGN', 'Assign or reassign a case to a user or team.'],
  ['CASE_APPROVE', 'Approve or reject a case at the REVIEW stage.'],
  ['CASE_DELETE', 'Archive (soft-delete) a case.'],
  ['TASK_CREATE', 'Create a task under a case.'],
  ['TASK_READ', 'View task details and task lists.'],
  ['TASK_UPDATE', 'Update task fields.'],
  ['TASK_ASSIGN', 'Assign or reassign a task to a user or team.'],
  ['TASK_COMPLETE', 'Mark a task as completed.'],
  ['DOCUMENT_UPLOAD', 'Upload a document to a case.'],
  ['DOCUMENT_READ', "List and download a case's documents."],
  ['DOCUMENT_DELETE', 'Delete/archive a document.'],
  ['APPROVAL_REQUEST', 'Request an approval on a case.'],
  ['APPROVAL_DECIDE', 'Approve or reject a pending approval request.'],
  ['TEAM_MANAGE', 'Create, update, or delete teams within a tenant.'],
  ['TEAM_READ', 'View team details and membership.'],
  ['USER_MANAGE', 'Create and manage organization users.'],
  ['USER_READ', 'View organization user details and lists.'],
  ['AUDIT_READ', 'Read-only access to immutable audit records.'],
  ['ORG_SETTINGS_MANAGE', 'Manage tenant-level organization settings.'],
  ['AUTH_SETTINGS_MANAGE', 'Manage tenant-level authentication token TTL settings.'],
  ['ROLE_MANAGE', 'Create/update/delete roles and manage user-role assignments.'],
];

const CASE_MANAGER_PERMISSIONS = [
  'CASE_CREATE',
  'CASE_READ',
  'CASE_UPDATE',
  'CASE_ASSIGN',
  'CASE_APPROVE',
  'CASE_DELETE',
  'TASK_CREATE',
  'TASK_READ',
  'TASK_UPDATE',
  'TASK_ASSIGN',
  'TASK_COMPLETE',
  'DOCUMENT_READ',
  'APPROVAL_DECIDE',
];

exports.up = async (pgm) => {
  for (const [code, description] of PERMISSIONS) {
    await pgm.db.query(
      'INSERT INTO permissions (code, description) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
      [code, description],
    );
  }

  const allCodes = PERMISSIONS.map(([code]) => code);
  await seedSystemRole(pgm, 'ORG_ADMIN', 'Full tenant control - every permission.', allCodes);
  await seedSystemRole(
    pgm,
    'CASE_MANAGER',
    'Manages the case/task lifecycle and approvals, without org/user/role administration.',
    CASE_MANAGER_PERMISSIONS,
  );
};

async function seedSystemRole(pgm, name, description, permissionCodes) {
  const {
    rows: [role],
  } = await pgm.db.query(
    `INSERT INTO roles (organization_id, name, description, is_system_role)
     VALUES (NULL, $1, $2, TRUE)
     ON CONFLICT (name) WHERE organization_id IS NULL DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name, description],
  );

  for (const code of permissionCodes) {
    await pgm.db.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = $2
       ON CONFLICT DO NOTHING`,
      [role.id, code],
    );
  }
}

exports.down = async (pgm) => {
  await pgm.db.query(
    "DELETE FROM roles WHERE name IN ('ORG_ADMIN', 'CASE_MANAGER') AND is_system_role = TRUE",
  );
  await pgm.db.query(
    `DELETE FROM permissions WHERE code IN (${PERMISSIONS.map((_, i) => `$${i + 1}`).join(',')})`,
    PERMISSIONS.map(([code]) => code),
  );
};
