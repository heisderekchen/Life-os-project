import { NextRequest, NextResponse } from 'next/server'

/** Only HappySpa's authenticated server-side gateway may reach Life OS. */
export function proxy(request: NextRequest) {
  const gatewayKey = process.env.LIFEOS_ENTRY_KEY
  if (!gatewayKey || request.headers.get('x-lifeos-gateway-key') !== gatewayKey) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/:path*'],
}
