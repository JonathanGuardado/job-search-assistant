import postgres from 'postgres'

/**
 * Local setup: creates the app login role and the database, deriving both from
 * the two connection URLs so there is one source of truth for credentials.
 * Needs a superuser admin URL. Production provisions roles out of band.
 */
export async function ensureRoleAndDatabase(urls: {
  readonly adminUrl: string
  readonly appUrl: string
}): Promise<void> {
  const admin = new URL(urls.adminUrl)
  const app = new URL(urls.appUrl)
  if (admin.pathname !== app.pathname) {
    throw new Error(`DATABASE_URL and DATABASE_ADMIN_URL must name the same database`)
  }
  const database = decodeURIComponent(admin.pathname.slice(1))
  const role = decodeURIComponent(app.username)
  const password = decodeURIComponent(app.password)

  const maintenance = new URL(urls.adminUrl)
  maintenance.pathname = '/postgres'
  const sql = postgres(maintenance.toString(), { max: 1, onnotice: () => {} })
  try {
    // Utility statements cannot take bind parameters, hence the manual quoting.
    const ident = `"${role.replaceAll('"', '""')}"`
    const literal = `'${password.replaceAll("'", "''")}'`
    const [existingRole] = await sql`select 1 from pg_roles where rolname = ${role}`
    await sql.unsafe(
      existingRole
        ? `alter role ${ident} with login password ${literal}`
        : `create role ${ident} with login password ${literal} nosuperuser nobypassrls`,
    )

    const [existingDb] = await sql`select 1 from pg_database where datname = ${database}`
    if (!existingDb) {
      await sql.unsafe(`create database "${database.replaceAll('"', '""')}"`)
    }
  } finally {
    await sql.end()
  }
}
