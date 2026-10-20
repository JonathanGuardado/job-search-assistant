/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native-socket clients stay as runtime requires instead of being bundled.
    serverComponentsExternalPackages: ['postgres', 'ioredis', 'bullmq', 'unpdf', 'mammoth'],
    // Resume uploads go through a server action; the default limit is 1 MB.
    serverActions: { bodySizeLimit: '6mb' },
  },
  webpack(config) {
    // Modules import siblings as './x.js' (TypeScript ESM style); map that to the .ts source.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}

export default nextConfig
