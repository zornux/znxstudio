import { describe, expect, test } from './harness';
import {
  memberReceiverAt,
  reactiveKindOf,
  reactiveMemberCompletions,
  reactiveMembersAt,
} from '../src/renderer/zoijs/zoijsReactiveMembers';

describe('zoijs reactive members', () => {
  const text =
    'const count = createState(0);\n' +
    'const full = computed(() => count.get());\n' +
    'const router = createRouter({});\n' +
    'const h = effect(() => {});\n' +
    'const other = something.createState(1);\n'; // `.createState` is NOT a factory

  test('infers the reactive kind from the declaration', () => {
    expect(reactiveKindOf(text, 'count')).toBe('state');
    expect(reactiveKindOf(text, 'full')).toBe('computed');
    expect(reactiveKindOf(text, 'router')).toBe('router');
    expect(reactiveKindOf(text, 'h')).toBe('effect');
    expect(reactiveKindOf(text, 'other')).toBeNull(); // method call, not the factory
    expect(reactiveKindOf(text, 'nope')).toBeNull();
  });

  test('memberReceiverAt finds the receiver before "."', () => {
    expect(memberReceiverAt('count.', 6)).toBe('count');
    expect(memberReceiverAt('count.ge', 8)).toBe('count');
    expect(memberReceiverAt('count', 5)).toBeNull();
  });

  test('state members are get/set/peek; set is a snippet', () => {
    const members = reactiveMemberCompletions('state');
    expect(members.map((m) => m.label)).toEqual(['get', 'set', 'peek']);
    const set = members.find((m) => m.label === 'set')!;
    expect(set.insertText).toBe('set(${1:next})');
    expect(set.snippet).toBe(true);
  });

  test('computed = get/peek; router = view..destroy; effect = dispose', () => {
    expect(reactiveMemberCompletions('computed').map((m) => m.label)).toEqual(['get', 'peek']);
    expect(reactiveMemberCompletions('router').map((m) => m.label)).toEqual(['view', 'link', 'go', 'path', 'query', 'match', 'destroy']);
    expect(reactiveMemberCompletions('effect').map((m) => m.label)).toEqual(['dispose']);
  });

  test('reactiveMembersAt: members for a known receiver, [] for unknown, null off-member', () => {
    const src = 'const count = createState(0);\ncount.';
    expect(reactiveMembersAt(src, src.length)!.map((m) => m.label)).toEqual(['get', 'set', 'peek']);
    expect(reactiveMembersAt('foo.', 4)).toEqual([]); // unknown receiver → suppress
    expect(reactiveMembersAt('count', 5)).toBeNull(); // not member position
  });
});
