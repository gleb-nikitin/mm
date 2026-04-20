import { describe, test, expect } from 'bun:test';
import { filterMechanical, FILTER_VERSION } from '../src/narrative';

describe('filterMechanical v2: chain-footer awareness', () => {
  test('FILTER_VERSION is 2', () => {
    expect(FILTER_VERSION).toBe(2);
  });

  test('chain-footer emits synthetic marker after role marker', () => {
    const input = [
      'User: hey can you confirm the plan?',
      'Approved. Please proceed with A.',
      '',
      '---',
      'chain: wgj',
      'from: mm_cto',
      'to: mm_devops',
    ].join('\n');

    const out = filterMechanical(input);
    const lines = out.split('\n');
    const roleIdx = lines.findIndex((l) => /^User:/.test(l));
    expect(roleIdx).toBeGreaterThanOrEqual(0);
    expect(lines[roleIdx + 1]).toBe('[chain-msg from=mm_cto to=mm_devops]');
    // Footer and body preserved
    expect(out).toContain('Approved. Please proceed with A.');
    expect(out).toContain('chain: wgj');
    expect(out).toContain('from: mm_cto');
    expect(out).toContain('to: mm_devops');
  });

  test('chain-footer with trailing chain_history field still detected', () => {
    const input = [
      'User: update',
      'WORKING.',
      '',
      '---',
      'chain: wgj',
      'from: mm_devops',
      'to: mm_cto',
      'chain_history: 6 messages, participants: mm_cto,mm_devops',
    ].join('\n');

    const out = filterMechanical(input);
    expect(out).toContain('[chain-msg from=mm_devops to=mm_cto]');
  });

  test('no chain footer preserves v1 behavior', () => {
    const input = [
      'User: plain session turn',
      'some body text',
      'Assistant: reply without footer',
      'more body',
    ].join('\n');

    const out = filterMechanical(input);
    expect(out).not.toContain('[chain-msg');
    expect(out).toContain('plain session turn');
    expect(out).toContain('some body text');
    expect(out).toContain('reply without footer');
    expect(out).toContain('more body');
  });

  test('multiple messages — only the one with a footer gets a marker', () => {
    const input = [
      'User: first turn no footer',
      'body 1',
      'Assistant: reply',
      'body 2',
      '',
      '---',
      'chain: abc',
      'from: mm_cto',
      'to: mm_devops',
    ].join('\n');

    const out = filterMechanical(input);
    const markers = out.match(/\[chain-msg from=\S+ to=\S+\]/g) ?? [];
    expect(markers.length).toBe(1);
    expect(markers[0]).toBe('[chain-msg from=mm_cto to=mm_devops]');
  });

  test('filler turn with a footer is still skipped (no orphan marker)', () => {
    const input = [
      'User: OK',
      '',
      '---',
      'chain: abc',
      'from: ac_ceo',
      'to: mm_devops',
      'Assistant: next',
    ].join('\n');

    const out = filterMechanical(input);
    // The "OK" turn is filler — role marker dropped, so the synthetic marker
    // should not appear detached from a role marker.
    const lines = out.split('\n');
    const markerIdx = lines.findIndex((l) => l === '[chain-msg from=ac_ceo to=mm_devops]');
    if (markerIdx >= 0) {
      expect(lines[markerIdx - 1]).toMatch(/^User:|^Assistant:|^Human:|^A:/);
    }
  });
});
