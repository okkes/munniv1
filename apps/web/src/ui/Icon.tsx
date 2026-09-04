import type { CSSProperties } from 'react';

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: CSSProperties;
}

/** Material Design Icons glyph (self-hosted @mdi/font). */
export function Icon({ name, size = 20, color, style }: IconProps) {
  return (
    <i
      aria-hidden
      className={`mdi mdi-${name || 'help-circle-outline'}`}
      style={{
        fontSize: size,
        color: color ?? 'currentColor',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
