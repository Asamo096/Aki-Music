// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_FONT_STACKS,
  buildFontFamilyCss,
  describeLyricsFont,
  normalizeFontFamilyStack,
  resolveLyricsFontFamily,
} from '@/settings/fontStacks';
import { isFontFamilyAvailable } from '@/settings/fontAvailability';

/* ───────────────── 字体栈归一化与转义 ───────────────── */

describe('normalizeFontFamilyStack', () => {
  it('去空、去引号、大小写不敏感去重、保序', () => {
    expect(
      normalizeFontFamilyStack([
        '"Inter"',
        ' inter ',
        '',
        null,
        '宋体',
        undefined,
        "'SimSun'",
      ])
    ).toEqual(['Inter', '宋体', 'SimSun']);
  });

  it('空输入返回空数组', () => {
    expect(normalizeFontFamilyStack(null)).toEqual([]);
    expect(normalizeFontFamilyStack(undefined)).toEqual([]);
  });
});

describe('buildFontFamilyCss', () => {
  it('含空格的名字加引号，通用族不加引号', () => {
    expect(buildFontFamilyCss(['Microsoft YaHei', 'sans-serif'])).toBe(
      '"Microsoft YaHei", sans-serif'
    );
  });

  it('名字里的引号被转义', () => {
    expect(buildFontFamilyCss(['A"B'])).toBe('"A\\"B"');
  });

  it('空数组 → 空串（调用方需自行兜底）', () => {
    expect(buildFontFamilyCss([])).toBe('');
  });
});

/* ───────────────── 设置 → CSS 栈 ───────────────── */

describe('resolveLyricsFontFamily', () => {
  it('默认/未知预设都用应用自带字体（保持改造前观感）', () => {
    expect(resolveLyricsFontFamily(null)).toBe('Barlow');
    expect(resolveLyricsFontFamily(undefined)).toBe('Barlow');
    expect(resolveLyricsFontFamily({})).toBe('Barlow');
    expect(resolveLyricsFontFamily({ lyricsFontPreset: 'app' })).toBe('Barlow');
    expect(resolveLyricsFontFamily({ lyricsFontPreset: '不知道' })).toBe(
      'Barlow'
    );
  });

  it('三个系统预设各自带上正确的通用族兜底', () => {
    expect(resolveLyricsFontFamily({ lyricsFontPreset: 'sans' })).toBe(
      BUILTIN_FONT_STACKS.sans
    );
    expect(resolveLyricsFontFamily({ lyricsFontPreset: 'serif' })).toContain(
      'serif'
    );
    expect(resolveLyricsFontFamily({ lyricsFontPreset: 'mono' })).toContain(
      'monospace'
    );
  });

  it('自定义字体插到最前，后面仍保留应用字体与通用族（缺字有回落）', () => {
    const stack = resolveLyricsFontFamily({
      lyricsFontPreset: 'custom',
      lyricsFontFamily: 'Source Han Serif',
    });
    expect(stack.startsWith('"Source Han Serif"')).toBe(true);
    expect(stack).toContain('Barlow');
    expect(stack.endsWith('sans-serif')).toBe(true);
  });

  it('自定义但没选字体 → 回落应用字体，不产生空 font-family', () => {
    expect(
      resolveLyricsFontFamily({
        lyricsFontPreset: 'custom',
        lyricsFontFamily: null,
      })
    ).toBe('Barlow');
    expect(
      resolveLyricsFontFamily({
        lyricsFontPreset: 'custom',
        lyricsFontFamily: '   ',
      })
    ).toBe('Barlow');
  });

  it('自定义与应用字体同名时不重复出现', () => {
    const stack = resolveLyricsFontFamily({
      lyricsFontPreset: 'custom',
      lyricsFontFamily: 'Barlow',
    });
    expect(stack.match(/Barlow/g)).toHaveLength(1);
  });
});

describe('describeLyricsFont', () => {
  it('预设给标签、自定义给字体名', () => {
    expect(describeLyricsFont({ lyricsFontPreset: 'app' })).toBe('跟随应用');
    expect(describeLyricsFont({ lyricsFontPreset: 'serif' })).toBe('宋体');
    expect(
      describeLyricsFont({
        lyricsFontPreset: 'custom',
        lyricsFontFamily: 'LXGW WenKai',
      })
    ).toBe('LXGW WenKai');
    expect(describeLyricsFont({ lyricsFontPreset: 'custom' })).toBe('自定义');
  });
});

/* ───────────────── 可用性探测 ───────────────── */

describe('isFontFamilyAvailable', () => {
  it('空名字不可用', () => {
    expect(isFontFamilyAvailable('')).toBe(false);
    expect(isFontFamilyAvailable('   ')).toBe(false);
  });

  it('通用族一律可用', () => {
    expect(isFontFamilyAvailable('sans-serif')).toBe(true);
    expect(isFontFamilyAvailable('system-ui')).toBe(true);
  });

  it('无 DOM 环境不做判断（返回 true，宁可漏报不误报）', () => {
    // 单测跑在 node 环境，没有 document —— 与浏览器里"无法测量"同一条分支
    expect(typeof document).toBe('undefined');
    expect(isFontFamilyAvailable('绝对不存在的字体名字')).toBe(true);
  });
});
