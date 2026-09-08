// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachScrollMemory } from './scrollMemory';

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('scrollMemory (#131)', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    sessionStorage.clear();
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  afterEach(() => {
    attachScrollMemory(null, 'list');
    el.remove();
  });

  it('restores the stored position on attach', async () => {
    sessionStorage.setItem('munni_scroll_list', '240');
    attachScrollMemory(el, 'list');
    await frame();
    expect(el.scrollTop).toBe(240);
  });

  it('remembers the user scroll once the restore settled', async () => {
    attachScrollMemory(el, 'list'); // nothing stored — settles instantly
    await frame();
    el.scrollTop = 512;
    el.dispatchEvent(new Event('scroll'));
    expect(sessionStorage.getItem('munni_scroll_list')).toBe('512');
  });

  it('the restore’s own scroll never overwrites the memory', async () => {
    sessionStorage.setItem('munni_scroll_list', '240');
    attachScrollMemory(el, 'list');
    // the restore assigns scrollTop and fires scroll while still pending
    el.dispatchEvent(new Event('scroll'));
    expect(sessionStorage.getItem('munni_scroll_list')).toBe('240');
  });

  it('detaching stops listening', async () => {
    attachScrollMemory(el, 'list');
    await frame();
    attachScrollMemory(null, 'list');
    el.scrollTop = 99;
    el.dispatchEvent(new Event('scroll'));
    expect(sessionStorage.getItem('munni_scroll_list')).toBeNull();
  });
});
