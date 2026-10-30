export function KeyCap({ children, inButton = false }: { children: string; inButton?: boolean }) {
  const single = [...new Intl.Segmenter().segment(children)].length === 1;
  return (
    <kbd
      className={single ? 'convai-key-cap convai-key-cap--single' : 'convai-key-cap'}
      aria-hidden={inButton || undefined}
    >
      {children}
    </kbd>
  );
}
