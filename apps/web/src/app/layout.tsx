import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./command-fonts.css";
const golos = localFont({
  src: "./fonts/golos.woff2",
  variable: "--font-golos",
  display: "swap",
});
const cormorant = localFont({
  src: "./fonts/cormorant.woff2",
  variable: "--font-cormorant",
  display: "swap",
});
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "XD · Guild Command Center", template: "%s · XD" },
  description: "Командный центр гильдии XD / ХД в ArcheAge.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${golos.variable} ${cormorant.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('xd-theme')==='light'?'light':'dark'}catch{}",
          }}
        />
      </head>
      <body>
        <div className="world-background" aria-hidden="true" />
        <a className="skip-link" href="#main">
          Перейти к содержимому
        </a>
        {children}
      </body>
    </html>
  );
}
