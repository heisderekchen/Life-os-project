'use client'

import { ChevronDown, LineChart } from 'lucide-react'
import { DashboardPage } from '@/components/lifeos/dashboard/dashboard-page'
import { MyOsOverview } from './myos-overview'

export function MyOsHome() {
  return <>
    <MyOsOverview />
    <details className="group mx-auto mb-5 w-full max-w-[1500px] rounded-xl border bg-card px-3 sm:mx-5 sm:px-4 lg:mx-7">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <LineChart className="h-4 w-4 text-primary" />个人生活图表与原有小组件
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t pt-2"><DashboardPage /></div>
    </details>
  </>
}
