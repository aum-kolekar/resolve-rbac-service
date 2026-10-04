const { z } = require('zod');

const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  permissionCodes: z.array(z.string()).default([]),
});

const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    permissionCodes: z.array(z.string()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required.' });

const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
});

const authzCheckSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  permission: z.string().min(1),
});

const authzCheckBulkSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  permissions: z.array(z.string().min(1)).min(1),
});

module.exports = {
  createRoleSchema,
  updateRoleSchema,
  assignRoleSchema,
  authzCheckSchema,
  authzCheckBulkSchema,
};
