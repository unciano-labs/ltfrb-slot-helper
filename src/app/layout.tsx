import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LTFRB Slot Helper",
  description:
    "Check open LTFRB franchise slots, get email alerts every 3 minutes, and manage your LTFRB account.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "LTFRB Helper",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F6F5F1] text-[#17191C] antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
