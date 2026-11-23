import { NextResponse, type NextRequest } from "next/server";

// فحص سريع لوجود الكوكي فقط؛ التحقق الفعلي من الجلسة والصلاحيات يتم على الخادم في كل صفحة وعملية
export function middleware(req: NextRequest) {
  const has = req.cookies.has("sd_session");
  if (!has && !req.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico|.*\\.(?:css|js|woff2?|png|svg)$).*)"] };
