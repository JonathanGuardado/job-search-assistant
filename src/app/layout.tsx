import type { ReactNode } from 'react'

export const metadata = { title: 'Job Seeker Assistant' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
