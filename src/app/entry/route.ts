import { NextRequest, NextResponse } from 'next/server'

export function GET(request: NextRequest) {
  const entryKey = process.env.LIFEOS_ENTRY_KEY

  if (!entryKey || request.nextUrl.searchParams.get('entry') !== entryKey) {
    return new NextResponse('Not found', { status: 404 })
  }

  const destination = new URL('/workbench', request.url)
  const response = NextResponse.redirect(destination)
  response.cookies.set('lifeos_session', entryKey, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24,
  })
  return response
}
