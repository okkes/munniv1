// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppBar, IconButton } from './AppBar';
import { Button } from './Button';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Chip, Field, HeroCard, Pill, ProgressBar, Row, Tile } from './primitives';
import { MasterDetailLayout } from './SplitPane';
// harness registers RTL cleanup between tests
import '@/test/harness';

// the layout reads its detail from the router — stub the two hooks so
// the primitive can be exercised without mounting a real route tree
const routerStub = vi.hoisted(() => ({ childMatches: [] as unknown[] }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useChildMatches: () => routerStub.childMatches,
  Outlet: () => <div data-testid="pane-detail" />,
}));

describe('Button', () => {
  it('renders each variant/size with the mapped classes', () => {
    render(
      <>
        <Button>Go</Button>
        <Button variant="outline" size="sm">
          Out
        </Button>
        <Button variant="ghost">Gh</Button>
        <Button variant="danger">Del</Button>
      </>,
    );
    expect(screen.getByText('Go').className).toContain('bg-brand');
    expect(screen.getByText('Go').className).toContain('h-12');
    expect(screen.getByText('Out').className).toContain('border-line');
    expect(screen.getByText('Out').className).toContain('h-9');
    expect(screen.getByText('Gh').className).toContain('bg-transparent');
    expect(screen.getByText('Del').className).toContain('bg-negative');
  });

  it('forwards native button props', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled data-testid="b">
        Save
      </Button>,
    );
    const btn = screen.getByTestId('b') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('AppBar', () => {
  it('compact bar renders title, sub, leading and trailing', () => {
    render(<AppBar title="Accounts" sub="3 linked" leading={<span>L</span>} trailing={<span>T</span>} />);
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('3 linked')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.getByText('T')).toBeTruthy();
  });

  it('large bar renders the title as an h1', () => {
    render(<AppBar title="Transactions" large />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Transactions');
  });
});

describe('IconButton', () => {
  it('exposes the aria label and handles clicks', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Close" onClick={onClick} testId="ib" filled>
        x
      </IconButton>,
    );
    const btn = screen.getByLabelText('Close');
    expect(btn.getAttribute('data-testid')).toBe('ib');
    expect(btn.className).toContain('bg-surface');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Icon', () => {
  it('maps the name to an mdi class and sizes the glyph', () => {
    const { container } = render(<Icon name="bank" size={24} color="red" />);
    const i = container.querySelector('i')!;
    expect(i.className).toContain('mdi-bank');
    expect(i.style.fontSize).toBe('24px');
    expect(i.style.color).toBe('red');
  });

  it('falls back to help-circle-outline for an empty name', () => {
    const { container } = render(<Icon name="" />);
    expect(container.querySelector('i')!.className).toContain('mdi-help-circle-outline');
  });
});

describe('Logo', () => {
  it('renders the wordmark with the accent dot', () => {
    const { container } = render(<Logo size={40} />);
    expect(container.textContent).toBe('munni.');
    expect((container.firstElementChild as HTMLElement).style.fontSize).toBe('40px');
  });
});

describe('redesign primitives', () => {
  it('Tile renders at exactly two sizes with tone-soft backgrounds', () => {
    const { container } = render(
      <>
        <Tile icon="bank" size={48} />
        <Tile icon="bank" tone="special" />
      </>,
    );
    const [hero, row] = [...container.querySelectorAll('span')].filter((s) => s.querySelector('i'));
    expect(hero.className).toContain('h-12');
    expect(hero.className).toContain('bg-accent-soft');
    expect(row.className).toContain('h-9');
    expect(row.className).toContain('bg-special-soft');
  });

  it('Row: nav rows are 15px with a chevron, data rows 13px without', () => {
    const onClick = vi.fn();
    const { container } = render(
      <>
        <Row title="Budgets" icon="wallet-outline" onClick={onClick} testId="nav-row" />
        <Row kind="data" title="Receipt" sub="12 items" trailing={<span>€3</span>} testId="data-row" />
      </>,
    );
    const nav = screen.getByTestId('nav-row');
    expect(nav.className).toContain('py-3.5');
    expect(nav.querySelector('.mdi-chevron-right')).toBeTruthy();
    fireEvent.click(nav);
    expect(onClick).toHaveBeenCalled();
    const data = screen.getByTestId('data-row');
    expect(data.tagName).toBe('DIV'); // no onClick -> not a button
    expect(data.className).toContain('py-2.5');
    expect(data.querySelector('.mdi-chevron-right')).toBeNull();
    expect(container.textContent).toContain('12 items');
  });

  it('Pill and Chip carry their tones', () => {
    const onClick = vi.fn();
    render(
      <>
        <Pill tone="warning" testId="pill">
          Unreviewed
        </Pill>
        <Chip selected onClick={onClick} testId="chip-on">
          Monthly
        </Chip>
        <Chip selected tone="warning" onClick={onClick} testId="chip-warn">
          Filter
        </Chip>
        <Chip selected={false} onClick={onClick} disabled testId="chip-off">
          Off
        </Chip>
      </>,
    );
    expect(screen.getByTestId('pill').className).toContain('bg-warning-soft');
    expect(screen.getByTestId('chip-on').className).toContain('border-accent');
    expect(screen.getByTestId('chip-warn').className).toContain('border-warning');
    expect((screen.getByTestId('chip-off') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('chip-on'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ProgressBar clamps, sizes and takes an overlay', () => {
    render(
      <>
        <ProgressBar value={1.4} size="sm" testId="bar" overlay={<div data-testid="stripes" />} />
        <ProgressBar value={-1} size="lg" color="red" testId="bar2" />
      </>,
    );
    const bar = screen.getByTestId('bar');
    expect(bar.className).toContain('h-1');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%');
    expect(screen.getByTestId('stripes')).toBeTruthy();
    const bar2 = screen.getByTestId('bar2');
    expect(bar2.className).toContain('h-2');
    expect((bar2.firstElementChild as HTMLElement).style.width).toBe('0%');
    expect((bar2.firstElementChild as HTMLElement).style.background).toBe('red');
  });

  it('Field puts a 12px label above its control', () => {
    render(
      <Field label="Name" htmlFor="f">
        <input id="f" />
      </Field>,
    );
    const label = screen.getByText('Name');
    expect(label.tagName).toBe('LABEL');
    expect(label.className).toContain('text-[12px]');
  });

  it('MasterDetailLayout: detail replaces the list below lg, panes beside it at lg', () => {
    // no detail child: the list owns the screen (any viewport)
    routerStub.childMatches = [];
    const { unmount } = render(<MasterDetailLayout list={<div data-testid="pane-list" />} />);
    expect(screen.queryByTestId('split-pane')).toBeNull();
    expect(screen.getByTestId('pane-list')).toBeTruthy();
    expect(screen.queryByTestId('pane-detail')).toBeNull();
    unmount();

    // happy-dom reports a non-lg viewport: a matched detail fills the screen
    routerStub.childMatches = [{}];
    const second = render(<MasterDetailLayout list={<div data-testid="pane-list" />} />);
    expect(screen.queryByTestId('split-pane')).toBeNull();
    expect(screen.queryByTestId('pane-list')).toBeNull();
    expect(screen.getByTestId('pane-detail')).toBeTruthy();
    second.unmount();

    const original = window.matchMedia;
    window.matchMedia = (() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(<MasterDetailLayout list={<div data-testid="pane-list" />} />);
      expect(screen.getByTestId('split-pane')).toBeTruthy();
      expect(screen.getByTestId('pane-list')).toBeTruthy();
      expect(screen.getByTestId('pane-detail')).toBeTruthy();
    } finally {
      window.matchMedia = original;
    }
  });

  it('HeroCard lays out tile, number, progress and meta', () => {
    render(
      <HeroCard
        testId="hero"
        tile={<Tile icon="flag-outline" size={48} />}
        title="Emergency fund"
        titleBadge={<Pill tone="accent">On track</Pill>}
        sub="Savings"
        number="€1,200"
        progress={<ProgressBar value={0.5} testId="hero-bar" />}
        meta={<span>next €100 · Aug</span>}
      />,
    );
    const hero = screen.getByTestId('hero');
    expect(hero.textContent).toContain('Emergency fund');
    expect(hero.textContent).toContain('On track');
    expect(hero.textContent).toContain('€1,200');
    expect(screen.getByTestId('hero-bar')).toBeTruthy();
    expect(hero.textContent).toContain('next €100');
  });
});
