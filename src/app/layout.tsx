import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";

const vt323 = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-boot",
});

export const metadata: Metadata = {
  title: "BioReserve OS",
  description: "BioReserve Systems Internal Operating Environment",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${vt323.variable} h-full`}>
      <body
        className="h-full overflow-hidden"
        style={{
          ["--font-os" as string]:
            '"MS Sans Serif", "Segoe UI", Tahoma, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
