import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LTFRB Slot Helper",
  description:
    "Check open LTFRB franchise slots, get email alerts every 15 minutes, and manage your LTFRB account.",
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
