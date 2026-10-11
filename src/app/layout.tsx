import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { Providers } from "@/components/lifeos/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Life OS - Personal Life Operating System",
  description: "Your personal life operating system. Manage tasks, notes, habits, finances, health, goals, and more — all in one place.",
  icons: {
    icon: [{ url: `${process.env.LIFEOS_BASE_PATH || ""}/logo.svg`, type: "image/svg+xml" }],
    shortcut: `${process.env.LIFEOS_BASE_PATH || ""}/logo.svg`,
    apple: `${process.env.LIFEOS_BASE_PATH || ""}/logo.svg`,
  },
  openGraph: {
    title: "Life OS",
    description: "Your personal life operating system — calm, private, all in one place.",
  },
};

// Cover the full screen so safe-area insets (notch / home indicator) are
// reported and the shell can keep its header and bottom affordances reachable.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  );
}
