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
      // Lock body scroll
      document.body.style.overflow = 'hidden'
    }

    return () => {
      window.removeEventListener('keydown', handler)
      // Restore body scroll
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm sm:px-6">
      {/* Overlay is handled by bg-black/60 on parent, click outside to close could be added here if requested */}
      <div
        className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-2xl bg-white shadow-2xl transition-all ${wide ? 'max-w-5xl' : 'max-w-2xl'
          }`}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-gray-100 px-5 py-4 sm:px-6">
          <div>
            {title ? <h3 className="text-lg font-semibold text-gray-900">{title}</h3> : null}
            {description ? <p className="text-sm text-gray-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 -mr-2 rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close modal"
          >
            &#10005;
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  )
}
