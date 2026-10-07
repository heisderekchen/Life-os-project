import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'lifeos_session'

/**
 * Life OS is intentionally a private application. HappySpa sends the owner to
 * `/?entry=<secret>` once; this proxy exchanges that short-lived URL value for
 * an HttpOnly cookie and immediately removes it from the address bar.
 */
export function proxy(request: NextRequest) {
  const entryKey = process.env.LIFEOS_ENTRY_KEY
  const hasSession = request.cookies.get(COOKIE_NAME)?.value === entryKey

  if (!entryKey) return new NextResponse('Not found', { status: 404 })
  if (hasSession) return NextResponse.next()

  if (request.nextUrl.searchParams.get('entry') === entryKey) {
    const cleanUrl = request.nextUrl.clone()
    cleanUrl.searchParams.delete('entry')
    const response = NextResponse.redirect(cleanUrl)
    response.cookies.set(COOKIE_NAME, entryKey, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24,
    })
    return response
  }

  return new NextResponse('Not found', { status: 404 })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
