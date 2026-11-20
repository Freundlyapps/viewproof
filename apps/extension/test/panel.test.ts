// @vitest-environment happy-dom
import type { Scorecard } from '@viewproof/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { renderPanel } from '../src/panel';

const card: Scorecard = {
  platform: 'youtube', videoId: 'vid00000001', title: 'Test video', age: { kind: 'value', value: 72, formula: 'hours since publishing', inputs: {} }, tags: ['pottery', 'bowl'],
  vph: { kind: 'value', value: 1240, formula: 'views ÷ hours since upload (average)', inputs: { mode: 'since_upload', views: 90000, hours: 72 } },
  outlier: { kind: 'value', value: 3, formula: '…', inputs: { views: 90000, baselineMedian: 30000, baselineCount: 5, mixedFormats: false, negative: false } },
};
const text = (h: HTMLElement) => h.shadowRoot!.textContent ?? '';

describe('renderPanel', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.documentElement.removeAttribute('dark');
    host = document.createElement('div');
    document.body.append(host);
  });

  test('renders values and why-line', () => {
    renderPanel(host, { kind: 'ok', card });
    const t = text(host);
    for (const s of ['ViewProof', 'Views / hour', '1,240', 'avg since upload', 'vs usual', '×3', 'Age', '3 days', 'Tags', 'pottery']) expect(t).toContain(s);
    expect(t).toContain('Why ×3? 90,000 views; this channel usually gets 30,000 (median of 5 earlier videos).');
    expect(t).toContain('Views / hour: 90,000 views ÷ 72 h since upload.');
  });

  test('mixed formats are mentioned', () => {
    const c = { ...card, outlier: { ...card.outlier, inputs: { ...(card.outlier as { inputs: object }).inputs, mixedFormats: true } } } as Scorecard;
    renderPanel(host, { kind: 'ok', card: c });
    expect(text(host)).toContain('(Shorts and long videos mixed)');
  });

  test('renders no data with reason', () => {
    renderPanel(host, { kind: 'ok', card: { ...card, outlier: { kind: 'no_data', reason: 'Needs 5 earlier videos of the same type; found 4' } } });
    const t = text(host);
    expect(t).toContain('No data');
    expect(t).toContain('Needs 5 earlier videos of the same type; found 4');
    expect(t).toContain('1,240');
  });

  test('renders parse failure', () => {
    renderPanel(host, { kind: 'error', reason: 'videoDetails.viewCount missing' });
    expect(text(host)).toContain("Couldn't read this page. YouTube may have changed something.");
  });

  test('uses dark tokens when YouTube is dark', () => {
    document.documentElement.setAttribute('dark', '');
    renderPanel(host, { kind: 'ok', card });
    expect(host.shadowRoot!.querySelector('.vp')!.getAttribute('data-theme')).toBe('dark');
  });

  test('re-render replaces content, one shadow root', () => {
    renderPanel(host, { kind: 'ok', card });
    renderPanel(host, { kind: 'ok', card: { ...card, title: 'Second' } });
    expect(host.shadowRoot!.querySelectorAll('.vp')).toHaveLength(1);
    expect(text(host)).toContain('Second');
  });

  test('titles and tags are text, not HTML', () => {
    renderPanel(host, { kind: 'ok', card: { ...card, title: '<img src=x onerror=alert(1)>', tags: ['<b>x</b>'] } });
    expect(host.shadowRoot!.querySelector('img')).toBeNull();
    expect(host.shadowRoot!.querySelector('b')).toBeNull();
  });

  test('delta VPH explains the visits it compares', () => {
    renderPanel(host, { kind: 'ok', card: { ...card, vph: { kind: 'value', value: 4276, formula: '…', inputs: { mode: 'delta', viewDelta: 12400, hours: 2.9 } } } });
    expect(text(host)).toContain('Views / hour: +12,400 views over 2.9 h between your visits.');
  });

  test('pending feed shows loading for ×N only', () => {
    renderPanel(host, { kind: 'ok', card, outlierPending: true });
    const t = text(host);
    expect(t).toContain('Loading');
    expect(t).not.toContain('Why ×3');
    expect(t).toContain('1,240');
  });

  test('scheduled video: age shows the reason', () => {
    renderPanel(host, { kind: 'ok', card: { ...card, age: { kind: 'no_data', reason: 'Not published yet' } } });
    expect(text(host)).toContain('Not published yet');
  });

  test('loading state replaces the previous video', () => {
    renderPanel(host, { kind: 'ok', card });
    renderPanel(host, { kind: 'loading' });
    expect(text(host)).not.toContain('Test video');
    expect(text(host)).toContain('Loading');
  });
});
