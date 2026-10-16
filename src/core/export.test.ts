import { describe, expect, it } from 'vitest';
import { addTry, addUsage, checkOut, initialState, startBreak, startWork, type Outcome, type State } from './model';
import { csvCell, streak, toCsv } from './export';

const T0 = new Date(2026, 9, 14, 9, 0).getTime(); // Wednesday
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function session(s: State, start: number, mins: number, outcome: Outcome, goal = 'g'): State {
  return checkOut(startWork(s, goal, start), outcome, '', start + mins * MIN);
}

describe('csv', () => {
  it('quotes what needs it and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell(42)).toBe('42');
  });

  it('writes finished sessions oldest first with work, breaks, programs and tries', () => {
    let s = startWork(initialState(T0), 'Fix sync, finally', T0);
    s = addUsage(s, { 'code.exe': 40 * MIN, 'chrome.exe': 5 * MIN });
    s = addTry(s, 'steam.exe');
    s = startBreak(s, 10, T0 + 20 * MIN);
    s = checkOut(s, 'done', 'Write tests', T0 + 60 * MIN);
    s = session(s, T0 + DAY, 30, 'not', 'Second');
    const lines = toCsv(s.log).split('\r\n');
    expect(lines[0]).toBe('date,start,end,worked_min,break_min,at_pc_min,goal,outcome,next,top_programs,blocked');
    expect(lines[1]).toBe('2026-10-14,09:00,10:00,50,10,45,"Fix sync, finally",Done,Write tests,code 40m; chrome 5m,steam x1');
    expect(lines[2]).toBe('2026-10-15,09:00,09:30,30,0,0,Second,Not done,,,');
    expect(lines[3]).toBe('');
  });
});

describe('streak', () => {
  it('counts work days in a row with a done session', () => {
    let s = initialState(T0);
    // Fri, Mon, Tue, Wed (today) done; the weekend in between is not a work day.
    for (const d of [-5, -2, -1, 0]) s = session(s, T0 + d * DAY, 30, 'done');
    expect(streak(s.log, T0 + 2 * 60 * MIN, [1, 2, 3, 4, 5])).toBe(4);
    // Every day counts: the weekend breaks it.
    expect(streak(s.log, T0 + 2 * 60 * MIN, null)).toBe(3);
  });

  it('is not broken by today before it is over, but by a missed work day', () => {
    let s = initialState(T0);
    s = session(s, T0 - DAY, 30, 'done'); // Tuesday
    expect(streak(s.log, T0, [1, 2, 3, 4, 5])).toBe(1);
    expect(streak(s.log, T0 + DAY, [1, 2, 3, 4, 5])).toBe(0); // Wednesday missed
    s = session(s, T0 + DAY, 30, 'partly'); // only partly on Thursday
    expect(streak(s.log, T0 + DAY + 60 * MIN, [1, 2, 3, 4, 5])).toBe(0);
    expect(streak([], T0, [])).toBe(0);
  });
});
