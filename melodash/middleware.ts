import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const proxyApiUrl = process.env.PROXY_API_URL || 'http://localhost:3055/api'
  const proxyOrigin = proxyApiUrl.replace(/\/api\/?$/, '')

  const pathname = request.nextUrl.pathname
  
  if (pathname.startsWith('/api/')) {
    const newPath = pathname.replace(/^\/api/, '')
    return NextResponse.rewrite(new URL(`${proxyApiUrl}${newPath}`, request.url))
  }
  
  if (pathname.startsWith('/debug/')) {
    const newPath = pathname.replace(/^\/debug/, '')
    return NextResponse.rewrite(new URL(`${proxyOrigin}/debug${newPath}`, request.url))
  }

  if (pathname === '/docs') {
    return NextResponse.rewrite(new URL(`${proxyOrigin}/docs`, request.url))
  }

  if (pathname === '/openapi.json') {
    return NextResponse.rewrite(new URL(`${proxyOrigin}/openapi.json`, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*', '/debug/:path*', '/docs', '/openapi.json'],
}
