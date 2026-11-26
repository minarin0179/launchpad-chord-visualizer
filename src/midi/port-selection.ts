/**
 * MIDI ポートの選択（純粋関数）。
 * 出力ポートはユーザーが選び、対応する入力ポートは名前から推測する。
 */
export interface PortInfo {
  readonly id: string;
  readonly name: string;
}

export interface OutputChoice {
  /** 最後にユーザーが選んだポート名。null = 未保存、'' = 「未選択」を選んだ */
  readonly preferredName: string | null;
  /** いま選択中のポート */
  readonly currentId: string | null;
}

const LAUNCHPAD_KEYWORD = 'launchpad';
const INPUT_KEYWORDS = ['launchpad', 'lpx'];

/**
 * 自動で選ぶ出力ポート。優先順:
 * 1. 最後にユーザーが選んだ名前のポート
 * 2. 名前に "launchpad" を含むポート
 * 3. 直前に選択していたポート
 * ユーザーが「未選択」を選んでいた場合（preferredName = ''）は、1・2 では自動接続しない。
 */
export function chooseOutput(
  outputs: readonly PortInfo[],
  { preferredName, currentId }: OutputChoice,
): string | null {
  if (preferredName) {
    const saved = outputs.find((output) => output.name === preferredName);
    if (saved) return saved.id;
  }
  if (preferredName !== '') {
    const launchpad = outputs.find((output) =>
      output.name.toLowerCase().includes(LAUNCHPAD_KEYWORD),
    );
    if (launchpad) return launchpad.id;
  }
  return outputs.some((output) => output.id === currentId) ? currentId : null;
}

/** 入力ポートをどの規則で見つけたか（ログ用） */
export type InputMatchStrategy =
  'midiin' | 'swap' | 'same-name' | 'base-name' | 'keyword' | 'fallback';

export interface InputMatch<P extends PortInfo> {
  readonly input: P;
  readonly strategy: InputMatchStrategy;
}

/** Windows の "MIDIOUT2 (LPX MIDI)" 形式 */
const WINDOWS_OUT_NAME = /^MIDIOUT(\d+)\s*\((.+)\)$/i;
const IN_OUT_WORD = /\b(In|Out)\b/g;
const PARENTHESIZED = /\((.+)\)/;

/** 出力ポートに対応する入力ポートを名前から探す（OS ごとに命名が違うので規則を順に試す） */
export function matchInput<P extends PortInfo>(
  output: PortInfo,
  inputs: readonly P[],
): InputMatch<P> | null {
  const first = inputs.at(0);
  if (!first) return null;
  const byName = (name: string): P | undefined => inputs.find((input) => input.name === name);

  // 1. Windows: "MIDIOUT<N> (base)" → "MIDIIN<N> (base)"
  const windows = WINDOWS_OUT_NAME.exec(output.name);
  const midiIn = windows && byName(`MIDIIN${windows[1]} (${windows[2]})`);
  if (midiIn) return { input: midiIn, strategy: 'midiin' };

  // 2. In ↔ Out の入れ替え（"LPX MIDI Out" → "LPX MIDI In"）
  const swappedName = output.name.replace(IN_OUT_WORD, (word) => (word === 'In' ? 'Out' : 'In'));
  const swapped = swappedName === output.name ? undefined : byName(swappedName);
  if (swapped) return { input: swapped, strategy: 'swap' };

  // 3. 出力と同じ名前
  const sameName = byName(output.name);
  if (sameName) return { input: sameName, strategy: 'same-name' };

  // 4. 括弧内のベース名（"MIDIOUT2 (LPX MIDI)" → "LPX MIDI"）
  const base = PARENTHESIZED.exec(output.name)?.[1];
  const baseName =
    base === undefined ? undefined : inputs.find((input) => input.name.includes(base));
  if (baseName) return { input: baseName, strategy: 'base-name' };

  // 5. 名前に "launchpad" / "lpx" を含む入力
  const keyword = inputs.find((input) =>
    INPUT_KEYWORDS.some((word) => input.name.toLowerCase().includes(word)),
  );
  if (keyword) return { input: keyword, strategy: 'keyword' };

  // どれにも当てはまらなければ最初の入力
  return { input: first, strategy: 'fallback' };
}
