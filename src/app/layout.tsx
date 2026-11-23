import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "الدليل الرقمي المدرسي المتكامل",
  description: "نظام إداري داخلي للمدرسة",
  robots: { index: false, follow: false }, // نظام داخلي لا يُفهرس
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#862f5f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
