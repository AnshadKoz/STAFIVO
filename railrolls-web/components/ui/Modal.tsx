'use client'

import { ReactNode, useEffect } from 'react'

type ModalProps = {
  open: boolean
  title?: string
  description?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

export default function Modal({ open, title, description, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    if (open) {
      window.addEventListener('keydown', handler)
    }
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
      <div
        className={`w-full rounded-2xl bg-white shadow-2xl transition-all ${
          wide ? 'max-w-5xl' : 'max-w-2xl'
        }`}
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            {title ? <h3 className="text-lg font-semibold text-gray-900">{title}</h3> : null}
            {description ? <p className="text-sm text-gray-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close modal"
          >
            &#10005;
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
