// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { LangProvider } from '@/i18n';
import { SearchField } from './SearchField';

function Host() {
  const [value, setValue] = useState('');
  return (
    <LangProvider>
      <SearchField testId="sf" value={value} onChange={setValue} placeholder="Search…" height="h-10" textSize="text-[13px]" />
    </LangProvider>
  );
}

describe('SearchField (#234)', () => {
  it('shows the clear × only with text, and one tap empties the field', () => {
    render(<Host />);
    const input = screen.getByTestId('sf') as HTMLInputElement;
    expect(screen.queryByTestId('sf-clear')).toBeNull();
    fireEvent.change(input, { target: { value: 'coffee' } });
    expect(input.value).toBe('coffee');
    fireEvent.click(screen.getByTestId('sf-clear'));
    expect(input.value).toBe('');
    expect(screen.queryByTestId('sf-clear')).toBeNull();
  });
});
