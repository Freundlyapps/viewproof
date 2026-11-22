import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, mockApi, signedOut } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('shell', () => {
  test('signed out offers Google sign-in', async () => {
    mockApi({ '/api/me': signedOut(), '/api/channels': signedOut() });
    renderAt('/settings');
    const link = await screen.findByRole('link', { name: 'Sign in with Google' });
    expect(link.getAttribute('href')).toBe('/auth/google/start');
  });

  test('navigation in the approved order; unbuilt items say soon', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel()] });
    renderAt('/settings');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const items = within(nav).getAllByRole('link');
    expect(items.map((a) => a.getAttribute('data-label'))).toEqual(['Home', 'Research', 'My channel', 'Optimize video', 'Competitors', 'Ask AI', 'Tools', 'Settings']);
    const soon = items.filter((a) => within(a).queryByText('soon')).map((a) => a.getAttribute('data-label'));
    expect(soon).toEqual(['Optimize video', 'Tools']);
  });

  test('theme toggle flips and remembers', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel()] });
    renderAt('/settings');
    const btn = await screen.findByRole('button', { name: 'Switch light / dark' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await userEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('vp-theme')).toBe('dark');
  });

  test('channel switcher lists channels and remembers the choice', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel(), channel({ id: 'row2', channelId: 'UCbbb', title: 'Second Channel' })] });
    renderAt('/settings');
    const select = await screen.findByRole('combobox', { name: 'Channel' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Quiet Hands Pottery', 'Second Channel']);
    await userEvent.selectOptions(select, 'row2');
    expect(localStorage.getItem('vp-channel')).toBe('row2');
  });

  test('a channel needing reconnect shows a banner with the action', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel({ status: 'reconnect', statusReason: 'Google access was removed or expired' })] });
    renderAt('/settings');
    expect(await screen.findByText('Google access was removed or expired')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconnect' }).getAttribute('href')).toBe('/auth/google/start?choose=1');
  });

  test('no channel connected yet', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [] });
    renderAt('/');
    expect((await screen.findByRole('link', { name: '+ Connect a channel' })).getAttribute('href')).toBe('/auth/google/start?choose=1');
  });

  test('settings links to channel management on the account page', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel()] });
    renderAt('/settings');
    expect((await screen.findByRole('link', { name: 'Manage channels' })).getAttribute('href')).toBe('/account');
  });

  test('a soon page says what it will do, with no made-up data', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel()] });
    renderAt('/tools');
    expect(await screen.findByText(/Tag extractor, chapter checker/)).toBeTruthy();
    expect(screen.getByText('Not built yet')).toBeTruthy();
  });

  test('an unknown address says not found, not "not built yet"', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel()] });
    renderAt('/nope');
    expect(await screen.findByText("This page doesn't exist.")).toBeTruthy();
    expect(screen.queryByText('Not built yet')).toBeNull();
  });
});
