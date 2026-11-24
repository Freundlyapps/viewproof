import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, mockApi } from './fake-api';
import { fakeExtension } from './fake-extension';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const ID = 'dQw4w9WgXcQ';
const VIDEO = { videoId: ID, title: 'Throwing a mug', channelId: 'UC1', tags: ['pottery', 'wheel throwing', 'mug'], description: '0:00 Intro\n0:30 Centering\n2:00 Pulling', lengthSeconds: 300 };
let ext: ReturnType<typeof fakeExtension> | null = null;
afterEach(() => { ext?.remove(); ext = null; });
const api = () => mockApi({ '/api/me': ME, '/api/channels': [channel()] });

describe('Tools', () => {
  test('nav opens the real Tools page with four tabs', async () => {
    api();
    renderAt('/tools');
    expect(await screen.findByRole('heading', { name: 'Tools' })).toBeTruthy();
    for (const t of ['Tags', 'Chapters', 'Transcripts', 'Calculators']) expect(screen.getByRole('tab', { name: t })).toBeTruthy();
    expect(screen.queryByText(/Coming/)).toBeNull();
  });

  test('tags: a pasted link is looked up through the extension; tags, total and chapters handoff', async () => {
    api();
    ext = fakeExtension({ video: () => ({ ok: true, video: VIDEO }) });
    renderAt('/tools/tags');
    await userEvent.type(await screen.findByLabelText('YouTube video link or id'), `https://youtu.be/${ID}?si=x`);
    await userEvent.click(screen.getByRole('button', { name: 'Get tags' }));
    const list = await screen.findByRole('list', { name: 'Tags of Throwing a mug' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['pottery', 'wheel throwing', 'mug']);
    expect(screen.getByText('3 tags · 28 of 500 characters')).toBeTruthy();
    expect(ext.lookups).toEqual([ID]);
    await userEvent.click(screen.getByRole('button', { name: 'Check its chapters' }));
    expect(await screen.findByText('3 chapters follow YouTube\'s rules.')).toBeTruthy();
  });

  test('tags: a video without tags says so; a refusal shows the reason; a bad link is caught first', async () => {
    api();
    let answer: unknown = { ok: true, video: { ...VIDEO, tags: [] } };
    ext = fakeExtension({ video: () => answer });
    renderAt('/tools/tags');
    const box = await screen.findByLabelText('YouTube video link or id');
    await userEvent.type(box, 'not a link');
    await userEvent.click(screen.getByRole('button', { name: 'Get tags' }));
    expect(await screen.findByText("That isn't a YouTube video link.")).toBeTruthy();
    expect(ext.lookups).toEqual([]);
    await userEvent.clear(box);
    await userEvent.type(box, ID);
    await userEvent.click(screen.getByRole('button', { name: 'Get tags' }));
    expect(await screen.findByText('This video has no tags.')).toBeTruthy();
    answer = { ok: false, reason: 'Lookup limit reached (30 per hour); try again in 5 minutes.' };
    await userEvent.click(screen.getByRole('button', { name: 'Get tags' }));
    expect(await screen.findByText('Lookup limit reached (30 per hour); try again in 5 minutes.')).toBeTruthy();
  });

  test('tags without the extension explains how to get it', async () => {
    api();
    renderAt('/tools/tags');
    await userEvent.type(await screen.findByLabelText('YouTube video link or id'), ID);
    await userEvent.click(screen.getByRole('button', { name: 'Get tags' }));
    expect(await screen.findByText(/needs the ViewProof browser extension/, {}, { timeout: 3000 })).toBeTruthy();
  });

  test('chapters: valid list, or the first broken rule', async () => {
    api();
    renderAt('/tools/chapters');
    const desc = await screen.findByLabelText('Description');
    await userEvent.type(desc, '0:00 Intro{enter}0:30 Centering{enter}2:00 Pulling');
    expect(await screen.findByText("3 chapters follow YouTube's rules.")).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Chapters' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['0:00 Intro', '0:30 Centering', '2:00 Pulling']);
    await userEvent.type(screen.getByLabelText('Video length (optional, e.g. 12:30)'), '2:05');
    expect(await screen.findByText('Each chapter must be at least 10 seconds ("Pulling")')).toBeTruthy();
    await userEvent.clear(desc);
    await userEvent.type(desc, '0:10 Intro');
    expect(await screen.findByText('First timestamp must be 0:00')).toBeTruthy();
  });

  test('transcripts: lists what this browser read; open, search and copy text', async () => {
    api();
    ext = fakeExtension({ transcripts: [{ videoId: ID, title: 'Throwing a mug', savedAt: Date.parse('2026-11-23T10:00:00Z'), segments: [{ startSec: 0, text: 'Welcome back' }, { startSec: 65, text: 'Now centre the clay' }] }] });
    renderAt('/tools/transcripts');
    await userEvent.click(await screen.findByRole('button', { name: 'Throwing a mug' }));
    expect(screen.getByText('Welcome back')).toBeTruthy();
    const time = screen.getByRole('link', { name: '1:05' });
    expect(time.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${ID}&t=65s`);
    await userEvent.type(screen.getByLabelText('Find in transcript'), 'clay');
    expect(screen.queryByText('Welcome back')).toBeNull();
    expect(screen.getByText('1 of 2 lines')).toBeTruthy();
  });

  test('transcripts: empty list explains how to add one', async () => {
    api();
    ext = fakeExtension({ transcripts: [] });
    renderAt('/tools/transcripts');
    expect(await screen.findByText(/No transcripts yet/)).toBeTruthy();
    expect(screen.getByText(/Show transcript/)).toBeTruthy();
  });

  test('calculators work only on typed numbers and explain bad input', async () => {
    api();
    renderAt('/tools/calculators');
    await userEvent.type(await screen.findByLabelText('Views', { selector: '#er-views' }), '2000');
    await userEvent.type(screen.getByLabelText('Likes'), '90');
    await userEvent.type(screen.getByLabelText('Comments'), '10');
    expect(screen.getByText('Engagement rate: 5%')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Views', { selector: '#er-views' }));
    await userEvent.type(screen.getByLabelText('Views', { selector: '#er-views' }), '0');
    expect(screen.getByText('Views must be more than 0.')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Views', { selector: '#wt-views' }), '1200');
    await userEvent.type(screen.getByLabelText('Average view duration (m:ss)'), '3:00');
    expect(screen.getByText('Watch time: 60 hours')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Views', { selector: '#avd-views' }), '1200');
    await userEvent.type(screen.getByLabelText('Watch time (hours)'), '60');
    expect(screen.getByText('Average view duration: 3:00')).toBeTruthy();
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
  });

  test('calculators read German and English separators, and refuse ambiguous input with a reason', async () => {
    api();
    renderAt('/tools/calculators');
    await userEvent.type(await screen.findByLabelText('Views', { selector: '#er-views' }), '100.000');
    await userEvent.type(screen.getByLabelText('Likes'), '4.900');
    await userEvent.type(screen.getByLabelText('Comments'), '100');
    expect(screen.getByText('Engagement rate: 5%')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Views', { selector: '#avd-views' }), '1.200');
    await userEvent.type(screen.getByLabelText('Watch time (hours)'), '2,5');
    expect(screen.getByText('Average view duration: 0:08')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Watch time (hours)'));
    await userEvent.type(screen.getByLabelText('Watch time (hours)'), '1,000');
    expect(screen.getByText('Write the watch time as a plain number, like 1000 or 2.5.')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Likes'));
    await userEvent.type(screen.getByLabelText('Likes'), '2,5');
    expect(screen.getByText('Likes must be a whole number, 0 or more.')).toBeTruthy();
  });
});
