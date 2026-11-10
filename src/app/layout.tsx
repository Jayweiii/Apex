import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Pixelify_Sans, Silkscreen } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Pixel display face for headings (mixed case). */
const pixelDisplay = Pixelify_Sans({
  variable: "--font-pixel-display",
  subsets: ["latin"],
  display: "swap",
});

/** Pixel label face for buttons, nav and small caps labels. */
const pixelLabel = Silkscreen({
  variable: "--font-pixel-label",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Apex — lap times",
  description:
    "Upload TrackAddict or GoPro telemetry, review laps, and compare sessions.",
};

/** Dark browser chrome + native dark form controls (selects, scrollbars). */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixelDisplay.variable} ${pixelLabel.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col text-foreground">
        <a href="#main-content" className="apex-skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
