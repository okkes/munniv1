/**
 * #302 (user, generalizing #227 r3): scroll an element into view, wait
 * for the scroll to SETTLE, then pulse it — the CSS pulse lives on
 * `[data-flash='1']` (ui/styles.css). Re-invocations cancel cleanly.
 */
const FLASH_MS = 1600;
const cleanups = new WeakMap<HTMLElement, () => void>();

const scrollAncestorOf = (el: HTMLElement): HTMLElement | null => {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
};

function startPulse(target: HTMLElement): void {
  delete target.dataset.flash;
  void target.offsetWidth; // reflow restarts the animation on a re-run
  target.dataset.flash = '1';
  const timer = window.setTimeout(() => {
    delete target.dataset.flash;
  }, FLASH_MS);
  cleanups.set(target, () => window.clearTimeout(timer));
}

export function flashJumpTo(target: HTMLElement): void {
  cleanups.get(target)?.();
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const scroller = scrollAncestorOf(target);
  let last = target.getBoundingClientRect().top;
  let quiet = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    teardown();
    startPulse(target);
  };
  const poll = window.setInterval(() => {
    const top = target.getBoundingClientRect().top;
    if (Math.abs(top - last) < 1) quiet += 1;
    else quiet = 0;
    last = top;
    if (quiet >= 2) finish();
  }, 100);
  const cap = window.setTimeout(finish, 1500); // a no-scroll jump still pulses
  const onEnd = () => finish();
  window.addEventListener('scrollend', onEnd);
  scroller?.addEventListener('scrollend', onEnd);
  const teardown = () => {
    window.clearInterval(poll);
    window.clearTimeout(cap);
    window.removeEventListener('scrollend', onEnd);
    scroller?.removeEventListener('scrollend', onEnd);
  };
  cleanups.set(target, () => {
    done = true;
    teardown();
  });
}
