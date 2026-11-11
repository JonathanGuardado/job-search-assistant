import type { ReactNode } from 'react'
import { AppNavigation } from './_components/AppNavigation'
import './globals.css'

export const metadata = { title: 'Job Seeker Assistant' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppNavigation />
        {children}
      </body>
    </html>
  )
}
