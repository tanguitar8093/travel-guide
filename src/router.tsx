import type { AnchorHTMLAttributes, MouseEvent } from 'react'

interface RouterLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
}

export function RouterLink({ to, onClick, ...props }: RouterLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === '_blank'
    ) {
      return
    }

    event.preventDefault()
    if (window.location.pathname !== to) {
      window.history.pushState(null, '', to)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }

  return <a {...props} href={to} onClick={handleClick} />
}
