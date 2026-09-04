interface LogoProps {
  size?: number;
  color?: string;
}

export function Logo({ size = 32, color }: LogoProps) {
  return (
    <span
      className="inline-flex items-baseline font-semibold tracking-[-0.04em]"
      style={{ fontFamily: 'var(--font-display)', fontSize: size, color: color ?? 'var(--m-ink)', lineHeight: 1 }}
    >
      munni<span style={{ color: 'var(--m-accent)' }}>.</span>
    </span>
  );
}
