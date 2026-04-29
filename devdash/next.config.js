/** @type {import('next').NextConfig} */
const path = require('path')

const proxyApiUrl = process.env.PROXY_API_URL || 'http://localhost:3055/api'
const proxyOrigin = proxyApiUrl.replace(/\/api\/?$/, '')

const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname)
  },
  async rewrites () {
    return [
      {
        source: '/api/:path*',
        destination: `${proxyApiUrl}/:path*`
      },
      {
        source: '/debug/:path*',
        destination: `${proxyOrigin}/debug/:path*`
      },
      {
        source: '/docs',
        destination: `${proxyOrigin}/docs`
      },
      {
        source: '/openapi.json',
        destination: `${proxyOrigin}/openapi.json`
      }
    ]
  }
}
module.exports = nextConfig
