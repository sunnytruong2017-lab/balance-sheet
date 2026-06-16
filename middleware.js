import { NextResponse } from "next/server";

export function middleware(request) {
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://api.anthropic.com https://sheets.googleapis.com https://mcp.notion.com https://*.notion.com https://*.vercel.app",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  return response;
}

export const config = {
  matcher: "/:path*",
};
