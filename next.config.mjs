/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native-socket clients stay as runtime requires instead of being bundled.
    serverComponentsExternalPackages: ['postgres', 'ioredis', 'bullmq', 'unpdf', 'mammoth'],
    // Resume uploads go through a server action; the default limit is 1 MB.
    serverActions: { bodySizeLimit: '6mb' },
    // Going back to a list seen in the last two minutes reuses it instead of reloading ~15k jobs.
    // Every server action calls revalidatePath('/', 'layout'), which empties this cache.
    staleTimes: { dynamic: 120 },
  },
  webpack(config) {
    // Modules import siblings as './x.js' (TypeScript ESM style); map that to the .ts source.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}

export default nextConfig
