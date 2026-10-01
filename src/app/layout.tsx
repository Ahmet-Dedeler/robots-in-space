import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Robots in Space Simulator",
  description:
    "Drop real robots, rovers, landers and your own designs onto Venus, the Moon, Mars or Mercury and watch what fails first, and when. Real atmosphere and regolith data, day/night cycles, thermal soak, material limits and MuJoCo physics in the browser.",
};

export const viewport: Viewport = { themeColor: "#120e0b", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
