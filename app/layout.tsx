import type { Metadata } from "next";
import { Sora, Manrope, Space_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "OtpStack",
  description: "Your code. Your number. Your stack.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${manrope.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-text">
        {children}
      </body>
    </html>
  );
}
