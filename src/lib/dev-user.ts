/**
 * The single hardcoded user until real auth exists. Seeded by `pnpm db:bootstrap`.
 */
export const DEV_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'dev@localhost',
} as const
