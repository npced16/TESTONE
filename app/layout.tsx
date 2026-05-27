import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Data Insight Converter",
  description: "Paste spreadsheet data and generate insights, charts, and reports."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
