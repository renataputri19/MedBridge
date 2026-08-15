import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

/** Clinical-light toast styling that matches the surrounding surfaces. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      offset={76}
      toastOptions={{
        classNames: {
          toast:
            'group toast rounded-xl border border-slate-200 bg-white text-slate-900 shadow-lg',
          title: 'text-sm font-semibold',
          description: 'text-sm text-slate-500',
          actionButton: 'bg-primary text-white rounded-md text-xs font-medium',
          cancelButton: 'bg-slate-100 text-slate-600 rounded-md text-xs',
          success: 'border-emerald-200',
          error: 'border-rose-200',
          warning: 'border-amber-200',
          info: 'border-brand-200',
        },
      }}
      {...props}
    />
  )
}
