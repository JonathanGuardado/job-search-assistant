/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native-socket clients stay as runtime requires instead of being bundled.
    serverComponentsExternalPackages: ['postgres', 'ioredis', 'bullmq'],
  },
}

export default nextConfig
